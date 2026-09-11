# W12 — Lane API-2: backend follow-ups requested by UI-1 / B2 / Docs-1

Date: 02.09.2026. Lane: API-2. Status: **delivered; every number below is
real output from this machine** (commands in §8). All changes are
**additive**: no existing field changed meaning, no path was added or
removed (`openapi.yaml` stays 35 paths / 44 operations, `1.0.0-w12`), the
MCP tool surface was not touched, no migration was added.

Ownership honoured: `control-plane/src/api/{server,answerService,matterLink}.ts`
+ `openapi.yaml`, `src/store/answerStore.ts`, `src/matters/**`,
`src/files/**`, `src/research/**`, `export/text.py`, `scripts/serve.mjs`
(header comment only), `docs/implementation/{DECISIONS,EXPORT}.md`, this
lane's tests, this report. Not touched: `console.html`, `drafting/**`,
`answer/**`, `pipeline/**`, migrations, `package.json`.

> **SENTETİK.** Every test runs on in-memory fakes or the synthetic fixture
> corpus. Nothing here is a legal-quality measurement.

## 1. What changed (file by file)

| File | Change |
|---|---|
| `src/api/answerService.ts` | `AnswerSummary.fileScope?: {fileIds, includeCorpus}` read from the stored `result.fileScope`; `AnswerListOptions += fileId`; `fileScopeOf(value)` (untrusted → wire shape: string ids only, `includeCorpus` only when literally `true`, empty → absent); `answerCoversFile`; `InMemoryAnswerStore.list({fileId})` |
| `src/store/answerStore.ts` | `PgAnswerStore.list` selects `result -> 'fileScope' as file_scope` and filters `?fileId` by **jsonb containment** `result @> {"fileScope":{"fileIds":[id]}}` — **no schema change** (§3.2 for the driver pitfall); fragment-composed `matterId`/`fileId` clauses; `fileId` validated (non-empty, ≤ 200) before SQL |
| `src/api/server.ts` | `GET /v1/answers?fileId=` (400 `INVALID_REQUEST` path `fileId` for whitespace / > 200 chars; empty = no filter; combinable with `matterId`); the research router's sink is now `{put, settleLink}` so a background run can learn its link outcome (§2.4); header comment |
| `src/api/matterLink.ts` | `answerLinkPayload` denormalizes `fileScope` into the `answer` item when present; **race fix** (§3.1): `MatterLinker` keeps the last `RECENT_LINK_OUTCOMES = 128` settled outcomes so `settle()` still reports a link that finished before the caller asked |
| `src/matters/routes.ts`, `src/matters/types.ts` | event `source` accepts `belge:<fileId>` **and** `belge:<fileId>:<chunkId>` (regex `^(manual\|belge:[^\s:]{1,200}(?::[^\s:]{1,200})?)$`, Turkish message names all three forms); matter-page enrichment and the `POST /items {kind:'answer', refId}` fill carry `fileScope` |
| `src/files/store.ts` | `FileListEntry.pages?: FilePageStats` — `toListEntry` reads `metadata.fixture_meta.upload.page_stats` (the same block `showFile` reads; the list query already fetched `v.metadata`, so the cost is zero extra queries); `showFile` now inherits `pages` from the entry instead of computing it twice |
| `src/research/routes.ts` | `ResearchRunView.warnings: string[]` (always present); `ResearchRunRegistry.addWarning(runId, warning)` (unknown run no-op, empty/duplicate collapse); `ResearchAnswerSink.settleLink?` seam; the background run awaits the link **before** flipping `state` to `done` |
| `src/research/researchService.ts` | B2's two-line request applied: `buildEvidencePack(…, {asOf, now, defaultOrigin: "live"})`; `toLiveEvidenceView` → `origin: item.origin ?? "live"` (result, bundle and stored entry all carry it) |
| `src/api/openapi.yaml` | §4 |
| `export/text.py` | `CURRENTNESS_TR["NOT_APPLICABLE"] = "yüklediğiniz belge — yürürlük değerlendirilemez"` (DOCX/Markdown already print `CURRENTNESS_TR.get(status, status)`) |
| `scripts/serve.mjs` | header comment: the five-tab desk (Dosyalarım / Araştır / Belgeler / Taslak / Ayarlar + `#dosya/<id>`, `#belge/<fileId>`) |
| `docs/implementation/DECISIONS.md` | dated 2026-09-02; ADR index 016–021; three non-ADR rows (containment filter, link-warning seam, two-segment event source) |
| `docs/implementation/EXPORT.md` | §6 corrected **from the code**: `renderEvidenceBundle` still emits only the core contract; `synthetic`/`syntheticNotice`/`producer` are added by `AnswerPipeline` (render stage) and `runResearch`; `texts` by `buildAnswerBundle` / `toAnswerEntry`; `evidence[].origin` by the renderer (ignored by `export/bundle.py`) |
| Tests | §7 |

## 2. Contract AS IMPLEMENTED (for UI-2)

### 2.1 `AnswerSummary.fileScope` and `GET /v1/answers?fileId=`

```ts
AnswerSummary += { fileScope?: { fileIds: string[]; includeCorpus: boolean } }
GET /v1/answers?matterId=<uuid>&fileId=<id>&limit=<n>
```

- `fileScope` is present **only** for an answer whose stored
  `result.fileScope` names at least one upload (a `/v1/answer` with
  `filters.fileIds`); a corpus or live answer has no key at all (the row is
  byte-identical to the pre-API2 shape — pinned by test).
- `?fileId=` returns the answers whose `fileScope.fileIds` **contains** the
  id (whole-element match, never substring), newest first, clamped by
  `limit`, intersected with `matterId` when both are given. Both stores
  answer identically (in-memory predicate vs. Pg containment; both tested).
- `?fileId=` empty → no filter. Whitespace or > 200 chars → 400
  `INVALID_REQUEST` with `issues[0].path === "fileId"` and the Turkish
  message "Belge kimliği boşluk içermeyen, en fazla 200 karakterlik bir
  metin olmalı."
- Matter page: `items.answers[].payload.fileScope` is present for such an
  answer (live enrichment AND the denormalized link payload, so it survives
  a cache miss). `POST /v1/matters/{id}/items {kind:'answer', refId}` fills
  it from the stored answer too. → UI-2 can label the row **"Belge"**
  instead of "Yerel" and derive "Bu belgeye sorulan sorular" from
  `GET /v1/answers?fileId=` instead of localStorage.

### 2.2 `GET /v1/files` list rows: `pages?`

`FileListEntry.pages?: { pageCount, pagesWithText, emptyPages[] }` — the
same block `GET /v1/files/{id}` returns (`pageStatsOf` narrows untrusted
metadata; non-numeric page numbers are dropped). Absent for non-PDF uploads
and pre-statistics intakes. → the "taranmış sayfa" badge no longer depends
on `uploadResults` of the current session.

### 2.3 Matter event `source`

`manual` · `belge:<fileId>` (a date the intake's heuristic analysis found —
no chunk identity; replaces the console's invented `belge:<fileId>:analiz`)
· `belge:<fileId>:<chunkId>`. Anything else (`belge:`, `belge:a:b:c`,
`belge::c`, `ai`, `uyap`, embedded space) is 400 with
`payload.source` → "Kaynak: manual, belge:<dosya kimliği> veya
belge:<dosya kimliği>:<parça kimliği> olmalı." Survives a PATCH merge.

### 2.4 `GET /v1/research/runs/{id}.warnings` and live `origin`

```ts
ResearchRunView += { warnings: string[] }   // always present, [] when clean
// today: "MATTER_LINK_FAILED:Kayıt dava dosyasına bağlanamadı; kaydın kendisi oluşturuldu, dosyaya elle ekleyebilirsiniz."
```

- Seam: `ResearchAnswerSink.settleLink?(runId) → Promise<{ok, warning?} |
  undefined>`; `server.ts` wires it to `MatterLinker.settle("answer",
  runId)`. The router awaits it **after** `persist` and **before**
  `state = "done"`, so the first poll that reports `done` already carries
  the warning (a poller that stops at `done` cannot miss it). A sink whose
  `settleLink` rejects, or has none, never fails or delays the run. Driver
  text never reaches the client (pinned: `57P01` / "connection terminated"
  absent from the view).
- The synchronous `POST /v1/research` keeps reporting the same failure in
  its own `warnings` (unchanged contract; now reliable — §3.1).
- Live evidence: every `evidence[].origin`, `bundle.evidence[].origin` and
  the pack item carry `"live"`; the source card prints
  `- Kaynak türü: canlı resmî kaynak`; the stored answer (`mode:'live'`) is
  the same object, so `GET /v1/answers/{runId}` and
  `…/evidence-bundle` serve it. Currentness of live text follows the
  ordinary yürürlük rules (never `NOT_APPLICABLE`). A live answer stored
  **before** this lane carries no origin — UI-2 should keep defaulting a
  missing origin to `live` when `mode === "live"` (B2 §5.2; also in the
  OpenAPI description).

## 3. Two defects found on the way (both fixed, both pinned)

### 3.1 `MatterLinker.settle` lost a fast failure (race)

`settle(kind, refId)` returned only the **in-flight** job. The routes that
report a link ask after the handler answered (`/v1/research` middleware,
drafts PUT middleware, and now `settleLink`), and an in-memory link that
fails settles within a few microtasks — so the warning was silently
dropped. It had never shown in the probes because the Pg store's link takes
a network round trip. Fix: the linker remembers the last 128 settled
outcomes (`recent`, newest last, bounded); a new link for the same record
supersedes the remembered one; `settle` returns `pending ?? recent`.
Regression test: `tests/integration/app.test.ts` "a background run whose
matter link fails …" (async view **and** the sync body).

### 3.2 postgres.js double-encodes a pre-stringified value under `::jsonb`

`result @> ${JSON.stringify(x)}::jsonb` returned nothing although
`pg_typeof` said `jsonb`: with an explicit cast the driver runs the JS
**string** through its jsonb serializer, JSON-encoding it a second time, so
the parameter arrived as a jsonb *string* scalar. Measured on a temp table
of the maintenance database (PostgreSQL 18, postgres.js 3.4.9; scratch
script, nothing persisted): `string::jsonb` → `[]`; `sql.json(x)` (with or
without the cast) → hit; `-> 'fileIds' ? text` → hit; `to_jsonb(array[…])`
→ hit. The store uses `sql.json(...)::jsonb` and the persistence test
pins it (including a `'"]}'` id, which is just a value).

## 4. `openapi.yaml` (pyyaml-parsed after every edit; 35 paths / 44 operations; 0 unresolved `$ref`)

- `CurrentnessAssessment.status` enum `+= NOT_APPLICABLE` (with the
  upload/live semantics); `Confidence` description: neutral 1.0 when
  `currentnessApplicable` is false.
- `ClaimView.currentnessApplicable?: boolean`.
- `EvidenceBundle.evidence[].origin` (`upload|corpus|live`, additive,
  ignored by the Python exporter).
- `AnswerResult.reasons` description `+= UPLOAD_ONLY_EVIDENCE` (sentence
  verbatim).
- `EvidenceView.origin`: `live` is no longer "reserved" — emitted by the
  research lane; default rule for older stored rows.
- `AnswerSummary.fileScope` (allOf `FileScope` + description);
  `/v1/answers` `fileId` query parameter.
- `FileListEntry.pages` (allOf `FilePageStats`).
- `ResearchRunView.warnings` (required; always present).
- `addMatterItem` and `MatterItem` descriptions: the three event source
  forms; `answer` payload `fileScope?`.

## 5. Export

`export/text.py`: `CURRENTNESS_TR["NOT_APPLICABLE"]` = the shared label.
`bundle_docx.py` / `bundle_markdown.py` were already printing
`CURRENTNESS_TR.get(status, status)` on the KAYNAKLAR entry, so an uploaded
document's entry now reads `Güncellik: yüklediğiniz belge — yürürlük
değerlendirilemez` and the raw code never reaches the reader (both formats
tested by mutating the cited `ev-tck-157` entry of the synthetic ŞERHLİ
fixture; the other entries keep `yürürlükte`).

## 6. Docs

- `serve.mjs` header: five-tab desk wording (comment only; no behaviour).
- `DECISIONS.md`: dated; ADR-016..021 indexed with status/date from
  `ADRS.md`; three non-ADR rows for this lane's design choices.
- `EXPORT.md` §6: read `renderer.ts`, `answerPipeline.ts`,
  `researchService.ts`, `answerService.ts`, `research/routes.ts` — the
  paragraph now says who emits `synthetic`/`syntheticNotice`/`producer`
  (pipeline + research service, **not** the renderer), who emits `texts`
  (`buildAnswerBundle`, `toAnswerEntry`) and that `evidence[].origin` is the
  renderer's and is ignored by the exporter; the "henüz yazmıyor" claim was
  stale (pinned by `tests/pipeline/answerService.test.ts`).

## 7. Tests added (+20 vitest, +2 pytest; nothing weakened or removed)

| File | Added |
|---|---|
| `tests/pipeline/answerService.test.ts` | `fileScopeOf` narrowing; summary carries `fileScope` only when present (pre-API2 row shape pinned); `list({fileId})` alone / with `matterId` / with `limit`, whole-id match |
| `tests/api.test.ts` | mounted app: scoped `/v1/answer` → `?fileId=` (hit / miss / with matterId / empty = no filter / two 400s with path `fileId`), summaries and the matter-page item carry `fileScope` |
| `tests/integration/app.test.ts` | list rows carry `pages` (= detail); live run → origin `live` on result / bundle / stored entry / served bundle + card text; run view `warnings: []` on success; **failing matter store** → `MATTER_LINK_FAILED` on the first `done` poll, run still stored, no driver text, sync body carries it too; event `belge:<fileId>` (201, defaults) / three-segment / four-segment 400 |
| `tests/matters/routes.test.ts` | the two `belge:` forms + six refused shapes with the exact message, PATCH merge; `answer` item with `fileScope` (fill + page + `list({fileId})`) |
| `tests/files/routes.test.ts` | `pages` passthrough on `GET /v1/files`; `PostgresFilesStore.listFiles` over a fake `Sql`: reads `page_stats` from the same metadata block, narrows an untrusted element, **one** grouped query, shared client not closed |
| `tests/research/asyncRuns.test.ts` | `warnings` [] while running and when the link succeeded (`settleLink` called once); failed link on the first `done` poll, no duplicate on re-poll; rejecting/absent `settleLink` never fails the run; `addWarning` no-op/dedupe/copy; live origin on result/bundle/pack + card text |
| `tests/research/researchService.test.ts` | origin `live` on pack items, views and bundle rows; never `NOT_APPLICABLE` |
| `tests/store/persistence.test.ts` (real Pg, `collex_persist_test`) | `fileScope` listed from the result column; `list({fileId})` containment alone / with matter / miss / substring miss / injection-shaped id / RangeError on empty and > 200; warm keeps the scope |
| `tests/export/test_markdown_export.py`, `test_docx_export.py` | NOT_APPLICABLE label printed, raw code absent, other entries unchanged |

## 8. Verification (all on this machine, 02.09.2026, 04:02–04:14)

| Command | Result |
|---|---|
| `control-plane> npx tsc --noEmit` | **exit 0** (sources + tests) |
| `control-plane> npx vitest run` | **79 files passed; 1555 passed, 4 skipped (1559)** — before this lane 1535 + 4; the 4 skips are the documented "environment unavailable" markers (`real-export`, `store/persistence`, `integration/serve`, `integration/real-exec`) whose real counterparts **ran** (PG 55432 + venv present) |
| focused: `npx vitest run tests/api.test.ts tests/integration/app.test.ts tests/matters tests/files tests/research tests/store/persistence.test.ts tests/pipeline/answerService.test.ts` | 13 files, 213 passed, 1 skipped |
| `.venv/Scripts/python.exe -m pytest tests/export -q` | **89 passed** (87 + 2) |
| `.venv/Scripts/python.exe -m pytest tests/intake -q` | **68 passed** (74.7 s; `collex_intake_test`, run sequentially with vitest) |
| pyyaml over `openapi.yaml` | 35 paths, 44 operations, `1.0.0-w12`, unresolved `$ref`: none |
| `node control-plane/scripts/demo.mjs` | **NOT run to completion — refused by design**, exit 3: `DURDURULDU: collex_demo içinde 1 kiracı yüklemesi (UPLOAD) var; demo bu veritabanını silmeyi reddediyor.` The upload is `probe_kira_sozlesmesi.txt` (`a512f2f094fbc8c4`, 03:29:31, 8 chunks) — **UI-1's walkthrough file** (W12-UI1 §5 step 3), not this lane's, so `--force-drop-uploads` was NOT used (CLAUDE.md: only for your own probe uploads). Port 8841 was free at every check; no server was started by this lane. The S6-shaped flows this lane touched are covered by the mounted-app tests above; the last measured demo is UI-1's 6/6 |

Databases touched: `collex_persist_test` (vitest, its owner, dropped at the
end), `collex_intake_test` (real-exec + `tests/intake`, sequential),
`collex_retrieval_test`/`collex_quality_test` (their suites), a TEMP table
on the `postgres` maintenance database for the §3.2 probe (nothing
persists). `collex_local` untouched; `collex_demo` read with `--list`
only. No network.

## 9. Integration requests (files this lane may not edit)

1. **UI-2 (`console.html`)**: label matter-page / history rows with
   `fileScope` as "Belge"; build "Bu belgeye sorulan sorular" from
   `GET /v1/answers?fileId=` (localStorage becomes a fallback); read the
   scan badge from `GET /v1/files` `pages`; write `belge:<fileId>` (not
   `belge:<fileId>:analiz`) for analysis dates; show
   `GET /v1/research/runs/{id}.warnings` (`MATTER_LINK_FAILED` is already in
   `WARN_PATTERNS`) when the async run finishes; keep the `mode === "live"`
   → origin `live` default for pre-API2 stored answers.
2. **Docs lane (`STATUS.md`, `TRACEABILITY.md`, `RUNBOOK.md` §3)**: vitest
   count 1555 / 79 + 4 skips; `tests/export` 89; the two §3 findings (linker
   race, postgres.js jsonb cast) as measured facts; `AnswerSummary.fileScope`,
   `?fileId`, list `pages`, run `warnings`, live `origin` in the endpoint
   table (`W12-INTEGRATION.md` §3 is the integration lane's report — not
   edited here).
3. **Whoever owns the current `collex_demo` state** (UI-1/UI-2): the
   walkthrough upload `a512f2f094fbc8c4` blocks `demo.mjs`; delete it with
   `intake.cli --delete a512f2f094fbc8c4` or run `demo.mjs
   --force-drop-uploads` **yourself** when the walkthrough is over, then
   re-measure 6/6.

## 10. Open issues / honest notes

1. `demo.mjs` 6/6 was not re-measured by this lane (§8) — the refusal is the
   intended guard, and the file is another lane's.
2. `?fileId` on the Pg store is a jsonb containment scan without an index —
   fine for one lawyer's table (bounded by `limit`, ≤ 200), and deliberately
   so (no migration); if the answers table ever grows into the tens of
   thousands, a GIN index on `result` (or a denormalized column) would be
   the next step, as a new sentinel-carrying migration.
3. `warnings` on the run view is the only run-level channel; the result's
   own `warnings` (lane failures, `TIMEOUT:<n>`) stay inside `result` —
   UI-2 shows both, they do not overlap.
4. Live answers stored before this lane carry no `origin`; no migration
   rewrites stored results (they are the audit record) — the client-side
   default stands.
5. The `MatterLinker.recent` map is bounded (128) and process-local; a
   route that asks about a link older than 128 subsequent links gets
   `undefined` (= "nothing to report"), which is the pre-fix behaviour and
   never a false warning.
