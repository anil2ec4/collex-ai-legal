# CLAUDE.md

Working contract for Claude Code (or any agent/human) in this repository.
Last updated: **2026-09-04** — **W15, the plain-language wave, is complete.**
It changed no capability and no gate; it changed the WORDS on the screen and the
explanation layer around them. Read `docs/implementation/waves/W15-DEGISMEZLER.md`
(binding invariants + the canonical glossary) BEFORE writing any user-facing
Turkish, and `W15-TASARIM.md` for the screen designs. Two new hidden views
exist (`#nasil`, `#sozluk`); `TERM_TR` in `console.html` is an OBJECT and is the
**single source** of every term definition — the inline `?` card and the Sözlük
screen are both drawn from it, and no definition may be written a second time by
hand. `console.test.ts` now sweeps the page's visible flow and FAILS if
"SHA-256", "Unicode", "korpus", "endpoint", "JSON", "MCP" or "sentetik" appear
outside the collapsed "Teknik adı: …" layer.

**W17/b (2026-09-06) — the petition analysis met a real petition.** A real Turkish
cevap dilekçesi (eser sözleşmesi / ayıp; TBK m. 474-475, TTK m. 23/1-c, HMK
m. 119/129, one Yargıtay 15. HD decision) was POSTed to a running server. **The
code that passed all 34 synthetic-fixture tests produced thirteen defects on the
real document**, and every one of them came from the same fact: the fixture
writes each heading on a line of its own and a real petition writes
`HUKUKÎ SEBEPLER : TBK m. 474, …` on one line. Read
`docs/implementation/waves/W17-DILEKCE.md` for the measurements. What changed and
what you must not undo:
`isPreambleLine` checks the ≤30-character LABEL before the 90-character shape
guard (the real `KONU :` line is 97 characters and became "iddia-1");
`SIGNATURE_LINE` is a CLOSED list of forms, never a shape heuristic;
`inlineHeadingOf` recognises a heading written on its content's line and KEEPS
the content as a claim (throwing away the HUKUKÎ SEBEPLER line would leave the
petition's statutes attached to nothing); `HEADING_RULES` entries carry `weak`
and under a weak (generic) heading the paragraph's own PARSED CITATION decides
its kind, because `CLAIM_KIND_HELP_TR.VAKIA` tells the lawyer a missing citation
is normal — a mislabelled legal claim excuses the very gap the report exists to
show; `contraryBaseTerm` returns an INSTITUTION from the concept engine and
never a statute number (`6098 sayılı m. 475 bozma` matched five unrelated
decisions and printed them as "aleyhe kaynak BULUNDU" on five of twelve claims —
in a rebuttal report a false "there IS authority against you" is the most
expensive error there is), and the concept engine runs BEFORE the `OPPOSITE_TERMS`
scan because the concept table is ordered most-specific-first and
`OPPOSITE_TERMS` is not ordered at all; `documentContraryTerm` builds its
candidate set from **the claims' own terms first** — running the concept engine
over a whole petition is a different question from running it over a paragraph,
and the first two attempts answered "ihbar tazminatı" (an employment institution
absent from the file) and then "tazminat"; a borrowed term always says on screen
that it was borrowed; `CONTRARY_TIME_BUDGET_MS = 30_000` is read BETWEEN lanes
and only after one lane has actually run; **one upstream call per DISTINCT query
per report** (`contraryCache`) — six claims once sent the identical search six
times and thirteen of sixteen lanes died on the clock; a decision is listed under
the FIRST lane of a claim that found it and the next lane keeps its BULUNDU state
while saying how many were already above; `TALEP` and `DIGER` blocks get neither
a contrary search nor an unsourced-statement scan (a request and a document list
assert no fact, and a warning that fires on something that could never be sourced
trains the reader to skip the ones that matter). `formatSourceKunye` and
`formatDecisionDateNote` in `src/sources/searchService.ts` are the ONE place a
row is printed as a künye: parts are added only when the line does not already
carry them and a subsuming part REPLACES what it subsumes (the lane used to print
"Yargıtay 11. Hukuk Dairesi · Yargıtay 11. Hukuk Dairesi E. 2026/5892
K. 2026/4208 · 2026/5892 · 2026/4208"), and a decision date outside
`KUNYE_YEAR_MIN..KUNYE_YEAR_MAX` says the source's date was unreadable instead of
printing it (a row really did come back "6006-09-20"). **A contrary hit's `href`
is provider text and `console.html` assigns it straight to an anchor, so it goes
through `checkFetchUrl` server-side** — a rejected URL yields NO link.
Measured, same petition, same server: **2 m 04 s → 33,2 s · 12 → 10 claims ·
false FOUND 1 → 0 · 10 → 6 citation rows, every one statute-qualified · 4 → 16
lanes built, 15 run · every hit a one-line künye with a working link**. Relevance
is still **unmeasured** — say "erişim ölçüldü, isabet ölçülmedi".

**Then six independent lenses audited the same surface and every finding was
handed to two skeptics to refute: 35 judged, 14 survived, 21 refuted — and all
fourteen are fixed.** The three that matter most, and the rules they leave
behind: **(a) `searchSources` NEVER rejects on an outage** — it catches every
gateway throw and every provider error into `failedSources` and resolves with
`rows: []` — so any port that consumes it MUST read `okSources`/`failedSources`
or a dead archive is drawn "arandı, bulunamadı" and ARAMA_BASARISIZ becomes
unreachable in the product; **(b) a lane state may not assert a direction
nobody measured.** The contrary lane counts ROWS; it never reads what a
returned decision says, and verifying that was tried and rejected because
`ContraryHit` carries only künye/date/link and the Bedesten path publishes no
snippet, so a direction test would make BULUNDU unreachable — its own
dishonesty. The label is therefore **"sorgu sonuç getirdi"** and the sentence
says "…AKSİ yönünde olup olmadığı ÖLÇÜLMEDİ", the same idiom the coverage
manifest and the fee tariffs use; **(c) `DIGER` means "could not be classified",
NOT "a document list".** Gate list behaviour on `isDocumentListHeading(heading)`
and never on the fallback kind — reading the two as one turned four of five
grounds in an ordinary ceza savunma dilekçesi into an evidence list that was
never searched and never scanned for unsourced statements. Also fixed:
`CLAIM_MARKER` now takes `1-)` and `(1)` as two SEPARATE alternatives (making
the separator optional was tried and reverted within the hour — it read
"14.03.2024 tarihli" as a claim number) and `HEADING_LEAD` strips a Roman or
letter prefix, so `I. AÇIKLAMALAR` is a heading and an icra itirazı's three
grounds are three claims; `COURT_ADDRESS_TAIL` carries every office's
apostrophe-split spelling and `PREAMBLE_LABELS` the compound role labels
(`MÜDAFİ :`, `İSTİNAF EDEN (DAVALI) :`) — both still CLOSED lists;
`citesAuthority` and `isCheckableCourtReference` require a statute or a
decision, so "sözleşmenin 5. maddesi" is no longer audited as mevzuat (it
reaches the unsourced pass instead, where it belongs); **`extractAuditCitations`
parses the document as PROSE** (whitespace collapsed) because a petition wraps
its lines wherever the margin falls — "2004 sayılı İcra ve\nİflas Kanunu m. 269"
produced no statute at all and two decision künye carried a literal newline onto
the screen; `AuditCitation.rawForms` (additive) keeps EVERY spelling the
document used, so a count is never attached to a spelling that did not occur
that many times and a claim citing "TTK m. 23" is joined to the row keyed on
"TTK m. 23/1-c" (the HUKUKÎ SEBEPLER block's count went 4 → 5). On screen: the
petition report has its OWN `TERM_TR` key **"KAYNAKSIZ (dilekçe incelemesi)"**
— the drafting definition ("dayanağını siz eklemelisiniz", "taslak dışa
aktarılmaz") is wrong for the other side's sentence; "kova" is gone; a notice no
longer names a JSON field; and the full-text link opens in a NEW TAB with `rel`,
because the report takes 33 s, is not persisted, and one click used to destroy
it.

**W16 (2026-09-05) — the competitive-gap wave.** Three axes Apilex and De Jure
sell and ColleX did not have, plus the one advantage neither can copy:
`src/planner/intake.ts` CONCEPT_TABLE **18 → 164 concepts** (each with optional
statutory `anchors`, ordered most-specific-first);
`src/sources/relatedSearch.ts` + **POST /v1/sources/related** — "olayı anlat →
ilgili kararlar": up to 8 generated queries fanned across 26 official sources,
deduped by decision identity, ranked by MUTABAKAT (how many independent queries
found it) — a measurable agreement count, **never** sold as a relevance score;
`src/retrieval/{embeddingConfig,semanticRerank}.ts` — semantic re-ranking, OFF
by default with a typed reason, only over FETCHED FULL TEXTS (a search snippet
is refused), three verbal bands and **no percentage anywhere**;
`src/contracts/petitionAnalysis.ts` + **POST /v1/contracts/petition-analysis** —
karşı dilekçe analizi, rule-based, three buckets per claim, and four DISTINCT
contrary states (BULUNDU / ARANDI_BULUNAMADI / **ÇALIŞTIRILMADI** /
ARAMA_BASARISIZ) so a lane that never ran is never drawn as "no contrary
authority"; `src/drafting/**` — the optional `olayAnlatisi` narrative (every
paragraph `supported:false`, ADR-021), the `kapsam` switch (**Kısa/Geniş widens
the RELEVANCE gate only — DOMAIN_MISMATCH still gates and the verification is
identical**), and the 14th template **hukukî mütalaa** whose aleyhe section can
never be empty. And `ingestion/library.py` +
`python -m ingestion.cli --publish-library <spool>`, called by
`ColleX-Baslat.cmd` on every start: every full text a live research fetched is
now published into `collex_local` — **the lawyer's archive accumulates on their
own disk instead of being rented.**

Previous line: **2026-09-03** — **W14 complete through phase M.** W13 was an
intelligence/design wave (`waves/W13-*.md`: APILEX, DEJURE, TRMARKET, GLOBAL,
ARCH, ENGRISK, DESIGN, COPY, DAILYFLOW, UXAUDIT, FEATURE, BACKLOG,
DESIGN-SPEC). W14 built it: seven parallel phase-A lanes
(`waves/W14-L-{EVID,ANSWER,SAFE,MATTER,LEGAL,SOURCES,CONSOLE}.md`), a phase-B1
integration lane (`W14-L-FIX.md`), a phase-B2 console lane
(`W14-L-CONSOLE-B.md`) and documentation pass (`W14-L-DOCS.md`), an
**independent verification lane** (`W14-L-VERIFY.md`, findings **V-1..V-22**),
four **phase-F lanes** (`W14-F-PERF.md`, `W14-F-API.md`, `W14-F-UI.md`,
`W14-F-DOCS.md`), an **independent closing audit** (`W14-F-VERIFY.md`) and two
**phase-C cleanup lanes** (`W14-C-SRV.md`, `W14-C-UI.md`) with a closing
measurement (`W14-C-FINAL.md`), and two **phase-M lanes** (`W14-M-SRV.md`,
`W14-M-UI.md`) plus a closing measurement (`W14-M-CLOSE.md`), and a
follow-up round (`W14-N7.md`) that closed N-7.

**Read the verdict, not the lane's own claim.** The phase-F lanes said they
had closed 19 of the 22 findings. The independent audit re-derived every one
and found **16 closed · 3 improved-but-not-closed (V-1, V-10, V-22) · 3 open
(V-14, V-19, V-21)**, plus **six new defects N-1..N-6**. Phase C then closed
V-14, V-19, V-21, the V-10 and V-22 remainders, and N-2/N-3/N-5/N-6, and
closed the list half of N-4. Phase M then **closed N-8**, gave V-1's residue
its screen half (a progress card and a working cancel on every long wait) and
N-4 its record-count half (`totalRecords`), and **narrowed N-7 without closing
it**. A following round (`W14-N7.md`) then **closed N-7**: `AnswerPipeline`'s
rank stage broke a score tie on `hit.chunkId`, an ingest-minted uuid, so the
coverage-aware cap kept a different top-8 after every re-ingest; it now orders
on corpus identity and six consecutive `run_evals.py` runs agree digit for
digit. **Today: V-1..V-22 = 21 closed,
1 improved (V-1 — its 7,5 s ceiling is now visible and cancellable, not
shorter); N-1..N-6 = 4 closed, 1 partial (N-4: the count landed, the ranking
did not), 1 documented-not-closed (N-1); N-8 CLOSED; N-7 CLOSED.**
`STATUS.md` (rows **S1–S41**) and `TRACEABILITY.md` (W12 rows #31–#60, one row
per backlog item B-01..B-46, plus the **V-1..V-22** and **N-1..N-8** blocks)
are current. The lane reports remain the binding "as implemented" contracts,
and they are **historical**: a wrong number in one is corrected in STATUS, and
at most annotated in place — never rewritten.

## Read this first — six rules that override convenience

1. **Never use Supabase or Resend remote services, or their MCP tools, from
   this repo.** Nothing here has ever touched a live Supabase project, and
   that must stay true. All database work is local files + a local scratch
   PostgreSQL.
2. **Never run the pgvector migrations** (`supabase/migrations/20260826080000_*`,
   `20260826090000_*`). pgvector is not installable on this machine; those two
   files are pglast-syntax-validated only.
3. **Always call Python through the repo venv interpreter**
   (`.venv/Scripts/python.exe`). Never bare `python`. **Never `uv run` or
   `uv sync` against this venv** — see "Commands".
4. **The MCP tool surface is exactly 54 offline** (55 with an embedding key).
   Never add, remove or rename a tool or parameter. Response shapes may gain
   **additive** fields only.
5. **The corpus in `evals/fixtures/corpus/` is SENTETİK authored test data**,
   not real Turkish law. No number measured on it is a legal-quality
   benchmark, and it must never be presented as one. The same holds for W14's
   scale probe corpora (`collex_answer_test`, `collex_fix_test`,
   `collex_matter_test`): they are GENERATED, their trigram diversity is not
   realistic, and every number taken on them says so.
6. **`STATUS.md` → "Ölçülen sayılar" is the ONLY place a number is written.**
   Every other document cites a row id (`S1`…`S24`). A number with no row in
   that table may not appear on any surface — not in a doc, not in the
   console, not in a report. (W13-BACKLOG §C.1: a published number you did
   not measure is a liability.)

## Project identity

- **Bağımsız Yargı ve Mevzuat MCP / ColleX** — a self-hosted MCP server for
  Turkish case law and legislation, plus an evidence/answer control-plane.
  Package: `yargi-mevzuat-mcp-independent`, version 1.0.0.
- This is an independent fork. It has **no** Clerk/OAuth, Fly.io, Upstash/Redis,
  Stripe or SaaS deployment contract. Any doc claiming those (or "production
  ready", 19/21 tool counts, api.yargimcp.com) is stale upstream residue —
  do not trust or restore it.
- This repo is the **canonical** copy. Sibling checkouts `../yargi-mcp` and
  `../mevzuat-mcp` are stale references only; never deploy or copy from them.
- The working tree carries the user's uncommitted changes. **Never** revert,
  checkout, stash, reset or commit them without being asked.
- Current overall status is **PARTIAL** — see `docs/implementation/STATUS.md`
  for the argument and the evidence, in particular its **eight unverified
  surfaces** and the **two measured ceilings** underneath them: over 20 000
  chunks a common word costs ~3,8 s and DOES answer, but **a phrase that is
  nowhere in the corpus costs 7,5 s and comes back empty**, and the trigram
  lane's plan behaviour differs from probe corpus to probe corpus. Do not
  upgrade that word anywhere. `STATUS.md` holds the **single counts table** ("Ölçülen sayılar",
  rows **S1–S41**); `TRACEABILITY.md` carries the W12 rows #31–#60, one row
  per W13 backlog item **B-01..B-46**, and one row per verification finding
  **V-1..V-22**. The lane reports under `docs/implementation/waves/`
  remain the binding "as implemented" contracts.

## Directory map (what actually exists)

### Python — MCP provider gateway

| Path | What it is |
|---|---|
| `mcp_server_main.py` | Main FastMCP app: court/regulator tools (Yargıtay, Danıştay, Bedesten unified, Emsal, Uyuşmazlık, Anayasa, KİK v2, Rekabet, Sayıştay, KVKK, BDDK, BTK, GİB Özelge, Sigorta Tahkim) + Deep Research compatibility tools (`search`, `fetch`) + `check_government_servers_health` |
| `mevzuat_mcp_server.py` | Legislation FastMCP app (26 tools: `search_mevzuat`, nine type-specific `search_*`, `search_within_*` semantic lanes, content/gerekçe/madde tools), **mounted unprefixed** onto the main app |
| `{institution}_mcp_module/` | One module per upstream (`client.py` + `models.py`) |
| `mevzuat_bedesten_client.py`, `mevzuat_client.py` | Legislation clients |
| `bedesten_rate_limit.py` | Process-wide token bucket + endpoint-keyed circuit breaker (admission epochs) + deadline-bounded bulkhead |
| `legal_contracts/outcomes.py` | Typed `Outcome` / `FailureKind` taxonomy; mirrored by `control-plane/src/capabilities/types.ts` |
| `legal_reference/` | Turkish normalization, exact reference parser, abbreviations (TCK→5237 …), amendment target resolver |
| `semantic_search/`, `mevzuat_semantic_search/` | In-memory NumPy vector stores for the key-gated 55th tool and `search_within_*`. **Not** the corpus — no provenance, no offsets, nothing citable |
| `asgi_app.py` | HTTP transport + bearer auth |

### Python — data plane and delivery

| Path | What it is |
|---|---|
| `ingestion/` | Fixture corpus → PostgreSQL with provenance: `identity`, `versioning`, `chunking`, `indexer` (batched `executemany`, 500 rows), `relations`, `jobs`, `snapshot`, `pipeline` (`connect_local` — the ONE helper every local connect goes through, `connect_timeout=5`), `ports`, `cli`. **`migrations.py` is the migration ledger** (`app_private.schema_migrations`, `apply_missing_migrations`; every runnable migration carries a `-- [LEDGER SENTINEL] <kind>:<name>` probe, bootstrap records only files whose probe resolves, ledger + bootstrap in one transaction; `parse_sentinel` / `sentinel_resolves` / `SENTINEL_PROBE_SQL`; ADR-020 as amended by FIX-2) |
| `intake/` | Tenant uploads: quarantine (`UPLOAD_CAP_MIB = 25` — the single source of the cap; magic-byte/MIME sniff, ZIP-bomb checks), PDF/DOCX/TXT/UDF extraction (OCR **fail-closed**; per-page text-layer gate; **W14: `PDF_MAX_PAGES = 600` read from the header BEFORE a single page is extracted**), heuristic v1 analysis (`analysis.py`; **W14 B-37**: multi-word role labels, dedupe by normalized name, word-boundary context windows, `references` vs `referencesAmbiguous`, numbered SONUÇ VE İSTEM items), ingest through the SAME pipeline as the corpus (`scope='tenant'`, `source='UPLOAD'`, `fileId = sha256[:16]`; **W14 B-33**: originals are written BEFORE the pipeline runs and atomically — `.part` → `fsync` → `os.replace` — and `meta.upload.chars` is recorded so the list endpoint need not detoast). CLI: `python -m intake.cli --dsn <dsn> --file/--dir/--list/--show/--delete/--ensure-db`; **`--dir <folder>`** (W14 B-19) walks recursively, treats non-document extensions as *skipped* rather than errors, refuses above `BATCH_MAX_FILES = 200`, and routes every file through the SAME `process_file` — there is no second intake path. `--ensure-db` creates ONLY `collex_local`/`collex_intake_test` (never drops) and applies MISSING migrations through the ledger. `errors.py`: `StoreUnavailableError` → typed, driver text withheld. Originals under `<COLLEX_DATA_DIR>/uploads/` (default `var/uploads/`) |
| `export/` | `collex.answer.evidence-bundle/v1` → DOCX/Markdown (`bundle*.py`); `collex.draft/v1` → DOCX (`petition.py`, `--draft --format dilekce-docx`) and → **UDF (deneysel)** (`udf.py`, `--format dilekce-udf`; UTF-16 offsets, unsigned, ADR-019); `draft.py` = shared draft parser/verifier (`K-n` numbering, `ek-dogrulama` section, `canonical_quote_text`, the **B-01 quote-integrity check**, `ExportMode`, the B-36 review record). **W14 additions:** `audit.py` (`collex.citation-audit/v1` → DOCX, `--audit`), `review.py` (`collex.contract-review/v1` → DOCX, `--review --format inceleme-docx`), `package.py` (`collex.matter-package/v1` → ZIP, `--package`, plus `verify_package(path)` for the recipient). Every one of them parses strictly → builds → writes to a temp name → **re-opens and self-checks the artifact** → publishes; a refused export leaves **no file at all**, temp included. **Refuses to export an unverifiable citation** (exit 2, nothing written) |
| `supabase/migrations/` | **15 migrations** + `seed.sql`. **Thirteen are runnable locally** and every one carries a ledger sentinel; the two W14 files are `20260903100000_ai_audit_and_scale_indexes.sql` (`app_private.ai_calls` + RLS + `answers_filescope_gin`) and `20260904090000_hearing_kind_and_search_indexes.sql` (widens the `matter_items.kind` CHECK to accept `'hearing'`, plus three search indexes). Two require pgvector and **must never be executed here** |
| `evals/` | Gold sets, synthetic fixture corpus, retrieval + citation harness, adversarial fixtures, dated reports |
| `scripts/` | Offline checks, DB checks, eval gate, fixture generators, live (network) checks |
| `tests/` | pytest suite: root plus `tests/resilience/`, `tests/amendment/`, `tests/contracts/`, `tests/ingestion/`, `tests/export/` |

### TypeScript — control-plane

| Path | What it is |
|---|---|
| `control-plane/src/capabilities/` | Registry: 54 tools → 7 capabilities; `types.ts` mirrors the Python Outcome taxonomy |
| `control-plane/src/store/` | `chunkStore.ts` (real SQL lanes: exact-pin, `turkish` FTS coverage mode, `pg_trgm` `word_similarity`, citator over `legal.document_relations`; `fileIds`/`includeCorpus` file scope), `db.ts`; **W12 write-through Pg stores** (ADR-016): `answerStore.ts` (`PgAnswerStore`: cache + background upsert, `warm`/`list`/`attach`/`flush`), `draftStore.ts` (`PgDraftStore`: one row per draft VERSION), `health.ts` (`checkDatabase` with a 3 s race → `ok|down|missing` + migration ledger count, `describeDatabaseHealth` Turkish line) |
| `control-plane/src/retrieval/` | `hybrid.ts` (RRF, diversity cap, citation expansion on its own `citation` lane at 0.9× seed and UNPINNED, citator lane, divergence completion), `normalize.ts`, `referenceParser.ts`, `rrf.ts`, `searchService.ts`, `corpusErrors.ts` (typed `CORPUS_UNAVAILABLE` — connection-class errors become one Turkish sentence, never driver prose) |
| `control-plane/src/pipeline/` | `answerPipeline.ts` (coverage gate before the drafter, coverage-aware top-8 cap, per-request `useCloudAi` switch, `aiUsed`; **answer time budget** `DEFAULT_ANSWER_TIME_BUDGET_MS = 60_000` checked between stages → PARTIAL + `TIME_BUDGET_EXCEEDED`, 0 = off; quote cap → `QUOTE_TRUNCATED`), `questionIntent.ts`, `stance.ts`, `tamper.ts`, `storeAdapters.ts` |
| `control-plane/src/answer/` | `evidencePack.ts` (`DEFAULT_MAX_QUOTE_CODE_POINTS = 4000`: a longer passage is cut to the best question-lexeme window and offsets/quote/hash describe the shown window, `EvidenceItem.quoteTruncated`), `verifier.ts`, `renderer.ts` (the evidence-bundle contract), **`coverage.ts`** (question-coverage abstention gate: lexical, floor 0.4, `bypassed-by-reference`, ADR-017) |
| `control-plane/src/exhaustive/` | **W19**: the exhaustive Matter analysis census. `units.ts` (analysis units = contiguous runs of whole chunks; code-point slicing), `observations.ts` (deterministic Turkish date/amount/ratio propositions + topic key), `contradictions.ts` (`CONTRADICTION/TENSION/CORROBORATION/INDEPENDENT/INSUFFICIENT_EVIDENCE`), `processingCoverage.ts` (**derived** `complete`, itemized gaps, `refuseExhaustiveClaim`), `runner.ts` (Map→Aggregate→Reduce, reuse keyed on `unitNo + sourceSha256`), `store.ts`, `routes.ts` (`POST/GET /v1/matters/{id}/analysis`) |
| `control-plane/src/llm/` (W19 additions) | `endpointTrust.ts` (`LOCAL_PROCESS`/`TRUSTED_LOCAL_NETWORK`/`CLOUD`; private hosts need an explicit allow-list), `localGenerationConfig.ts`, `localGenerationAdapter.ts` (OpenAI-compatible, model-agnostic, boundary re-checked per call, refuses `draftClaims`) |
| `control-plane/src/matters/` | `types.ts`, `store.ts` (`PgMatterStore` / `InMemoryMatterStore`, `deriveMatterSummary`), `routes.ts` (`/v1/matters*`: CRUD, polymorphic items file/answer/draft/note/event/deadline/**hearing**, `/v1/matters/deadlines`, `items:batch` ≤ 50 with `dedupeKey` suppression, `/search` + `/v1/search/all`, `/activity`, `/hearings/{itemId}/prep`). **W14 files:** `ics.ts` (RFC 5545 generator — deadlines are all-day, hearings are timed with `TZID=Europe/Istanbul` and an embedded `VTIMEZONE`; folding at **75 OCTETS**, UTF-8 aware; `DEADLINE_DISCLAIMER` verbatim in every `DESCRIPTION`), `contacts.ts` + `contactsRoutes.ts` (B-42; one jsonb document under `app_private.settings`, `MAX_CONTACTS = 2000`; the conflict scan is a **POST** because a party name must not sit in a query string), `recordsRoutes.ts` (`DELETE /v1/answers/{runId}`, `DELETE /v1/drafts/{id}`, `GET /v1/drafts/{id}/versions/{n}`), `packageRoutes.ts` (B-30 HTTP end: writes the plan, shells to `export.cli --package`, **reads no bytes and computes no digest itself**) |
| `control-plane/src/settings/` | `store.ts` (`PgSettingsStore` / `InMemorySettingsStore`, `DEFAULT_SETTINGS`, `normalizeSettings`), `routes.ts` (`GET/PUT /v1/settings`, full replace) |
| `control-plane/src/deadlines/` | Pure TS, no I/O: `dates.ts` (strict `YYYY-MM-DD`, GG.AA.YYYY, HMK m.92/2 month clamping), `holidays.ts` (2429 s.K. fixed days, dini bayram 2025–2028 as data, adli tatil 20 Temmuz–31 Ağustos), `rules.ts` (**41 rules; 16 `dogrulandi` — the article text was pulled from mevzuat.gov.tr through the yargi-mevzuat MCP tools on 02.09.2026 — and 25 still `dogrulanmadi`**; every rule carries `nasilDogrulanir` (one sentence: which article to open and what to compare) and the three-valued `adliTatileTabi` (`true` / `false` / `"belirsiz"`, seven of them `"belirsiz"` — the computation then uses the SHORT, safe date and the interface shows both); `DEADLINE_DISCLAIMER` verbatim), `calc.ts` (`computeDeadline`), `routes.ts` (`/v1/deadlines/rules|holidays|compute`) |
| `control-plane/src/ai/` | Cloud AI (Anthropic), default OFF, per-request consent (ADR-018): `config.ts` (`resolveAiConfig`, key in a module-private WeakMap, `AI_LIVE_TESTED = false`), `routes.ts` (`/v1/ai/status|analyze-document|ocr|draft-paragraph`; `AI_LOCKED_SECTION_IDS` = `ek-dogrulama`, `karsi-ictihat` → 400 before the store and the model), `analysis.ts` (exact NFC quote verification → `kaynakli`), `ocr.ts`, `paragraph.ts` (entailment threshold 0.85, fails closed), `types.ts`. **Never live-tested** |
| `control-plane/src/api/` | **`localGuard.ts` (W14 B-04) is the FIRST `app.use("*")`** — before the body limiter, so a rejected request never reaches the pipeline, the intake process or the model: `Host` allow-list (`127.0.0.1`/`localhost`/`::1`, else **421 `FOREIGN_HOST`**), and on state-changing methods a foreign `Origin` **or** a `Sec-Fetch-Site` that is not `same-origin`/`none` → **403 `FORBIDDEN_ORIGIN`** (`text/plain` and `multipart/form-data` are CORS-safelisted, so the browser sends no preflight — that was the measured hole), plus `cache-control: no-store` / `nosniff` / `no-referrer` on `/v1/*`. Then hono server (`server.ts`: `hono/body-limit` before every route — `JSON_BODY_LIMIT_BYTES` 1 MiB / `MULTIPART_BODY_LIMIT_BYTES` 40 MiB → typed `413 PAYLOAD_TOO_LARGE`; `/v1/answer`, `/v1/evidence-bundle`, `/v1/health` composition, `/v1/answers` list + `/v1/answers/*`, `/v1/research-runs*`, mounts every sub-router with ONE shared `answerStore`/`draftStore`), **`matterLink.ts`** (auto-linking of answers/drafts/files to a matter: pre-check `404 MATTER_NOT_FOUND` before work, link failure never fails the request → `MATTER_LINK_FAILED` warning), **`healthReport.ts`** (`reportDatabaseHealth` → `db/dbName/migrations/corpus`), `answerService.ts` (`AnswerStore` contract, `InMemoryAnswerStore`, `boundedAnswerBundle` — `MAX_STORED_TEXT_BYTES` 5 MiB → `STORED_WITHOUT_TEXTS`), `openapi.yaml` (**67 paths / 82 operations** (W16), `info.version` **`1.0.0`** read from the repo-root `VERSION` file — see STATUS S8; W14 added the citation-audit, contracts, fees, sources, backup, contacts, calendar/`.ics`, search, activity, batch, package, original/usage and draft-version paths, plus the additive fields of all seven lanes; **phase C added no path, operation or schema** — only two optional fields, `BackupResult.dumpFile` and `ContraryCoverage.skipped`, neither of them `required` because records written before phase C do not carry them, and corrected descriptions for `error.issues.path/label` and `/v1/backup`), operator console at `/` and `/console` |
| `control-plane/src/research/` | Live deep research: `createResearchRouter` (`POST /v1/research`, `POST /v1/research/start` → 202 + `GET /v1/research/runs/{runId}`, `GET /v1/research/health` with `state`), `mcpSession.ts` (real MCP streamable-HTTP session gateway + 54-tool probe, 85 s call timeout), live planner/executor (per-call `AbortSignal.timeout`, 80 s)/evidence, budget clamps (24/10/120000), **`progress.ts`** (lawyer-Turkish progress labels for all 54 tools), in-memory `ResearchRunRegistry` (16 runs, 30 min TTL); finished runs persist through the answer store |
| `control-plane/src/drafting/` | `createDraftingRouter` (`/v1/drafts*` incl. `GET` list, `PUT` revise → version+1, `/versions`, `/export?format=md\|docx\|udf` with `Content-Disposition` "<Belge> - <Dosya> - v<N>.<ext>" + UTF-8 `filename*`, local-time stamps, `DRAFT_ID_RE` → 404 before the store, `EXPORT_FAILED`/`EXPORT_REFUSED` with `correlationId` and never stderr; `/v1/draft-templates`, **13 templates** with `fieldGroups` and a `domain` each): evidence-disciplined drafts (beyan/İRADE vs bound vs **KAYNAKSIZ**), `runId`/`fileIds` evidence resolution, upload chunks are exhibits (`Ek-n`) and `suggestedFacts`, never claims (ADR-021); **`relevance.ts`** (drafting relevance gate, ADR-022: template `domain` × evidence domain + lexical overlap with the matter → `unusedEvidence` + `unusedReason` `DOMAIN_MISMATCH`/`NOT_RELEVANT`; a referenced entry is never dropped; `evidenceUse:true` overrides); `revise.ts` (`reviseDraft`, contract [D]; **W14**: an `issues[].code` of `QUOTE_ALTERED` and the B-36 review record); **`quoteIntegrity.ts` (W14 B-01)** — the ONE canonical comparison both runtimes agree on (fold the render guard's entity escapes, drop invisible/BiDi characters, NFC, collapse whitespace) and the gate itself: nothing else is forgiven, and the comparison is a SUBSTRING search with no `.length`/`.slice` arithmetic; **`exportMode.ts` (W14 B-02)** — `annex=full\|none` × `marks=all\|none`, where `annex=none&marks=none` is the filable NİHAİ copy and `verify_draft_or_refuse` runs IDENTICALLY in every mode; `store.ts` (`DraftStore`, `InMemoryDraftStore` with versions, `remove`, `getVersionBody`) |
| `control-plane/src/files/` | `/v1/files` lane: `store.ts` (postgres.js reader over tenant uploads + the `DraftingFilePort`; grouped chunk counts, `chunkWindow` pagination 12/200, `pages` stats), `routes.ts` (multipart upload with `matterId`, delete, `?q=` name filter; shells to `intake.cli` via injected exec; typed 400/404/415/422, **503 `STORE_UNAVAILABLE`**, **504 `UPLOAD_TIMEOUT`** at 180 s, **500 `INTAKE_FAILED`** with `correlationId` — stderr only in the server log; `FILE_ID_RE = ^[0-9a-f]{16}$` on DELETE → 404 with no process; `UPLOAD_CAP_MIB = 25` mirrors `intake/quarantine.py` and a test parses the Python line) |
| `control-plane/src/contracts/` | **NEW (W14).** Rule-based, model-free, cloud-free. `citationAudit.ts` (B-13: three buckets `FOUND` / `NOT_FOUND` / `UNCERTAIN`, mandatory `asOf` = the DOCUMENT'S date, an unresolved citation's `kunye` is the EMPTY STRING and is never synthesized, an injected resolver that may throw — a throw yields UNCERTAIN, never NOT_FOUND), `corpusResolver.ts` (`createCorpusCitationResolver` over `exactPinLookup`; `pairArticlesWithTheirLaw` re-joins "6098 sayılı Kanun m. 299", which `parseReferences` returns as TWO references), `draftAudit.ts` (audits OUR OWN draft — no resolver needed, every citation there is already a hashed evidence record), `clauseReview.ts` (B-24: `splitClauses` + `runChecklist` → VAR/YOK/BELİRSİZ; **the word "risk" belongs to a hash-verified quote only** and every Turkish inflection is stripped from an unsourced line), `checklistStore.ts` (`PgChecklistStore` over `app_private.settings`, no DDL), `routes.ts` |
| `control-plane/src/sources/` | **NEW (W14).** `catalog.ts` (26 selectable sources, 19 full-text kinds, 2 "içinde ara" lanes; validated against the capability registry at module load), `searchService.ts` (B-16; a row is a künye and carries NO digest and NO offsets — **a search snippet is never evidence**), `fetchService.ts` (the hash-sealed source card; SAME canonicalization as the live research lane, `verifySourceCard` re-verifies offline), `manifest.ts` (B-14 coverage manifest; an unmeasured cell is `null`, never 0), `localLibrary.ts` (B-20; `DisabledLocalLibrary` is the DEFAULT, so today's behaviour is unchanged), `routes.ts` |
| `control-plane/src/fees/` | **NEW (W14, B-35).** Pure TS, no I/O: `tariffs.ts` (**20 tariff lines for 2026, 5 `dogrulandi`, 17 with `amount: null`**, `FEE_DISCLAIMER` verbatim), `calc.ts` (step-by-step; a missing figure answers `TUTAR_GEREKLI` and the total becomes `null` rather than a guess), `routes.ts` (`/v1/fees/tariffs\|compute`) |
| `control-plane/src/backup/` | **NEW (W14, B-03).** `runner.ts` (`pg_dump -Fc` + originals + **`yedek.json` manifest** with per-file size and SHA-256; a folder without a manifest is not a backup; restore RENAMES rather than drops; `execFile` with an argument array, never a shell; `robocopy /E` merges and never purges), `routes.ts` (`POST/GET /v1/backup`) |
| `control-plane/src/verification/` | `validator.ts` (deterministic citation validator), `finalize.ts` (`canFinalize`) |
| `control-plane/src/planner/` | `intake.ts`, `rulePlanner.ts`, `templates.ts`, `contrary.ts`, `outcomes.ts` |
| `control-plane/src/orchestration/` | Bounded executor + budgets |
| `control-plane/src/security/` | `renderGuard.ts`, `untrusted.ts`, `urlPolicy.ts`, `POLICY.md` (parsed by a test, so it cannot rot) |
| `control-plane/src/llm/` | `ports.ts`, `ruleDrafter.ts` (responsiveness tier `ENRICHMENT`: a passage reached by citation/relation never leads), `lexicalEntailment.ts`, `anthropicAdapter.ts` (raw `fetch`, strict tools, retries; used ONLY when `ANTHROPIC_API_KEY` is set AND the request says `useCloudAi:true`). The rule-based drafter is what runs by default |
| `control-plane/scripts/` | `demo.mjs` (**6-scenario** end-to-end test; refuses to drop `collex_demo` while it holds uploads unless `--force-drop-uploads`), `serve.mjs` (console + API; DB check first, HTTP binds first, `--with-mcp` spawns the real MCP gateway in the background with `mcpState` starting→ok→down; writes `var/collex.pid` + `var/collex-mcp.pid`; default DSN `collex_local`; Pg stores when db `ok`, in-memory fallback otherwise), `serve-mcp.mjs` (real uvicorn MCP gateway, clean env + `COLLEX_NO_DOTENV=1` + `LOG_LEVEL=WARNING`, `--parent-stdin` watchdog, prints `{port,token,pid}`; the bearer token comes from `MCP_API_TOKEN` in its environment ONLY — `--token` throws), `ai-live-smoke.mjs` (manual, key-gated, `--dry-run`), `live-gateway-check.mjs`, `live-research-smoke.mjs`, `ts-loader.mjs` |
| `control-plane/tests/` | vitest suites (**106 files**, S2; `vitest.config.ts` includes ONLY `tests/**/*.test.ts`. The stale `control-plane/test/` and `control-plane/dist/` directories were DELETED in W14 B-44 and a regression test now pins their absence). `tests/integration/` = mounted-app contract tests (fake exec/gateway) + `launcher.test.ts` (parses both `.cmd` files) + guarded REAL suites (`real-exec` against `collex_intake_test`, `serve` incl. the `--with-mcp` process-list check, `store/persistence` against `collex_persist_test`, `matters/pg`, `drafting/real-export`, **`backup` — the B-03 disaster drill against `collex_safe_test`**) that print an honest "environment unavailable" marker when PG/venv are absent. **Those markers are INVERSE**: a skip means the environment was missing, so CI's last step asserts they did NOT skip |
| `VERSION` | **NEW (W14 B-34).** The ONE version string (`1.0.0`); `API_VERSION` reads it and a test pins it equal to `pyproject.toml [project].version` |
| `ColleX-Yedekle.cmd`, `ColleX-Geri-Yukle.cmd` | **NEW (W14 B-03).** Double-click backup / restore. Both read `COLLEX_DATA_DIR`. Restore never drops: it RENAMES the existing database to `collex_local_eski_<tarih>` |
| `ColleX-Baslat.cmd`, `ColleX-Durdur.cmd` | Double-click launcher/stopper for the lawyer (repo root): PG start → `intake.cli --ensure-db --list` (create-only; output in `%TEMP%\collex-ensure-db.log`; a non-zero exit prints a Turkish `STORE_UNAVAILABLE` / schema line and STOPS with `exit /b 1`) → `serve.mjs --port 8787 --with-mcp` in its own window → poll `/v1/health` up to 60 s → browser. Stop order: window → pid files (a pid is killed only if its CommandLine is ColleX's) → processes whose CommandLine matches `serve\.mjs\|serve-mcp\.mjs\|uvicorn asgi_app` → PG stop. **No port-based kill**: a foreign listener on 8787/8898 is never touched |

### Docs

`docs/README.md` is the index. `docs/implementation/STATUS.md` (03.09.2026,
W14 phase C) is the live state and the **only** place a measured number is
written ("Ölçülen sayılar", **S1–S41**) — including the **eight unverified
surfaces** and the **two measured ceilings** that keep the status at PARTIAL.
`docs/implementation/TRACEABILITY.md` carries the W12 rows #31–#60, one row
per W13 backlog item **B-01..B-46**, and one row per verification finding
**V-1..V-22**, each naming its file, its regression test and its STATUS row
(or the reason it is OPEN).
`docs/implementation/waves/` holds the binding "as implemented" contracts:
the W12 block (`W12-A..F`, `W12-INTEGRATION`, `W12-UI-SPEC`, `W12-UI1/UI2`,
`W12-API2`, `W12-B2`, `W12-FIX`, `W12-FIX2`, `W12-DOCS1/2`, `W12-CLOSEOUT`),
the W13 intelligence/design block (`W13-APILEX`, `W13-DEJURE`,
`W13-TRMARKET`, `W13-GLOBAL`, `W13-ARCH`, `W13-ENGRISK`, `W13-DESIGN`,
`W13-COPY`, `W13-DAILYFLOW`, `W13-UXAUDIT`, `W13-FEATURE`, **`W13-BACKLOG`**
— the item specs, the positioning, the 22-row parity matrix and the seven
traps — and `W13-DESIGN-SPEC`), and the W14 build block
(`W14-L-{EVID,ANSWER,SAFE,MATTER,LEGAL,SOURCES,CONSOLE}` for phase A,
**`W14-L-FIX`** for the phase-B1 integration, `W14-L-CONSOLE-B` and
`W14-L-DOCS` for phase B2, **`W14-L-VERIFY`** for the independent
verification round — read it for what the assembled product actually did on a
real server and in a real browser — `W14-F-{PERF,API,UI,DOCS}` for the fixes,
**`W14-F-VERIFY`** for the independent CLOSING audit that re-derived every
verdict and added N-1..N-6, and `W14-C-{SRV,UI}` plus **`W14-C-FINAL`** for
the cleanup lanes and the last measurement).
**Two of those reports carry a later annotation and it matters:**
`W14-L-VERIFY` §2.2 and `W14-F-PERF` §2 quote trigram speed-ups measured at
`word_similarity_threshold` **0.5**, which the answer path never uses; a
dated note at the end of each section says so and points at STATUS S26⁗.
Lane reports are historical records — **annotate, never rewrite**.
`docs/architecture/ADRS.md` holds **ADR-001..028** (023 quote-integrity gate,
024 export modes, 025 localGuard, 026 multi-sentinel ledger, 027 local
library, 028 citation audit). `docs/implementation/AI.md` is the cloud-AI
enablement/consent document; `docs/KULLANIM-ColleX.md` is the lawyer's
Turkish user guide; `docs/COMPETITIVE.md` is the W13 competitive
intelligence, the parity matrix and the seven traps;
`docs/implementation/RUNBOOK.md` §7 lists every request limit, budget and
ceiling.

## Invariants you must not break

- **Tool surface: exactly 54 tools offline; 55 when `OPENROUTER_API_KEY` is
  set** (the conditional `search_bedesten_semantic`). Asserted by
  `tests/test_tool_surface.py`, `scripts/smoke_check.py`,
  `scripts/http_e2e_check.py` and `scripts/live_local_gateway_check.py`.
  MCP responses are **additive-only**.
- **`page_size` is 1..20** on the unified legislation path; the legacy helper
  clamps with `min(..., 20)`. Never restore the old 25..100 contract.
- **Offsets are Unicode code points over NFC canonical text; hashes are
  sha256 over UTF-8** (ADR-003). Never use `.length`/`.slice` code-unit
  arithmetic on canonical text in JS. One fixture
  (`control-plane/fixtures/offset_policy.json`) is asserted by both runtimes.
- **The Python and TypeScript reference parsers are pinned to ONE fixture**
  (`evals/fixtures/reference_parity.json`). Change the behavior in both, or in
  neither.
- **No facade may return a silent empty list on upstream failure** —
  `tests/test_facade_contracts.py` exists to stop exactly that.
- **Chunks within a version must not overlap** (ADR-013) — it is what makes a
  citation have one identity.
- **`processingCoverage` and `coverage` are DIFFERENT CONCEPTS** (ADR-032).
  `control-plane/src/answer/coverage.ts` measures how much of the QUESTION
  the evidence answers and gates abstention; its meaning is locked by tests.
  `control-plane/src/exhaustive/processingCoverage.ts` measures how much of
  the SELECTED SCOPE was read. Never conflate them, and never rename either.
- **`complete` is derived in exactly one function** (`deriveCoverage`). No
  model may influence it, no other site may compute it, and an empty scope is
  never complete. Before rendering "dosyanın tamamı" / "tüm çelişkiler",
  call `refuseExhaustiveClaim`.
- **Source-locator ranges are measured AFTER NFC, per block** (ADR-029).
  `ingestion/locators.py` normalizes each block before taking its span and
  verifies the map at run time; if verification fails it returns NO map. An
  unreadable page is stored as an EMPTY range, never omitted.
- **Matter scope never widens** (ADR-030). Explicit file ids given alongside
  a matter are VERIFIED against membership and anything outside is refused by
  name. Membership is a link — one file may belong to many matters and is
  never duplicated.
- **Dense results are untrusted input** (ADR-031). `chunkProvenanceByIds`
  re-applies the same visibility filter the ranked lanes use; an index may
  never put a chunk into an answer that the database would not return.
- **`LOCAL_ONLY` has no fallback** (ADR-033). A private LAN inference host
  must be listed explicitly; `llm/endpointTrust.ts` and
  `security/urlPolicy.ts` are OPPOSITE policies and must not be merged.
- **RLS resolves tenancy through the owning document** (ADR-011). Do not add a
  child table with a plain grant and no policy; that was a P0 leak.
- **Temporal close-on-append lives in the database** (ADR-012). Do not move it
  into application code, and never reintroduce `'infinity'` as an open-ended
  range bound — it is a finite value and `upper_inf()` returns false for it.
- **Every runnable migration MUST carry a `-- [LEDGER SENTINEL]
  <kind>:<name>` probe line** (ADR-020 as amended by FIX-2), where `kind` is
  one of `regclass` · `regprocedure` · `extension` ·
  `column:<schema.table>.<col>` · `trigger:<schema.table>.<name>` and a bare
  name means `regclass` (so `app_private.settings` stays valid). The probe
  must name something the migration itself creates. The ledger bootstraps a
  pre-ledger database by recording ONLY the files whose probe resolves — no
  timestamp rule — and writes the ledger table plus the bootstrap rows in
  ONE transaction (a crash mid-bootstrap leaves no ledger table).
  `control-plane/src/store/health.ts` resolves the same probes with the same
  SQL CASE, so `/v1/health migrations.missing` agrees with Python.
  Test-enforced for all **13** runnable files:
  `tests/ingestion/test_migrations_ledger.py` (parseable unique probe per
  file, grammar, psql-built DB bootstrap, every kind resolves, atomic
  bootstrap) and `control-plane/tests/store/persistence.test.ts`. The ledger
  table itself is created by `ingestion/migrations.py`, never by a migration
  file.
- **Request bodies are bounded before any route runs**: `JSON_BODY_LIMIT_BYTES`
  = 1 MiB (non-multipart), `MULTIPART_BODY_LIMIT_BYTES` = 40 MiB (the 25 MiB
  upload and 32 MiB OCR caps still apply per route), `MAX_ITEM_PAYLOAD_BYTES`
  = 64 KiB per matter item; all three answer a typed `413 PAYLOAD_TOO_LARGE`
  with a Turkish message (`tests/api.test.ts`, `tests/matters/routes.test.ts`).
  Do not raise them to make a request fit; split the input.
- **The answer pipeline has a wall budget** (`DEFAULT_ANSWER_TIME_BUDGET_MS`
  = 60 000, checked between stages; 0 disables) and a quote cap
  (`DEFAULT_MAX_QUOTE_CODE_POINTS` = 4 000): over budget the drafter is
  skipped and the answer is PARTIAL with `TIME_BUDGET_EXCEEDED`; a cut quote
  keeps offsets/quote/hash consistent for the shown window and says
  `quoteTruncated`. Never make a truncated quote look whole.
- **The MCP bearer token never appears on a command line**: `serve.mjs` hands
  it to `serve-mcp.mjs` through `MCP_API_TOKEN` in the child's environment,
  and `serve-mcp.mjs --token …` throws. `tests/integration/serve.test.ts`
  inspects the real process list for `--token` and 48-hex tokens.
- **A child process's stderr never reaches an HTTP body**: `INTAKE_FAILED` /
  `EXPORT_FAILED` / `EXPORT_REFUSED` carry `detail` + `correlationId` and
  the stderr goes to the server log line with that id.
- **AI paragraphs cannot target `ek-dogrulama` or `karsi-ictihat`**
  (`AI_LOCKED_SECTION_IDS` → 400 before the store and the model), and a filed
  file/answer/draft item's `refId` is immutable (`REF_ID_IMMUTABLE_MESSAGE_TR`
  → 400; remove and re-add).
- **Naming rule for the cloud lane (LANG-7, rewritten in W15):** the lane has
  **exactly one name on screen — "bulut yapay zekâ"** ("Bulut yapay zekâ"
  sentence-initially and as a label: pills, field labels, chips, dialog
  titles). The old short label **"Bulut AI" is now forbidden too**: "AI" is an
  English abbreviation that never appeared expanded on any screen, and the
  wave's rule is that a lawyer may not meet an unexplained token. Never
  "Bulut AI", "Bulut Yapay Zekâ", "bulut ai", "BULUT AI", "yapay zeka" (no
  circumflex) or "Cloud AI" in Turkish user-facing text (`console.test.ts`
  "names cloud AI …" forbids all of them).
- **`control-plane/public/console.html` is LF-only, has exactly one
  `<style>` and one `<script>`, and assigns text with `textContent` only**
  (no markup-assigning API, no dynamic code evaluation, no remote asset;
  the served CSP pins the inline hashes). Enforced by
  `control-plane/tests/pipeline/console.test.ts`. Do not "improve" it by
  injecting HTML.
- **The upload cap has ONE source: `UPLOAD_CAP_MIB = 25` in
  `intake/quarantine.py`**; `control-plane/src/files/routes.ts` mirrors it and
  `tests/files/uploadCap.test.ts` parses the Python line. Change both or
  neither. (Kept at 25 MB on purpose: the upload is one synchronous intake
  process under a 180 s budget with no progress channel.)
- **The deadline disclaimer is verbatim and everywhere**
  (`DEADLINE_DISCLAIMER` in `control-plane/src/deadlines/rules.ts`): every
  `/v1/deadlines/compute` response, every card, **every `.ics` VEVENT's
  `DESCRIPTION`** and every export that shows a computed date carries it
  unchanged. Of the 41 rules, **16 are `dogrulandi` and 25 are
  `dogrulanmadi`**; a rule may only flip to `dogrulandi` **with the article
  text in hand**, and `tests/deadlines/rules.test.ts` REJECTS a sourceless
  one — the source must name the article (`m.NNN`), the access date
  (GG.AA.YYYY) and mevzuat.gov.tr, and may not say "bilgisine dayanır" or
  "çekilmedi".
- **The same discipline governs fees** (`FEE_DISCLAIMER` in
  `control-plane/src/fees/tariffs.ts`, verbatim on every `tariffs` and
  `compute` response). A yearly monetary amount is **NEVER invented**: a
  line whose Resmî Gazete figure ColleX does not know carries
  `amount: null`, the computation answers `TUTAR_GEREKLI` and the total
  becomes `null`. A wrong fee is a rejected filing; a null is the honest
  answer, and a test enforces both halves.
- **The quote-integrity gate (ADR-023) may not be softened.** A paragraph
  must contain the quote it cites VERBATIM in the one canonical form both
  runtimes agree on (`quoteIntegrity.ts` ↔ `export/draft.py::canonical_quote_text`
  — **the two change together or neither changes**): fold the render guard's
  entity escapes, drop invisible/BiDi characters, NFC, collapse whitespace.
  Nothing else is forgiven — one letter, one digit, one word and the bond
  breaks. The gate stands in TWO independent layers (the PUT path breaks the
  bond immediately; the export path catches a draft that entered the store
  another way) and refuses with **409 `EXPORT_REFUSED` / `QUOTE_ALTERED`**
  without spawning the exporter. Never replace it with a similarity score.
- **Export modes control CONTENT ONLY, never verification** (ADR-024).
  `annex=none` drops the künye table, the warnings, `EK — DOĞRULAMA
  BİLGİLERİ`, the `DAYANAK KAYNAKLARI` appendix and the format notes;
  `marks=none` drops the screen marks. `annex=none&marks=none` is the filable
  NİHAİ copy. But `verify_draft_or_refuse` — quote digests, citation closure,
  the KAYNAKSIZ count and the B-01 check — runs **identically in every
  mode**, and the mandatory review band and the footer stay in every mode.
  **Removing the ink does not remove the discipline.**
- **`localGuard` is the FIRST middleware and its two rules are not
  negotiable** (ADR-025): a `Host` outside `127.0.0.1`/`localhost`/`::1` is
  **421**, and a state-changing request with a foreign `Origin` or a
  `Sec-Fetch-Site` that is not `same-origin`/`none` is **403
  `FORBIDDEN_ORIGIN`** — including `/v1/ai/*`, whose per-request consent is
  a body field the attacker could otherwise write. It runs before the body
  limiter so a rejected request never reaches the pipeline, the intake
  process or the model. Do not move it, and do not exempt a route.
- **A migration may declare SEVERAL ledger sentinels** (ADR-026, amending
  ADR-020): `-- [LEDGER SENTINEL] <kind>:<name>`, kind ∈ `regclass` ·
  `regprocedure` · `extension` · `type` · `column` · `trigger` · `policy` ·
  `constraint` (a bare name means `regclass`). Every runnable file probes
  its FIRST and its LAST created object, and **bootstrap records the file
  only if ALL of its probes resolve** — that is what closes the
  half-applied-migration blindness. `ingestion/migrations.py` and
  `control-plane/src/store/health.ts` resolve the SAME probes with the SAME
  SQL CASE, and `apply_missing_migrations` holds a session-level
  `pg_advisory_lock` so two concurrent `--ensure-db` runs cannot race.
- **`/v1/health.rls` must equal `expected`.** A complete database carries
  **18** policies. `present < expected` means a migration ran half-way and
  client rows are unprotected; never lower `expected` to make it match.
- **Cloud AI runs only when `ANTHROPIC_API_KEY` is set AND the request
  itself carries `useCloudAi: true`** (per-request consent, no remembered
  consent; ADR-018). The key goes into the server window's environment or a
  user-level Windows variable — **never into this repo's `.env`**, which no
  code path reads for it. Nothing about the cloud lane has been tested
  against the live API; `liveTested:false` stays until
  `docs/implementation/AI.md` records a smoke run.
- **Uploaded document chunks are exhibits, never legal assessment** (ADR-021):
  a draft lists an upload as `Ek-n` in DELİLLER and may offer
  `suggestedFacts`, but never writes a hukukî değerlendirme paragraph or a
  Dayanak from it.
- **The trigram lane is a FALLBACK with its own wall budget** (W14-F-PERF,
  V-1): `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS = 8` — it runs only when exact +
  lexical produced fewer than 8 distinct passages — and
  `DEFAULT_TRIGRAM_BUDGET_MS = 2 500` is applied as a transaction-local
  `statement_timeout` that may only LOWER the connection's limit. A cut lane
  raises a typed `TrigramBudgetExceededError` (`TRIGRAM_BUDGET_EXCEEDED`);
  the driver's "canceling statement due to statement timeout" prose must
  never reach a warning again. Every query carries a `TrigramReport` where
  `SKIPPED_PRIMARY_SUFFICIENT` and `EXECUTED_NONE_FOUND` are DIFFERENT
  answers — "did not find" is not "never ran". **This gate is a measured
  recall change, not a free optimization** (a ninth passage reachable only by
  fuzzy match no longer arrives); say so wherever the latency gain is
  mentioned, and do not expose either constant through `searchRequestSchema`
  — a caller may only ask for less work, never more.
- **Two trigram thresholds exist and they are different on purpose**
  (W14-C-SRV §6): `DEFAULT_SEARCH_LIMITS.trigramMinSimilarity` = **0.5**
  (`retrieval/hybrid.ts`), `DEFAULT_ANSWER_LIMITS.trigramMinSimilarity` =
  **0.35** (`api/answerService.ts`), and `clampAnswerLimits` can only raise a
  caller's value — so **`/v1/answer` runs at 0.35 and NEVER at 0.5**. Every
  published speed-up for the `TRIGRAM_SEQSCAN_SETTING` hammer (≈490×, ≈9 700×,
  0,329 ms) was measured **at 0.5**; **never quote one of them for
  `/v1/answer`**. Three probe corpora produced three different plan tables
  (STATUS S26⁗), so those figures are a property of a corpus and a query, not
  of the threshold or the setting. Raising the answer threshold to 0.5 was
  tried and **reverted**: no measurable time gain, and one gold row lost its
  `CONFLICTING_AUTHORITIES` caveat. The lane's cost is bounded by
  `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS` and `DEFAULT_TRIGRAM_BUDGET_MS`, not by
  the threshold. `tests/api.test.ts` pins both defaults, the clamp direction,
  and that `chunkStore.ts`'s comment still attributes the old numbers to 0.5.
- **The backup archive is named after the database it holds** (W14 V-14):
  `backupDumpFileName(database)` in `src/backup/runner.ts` DERIVES the name
  (every character outside `[A-Za-z0-9_.-]` → `_`, leading dots → `_`, empty →
  `veritabani`), so no database name can produce a path separator, a parent
  reference or a hidden file. `BackupResult.dumpFile` is additive;
  `verifyBackup`, `backup.mjs --dump-name` and `ColleX-Geri-Yukle.cmd` all read
  the name from `yedek.json` instead of assuming it. `collex_local` still
  yields `collex_local.dump`. Never reintroduce a constant file name — the old
  restore check only worked because every backup happened to share one.
- **A `.strict()` rejection names the field it rejected** (W14 V-19). zod puts
  `unrecognized_keys` on the CONTAINING object's path, which is empty for the
  body, so every strict route goes through ONE helper,
  `src/api/zodIssues.ts::fieldIssues` — one issue per rejected key, named by
  that key (two extra fields are two lines, never one joined dotted string),
  a nested rejection reads `profile.imza`, and the label is
  `Fazladan alan (<anahtar>)`: Turkish first, machine string in parentheses.
  No issue in a 400 body may have an empty `path`.
- **The contrary-authority scan is skipped only when it provably cannot
  matter** (W14 V-21): nothing `pinned` AND
  `assessQuestionCoverage(...).bestPassageCovered === 0`, i.e. the coverage
  gate is certain to set every passage aside. `ContraryCoverage.skipped`
  (additive) is what separates "no contrary query could be built" from "built,
  then not needed", and the sentence on screen must say which. **One anchoring
  or pinned passage and every contrary lane runs as before** — two guard tests
  measure exactly that, so do not widen the condition.
- **`answerStore.list({fileId})` must use the index's own expression**
  (`result -> 'fileScope' @> '{"fileIds":["<id>"]}'`), not `result @>
  '{"fileScope":{"fileIds":[…]}}'`. The second shape is correct and produces
  a `Seq Scan`; `answers_filescope_gin` never sees it.
  `tests/store/persistence.test.ts` asserts the PRODUCT's own call advances
  `pg_stat_user_indexes.idx_scan` and forces no planner setting.
- **The originals directory has ONE resolver, and it is now literally one
  function.** `createApp` calls `resolveUploadsDir({uploadsDir, repoRoot})`
  (`src/api/healthReport.ts`) exactly once — `<COLLEX_DATA_DIR>/uploads`, else
  `<repo>/var/uploads`, always absolute — and gives the SAME string to
  `createFilesRouter`, to `createMatterPackageRouter` **and to
  `/v1/health.uploadsDir`**; the routers' own fallbacks were moved up into
  `createApp` so no third computation can appear. Two code paths computing it
  independently is exactly how "Aslını indir" answered 404 for every document
  on a `COLLEX_DATA_DIR` installation (V-4).
  `tests/integration/healthUploadsDir.test.ts` pins the BOND, not the field:
  the folder health prints is the folder `GET /v1/files/{id}/original` reads.
- **A count the provider did not publish is `null`, never 0** (W14 phase M,
  `totalRecords` on `POST /v1/sources/search` — the result and each `trace[]`
  row). "Not in the archive" and "we could not find out" are different
  sentences and only one of them may be shown as a number: a provider that
  really answers 0 keeps its 0, a failed source is always `null`, and the
  total is the sum of the sources that published a count (758 + unknown =
  **758**). The console reads `null` as "kaynak … bildirmedi", never as 0.
  The same rule already governs the coverage manifest and the fee tariffs;
  it has no exceptions.
- **A long wait must say what it is doing and be stoppable, and it may not
  invent a number** (W14 phase M, `beginBusy` in `console.html`). Every long
  operation draws a progress card with a phase sentence that states only what
  is actually known, the elapsed time the BROWSER measured, and a cancel
  button whose `AbortSignal` really reaches `fetch`; a cancelled request is
  never redrawn as an error. **There is no percentage** — the server reports
  no progress, and a percentage would be exactly the unmeasured number this
  project forbids. Two deliberate exceptions, each with its reason written on
  screen: **backup has no cancel** (a half-copied folder is not a backup) and
  **`<a download>` exports have no progress bar** (the page cannot see them
  finish). Do not add a spinner to something whose completion you cannot
  observe.
- **A list filter either really filters or answers 400** — including
  `GET /v1/answers`, whose `q` and `status` were read by both stores and
  never fed from HTTP until W14-F-API. An unrecognized query parameter is a
  typed 400 that NAMES it (`ANSWER_LIST_QUERY_PARAMS`), the contract
  `/v1/files` already enforced. A silently dropped filter is worse than an
  error: the lawyer reads an unfiltered list believing it was filtered.
- **A screen asks the ENDPOINT, not the health badge.** `/v1/health.mcp:"ok"`
  was true while `POST /v1/sources/search` answered 502; a health pill is a
  claim about a child process, not about the route the lawyer is about to
  use. A screen whose endpoint refuses is drawn DISABLED with the reason
  written into it (the vaporware gate, W13-BACKLOG §G.3.4).
- **No toast may print a bare `HTTP <code>`.** `httpStatusTR` turns every
  status into a Turkish sentence and the machine code survives only in
  parentheses after it; a `console.test.ts` regex sweep over every
  `toast(...)` call keeps that closed.
- **The whole project must typecheck cleanly** (`npx tsc --noEmit`) when you
  finish.

## Scratch database discipline — which lane owns which name

One local PostgreSQL 18 cluster on **port 55432** (user `postgres`, no
password) serves everything. Each script creates and drops exactly one
database and **refuses every other name**. Never point one lane at another's
database.

| Database | Owner |
|---|---|
| `collex_mig_test` | `scripts/db_local_check.py` |
| `collex_eval_test` | `scripts/run_evals.py` |
| `collex_ingest_test` | `ingestion/cli.py` and `tests/ingestion/` |
| `collex_intake_test` | `tests/intake/` and `control-plane/tests/integration/` (real-exec suite) |
| `collex_demo` | `control-plane/scripts/demo.mjs` (read by `serve.mjs --dsn ...collex_demo`). Refuses to drop itself while it holds `UPLOAD` rows unless `--force-drop-uploads` — use that flag only for YOUR OWN probe uploads |
| `collex_persist_test` | `tests/ingestion/test_migrations_ledger.py` and `control-plane/tests/store/persistence.test.ts` (run sequentially; dropped at the end of each run) |
| `collex_retrieval_test`, `collex_quality_test` | `control-plane/tests/store/retrieval.test.ts`, `control-plane/tests/quality/retrievalQuality.test.ts` |
| `collex_answer_test` | **W14.** `control-plane/tests/store/retrieval.test.ts` block (k) — the B-06 query-plan regression; created and dropped inside the block, so `collex_retrieval_test` never sees one of its rows |
| `collex_safe_test` | **W14.** `control-plane/tests/integration/backup.test.ts` — the B-03 disaster drill. This suite DESTROYS its database on purpose; a class constant refuses to run `resetDrillDb` against any other name |
| `collex_matter_test` | **W14.** L-MATTER's B-29 search probe (`searchProbe.mjs`); created and dropped by the probe |
| `collex_fix_test` | **W14.** The phase-B1 integration probe (multi-sentinel `constraint:` kind, the B-06 saturated-corpus measurement); dropped at the end of the run |
| `collex_final_test` | **W14 phase F.** The closing audit's own 20 000-chunk probe (`W14-F-VERIFY` §2); created, measured, **dropped** |
| `collex_srv_test` | **W14 phase C.** C-SRV's probe: the V-14 backup/restore round trip and the trigram-threshold measurement; created, measured, **dropped** |
| `collex_local` | **Persistent** local product store — created by `intake.cli --ensure-db`, default DB of `serve.mjs` and the launcher. NEVER dropped, NEVER touched by tests, NEVER given test data. Probes go to `collex_demo` |

If you add a database-backed lane, give it a new `collex_*` name and make its
script refuse all others. `intake.cli --ensure-db` is create-only and accepts
ONLY `collex_local` / `collex_intake_test`; on an EXISTING database it applies
the migrations the ledger says are missing (bootstrapping the ledger first on
a pre-ledger database) and reports
`migrationsApplied` / `migrationsBootstrapped` / `migrationsAlreadyApplied`.

## Environment contract (names only — never write values anywhere)

- HTTP auth: `REQUIRE_HTTP_AUTH`, `MCP_API_TOKEN` (>= 32 chars), `ALLOWED_ORIGINS`.
- Search providers (**fail-closed** when empty — tools report a
  disabled/missing credential and never fall back to an embedded key):
  `BRAVE_API_TOKEN` (KVKK), `TAVILY_API_KEY` (BDDK + Sigorta Tahkim).
- Embeddings: `OPENROUTER_API_KEY`, `OPENROUTER_EMBEDDING_MODEL`,
  `OPENROUTER_EMBEDDING_DIMENSION`, `EMBEDDING_PROMPT_STYLE`,
  `EMBEDDING_PROVIDER`, `LOCAL_EMBEDDING_BASE_URL`, `LOCAL_EMBEDDING_API_KEY`,
  `LOCAL_EMBEDDING_MODEL`, `LOCAL_EMBEDDING_DIMENSION`.
- Rate limits: `BEDESTEN_RATE_CAPACITY`, `BEDESTEN_RATE_REFILL_S`,
  `BEDESTEN_RATE_MAX_WAIT_S`, `BEDESTEN_BREAKER_*`,
  `BEDESTEN_BULKHEAD_MAX_CONCURRENT`, `EMSAL_RATE_CAPACITY`,
  `EMSAL_RATE_REFILL_S`, `EMSAL_RATE_MAX_WAIT_S`.
- Local database: `COLLEX_DB_HOST`, `COLLEX_DB_PORT`, `COLLEX_DB_USER`
  (db_local_check), `COLLEX_EVAL_DSN` (run_evals), `COLLEX_DB_URL`
  (control-plane).
- Cloud AI (W12, opt-in): `ANTHROPIC_API_KEY` (absent = the whole lane is
  OFF), `COLLEX_AI_MODEL` (default `claude-sonnet-5`), `COLLEX_AI_BASE_URL`,
  `COLLEX_AI_TOOL_CHOICE` (`forced` | `auto`). Set them in the server
  window's environment or as user-level variables — **not in `.env`**.
- Process hygiene: `COLLEX_NO_DOTENV=1` makes `mcp_server_main.py` and
  `mevzuat_client.py` skip `load_dotenv` (set by `serve-mcp.mjs` for the
  child); `LOG_LEVEL` sets the MCP gateway's root/console log level
  (standard names; unknown → INFO).
- Misc: `MEVZUAT_ENABLE_LEGACY_PLAYWRIGHT`, `MISTRAL_API_KEY`, `HOST`, `PORT`.
- `.env` contains real keys. **Never read, print, log or copy `.env`.**

## Commands

### Python

Always the venv interpreter:

```bash
.venv/Scripts/python.exe <script>     # Windows
.venv/bin/python <script>             # POSIX
```

Do **not** use bare `python` (system 3.14 is unsupported; `requires-python` is
`>=3.11,<3.14`). Do **not** use `uv run` or `uv sync` on this checkout: `uv run`
re-syncs and can remove packages, and `uv sync --group dev` fails here because
the repo path contains non-ASCII characters (`yargı-anıl`) and the editable
build cannot handle it. To add a package:

```bash
uv pip install --python .venv/Scripts/python.exe <pkg>
```

### control-plane

`npm ci` only. **`npm install` and edits to `control-plane/package.json` are
forbidden.** The available set is fixed: typescript, vitest, zod, hono,
`@hono/node-server`, postgres@3.4.9, `@types/node`.

### Servers

```bash
.venv/Scripts/python.exe mcp_server_main.py                        # stdio MCP
.venv/Scripts/python.exe -m uvicorn asgi_app:app --port 8000       # HTTP MCP
node control-plane/scripts/serve.mjs                               # console + /v1 API (DSN default: collex_local; port 8787)
node control-plane/scripts/serve.mjs --with-mcp                    # + real MCP gateway child (background) -> live /v1/research
node control-plane/scripts/serve-mcp.mjs                           # MCP gateway alone (prints {port,token,pid})
ColleX-Baslat.cmd / ColleX-Durdur.cmd                              # the lawyer's launcher/stopper (Windows, repo root)
ColleX-Yedekle.cmd / ColleX-Geri-Yukle.cmd                        # W14 B-03: backup / restore (Windows, repo root)
node control-plane/scripts/serve.mjs --library-dir var/library     # W14 B-20: queue live-research documents locally
node control-plane/scripts/backup.mjs --database collex_local --out <folder>
node control-plane/scripts/backup.mjs --verify <folder>            # re-checks every SHA-256 in the manifest
python -m intake.cli --dsn <dsn> --dir <folder> --json             # W14 B-19: folder intake (<= 200 files)
python -m export.cli --audit <report.json> --out <x.docx> --format denetim-docx
python -m export.cli --review <report.json> --out <x.docx> --format inceleme-docx
python -m export.cli --package <plan.json> --out <x.zip> --format dosya-paketi-zip
```

`ColleX-Durdur.cmd` now stops GENTLY: it drops `<data>/collex.stop` FIRST and
waits up to 6 s for the pid file to disappear. `serve.mjs` removes that pid
file only after `flush()` + `sql.end()`, so **the pid going away means the
records were written**. Only then does it fall back to a hard kill. There is
still **no port-based kill**: a foreign listener on 8787/8898 is never
touched.

### Offline checks (safe anytime; all nine verified exit 0 on 2026-09-03)

```bash
.venv/Scripts/python.exe -m pytest tests evals/tests -q     # 1352 passed (S3)
.venv/Scripts/python.exe scripts/smoke_check.py             # 54 tools (S4)
.venv/Scripts/python.exe scripts/http_e2e_check.py          # 54 tools over HTTP
.venv/Scripts/python.exe scripts/live_local_gateway_check.py # 54 over the real MCP transport (LOOPBACK ONLY)
.venv/Scripts/python.exe scripts/db_local_check.py          # 19/19 PASS (S5; needs scratch PG; c15 = hearing kind + search indexes)
.venv/Scripts/python.exe scripts/run_evals.py               # RESULT: PASS (S6; needs scratch PG + npm ci; 34 gold rows)
.venv/Scripts/python.exe scripts/run_evals.py --repeats 4   # same, but the answer layer prints a BAND (S40/S41;
                                                            #   width zero today: "identical across them")
node control-plane/scripts/demo.mjs                         # 6/6 scenarios PASS (S7; S6 = DOSYA BAĞI, 10 checks)
cd control-plane && npx tsc --noEmit && npx vitest run      # clean; 106 files, 2145 passed, 6 skipped (S1, S2)
                                                            # (the 6 skips are INVERSE markers — "environment
                                                            #  unavailable" in real-export, store/persistence,
                                                            #  matters/pg, integration/{serve,real-exec,backup}.
                                                            #  With scratch PG + venv present the REAL suites
                                                            #  run and only the markers skip.)
```

**Never write one of those numbers into prose.** They live in the STATUS
"Ölçülen sayılar" table (S1–S41); when you re-measure, patch that table and
cite the row. Other counts that docs quote and tests pin — all of them STATUS
rows: `openapi.yaml` **67 paths / 82 operations / 140 schemas** (W16),
`info.version` **`1.0.0`** (S8); **14** draft templates (W16 added hukukî mütalaa), each with a `domain`,
and **8** field groups (S9); **41** deadline rules, 16 `dogrulandi` (S10);
**20** fee tariff lines, 5 `dogrulandi`, 17 with `amount: null` (S11);
**13** runnable migrations of 15 files, every one carrying a ledger probe
(S12); **54** tools, all reachable (S14).

**`vitest` and `run_evals.py`'s answer layer are both deterministic again —
and a single run of the second is still not the result. Read the band.**

`npx vitest run` used to go red once in seven (N-8) because
`tests/store/retrieval.test.ts` block (l) set `trigramBudgetMs: 1` and raced a
wall clock. **Phase M closed it** (STATUS S39): the block now injects a
`pg_sleep(0.05)` into the lane's own transaction — fifty times the budget, so
the cancellation is certain and still follows the production path — and two
non-vacuity proofs live inside the test. **Nine consecutive green full runs**
(M-SRV 6, M-CLOSE 3). A red run there is now a real finding: investigate it,
do not re-run until it goes away.

**One command's numbers are still read as a band, and the band is now width
zero** (N-7, STATUS S6/S40/S41). `run_evals.py`'s **hard gates** and its
retrieval metrics were always stable — six consecutive runs on one tree gave
identical Recall@5, lane distribution, citation resolvability and quote/hash
integrity, and every gate PASSed every time, including the band gate (an
`acceptable_abstention` gold row must be answered in **no** repeat). Its
**report-only answer layer** was not, and now is: six consecutive runs after
the fix give ABSTAIN 14 · COMPLETE 13 · PARTIAL 3 · QUALIFIED 4, one false
abstention (`fx-amend-002`, in all six), zero false answers and a finalizable
rate of 81,0 %, and `--repeats 4` prints `stable: true` on every row
(`identical across them`). Before the fix the same six runs gave COMPLETE
11–14, QUALIFIED 4–6 and a false abstention in three of six.

**The band stays, and so does the rule that produced it.** A zero-width band
is the only PROOF of stability on the tree in front of you; one run never is,
and **two agreeing runs are not either** — the round that found this had two
runs agree digit for digit before the next four disagreed. Keep using
**`--repeats N`** and quote the band.

Four ingest-minted ids were removed from ordering paths to get here, and only
the last one mattered: the citator lane's two queries and the pinned-legislation
window (`chunkStore.ts`), `ingestion/relations.py`'s candidate-law query, and
finally `answerPipeline.ts`'s rank stage, which broke a score tie on
`hit.chunkId`. Every passage reached by the citation, citator or contrary lane
carries `fusedScore: 0`, so the tie group was most of the candidate list and
the uuid alone ordered it; the coverage-aware top-8 cap then kept a different
set after every ingest. It now sorts on `(source, external_id, ordinal)` with
`chunkId` last — the same key `chunkStore.stableTieBreak` and
`hybrid.stableKey` use. **Any new ordering, cap or LIMIT in the store,
retrieval, answer or pipeline layers must end on that key, never on a uuid.**
The one ingest-dependent thing left is a LABEL, not a number:
`deterministicEvidenceId` hashes `documentVersionId`, so the `ev-<hex>` strings
inside three gold rows' `reasons` differ between ingests. Do not "fix" it
casually — `evidenceId` is a persisted identifier in stored answers, drafts and
evidence bundles.

`/v1/health` reports `templates`, `deadlineRules`,
`registeredToolCount`, `db`/`dbName`/`migrations` (with `unknown`), **`rls`**,
**`backup`**, `mcp`, `ai`, `corpus`, `version` and **`uploadsDir`** (W14
phase M, additive, absolute; correct even when `db` is `down`).

`scripts/live_local_gateway_check.py` is **offline-safe despite its name**: it
launches a real uvicorn worker on loopback with every provider key blanked and
makes no external request.

### Live checks (real network, real keys, **sequential only — never two at
once**; court and legislation share one Bedesten quota)

```bash
.venv/Scripts/python.exe scripts/live_regression_check.py
.venv/Scripts/python.exe scripts/live_remaining_check.py
.venv/Scripts/python.exe scripts/embedding_quality_check.py
```

In CI these exist only in `.github/workflows/live-checks.yml`
(`workflow_dispatch`). `ci.yml` must stay fully offline. Its five jobs are
`python-offline`, `eval-gate`, `control-plane`, `secret-scan`, `sql-syntax`.

### Offline test pattern

Blank the provider env vars **before importing server modules**
(`scripts/smoke_check.py` lines 10-13):

```python
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""
os.environ["MCP_API_TOKEN"] = "offline-smoke-token-0123456789abcdef"
```

In-memory MCP testing (no network/process overhead):

```python
from fastmcp import Client
from mcp_server_main import app

async with Client(app) as client:
    tools = await client.list_tools()          # expect 54 offline
    result = await client.call_tool("search_bedesten_unified",
                                    {"phrase": "mülkiyet", "pageSize": 5})
    data = json.loads(result[0].text)          # results arrive as TextContent
```

## Conventions that still hold

- **Empty-string defaults instead of Optional/None** for tool params
  (token-efficient schemas). Do not reintroduce `Optional[...] = None`.
- **MarkItDown + BytesIO** for HTML/PDF → Markdown (in-memory, no temp files).
- **5,000-character pagination** for long documents (`current_page`,
  `total_pages`, `is_paginated`).
- Bedesten date params accept `YYYY-MM-DD` (auto-converted to ISO 8601) or
  full ISO 8601; exact-phrase search uses escaped quotes: `"\"tam ifade\""`.
- Every client exposes `close_client_session()`; cleanup is wired via
  `atexit.register(perform_cleanup)`.
- Structured, English code comments. Turkish is fine in user-facing docs
  (`KULLANIM-REHBERI.md`, `docs/legal/`, `docs/DEMO.md`).
- A defect fixed in a migration gets its diagnosis written into the migration
  header **and** a regression check in `scripts/db_local_check.py`.

## Known constraints — do NOT do

- Do not use Supabase or Resend remote services / MCP tools. Ever.
- Do not execute `supabase/migrations/20260826080000_*` or `20260826090000_*`
  locally — pgvector is absent and they are syntax-validated only.
- Do not run multiple server workers/replicas: the in-process token bucket
  cannot coordinate quota across processes. **Single worker.**
- Do not run live check scripts in parallel (locally or in CI).
- Do not commit, print or copy secrets; no hardcoded fallback credentials,
  ever (`docs/security/incident-2026-08-26-embedded-tokens.md` is **still
  OPEN** — the old embedded Brave/Tavily keys are fully public and must be
  rotated by the user).
- Do not accept or emit `page_size` outside 1..20 on legislation search.
- Do not change the 54/55 tool count or any existing tool contract.
- Do not add network calls to `tests/`, `evals/tests`, or any `ci.yml` job —
  mock `httpx` (respx) or inject fakes.
- Do not weaken, skip or delete a test to make a suite green, and do not tune
  a metric by special-casing the gold set.
- Do not expose the operator console beyond `127.0.0.1` — it has no auth.
- Do not treat `../_baseline-backup/` as disposable: it preserves the user's
  pre-fix state (including old key values), stays outside the repo, and must
  never be committed.
- Do not describe fixture-corpus measurements as legal-quality results, and do
  not describe anything in this repo as having reached a live Supabase project.
- Do not write test data into `collex_local`, and do not drop it. Probe against
  `collex_demo` (rebuilt by `demo.mjs`); pass `--force-drop-uploads` only for
  uploads you made yourself.
- Do not present any of the **eight unverified surfaces** as verified
  (`STATUS.md`): a `dogrulanmadi` deadline rule (25 of 41), a fee line with
  `amount: null` (17 of 20), a UDF file (never opened in UYAP), the cloud AI
  lane (`liveTested:false`), the `.ics` stream (never opened in a calendar
  client), the B-16 live search, the local library (nothing reaches
  `collex_local` yet) or the B-13 report (a coverage statement, not a full
  citation verification). Every one of them already says so on its own
  surface; do not remove the label to make a screen look finished.
  **B-16's label changed in phase F/C and the new wording is the honest
  one:** real upstreams HAVE answered now — seven searches returned real
  künye rows and two full texts contained the query phrase (S34) — so do not
  keep writing "no real upstream has ever answered". What is unverified is
  **relevance**: the source server decides the ordering, ColleX can only
  re-sort the 20 rows it was handed and says so on screen. **Phase M added the
  source's own record count** (`totalRecords`, S38) so the lawyer can see
  whether those 20 rows are the tip of an iceberg — that is a count, not a
  relevance measurement, and it changes nothing about the label. Say "erişim
  ölçüldü, isabet ölçülmedi", never "arama doğrulandı". And **never present a scale number taken on a generated probe
  corpus as a product claim** — those corpora come from a 200-word
  vocabulary and every figure on them is an upper-bound scenario.
- **Do not draw a screen for an endpoint that does not answer on this
  server** (the vaporware gate, W13-BACKLOG §G.3.4). A work card whose
  endpoint returns 404 is drawn DISABLED with the reason written into it,
  and a feature that did not land in a wave gets no card at all — a test
  pins its ABSENCE. The same rule binds the docs: describe the endpoint, and
  mark the UI as pending.
- **Do not let a machine code stand alone in front of the lawyer.** The
  machine code is English UPPER_SNAKE and belongs in parentheses AFTER a
  Turkish sentence, or inside a collapsed "Teknik ayrıntılar" disclosure.
  Ceiling on an answer screen: **4 warning blocks, 8 sentences, no sentence
  twice** (B-27). A repeated warning is an unread warning, and in this
  product the warning IS the product.
- **Do not let the word "risk" appear on an unsourced line** (B-24). An
  observation whose `evidenceId` does not resolve to a hash-verified quote
  is prefixed `⚠ KAYNAKSIZ — ` and every Turkish inflection of "risk" is
  replaced with "gözlem". Torn out of context it must still not read as a
  risk assessment.
- **Do not invent a künye.** An unresolved citation's `kunye` is the EMPTY
  STRING and the renderer leaves the cell blank — never "?", never a dash,
  never "bilinmiyor", never a guess. And never report a citation as
  `NOT_FOUND` on the strength of not having looked: an unreachable or
  out-of-scope source is `UNCERTAIN`, and the two are never drawn in the
  same colour.
- Do not put `ANTHROPIC_API_KEY` (or any key) into `.env`, a log line, a JSON
  response or a report. The AI config's `toJSON`/`inspect` print `[gizli]`;
  keep it that way.
- Do not weaken the coverage gate (`DEFAULT_COVERAGE_FLOOR = 0.4`), the
  entailment threshold (`0.85`) or the drafting relevance gate
  (`src/drafting/relevance.ts`, ADR-022) to make a fixture answer or draft
  look better; all are documented as unvalidated on real law and
  re-measuring is the only legitimate way to move them. The lawyer's
  override is `evidenceUse:true` ("Yine de dayanak olarak kullan"), never a
  looser gate.
- Do not pass the MCP token as `--token` to `serve-mcp.mjs` (it throws), and
  do not bring back a `netstat`/port-based kill in `ColleX-Durdur.cmd`
  (`tests/integration/launcher.test.ts` fails).

## Further reading

- `docs/README.md` — the documentation index (start here).
- `docs/implementation/STATUS.md` — real current state, the single counts
  table (S1–S41) with commands and exit codes, the eight unverified surfaces,
  the two measured ceilings and the measurement-tool caveat (N-7);
  `FINAL_REPORT.md` — the full §18 report (its §13 is the W13/W14, phase-F and
  phase-C layer); `TRACEABILITY.md` — requirement → test → STATUS row, plus
  one row per backlog item B-01..B-46, per verification finding V-1..V-22 and
  per audit finding N-1..N-8.
- `docs/implementation/RUNBOOK.md` — every operational command (§7 limits
  and budgets, §15 launcher/stopper semantics).
- `docs/KULLANIM-ColleX.md` — the lawyer's Turkish user guide (no
  engineering vocabulary; screen names match the console verbatim).
- `docs/architecture/overview.md`, `docs/architecture/ADRS.md` (ADR-001..028).
- `docs/COMPETITIVE.md` — the verified Apilex and De Jure profiles, the
  22-row parity matrix and the **seven traps**. Read §6 before adding any
  claim to any surface.
- `docs/implementation/waves/` — `W12-*.md` (the W12 lane reports),
  **`W13-BACKLOG.md`** (the B-01..B-46 item specs, the positioning sentence,
  the parity matrix, the seven traps and §G the wave plan), the other
  `W13-*.md` intelligence and design reports, `W14-L-*.md` (the seven
  phase-A lanes plus `W14-L-FIX.md`, the phase-B1 integration lane — read it
  for what the seams between lanes actually cost), **`W14-F-VERIFY.md`** (the
  independent closing audit — the single most useful report if you read one,
  including its one-paragraph honest answer to "is it better than Apilex and
  De Jure?"), `W14-C-{SRV,UI,FINAL}.md` (the cleanup lanes and their closing
  measurement), **`W14-M-{SRV,UI,CLOSE}.md`** (phase M: the two additive
  fields, the N-8 fix and N-7's measured root cause; the progress/cancel layer
  on every long wait; and the closing round that re-derived both verdicts and
  closed only one) and **`W14-N7.md`** (the N-7 closure — read it for the
  method: a stable-key content diff of two ingests, an instrumented trace of
  the one gold row that flipped, and the four ordering keys that had to stop
  being uuids). Plus
  `docs/implementation/AI.md` (cloud AI: enablement, consent, what leaves
  the machine, KVKK note).
- `docs/security/threat-model.md`, `docs/security/incident-2026-08-26-embedded-tokens.md`.
- `evals/reports/BASELINE.md` — what the measured baseline is and, more
  importantly, what it is not.
- `KULLANIM-REHBERI.md` (Turkish user guide), `README-INDEPENDENT.md` — the
  user's own files; do not edit them without being asked.
