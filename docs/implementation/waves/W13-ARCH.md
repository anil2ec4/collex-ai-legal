# W13 — Lane ARCH: architecture, shape review, packaging

Date: **02.09.2026**. Lane: read-only audit. Nothing in this repository was
modified except this file. No git operation, no Supabase/Resend, no `.env`
read, no write to `collex_local`, no server started, no port bound.

**Evidence markers used below**
- `[ölçüldü]` — I ran it on this machine today and the output is quoted.
- `[kodda]` — read directly in the source, with `file:line`.
- `[çıkarım]` — my inference from the two above; argued, not measured.

**What I ran** (all read-only, all offline):
1. an import-graph/cycle scan over all 91 `control-plane/src/**/*.ts`
   (scratchpad `deps.mjs`);
2. two entailment probes through the real `LexicalEntailmentPort` via
   `scripts/ts-loader.mjs` (scratchpad `entail-probe.mjs`,
   `entail-probe2.mjs`) — these reproduce the W12-B2 §3.3 finding exactly;
3. read-only `psql` `SELECT`s against `collex_local` (counts only, no writes).

---

## 0. The three facts that frame everything else

**F1 — `collex_local` is empty.** `[ölçüldü]`

```
$ psql -p 55432 -U postgres -d collex_local -tAc
    "select 'matters',count(*) from app_private.matters
     union all select 'answers',count(*) from app_private.answers
     union all select 'drafts', count(*) from app_private.drafts
     union all select 'migrations',count(*) from app_private.schema_migrations
     union all select 'documents',count(*) from legal.documents;"
matters|0
answers|0
drafts|0
migrations|11
documents|0
$ ... -tAc "select count(*) from legal.chunks;"
0
```

The persistent product database has the full schema (11/11 migrations) and
**zero rows of every kind**. The product has never held a real matter, a real
answer, a real draft or a single document. STATUS.md already says the corpus
is absent by design ("`collex_local`'da sentetik korpus yoktur"); what the
probe adds is that the *workspace* is empty too. Every judgement about
"unhelpful results" below is therefore about the code path, not about
observed lawyer usage — and the first thing that should happen after W13 is a
week of the lawyer actually using it on one real matter.

Consequence for the roadmap: **the "Yerel korpus" research mode returns
nothing on the real install today.** Only "Yüklediğim belgeler" and "Canlı
kaynaklar" can produce evidence. A "real search screen" built against the
local corpus would search an empty table.

**F2 — three runtimes, one product.** `[kodda]` A single answer touches
Node (control-plane), Python (MCP gateway / intake / export) and PostgreSQL.
Python is not optional: uploads (`intake.cli`), DOCX/UDF export
(`export.cli`), schema creation (`intake.cli --ensure-db`) and live research
(`serve-mcp.mjs` → `uvicorn asgi_app`) all shell out to
`.venv/Scripts/python.exe`. Any packaging answer that assumes "just ship
Node" is wrong.

**F3 — there is no backup path anywhere.** `[ölçüldü]`

```
$ grep -rin "backup|yedek|pg_dump" control-plane/src control-plane/scripts \
      ingestion intake export *.cmd
(no matches)
```

A product that holds a solo lawyer's case files, uploaded evidence
(`var/uploads/`) and drafts, and has **no** backup, restore or export-all
path, is one `pgdata` corruption away from total loss. This is the single
highest-severity structural finding in this report (S1 below).

---

## 1. The architecture as it actually is

### 1.1 Processes and boundaries

```
  ┌─ ColleX-Baslat.cmd ────────────────────────────────────────────────┐
  │ 1 pg_ctl start (scoop PostgreSQL 18, 127.0.0.1:55432)              │
  │ 2 .venv python -m intake.cli --ensure-db   (creates + migrates)    │
  │ 3 start "ColleX Sunucu" node serve.mjs --port 8787 --with-mcp      │
  │ 4 poll /v1/health ≤60 s → open browser                             │
  └────────────────────────────────────────────────────────────────────┘

  browser (127.0.0.1:8787, no auth)
     │  fetch, JSON only, CSP default-src 'none'
     ▼
  ┌ node serve.mjs (SINGLE process, single worker — required) ────────┐
  │  hono app (src/api/server.ts, composition root)                   │
  │    ├ inline routes: /, /console, /v1/health, /v1/search,          │
  │    │                /v1/answer, /v1/answers*, /v1/evidence-bundle,│
  │    │                /v1/research-runs*                            │
  │    └ mounted routers: files · drafting · research · matters ·     │
  │                       settings · deadlines · ai                   │
  │  ts-loader.mjs transpiles .ts on import (NO build step)           │
  │  postgres.js pool (max 5) ──────────────► PostgreSQL collex_local │
  │  child_process ─► .venv python -m intake.cli   (upload / delete)  │
  │  child_process ─► .venv python -m export.cli   (DOCX / UDF)       │
  │  child_process ─► node serve-mcp.mjs ─► uvicorn asgi_app (8898)   │
  │                     token via MCP_API_TOKEN env, never argv       │
  └───────────────────────────────────────────────────────────────────┘
                                        │ JSON-RPC 2.0 over streamable HTTP
                                        ▼
                              FastMCP app — 54 tools ─► resmî kaynaklar
                                        (only lane that leaves the machine,
                                         plus /v1/ai → api.anthropic.com)
```

Boundary quality: **good**. Three things are enforced, not merely intended —
the token never reaches a command line, child stderr never reaches an HTTP
body (`correlationId` instead), and the console's CSP is derived from the
served file's own inline blocks by SHA-256
(`src/api/consolePage.ts:59-74`). `[kodda]`

### 1.2 The TypeScript module map (91 files, 34,179 lines)

Layers, from the bottom up. Fan-in measured by the import scan `[ölçüldü]`:

| layer | modules | LOC | notes |
|---|---|---:|---|
| **contracts** | `evidence/types.ts` (fan-in 13), `capabilities/types.ts` (8), `llm/ports.ts` (7), `pipeline/ports.ts` | 55 + … | tiny, stable, correct |
| **primitives** | `retrieval/normalize.ts` (**fan-in 16 — the most depended-on module in the repo**), `retrieval/referenceParser.ts` (12), `verification/validator.ts` (8), `verification/finalize.ts` | 2 794 (retrieval) + 305 | |
| **store** | `store/db.ts` (12), `chunkStore.ts` (1 124), `answerStore.ts`, `draftStore.ts`, `health.ts` | 2 178 | |
| **retrieval** | `hybrid.ts` (1 272: 4 lanes + RRF + diversity + citation + citator + divergence), `searchService.ts` | | |
| **evidence/answer** | `answer/evidencePack.ts` (fan-in 13), `coverage.ts`, `verifier.ts`, `renderer.ts` | 2 067 | |
| **generation** | `llm/ruleDrafter.ts`, `lexicalEntailment.ts`, `anthropicAdapter.ts` (1 006) | 1 475 | |
| **orchestration** | `orchestration/executor.ts` (8), `planner/*` (intake, rulePlanner, templates 805, contrary, outcomes) | 2 945 | |
| **pipeline** | `pipeline/answerPipeline.ts` (1 455) + stance/intent/tamper/storeAdapters | 2 600 | |
| **features** | `drafting/` **6 265**, `research/` 3 350, `ai/` 1 767, `deadlines/` 1 749, `matters/` 1 326, `files/` 928, `settings/` 293 | | |
| **api** | `api/server.ts` (1 134) + consolePage/consoleGuard/matterLink/healthReport/answerService | 2 218 | |
| **UI** | `public/console.html` — **8 634 lines / 393 KB**, 1 `<style>`, 1 `<script>`, 1 IIFE, 267 functions | | |

**Cycles: zero.** `[ölçüldü]` No import cycle exists at file level, either over
value imports or including `import type`. That is unusual and worth
protecting with a test.

**Directory-level cycles (4), all benign but all worth naming** `[kodda]`:

| edge pair | why | verdict |
|---|---|---|
| `retrieval/hybrid.ts` → `pipeline/{stance,questionIntent}.ts` and `pipeline/*` → `retrieval/*` | retrieval needs the stance/intent classifiers | `stance.ts` + `questionIntent.ts` are pure classifiers over document text; they belong in `retrieval/` or a new `classify/`, not in `pipeline/` |
| `store/answerStore.ts:38` → `api/answerService.ts` and `api/*` → `store/*` | the `AnswerStore` interface + `InMemoryAnswerStore` live in `api/` | move the contract to `store/answerContract.ts`; `api/` should not be a dependency of `store/` |
| `matters/routes.ts:38` → `api/answerService.ts` | same cause | same fix |
| `capabilities/types.ts:10` → `retrieval/referenceParser.ts` | the Outcome taxonomy imports `ParsedReference` | type-only; harmless, but it makes the "contracts" layer depend on a 884-line parser |

One more layering smell: `api/consoleGuard.ts:40` imports `guardAnswerMarkdown`
from `pipeline/answerPipeline.ts` — a security helper re-exported from the
1 455-line pipeline. It should live in `security/renderGuard.ts` (where its
sibling `sanitizeAnswerMarkdown` already is) and be imported by both.

### 1.3 The five journeys

**(A) Answer — `POST /v1/answer`** (`answerPipeline.ts`, 12 traced stages)

```
intake (validate + issues)  → normalize → parseReferences → intent
 → plan (primary + ≤4 contrary lanes, planner/contrary.ts)
 → retrieve  (CorpusRetrievalPort → searchLegalCorpus → searchPipeline
              → chunkStore lanes: exact-pin | turkish FTS coverage |
                pg_trgm word_similarity | citator | citation-expansion)
 → rank + NORM_CONTENT scoping + coverageAwareCap(8)
 → versionFacts → evidence (buildEvidencePack: RE-SLICE canonical text at
   stored code-point offsets, sha256, quote cap 4 000 cp)
 → coverage gate (floor 0.4; per-passage admission under bypass;
   structural closure over relation/citation/contrary edges)
 → draft (RuleBasedDrafter, or cloud on per-request consent)
 → verify (validateEvidence per citation → entailment per pair →
   confidence → conflicts → canFinalize)
 → degrade (primaryFailed | drafterFailed | budgetExceeded → PARTIAL)
 → render (markdown + evidence bundle, both through the render guard)
```

**(B) Live research — `POST /v1/research/start` → 202 + progress**

```
intake → selectTemplate (5 templates) → createLiveResearchPlanner
 → executor (budgets 24 steps / 10 fetches / 120 s, idempotency keys)
   phase 1 searches: planNextDecision (rulePlanner, PURE)
   phase 2 fetches:  selectFetchTargets — contrary lane gets a reserved slot
   phase 3 follow-ups: E./K. parsed out of fetched text (≤3), gap round 2
 → gateway (mcpSession: initialize → Mcp-Session-Id → tools/call, 85 s)
 → payloads.ts normalizes each provider shape into typed hits
 → liveEvidence → buildEvidencePack → the SAME verifier/renderer as (A)
 → answer store (durable); progress registry in-memory (16 runs, 30 min TTL)
```

**(C) File intake — `POST /v1/files`** (multipart ≤40 MiB, file ≤25 MiB)
→ temp file → `child_process` `.venv python -X utf8 -m intake.cli --dsn … --file … --json`
(`files/routes.ts:489`) → quarantine (magic bytes, ZIP bomb) → extract
(PDF/DOCX/TXT/UDF, OCR fail-closed, per-page text-layer gate) → the SAME
ingestion pipeline as the corpus (`scope='tenant'`, `fileId = sha256[:16]`,
`MAX_GENERIC_CHUNK_CHARS = 4000`) → `legal.*` rows + original under
`var/uploads/` → 180 s budget → `504 UPLOAD_TIMEOUT`.

**(D) Draft — `POST /v1/drafts`** → template (13, each with a `domain`) →
`drafting/input.ts` normalize → `evidence.ts` resolve `runId`/`fileIds` →
**`relevance.ts` gate** (domain × lexical overlap vs the matter, ADR-022) →
`composer.ts` → sections/paragraph roles (beyan / bound / KAYNAKSIZ) →
`draftStore` (one row per version) → `PUT` with `baseVersion` → 409 on
conflict → `/export?format=md|docx|udf` → for docx/udf a `child_process`
`export.cli` (`drafting/routes.ts:693`) which **refuses** to export an
unverifiable citation.

**(E) Deadline — `POST /v1/deadlines/compute`** — pure TS, no I/O, no store:
`dates.ts` (strict parse, HMK m.92/2 month clamp) + `holidays.ts` (2429 s.K.
+ dini bayram 2025–2028 as data + adli tatil) + `rules.ts` (30 rules, **all
`dogrulanmadi`**) → `calc.ts` → verbatim `DEADLINE_DISCLAIMER`. This is the
cleanest lane in the product and the only one with no dependency on anything
else. It is also the one whose *content* is unverified — a nice illustration
that structural quality and legal quality are independent axes.

---

## 2. Structural risks, ranked

Severity is for **this** product: one lawyer, one machine, real case files.

### S1 · P0 — No backup, no restore, no export-all `[ölçüldü]`

The lawyer's matters, answers, drafts and settings live in `collex_local`;
their uploaded originals live in `var/uploads/` **inside the repo folder**.
Nothing in the product copies either. A `pgdata` corruption, a mistaken
`ColleX-Durdur.cmd` + folder move, or a `git clean` loses everything with no
recovery. There is not even a documented manual procedure in RUNBOOK.

*Fix (small, ~1 day):* `ColleX-Yedekle.cmd` + a button in Ayarlar →
`pg_dump -Fc collex_local` **plus** a copy of `var/uploads/` into
`var/backups/collex-<YYYYMMDD-HHMM>/`, with a manifest recording the app
version, the migration ledger contents and a sha256 of each part; and
`ColleX-Geri-Yukle.cmd` that refuses to restore into a database whose ledger
is *newer* than the dump's. Both halves are required: `pg_dump` alone loses
the originals, and the originals alone lose the provenance.

### S2 · P0 — `var/uploads/` and `pgdata` live outside any product-owned data directory `[kodda]`

`serve.mjs` computes `VAR_DIR = <repo>/var`; `ColleX-Baslat.cmd` hard-codes
`%USERPROFILE%\scoop\apps\postgresql\current\data`. The lawyer's data is
therefore interleaved with the code, in a folder whose path contains non-ASCII
characters (`yargı-anıl`) that already breaks `uv sync` (CLAUDE.md §Commands).
Any update-by-replacing-the-folder scheme destroys the data; any move of the
repo breaks the install.

*Fix:* one `COLLEX_DATA_DIR` (default `%LOCALAPPDATA%\ColleX\data`) holding
`pgdata/`, `uploads/`, `backups/`, `logs/`, `var/*.pid`. Prerequisite for S1,
for packaging (§4) and for auto-update (§5). Touches `serve.mjs`,
`intake/quarantine.py`, both `.cmd` files, `RUNBOOK.md`.

### S3 · P1 — The entailment axis is measured on the wrong unit (see §3 for the full diagnosis and fix)

Reproduced `[ölçüldü]`. Costs 9 of 21 answerable gold rows their
finalizability for a purely mechanical reason.

### S4 · P1 — The capability registry is honest; the *planner's use of it* is not (see §3.1)

**29 of the 54 registered tools are unreachable from every code path.**
`[ölçüldü]` Details and the ones that matter in §3.1.

### S5 · P1 — Nothing exposes the local corpus over HTTP; `/v1/search` is a one-tool scaffold `[kodda]`

`retrieval/searchService.ts:271 searchLegalCorpus` — the only entry point to
the hybrid lanes — is imported by exactly two callers:
`pipeline/storeAdapters.ts` and `research/researchService.ts`. There is **no**
route that returns ranked corpus/upload passages without running the whole
answer pipeline (coverage gate, drafter, verifier, renderer). Meanwhile
`POST /v1/search` (`server.ts:507-560`) requires the MCP gateway, ignores the
capability fan-out entirely and calls **one** tool:

```ts
const outcome = await gateway.callTool({ toolName: "search", args: { query: normalizedQuery } });
```

with the comment "Scaffold retrieval path … Capability-fanout … comes later".
The console never calls it (`grep -c "v1/search" console.html` → **0**).

This is the single biggest blocker for "a real search screen" (§2.1 below).

### S6 · P1 — `console.html` at 393 KB is past the point where it is defensible, and splitting is cheaper than the docs claim `[ölçüldü]`

The file is 8 634 lines: 1 646 CSS, ~320 HTML, **6 660 lines of JS in one
IIFE with 267 functions** covering five tabs, two hidden pages, the answer
renderer, the draft editor, the live-progress panel and every Turkish
dictionary. It has no module boundary, so a change to the deadline panel and
a change to the evidence card are the same blast radius.

The commonly cited reason not to split — "the hash-pinned CSP contract" — is
**not actually a constraint**. `buildConsoleCsp` (`consolePage.ts:59`) hashes
*every* `<style>` and `<script>` block it finds and pins them all:

```ts
const scripts = hashesOf(html, SCRIPT_BLOCK);   // matchAll — all blocks
`script-src ${scripts.join(" ")}`
```

So N inline blocks cost **zero** CSP work. What actually blocks a split is
two test assertions — `console.test.ts:345` and `:497`,
`expect(html.match(/<script\b/gi)).toHaveLength(1)` — and the fact that the
code is inside one `(function(){ "use strict"; … }())`.

*Fix, in the cheap order:*
1. Split the single `<script>` into 6–8 topical blocks **in the same file**
   (`dictionaries`, `net+errors`, `render/answer`, `render/evidence`,
   `views`, `files`, `drafting`, `boot`), each its own IIFE assigning to one
   `var CX = window.CX || (window.CX = {})` namespace. Change the two
   assertions to `toBeGreaterThan(0)` plus a new one that every block is
   hash-pinned. CSP unchanged, no build step, no dependency.
2. Only if that is not enough: keep the split sources under
   `control-plane/public/console/*.js` and add a dependency-free
   `scripts/build-console.mjs` that concatenates them into `console.html`,
   with a test asserting the checked-in file equals the concatenation. That
   is a build step, but a 40-line one with no npm change.
3. Do **not** move to external `<script src>` files: that forces
   `script-src 'self'` and loses the per-byte hash pin, which is a real
   security property of this page.

### S7 · P1 — `drafting/templates.ts` is 2 104 lines of *data* compiled as code `[kodda]`

The 13 templates (fields, groups, help text, clauses, section leads) are
literals in a TypeScript module. Every legal-content correction (there were
~15 in W12-FIX alone: P1-13, P1-14, P1-15, LANG-13…LANG-19) is a code change
to a module the answer path also imports. It should be `templates/*.json`
+ a zod schema + one loader, so a lawyer-facing text fix is a data diff and
`tests/drafting/templates.test.ts` validates shape rather than prose.

### S8 · P1 — `answerPipeline.ts` (1 455 lines) is doing four jobs `[kodda]`

Planning, retrieval fan-out and merge, coverage admission + structural
closure (lines 731–862), the coverage-aware cap (`coverageAwareCap`, 1 093–
1 146), port selection, budget accounting, degradation and every view mapper.
Two extractions are obvious and behaviour-preserving: `coverageAwareCap` and
the admission/closure block belong in `answer/coverage.ts` (which already owns
`mapPassageCoverage` and `admitUnderReferenceBypass`); the `toClaimView` /
`toEvidenceView` / `toCoverageView` mappers belong in `pipeline/views.ts`.
That alone removes ~350 lines.

### S9 · P2 — GG.AA.YYYY is implemented four times in TS and again in Python, pinned nowhere `[ölçüldü]`

`deadlines/dates.ts:132`, `drafting/input.ts:52`, `drafting/evidence.ts:289`,
`ai/ocr.ts:87`, plus the Python exporters. W12-FIX P2-5 already deferred this
("needs one shared formatter and a naming contract"). One `src/format/date.ts`
+ a fixture shared with Python is a half-day and it closes a whole class of
"the export says a different date than the screen" bugs.

### S10 · P2 — Two divergent tokenizers inside TypeScript `[kodda]`

`answer/coverage.ts` has a ~120-entry stopword list plus `stemTurkish`
(coverage gate, drafting relevance gate). `llm/lexicalEntailment.ts:23-54`
has a **22-entry** stopword list and **no stemmer**. They are used on the same
Turkish legal text to make two different gating decisions, and nothing pins
them to each other. This is not cosmetic: the entailment judge's lack of a
stemmer is why a claim can fail on inflection alone.

### S11 · P2 — `hybrid.ts` contains a raw NUL byte `[ölçüldü]`

`node -e "…indexOf(0)"` → byte 47 720, inside `].join("\0")` written as a
literal control character. Consequence: `file` reports the source as `data`,
`grep` skips it as binary by default (my first cross-directory scan missed
its two `pipeline/` imports because of this), and some editors/diff tools
mangle it. Replace the literal with the `"\0"` escape.

### S12 · P2 — Matter items have no concurrency token `[kodda]`

Drafts have `baseVersion` → `409 VERSION_CONFLICT` (`drafting/routes.ts`).
`matters/routes.ts` has no `baseVersion`/`If-Match` anywhere: two windows
editing the same matter's notes silently last-write-wins. The console already
handles the *active matter* across tabs via a `storage` event, so
multi-window is a real usage pattern.

### S13 · P2 — Upstream residue still in the tree `[kodda]`

`example_fastapi_app.py` (80 KB, referenced only by
`tests/test_pydantic_clean.py`), `migration_app.py`, `redis_session_store.py`
(17 KB, referenced by nothing), `Dockerfile`, `railway.json`,
`control-plane/dist/` (a stale partial build of 7 modules that no runtime
path loads — `ts-loader.mjs` reads `src/`), `control-plane/test/` (four
never-executed duplicates, already documented in CLAUDE.md). ~200 KB of code
that a build agent will read and be misled by, and dead weight in any bundle.

### 2.1 What blocks the next three features

| feature | blocker | size |
|---|---|---|
| **Real search screen** | (1) no HTTP route over `searchLegalCorpus` (S5); (2) a search result must show a *quote*, and the product's rule is "a provider snippet is never evidence" — so the route must slice from canonical text at stored offsets, i.e. reuse `buildEvidencePack` or a stripped `quoteOnly` variant, not `chunk.original_text`; (3) `collex_local` has 0 chunks (F1) so the screen searches uploads only until a corpus is ingested | route + view: ~2 days. The corpus question is a separate, larger decision. |
| **Global search** | no `q` on `GET /v1/answers` (`AnswerListOptions` = `{matterId, limit, fileId}`, `answerService.ts:255`) or `GET /v1/drafts` (only `matterId`, `limit`); no cross-entity endpoint. But the columns exist: `app_private.answers.question`, `drafts.title`, `matters.title/client/docket_no`, and `pg_trgm` is already installed | add two GIN trigram indexes in a new migration + `GET /v1/search/all?q=` unioning 5 small queries with a `kind` discriminator. ~1.5 days, no new dependency |
| **Backup** | S1 + S2. `var/uploads/` inside the repo makes "copy the data folder" impossible today | S2 first (~1 day), then S1 (~1 day) |
| **Multi-window** | mostly fine already (single process, `storage` event, draft 409). Gaps: S12; the research progress registry is in-memory so a restart drops a running run's stream; and **nothing prevents a second `serve.mjs` on another port against the same `collex_local`** — the launcher only probes 8787 | S12 + a DSN-scoped advisory lock (`pg_try_advisory_lock`) at startup: ~half a day, and it enforces the single-worker invariant that the rate limiter already assumes |

---

## 3. The MCP surface: is the capability registry still an honest map?

### 3.1 Registry: honest. Reachability: not.

`capabilities/registry.ts` maps exactly 54 tool names onto 7 capabilities:
5 + 10 + 8 + 19 + 11 + 0 + 1 = 54 `[ölçüldü]`, with a load-time uniqueness
check and a `templates.ts` self-check (`assertToolBelongsTo`, lines 795-805)
that throws on drift. `legislation.resolveTarget` correctly declares an
**empty** tool list because it is implemented natively. This is a good,
honest map of the *surface*.

What it does not tell you is that **the planner can only ever emit 25 of the
54** `[ölçüldü]` — enumerated from `templates.ts` (`caseLawSearch`,
`legislationLookup`, `statuteRead`, `REGULATOR_SEARCH_TOOLS`,
`FETCH_BY_PROVIDER`), `rulePlanner.ts` (follow-up + gap both hard-code
`search_bedesten_unified`), `livePlanner.ts` (fetch phase only) and
`research/routes.ts:610` (`check_government_servers_health`):

**Reachable (25):** `search_bedesten_unified`, `search_anayasa_unified`,
`search_uyusmazlik_decisions`, `search_mevzuat`, `search_within_kanun`, the 8
regulator searches, `check_government_servers_health`, and the 12 fetch tools
in `FETCH_BY_PROVIDER` (`fetch`, `get_emsal_document_markdown`,
`get_anayasa_document_unified`, `get_mevzuat_content`, KİK, KVKK, Rekabet,
Sayıştay, BDDK, BTK, GİB, Sigorta Tahkim).

**Unreachable (29):** `search`, `search_emsal_detailed_decisions`; nine of ten
legislation searches (`search_kanun`, `search_khk`, `search_cbk`,
`search_cbyonetmelik`, `search_cbbaskankarar`, `search_cbgenelge`,
`search_kurum_yonetmelik`, `search_teblig`, `search_tuzuk`); ten of eleven
`search_within_*`; and seven fetch tools (`get_bedesten_document_markdown`,
`get_cbbaskankarar_content`, `get_cbgenelge_content`, `get_mevzuat_gerekce`,
`get_mevzuat_madde_tree`, `get_teblig_content`,
`get_uyusmazlik_document_markdown_from_url`).

`research/progress.ts` nevertheless carries a Turkish progress label for all
54 — 29 of which can never be printed. That is not dishonest, but it is a
maintenance cost and it hides the gap.

Three of these gaps are **product defects for a Turkish lawyer**, not
housekeeping:

- **G1 — Uyuşmazlık hits can never be fetched.** `search_uyusmazlik_decisions`
  *is* emitted (the `yargitay_danistay_contrary` template, when the question
  raises a görev/yargı yolu angle) and `SEARCH_TOOL_PROVIDER` maps it to
  provider `UYUSMAZLIK` (`payloads.ts:118`), but `FETCH_BY_PROVIDER` has no
  `UYUSMAZLIK` entry — the comment even says so. Since the brief forbids
  citing a search snippet, a Uyuşmazlık Mahkemesi decision found by the
  planner **can never become evidence**. And `get_uyusmazlik_document_markdown_from_url`
  exists, registered, unused. This is a ~10-line fix (`{ toolName:
  "get_uyusmazlik_document_markdown_from_url", idParam: "document_url" }`)
  and it turns a whole court back on.
- **G2 — Emsal (UYAP) is never searched.** `get_emsal_document_markdown` is a
  fetch descriptor, so the provider is reachable in principle, but no template
  emits `search_emsal_detailed_decisions`, so no `EMSAL` hit is ever recorded
  and the fetch descriptor is dead. Emsal is where a solo lawyer finds
  *yerel mahkeme + istinaf* precedent that Bedesten's high-court lanes miss —
  arguably the single most useful daily source for an İzmir practice. One
  `mkCall` in the `mevzuat_amendment_ictihat` and `yargitay_danistay_contrary`
  primary phases.
- **G3 — The legislation lane is `search_mevzuat`-only, and `search_within_*`
  is one tool wide.** `statuteRead` only ever calls `search_within_kanun`
  (`templates.ts:481`), so a question about a *yönetmelik*, a *tebliğ*, a
  *KHK* or a *Cumhurbaşkanlığı kararnamesi* — which is most of what a lawyer
  reads outside the codes — can find the instrument (`search_mevzuat` is
  untyped, correctly) but cannot **read inside it**. The fix is a
  `WITHIN_BY_TYPE` table keyed on the `mevzuat_tur` the search returned,
  exactly parallel to `FETCH_BY_PROVIDER`.

### 3.2 Is the planner's tool selection right for a Turkish lawyer?

Reading `rulePlanner.ts` and `livePlanner.ts` against what the tools do:

**Right, and non-obviously so:**
- Every `document.fetch` input's `externalId` comes from a **typed prior
  outcome** (`extractHits`), never from document text; document text feeds
  exactly one thing, the strict E./K. reference parser, bounded to 100 000
  chars (`rulePlanner.ts:94,165`). That is a correct, tight injection
  boundary — better than most agent planners.
- The contrary lane gets a **reserved fetch slot**
  (`livePlanner.ts:133-145`) so opposing authority is pulled in full before
  the budget is spent on friendly documents. Legally, this is the right
  instinct.
- `primaryQueryForIssue` builds `"5237 sayılı" 157` rather than
  "5237 sayılı kanun madde 157" — the citation form decisions actually
  contain. Someone who has read Turkish decisions wrote that.
- `mevzuatByNumberInput` deliberately omits `mevzuat_tur` because a numbered
  reference may be a KHK or a CB kararnamesi. Correct.
- The gap round measures **judicial** evidence only, so a statute hit cannot
  suppress the retry for "how is this rule applied". Correct.

**Wrong or thin:**
- **`kararTarihiEnd: asOf` only, never `kararTarihiStart`** (`bedestenInput`,
  `templates.ts:165-174`). Every case-law lane is unbounded backwards, so a
  1998 Yargıtay decision on a provision amended in 2019 ranks alongside a
  2024 one. For Turkish practice, where a *torba kanun* rewrites a code every
  couple of years, that is the most consequential retrieval defect in the
  planner. It should default to "decisions after the effective date of the
  version being asked about" whenever the amendment resolver has one.
- **No `birimAdi` targeting except HGK for direnme.** The tool exposes a
  chamber filter; a kira/tahliye question should reach 3. and 6. Hukuk
  Dairesi, an iş question 9. and 22. This is the cheapest available precision
  win and it is unused.
- **`gapQueryForIssue` appends the literal string `"emsal karar"`** to a
  full-text query (`templates.ts:139-143`). Bedesten ANDs its tokens, so the
  round-2 "different angle" query is *narrower* than round 1 for every
  decision that does not contain the phrase "emsal karar" — which is nearly
  all of them. The gap round is therefore mostly a wasted step. It should
  swap the *term* (which it already does via `expandedTerms[1]`) and stop
  there.
- **`hasJurisdictionAngle`** matches five substrings against the normalized
  question. `"görev"` will match "görevli" but also "görevlendirme",
  "görevden alma" — an idari personel question gets a spurious Uyuşmazlık
  lane (which, per G1, then cannot be fetched anyway).
- **`uploaded_claims_counter_evidence` still throws
  `TemplateNotImplementedError`** ("needs the secure upload pipeline (brief
  section 11)") — but the upload pipeline **shipped in W12**. This is the
  template a solo lawyer would use most: "here is the other side's dilekçe,
  find me the counter-authority". It is now unblocked and should be the next
  planner work item.
- The **five-template selector** is a 4-line if-chain
  (`selectTemplate`, `templates.ts:772-783`) over marker counts. It is
  deterministic and testable, which is right; it is also going to mis-route
  a mixed question, and nothing tells the lawyer which template ran or lets
  them pick. Surface `templateId` in the progress panel with an override.

---

## 4. The answer pipeline, with fresh eyes

### 4.1 Design decisions that are right and should not be touched

- **Quotes are re-sliced from canonical text at stored code-point offsets and
  hashed** — retrieval supplies identity and ranking only. This is the
  product. Everything else is commentary.
- **"Could not look" ≠ "nothing to find"**: a corpus failure degrades to
  PARTIAL with a typed `CORPUS_UNAVAILABLE`, never to ABSTAIN
  (`answerPipeline.ts:952-973`). Most systems get this wrong.
- **Set-aside passages are reported by identity, never silently dropped**
  (`observed[]` with `SCOPED_OUT_NORM_CONTENT` / `EVIDENCE_CAP_APPLIED` /
  `QUESTION_NOT_COVERED`). A lawyer can see what was found and refused.
- **`canFinalize` has exactly one definition** (`verification/finalize.ts:104`)
  and the verifier calls it rather than re-deriving it; thresholds fail closed
  on NaN/Infinity. The comment at `verifier.ts:288-305` explaining why the
  non-vacuity rule moved *down* a layer is the best piece of documentation in
  the repo.
- **The coverage-aware cap** (`coverageAwareCap`) — the plain top-8 cut
  manufactured a false abstention on a real question; the swap rule fixes it
  and each swap strictly grows coverage so it terminates. Correct and
  well-argued.
- **An upload's stance is neutral by construction** — running the outcome
  marker table over the lawyer's own cevap dilekçesi turned its own
  "davanın REDDİNE" into contrary authority against itself. Right fix.

### 4.2 Where it produces results a lawyer would call wrong or unhelpful

**W1 — Consolidated claims fail entailment for a mechanical reason (the known
issue). Diagnosed and reproduced.** See §4.3.

**W2 — In rule-based mode the entailment axis measures nothing.** `[çıkarım,
from ölçüm]` `RuleBasedDrafter.claimFromGroup` (`ruleDrafter.ts:257-281`)
builds `text = "<citeLabel>: \"quote1\"\n\"quote2\""` — the claim text *is*
the quotes. So a single-passage claim scores exactly 1.000 (measured), and
after the §4.3 fix a multi-passage claim will too. The axis is a tautology
in the default mode. That is not a bug to hide: the real verification is
`validateEvidence` (offset re-slice + sha256), which is strong. But the
console shows "Anlamsal doğrulama %100" next to it, which reads to a lawyer
as *semantic* confirmation. The honest surface is: show the axis as
"— (kural tabanlı üretimde ölçülmez)" whenever `aiUsed.entailment === false`,
exactly as W12-B2 already did for `currentnessApplicable === false`.

**W3 — `addressesSameIssue` links conflicts on a 25 % token overlap or *any*
shared number** (`verifier.ts:131-150`). `extractNumbers` returns every digit
run, including years and amounts. A claim citing TCK m.157 and a contrary
passage that merely mentions "2019" will be linked as CONFLICTING_AUTHORITIES.
Four of the nine PARTIAL gold rows are conflicted (W12-B2 §3.3) — worth
checking how many are this. *Fix:* restrict the number rule to
legislation/article/E./K. tokens (the parser already classifies them) and
raise the bare-lexical floor.

**W4 — The evidence cap is 8, hard, for the whole answer including contrary
lanes.** For a multi-issue question ("kira bedeli tespiti + tahliye taahhüdü")
eight passages across two issues plus their contrary lanes is thin, and the
cap is applied *globally* rather than per-issue, so the second issue can be
squeezed out entirely (`coverageAwareCap` mitigates but does not guarantee a
per-issue floor). A per-issue reservation (min 2 admitted passages per
material issue) would be a small, well-defined change.

**W5 — `CURRENTNESS_THRESHOLD = 0.9` with `UNKNOWN → 0.7` is a silent
"unhelpful" generator.** Any corpus passage without an `effectiveFrom` scores
0.7 and its claim becomes `OUT_OF_DATE_SOURCE` → not finalizable. W12-B2 fixed
this for uploads (`NOT_APPLICABLE`) but not for corpus rows with missing
version facts — and `versionFacts` is optional in the pipeline
(`answerPipeline.ts:635-653`). On an ingest where dates are absent, *every*
answer comes back KESİNLEŞTİRİLEMEZ with a reason the lawyer cannot act on.
The verdict should distinguish "we know it is stale" from "we do not know",
as the upload path already does.

**W6 — The answer time budget cannot cut a slow call.** Documented in STATUS
(60 s checked *between* stages). A single `chunkStore` lane that hangs takes
the whole request past the 15 s `statement_timeout` and then some. Correct as
documented; worth pushing the budget into the port with an `AbortSignal`, as
the live executor already does per call (80 s).

**W7 — `/v1/answer` is the only way to ask anything.** There is no "just show
me the passages" mode. For a lawyer who already knows the law and wants to
find the decision, the whole drafter/verifier/coverage apparatus is in the
way and will abstain on exactly the exploratory queries they want to run.
This is the same gap as S5 and it is why "a real search screen" is the right
next feature.

### 4.3 The known issue, diagnosed properly

**Symptom** (W12-B2 §3.3): 9 of 21 answerable gold rows are PARTIAL /
non-finalizable; every one carries `ENTAILMENT_BELOW_THRESHOLD` on exactly one
claim, and that claim is always the **consolidated provision claim**.

**Diagnosis.** The drafter's unit of production and the verifier's unit of
judgement disagree.

- `RuleBasedDrafter` groups passages by `(documentVersionId, article)` and
  emits ONE claim whose text is the concatenation of all the group's quotes,
  citing all of them (`ruleDrafter.ts:263-270`).
- `verifyAnswer` calls `entailmentPort.assess(draft.text, item.ref)` **once
  per evidence item, each against that item alone**
  (`verifier.ts:195-199`), then takes `confidence.entailment = max(scores)`
  (`verifier.ts:224-231`).
- `LexicalEntailmentPort.assess` scores *fraction of the claim's content
  tokens present in ONE passage's surface*, with a hard cap of 0.2 when a
  number in the claim is missing from that passage
  (`lexicalEntailment.ts:118-136`).

So a consolidated claim asks each passage to entail the *other* passages'
words too. Both failure branches reproduce exactly `[ölçüldü]`:

```
# probe 1 — two fıkra of one article, no cross-reference numbers
consolidated vs passage-1 : 0.612  (token overlap 30/49)
consolidated vs passage-2 : 0.633  (token overlap 31/49)
verifier aggregate (max)  : 0.633   < 0.85  → ENTAILMENT_BELOW_THRESHOLD
same claim, one passage   : 1.000            → SUPPORTED

# probe 2 — fıkra 2 carries a cross-reference ("158 inci maddede")
consolidated vs passage-1 : 0.200  "sayı/referans uyuşmazlığı — iddiadaki
                                    [158] kanıtta yok"           ← the 0.20 in W12-B2
consolidated vs passage-2 : 0.563
verifier aggregate (max)  : 0.563   < 0.85
```

Two things follow that the earlier report did not say:

1. **This is not a rule-drafter quirk.** `anthropicAdapter.ts:462` requires
   `evidenceIds: { minItems: 1 }` with no upper bound, so a cloud-drafted
   synthesis citing three passages hits the identical wall. The defect is in
   `ClaimDraft` + `EntailmentPort`, which have **no notion of which citation
   supports which part of a claim**, and in `max()` being the wrong aggregator
   for a conjunctive claim.
2. **`max()` is not merely wrong, it is backwards.** For a claim that
   conjoins N assertions, `max` asks "does *some* passage carry *everything*",
   which is strictly harder than the honest question and impossible by
   construction here. The honest question is: *is every part of the claim
   carried by at least one of its cited passages, and does every cited
   passage carry at least one part?*

**Proposed fix (additive, contract [E]).** Do not touch
`ENTAILMENT_THRESHOLD = 0.85`, `DEFAULT_COVERAGE_FLOOR` or any gate value.

1. `evidence/types.ts` — `ClaimDraft` gains
   ```ts
   /** Optional attribution: which cited passages carry which part of the text. */
   segments?: ReadonlyArray<{ text: string; evidenceIds: string[] }>;
   ```
   `ruleDrafter.claimFromGroup` fills it trivially (one segment per quote,
   one evidenceId each). The Anthropic tool schema gains the same optional
   array; `parseDraftClaims` drops segments citing unknown ids.
2. `llm/ports.ts` — `EntailmentPort` gains an optional
   `assessSet(claimText, evidence: readonly EvidenceRef[])`.
   `LexicalEntailmentPort.assessSet` runs the identical measure over the
   **union** of the evidence surfaces, keeping the number rule a hard failure
   over that union.
3. `answer/verifier.ts` — `confidence.entailment` becomes:
   - **segments present and every segment's ids validate** →
     `min over segments of assess(segment.text, its evidence)`;
   - **no segments, >1 valid item, and the drafter is the rule-based one**
     (whose claim text is provably the concatenation of the quotes) →
     `assessSet(claim.text, validItems)`;
   - **no segments, >1 valid item, cloud drafter** → keep today's
     `max` (conservative — a cloud paraphrase is exactly the case where union
     coverage would be a lexical illusion), and emit
     `ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM` so the gap is visible;
   - **1 valid item** → unchanged.
   Per-item judgements keep being computed and returned — the console renders
   them and they are the reader's audit trail.
4. **Anti-padding guard.** A validated citation that contributes no matched
   token the others do not already cover is reported
   `UNUSED_CITATION:<claimId>:<evidenceId>` (a warning, not a failure). With
   segments this is automatic; without them it stops the union path from being
   gamed by adding citations.

Measured effect of the two candidate aggregations on the reproduction
`[ölçüldü]`:

| aggregation | probe 1 | probe 2 |
|---|---:|---:|
| today, `max` per item | 0.633 ✗ | 0.563 ✗ |
| union surface | **1.000 ✓** | **1.000 ✓** |
| per-segment `min` | **1.000 ✓** | **1.000 ✓** |

Both work; **per-segment `min` is the one to build**, because it survives the
move to a cloud drafter and to a real semantic judge, while the union does
not.

**Do not report this as a quality improvement.** After the fix, the
finalizable rate on the synthetic gold set will rise (12/21 → likely 18–21),
and that number measures a bug being removed, not the product getting more
correct. Re-run `scripts/run_evals.py` and say so in the report, per W2:
the rule-based entailment axis is a tautology either way.

---

## 5. Packaging: making this installable for one non-technical user

### 5.1 What the install actually requires today `[ölçüldü]`

Node ≥22 (measured: v24.15.0) · a 483 MB `.venv` with 14 runtime dependency
trees including `playwright==1.55.0` · a 61 MB `control-plane/node_modules`
· scoop-installed PostgreSQL 18 with `pg_trgm`, `btree_gist`, `pgcrypto` and
the `turkish` snowball config · the repo checked out at a path the lawyer
must not move · and enough shell literacy to read a Turkish `.cmd` error and
act on it. A fresh machine is a half-day of expert work.

### 5.2 The five options, honestly

| option | solves | effort | risk | verdict |
|---|---|---:|---|---|
| **(a) `.cmd` + first-run doctor** | broken-prereq diagnosis, autostart-ish | 1–2 d | low | **necessary but insufficient** — it can *detect* a missing Node/PG/venv and print Turkish instructions; making it *fix* them means downloading and installing three toolchains from a batch file, which is where it becomes fragile. Keep the doctor; do not make it the installer. |
| **(b) Windows service + tray app** | autostart, no console window, clean stop | 3–5 d | medium (service account, `pgdata` ACLs, no UI when it fails) | **defer.** It solves the least painful problem. A tray icon is nice; a service that fails silently at boot for a non-technical user is worse than a `.cmd` that prints why. |
| **(c) Electron / Tauri shell** | a window with an icon instead of a browser tab | Electron 3–4 d + ~150 MB; Tauri needs a Rust toolchain and MSVC | medium | **no.** It changes the frame, not the install: Python and PostgreSQL are still side-by-side prerequisites. It would also break the CSP story — the console's `default-src 'none'` + per-block SHA-256 pin is a real security property that an Electron `BrowserWindow` re-implements badly. |
| **(d) Portable bundle: embedded Node + embedded PostgreSQL** | **installation, uninstall, backup, relocation, non-ASCII path** | 5–8 d | medium, and every risk is enumerable | **recommended — see §5.3** |
| **(e) Docker** | reproducibility | 2 d to write, ∞ to support | high | **no.** Docker Desktop for one lawyer means a licence question, admin rights, WSL2, a 2 GB memory floor and a second thing that can break. Keep the existing `Dockerfile` as upstream residue or delete it (S13); it is not this product's delivery mechanism. |

**SQLite: reject, with evidence.** `[kodda]` The retrieval design is
Postgres-specific end to end: `to_tsvector('turkish'::regconfig, …)` as a
GENERATED STORED column plus GIN (`20260826110000_turkish_fts.sql:43-45`),
`websearch_to_tsquery` + `ts_rank_cd` (`chunkStore.ts:502-509`),
`extensions.word_similarity` from `pg_trgm` (`chunkStore.ts:622-627`),
`daterange` + `btree_gist` exclusion for temporal versioning, RLS policies
(19 in `20260826060000_rls.sql`) and plpgsql close-on-append triggers
(ADR-012). FTS5 has **no Turkish stemmer**, and the migration header records
that on the fixture corpus `turkish` gives recall 1.00 where `simple` gives
0.00. Porting is a rewrite of `hybrid.ts` (1 272 lines), all 13 migrations,
and the entire eval baseline — and it would make the product worse.

**pglite: interesting, not now.** It is real PostgreSQL 17 in WASM and ships
`pg_trgm`, so the SQL would largely survive. But (i) the Python data plane
connects by DSN, so you would need `@electric-sql/pglite-socket` to expose a
wire port — a new npm dependency the current contract forbids, and a
single-connection bottleneck; (ii) it puts the database inside the Node
process, so the hard-kill risk that STATUS already documents for background
writes becomes a whole-database risk; (iii) unproven at 12 000+ chunks with
GIN indexes. Revisit only for a zero-install demo build.

### 5.3 Recommendation: (d) a portable bundle, with (a)'s doctor as its first run

**Shape**

```
%LOCALAPPDATA%\ColleX\                      ← ASCII path, per-user, no admin
  app\1.1.0\                                ← immutable, one folder per version
    node\node.exe                           ← official Windows .zip, ~55 MB
    python\python.exe + Lib\site-packages   ← python-build-standalone 3.12, ~180 MB
    pgsql\bin\ + share\                     ← EDB "binaries only" zip, ~350 MB
    collex\                                 ← this repo's runtime subset (see below)
  data\                                     ← the ONLY thing backups and updates touch
    pgdata\  uploads\  backups\  logs\  var\
  current                                   ← text file naming the active version
  ColleX.cmd  ColleX-Durdur.cmd  ColleX-Yedekle.cmd  ColleX-Guncelle.cmd
```

Distributed as one `ColleX-1.1.0.zip` (~700–800 MB, ~350 MB compressed).
Install = unzip. Uninstall = delete the folder. Nothing on `PATH`, nothing in
the registry, no admin rights, no service.

**First run (`ColleX.cmd`, doctor + initdb)**
1. `if not exist data\pgdata` → `initdb -D data\pgdata -E UTF8 --locale=C -U postgres --auth=trust`
   (trust is safe: `listen_addresses=127.0.0.1` only).
2. `pg_ctl -D data\pgdata -o "-p 55432 -c listen_addresses=127.0.0.1" -w start`.
3. `python.exe -m intake.cli --dsn …/collex_local --ensure-db` — unchanged,
   creates the DB and applies all 11 migrations through the ledger.
4. Preflight, printing one Turkish line per failure: pgdata writable ·
   port 55432 free · `select extversion from pg_extension where extname='pg_trgm'`
   · `select to_tsvector('turkish','dolandırıcılığın')` non-empty ·
   `node --version` ≥22 · `python -c "import pypdf, docx, defusedxml"` ·
   free disk ≥2 GB.
5. `node collex\control-plane\scripts\serve.mjs --port 8787 --with-mcp` →
   poll `/v1/health` → open browser.

**What must change in the repo for this to work** (this is the real work):

| # | change | why |
|---|---|---|
| P1 | **`COLLEX_DATA_DIR`** — one resolver used by `serve.mjs` (`VAR_DIR`, both pid files), `intake/quarantine.py` (`var/uploads`), the launcher and the stopper | S2. Today data is inside the code folder; an update that replaces the folder destroys it |
| P2 | **Interpreter/tool discovery via environment, not layout** — `serve.mjs:venvPython()` hard-codes `<repo>/.venv/Scripts/python.exe` (`serve.mjs:98-107`). Add `COLLEX_PYTHON` / `COLLEX_PG_BIN` with the current paths as fallback | the bundle's Python is at `app\<v>\python\python.exe`, not in a `.venv` |
| P3 | **Ship only the runtime subset**: drop `.venv` (replaced by a pre-built `site-packages`), `example_fastapi_app.py`, `migration_app.py`, `redis_session_store.py`, `control-plane/dist/`, `control-plane/test/`, `tests/`, `evals/`, `docs/`, `.git`, `ornek.png`, `5ire-settings.png` (S13). Keep `supabase/migrations/`, `ingestion/`, `intake/`, `export/`, `legal_reference/`, `legal_contracts/`, all `*_mcp_module/`, the two MCP servers, `control-plane/{src,public,scripts,node_modules,package.json}` | ~700 MB instead of ~1.2 GB, and no dead code for a support call to trip over |
| P4 | **Playwright**: confirm the import is lazy behind `MEVZUAT_ENABLE_LEGACY_PLAYWRIGHT` and ship the pip package **without** `playwright install` browser binaries (~400 MB saved) | it is a declared core dependency but the product path should not need a browser |
| P5 | **Single-instance lock** — `pg_try_advisory_lock` on the DSN at `serve.mjs` startup, Turkish message and exit 1 if held | the single-worker invariant is currently enforced by nothing (S12/multi-window) |
| P6 | **Signing** — at minimum an Authenticode-signed `ColleX.cmd`→`.exe` shim, or SmartScreen will scare the user off an unsigned 350 MB zip | this is the failure mode that ends the rollout on day 1 |

**What breaks / what to watch**
- `initdb --locale=C` changes `ORDER BY` collation for Turkish text. The
  `turkish` snowball config is locale-independent (it is a stemmer, not a
  collation), so FTS is unaffected — but **verify it** with the same probe
  the migration header uses, and use `--lc-collate=tr-TR` only if a real
  ordering surface needs it.
- Windows Defender real-time scanning of `pgdata` slows first ingest
  noticeably; the doctor should suggest an exclusion (and never add one
  itself).
- A user who unzips into `%PROGRAMFILES%` gets a read-only `data\` — the
  launcher must refuse any location it cannot write and say so in Turkish.
- The scoop PostgreSQL and the bundled one must not both run on 55432. The
  doctor should detect a foreign listener and pick 55433 (writing the port
  into `data\port`), never kill it — the same rule `ColleX-Durdur.cmd`
  already follows for 8787/8898.
- **Migration ordering across the split**: `intake.cli --ensure-db` reads
  `supabase/migrations/` relative to the package root, so P3 must keep that
  directory in the bundle and keep `runnable_migrations()` sorting by
  filename (it does; it is not asserted — add the assertion).

---

## 6. Auto-update and versioning

### 6.1 Today there is no version

Three numbers disagree `[ölçüldü]`: `pyproject.toml` `version = "1.0.0"`,
`control-plane/package.json` `"version": "0.1.0"`, `server.ts:119`
`API_VERSION = "1.0.0-w12"`. `/v1/health` reports the third. Nothing records
which build produced a stored answer or applied a migration.

*Fix:* one `VERSION` file at the repo root (`1.1.0`), read by `serve.mjs`
into `API_VERSION`, asserted equal to `pyproject.toml` by a test, stamped
into `AnswerResult.bundle.producer` and into the migration ledger (§6.3).

### 6.2 Update mechanism: side-by-side, never in-place

The bundle shape in §5.3 makes this simple and safe.

```
ColleX-Guncelle.cmd  (or a "Güncelle" button in Ayarlar that shells to it)
 1  stop everything (reuse ColleX-Durdur.cmd's rules — no port-based kill)
 2  verify the new zip's sha256 against a manifest the user got with it
 3  unzip → app\1.2.0\      (app\1.1.0\ untouched)
 4  BACKUP: pg_dump -Fc collex_local → data\backups\pre-1.2.0-<ts>.dump
          + copy data\uploads → data\backups\pre-1.2.0-<ts>\uploads
 5  app\1.2.0\python -m intake.cli --dsn … --ensure-db
          (ledger-driven, one transaction per file, idempotent)
 6  start app\1.2.0 → poll /v1/health, REQUIRE:
          db == "ok" AND migrations.missing == [] AND registeredToolCount == 54
          AND version == "1.2.0"
 7  success → write `current` = 1.2.0, keep app\1.1.0 and the dump
    failure → stop, restore `current` = 1.1.0, pg_restore the dump,
              restore uploads, start 1.1.0, print ONE Turkish sentence
              naming data\backups\… and the log file
 8  keep the last 2 versions and the last 5 backups; delete older
```

Rollback is `current` + `pg_restore`, which only works if migrations are
**backward compatible for one release**. Make that a written rule (a new ADR):
*a release may add tables, columns, indexes and defaults; it may not drop or
rename anything the previous release reads or writes. Removal happens one
release after the last writer is gone (expand → migrate → contract).*
The 13 existing migrations already satisfy this — nothing has ever been
dropped.

### 6.3 Three gaps in the ledger that must close first `[kodda]`

`app_private.schema_migrations` is `(filename text primary key, applied_at
timestamptz)` (`ingestion/migrations.py:291-295`). Per-file transactions and
the sentinel-probe bootstrap are solid (ADR-020 as amended); what is missing
for safe updates:

1. **No checksum.** A migration file edited after it was applied is invisible.
   Add `checksum text` (sha256 of the file) and make `apply_missing_migrations`
   raise a typed error when a recorded file's checksum differs — the single
   most likely way an auto-update corrupts a database silently.
2. **No app version.** Add `applied_by_version text` so `/v1/health` (and the
   rollback logic) can say which release created the schema it is looking at.
3. **No ordering assertion.** `runnable_migrations()` sorts by filename by
   convention; assert it, and assert filenames are strictly increasing
   timestamps, in `tests/ingestion/test_migrations_ledger.py`.

Additionally, `store/health.ts` must mirror the checksum CASE the same way it
already mirrors the sentinel probe, or the two runtimes will disagree about
"missing" again.

### 6.4 What the user sees

Ayarlar → Sistem durumu gains: `Sürüm 1.1.0` · `Son yedek: 02.09.2026 14:20`
· `Güncelle` (disabled unless a zip is present) · `Yedek al` ·
`Yedekten dön`. No network auto-check: this product is offline-first and a
silent background updater is exactly wrong for a machine holding case files.
The lawyer receives a zip and clicks Güncelle.

---

## 7. What I would change if I rebuilt it today

Seven things, in the order I would do them. None is a rewrite; four are
deletions or moves.

1. **Make the search screen the product's front door, and the answer pipeline
   an action on top of it.** The current shape forces every question through
   coverage → drafter → verifier → renderer, and abstains on exactly the
   exploratory queries a lawyer starts with. `searchLegalCorpus` already
   produces ranked, provenanced hits; expose it, put quotes through the same
   offset-slice-and-hash path, and let "Cevap üret" be a button on a result
   set the lawyer has already looked at. This also solves W7, S5 and half of
   "global search".

2. **Give a claim segments from the start.** `ClaimDraft` with
   `{text, evidenceIds}` and nothing linking a sentence to its citation is the
   root of §4.3, of the drafting linter's coarseness, and of every future
   "which passage supports this clause" question in the editor. Attribution
   at the sentence level should be in the contract, not inferred.

3. **One data directory, one version, one backup, from day one.** S1 + S2 +
   §6.1. These are cheap now and expensive after the lawyer has 200 matters.

4. **Data out of code.** The 13 draft templates (2 104 lines), the 30 deadline
   rules (600 lines), the Turkish dictionaries in `console.html` and the
   `LEGAL_DOMAIN`/`*_LAWS` tables in `relevance.ts` are all *legal content*
   maintained by a lawyer, compiled as TypeScript maintained by an engineer.
   JSON + a zod schema + a validation test makes the legal-content edit loop
   a data diff. Fifteen of the W12-FIX findings were content, not code.

5. **Split `console.html` at the seams it already has.** Six to eight inline
   blocks in one file (S6). The 393 KB single IIFE is the biggest obstacle to
   anyone but its author changing the UI, and the CSP does not require it.

6. **Delete the upstream residue and the never-run duplicates.**
   `example_fastapi_app.py`, `migration_app.py`, `redis_session_store.py`,
   `control-plane/dist/`, `control-plane/test/`, `Dockerfile`,
   `railway.json`. Every one of them is a wrong answer waiting for a future
   reader — I lost time on `control-plane/dist/` before finding that
   `ts-loader.mjs` never reads it.

7. **Close the loop between the registry and the planner.** The 54-tool
   invariant is well guarded; *reachability* is guarded by nothing, so
   `search_emsal_detailed_decisions` and
   `get_uyusmazlik_document_markdown_from_url` sat registered and dead. Add a
   test that enumerates the tools the templates + planners can emit and
   asserts an explicit `REACHABLE` / `NOT_YET_WIRED` classification for all
   54, with a one-line reason for each of the second kind. Then G1/G2/G3 stop
   being discoveries and become a list.

**And one thing I would not change.** The evidence chain — code-point offsets
over NFC canonical text, sha256 over UTF-8, re-slice-and-revalidate at every
layer, one fixture pinning both runtimes, an exporter that refuses rather than
emits an unverifiable citation. It is the reason this repository is worth
packaging at all, and every shortcut proposed above is chosen so that it stays
untouched.

---

## Appendix — files worth reading first (for the build agents)

| topic | file:line |
|---|---|
| the entailment defect | `control-plane/src/llm/ruleDrafter.ts:257-281`, `control-plane/src/answer/verifier.ts:195-231`, `control-plane/src/llm/lexicalEntailment.ts:118-136` |
| the fix's contract surface | `control-plane/src/evidence/types.ts:41-56`, `control-plane/src/llm/ports.ts:34-41`, `control-plane/src/llm/anthropicAdapter.ts:442-470` |
| tool reachability | `control-plane/src/planner/templates.ts:231-276` (`FETCH_BY_PROVIDER`), `:481-486` (`search_within_kanun` only), `:772-783` (`selectTemplate`), `control-plane/src/planner/rulePlanner.ts:173-188` |
| the missing corpus route | `control-plane/src/retrieval/searchService.ts:271`, `control-plane/src/api/server.ts:507-560` |
| CSP / console split cost | `control-plane/src/api/consolePage.ts:59-74`, `control-plane/tests/pipeline/console.test.ts:345,497` |
| data-directory coupling | `control-plane/scripts/serve.mjs:62-66,98-107`, `ColleX-Baslat.cmd:20-25` |
| migration ledger | `ingestion/migrations.py:287-349` |
| SQL that cannot leave PostgreSQL | `control-plane/src/store/chunkStore.ts:502-509,622-627`, `supabase/migrations/20260826110000_turkish_fts.sql:43-45` |
