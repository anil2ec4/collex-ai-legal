# W12 — CLOSEOUT: reconciling the documents to FIX-2 (02.09.2026)

Lane CLOSEOUT ran after DOCS-2 and FIX-2 had finished in parallel: DOCS-2
had written `STATUS.md`, `FINAL_REPORT.md`, `TRACEABILITY.md`, `DEMO.md`,
`KULLANIM-ColleX.md` and `docs/README.md` against the pre-FIX-2 numbers
(`W12-FIX.md` §2), and FIX-2 had then changed behaviour and re-measured
(`W12-FIX2.md` §2, binding). This pass made the document set agree with
FIX-2. It changed **no code** except the additive fields in
`control-plane/src/api/openapi.yaml`; it started no server, touched no
database, and ran no full suite (the orchestrator was running them
concurrently) — only the two OpenAPI-related vitest files and three small
files whose counts it needed.

> **SENTETİK.** Every number carried into these documents is a mechanism
> measurement on the synthetic fixture corpus or on in-memory fakes; none is
> a legal-quality result.

## 1. What was reconciled, per file

| File | Change |
|---|---|
| `docs/implementation/STATUS.md` | Dateline adds FIX-2 + CLOSEOUT. **"Ölçülen sayılar" is now the FIX-2 measurement:** S2 → 81 files / 1617 passed / 4 env skips (real PG/venv suites RAN), S3 → 1185, S7 18/18 (c14 via probes), S8 RESULT: PASS (gates re-run by FIX-2, metrics from B2 unchanged), S9 6/6 (run twice), S10 35/44 + the CLOSEOUT additive fields, S11 `domain`, S13 probe-based `migrations.missing`, S14 11/11 probes, S15 `console.test.ts` 74, S17 tally updated (18 P1 fixed; the 12 FIX-2 P2/P1b items fixed); **new rows** S18 (45 FIX-2 regression tests), S19 (FIX-2 12/12), S20 (ledger probe grammar + `--ensure-db` no-op on `collex_local`), S21 (budget / limit constants + the 3 MB probe timings), S22 (launcher/stopper/token tests). Status table `BLOCKED` row, the surface table (answer honesty, drafting v2, resilience, console rows), persistence caveats 4–5, the launcher/stopper flow, "In progress" (none), known risks (budget between stages, relevance tables) and "Last successful verification" (FIX-2 evidence; CLOSEOUT ran no suite) rewritten |
| `docs/implementation/TRACEABILITY.md` | Header + legend point at S1–S22 and `W12-FIX2`. Flipped **#33** (ledger: probe grammar, atomic bootstrap — `test_migrations_ledger.py` +4, `persistence.test.ts` real PG), **#45** (drafting relevance gate — `relevance.test.ts` 9, composer audit #2, console pins, probe 8881), **#53** (answer budget, quote cap, stored-bundle bound, body limits, ön inceleme — `evidencePack.test.ts`, `answerPipeline.test.ts`, `answerService.test.ts`, `api.test.ts`, `test_extract_analysis.py`), **#56** (launcher/stopper/token — `launcher.test.ts` 7, `serve.test.ts --with-mcp` real), **#58** (390 px, naming, preselect, export names) from DEFERRED to PASS; P2 markers folded into **#31** (64 KiB cap, `refId` immutable), **#48** (file names, local time, `correlationId`), **#51** (AI-locked sections), **#54** (`INTAKE_FAILED` id, `FILE_ID_RE`), **#57** (OpenAPI additions), **#59** (preselect); **#43** notes `domain`. Deferred table rewritten: what FIX-2 landed (by row), what is still open (budget not mid-call interruptible; relevance tables cover common codes / unmeasured on real law; P2-10; consolidated-claim entailment; 0.4/0.85/0.25 on real law; AI live smoke; UDF in UYAP; 30 rules `dogrulanmadi`; key rotation) |
| `docs/implementation/RUNBOOK.md` | Header: no counts quoted, every check cites a STATUS row. §1 verify block and §3 table → row ids (S1–S10, S20, S22). §7: probe-based `migrations.missing`; **new "Request limits and answer budgets" table** (`JSON_BODY_LIMIT_BYTES` 1 MiB, `MULTIPART_BODY_LIMIT_BYTES` 40 MiB, `MAX_ITEM_PAYLOAD_BYTES` 64 KiB, `DEFAULT_ANSWER_TIME_BUDGET_MS` 60 000 / 0 = off, `DEFAULT_MAX_QUOTE_CODE_POINTS` 4 000, `MAX_STORED_TEXT_BYTES` 5 MiB — code constants, not env vars) + the `correlationId` failure bodies + id-shape 404s. §15: `--ensure-db` stop-on-failure (log path, Turkish lines, `exit /b 1`), MCP token via `MCP_API_TOKEN` in the child env (`--token` throws), stopper order with `:killpid` command-line check and **no netstat/port kill**, env list. §14: ledger probe grammar for a hosted target |
| `CLAUDE.md` | Header dateline; PARTIAL bullet (STATUS/TRACEABILITY current; single table S1–S22); directory map rows for `ingestion/` (probe grammar), `pipeline/`, `answer/`, `ai/`, `api/` (body limits, bounded bundle, OpenAPI fields), `drafting/` (`relevance.ts`, ADR-022, export names), `files/` (`INTAKE_FAILED` id, `FILE_ID_RE`), `scripts/` (token via env), `tests/` (81 files, `launcher.test.ts`), launcher/stopper row; §Docs paragraph; **invariants**: ledger sentinel grammar `<kind>:<name>` with the five kinds (bare name = regclass), bootstrap only on resolving probes in one transaction, body limits, answer budget + quote cap, MCP token never on argv, stderr never in a body, AI-locked sections + immutable `refId`, "Bulut AI" / "bulut yapay zekâ (Bulut AI)" naming rule; commands block → 1185 / 1617 / 81 (STATUS S1–S9); "do not" list (+ relevance gate, `--token`, netstat); Further reading (+ `docs/KULLANIM-ColleX.md`, ADR-022, `W12-FIX2`/`W12-CLOSEOUT`) |
| `docs/architecture/ADRS.md` | Index paragraph; **ADR-016** amendment (persisted flag, `detachMatter`, bounded stored bundle); **ADR-020** retitled ("sentinel probe on every runnable migration"), status marks the original decision text as superseded, amendment records the probe grammar, the per-file probe list, bootstrap-on-resolving-probe, one transaction, `/v1/health` parity, evidence and the authoring rule; **ADR-021** amendment (relevance gate sits before the "used or referenced" filter); **new ADR-022 "Drafting relevance gate"** with context (kira cevap dilekçesi arguing TCK), candidates, decision (domain derivation order, compatibility table, verdict order, contrary handling, override), rationale, evidence (`relevance.test.ts` 9, probe 8881), binding known limits, consequences, rollout/rollback, file pointers |
| `docs/implementation/AI.md` | Title "Bulut yapay zekâ (Bulut AI) — Anthropic …"; naming rule block (LANG-7) and first-mention form in §1; **`AI_LOCKED_SECTION_IDS` note** in the `draft-paragraph` contract (400 before store and model, message, test); error-map paragraph notes the sentence-initial "Bulut yapay zekâ …" messages and the 1 MiB JSON limit on the AI JSON routes |
| `docs/KULLANIM-ColleX.md` | §1: launcher stops with a Turkish message on a DB failure; stopper touches only ColleX's own processes. §2: a filed record's reference is immutable (remove + re-add), 64 KB record cap. §3: "kayıt no" on an intake crash; 3 MB text answers in seconds; > 5 MB texts stored without full texts. §4: KISMİ after 60 s ("süre bütçesi"); "alıntı kısaltıldı" chip. §5: "Son araştırma" preselect; the alaka kontrolü; "Kullanılmayan kaynaklar (alakasız görünüyor)" + "Yine de dayanak olarak kullan"; AI paragraphs cannot target EK — DOĞRULAMA / KARŞI İÇTİHAT; export file names "Belge - Dosya - vN.ext" + local time; "kayıt no" on an export crash. §8: new rows (launcher STORE_UNAVAILABLE stop, 3 MB file now fast, süre bütçesi, PAYLOAD_TOO_LARGE, kayıt no). §9: relevance check is lexical/metadata; budget works between stages |
| `docs/DEMO.md` | §5 launcher block (ensure-db stop, token via env, stopper order, no port kill); §5.1 Araştır ("alıntı kısaltıldı", süre bütçesi KISMİ, `STORED_WITHOUT_TEXTS`, naming), Belgeler (`INTAKE_FAILED` id, 3 MB timings), Taslak (preselect, relevance gate, AI-locked sections, "Kullanılmayan kaynaklar", export names, `refId` immutable, 413); §5.3 DB-down row; §9 limits (budget between stages, relevance gate) |
| `docs/implementation/FINAL_REPORT.md` | Intro; §0 table (+ FIX-2 row, CLOSEOUT in the docs row; S10–S22); §1.2 ledger description; §1.3 FIX-2 defect list; §2 ADR table (020 amended, +022); §3 tests + FIX-2 files; §6 P2-13..19 closed; §8 items 4–7 rewritten; §12 final status |
| `docs/README.md` | Dateline (FIX-2 + CLOSEOUT, S1–S22); start-here row FIX → FIX2 → CLOSEOUT; STATUS / TRACEABILITY / RUNBOOK rows; INTEGRATION row's source → `W12-FIX2` §2; **W12-FIX2 row rewritten (binding, source of the counts), W12-CLOSEOUT row added**; ADRS row 001…022 |
| `docs/architecture/overview.md`, `docs/COMPETITIVE.md`, `docs/implementation/PLAN.md` | Copied counts (vitest/pytest totals) replaced by STATUS row pointers — these three still carried pre-FIX or pre-FIX-2 numbers |
| `control-plane/src/api/openapi.yaml` | Additive only (§2) |
| `docs/implementation/waves/W12-CLOSEOUT.md` | this report |

Not touched on purpose: `KULLANIM-REHBERI.md`, `README-INDEPENDENT.md`
(the user's files), `RISKS.md` (its W12 rows #18–#23 are still accurate;
the budget/relevance limits are recorded in STATUS "Known risks",
TRACEABILITY's deferred table and ADR-022 rather than as new risk numbers),
the wave reports (dated measurements stay as written), any test, migration,
script or console file.

## 2. `control-plane/src/api/openapi.yaml` — additive fields for FIX-2

Written against the FIX-2 code, not the report alone (`grep` in
`control-plane/src` for each constant and message). Nothing was removed or
renamed; **paths 35 / operations 44 / version `1.0.0-w12` unchanged**.

| Addition | Where |
|---|---|
| `DraftTemplate.domain` (enum `ozel-hukuk`, `ceza`, `idare`, `icra`, `genel`) | `components/schemas/DraftTemplate` |
| `DraftEvidence.unusedReason` (enum `DOMAIN_MISMATCH`, `NOT_RELEVANT`) | `components/schemas/DraftEvidence` |
| `EvidenceView.quoteTruncated` (boolean, absent when whole) | `components/schemas/EvidenceView` |
| `ApiError.error.detail`, `ApiError.error.correlationId` (uuid) | `components/schemas/ApiError` |
| `AnswerResult.reasons` text: `TIME_BUDGET_EXCEEDED`; `AnswerResult.warnings` text: `TIME_BUDGET_EXCEEDED:<ms>><budget>ms`, `QUOTE_TRUNCATED:<chunkId>:<n>><cap>`, `STORED_WITHOUT_TEXTS:<Türkçe>` | `components/schemas/AnswerResult` |
| `components/responses/PayloadTooLarge` (typed 413, limits named) referenced as `"413"` from **18 operations**: POST /v1/answer, /v1/evidence-bundle, /v1/search, /v1/research-runs, /v1/files, /v1/research, /v1/research/start, /v1/drafts, PUT /v1/drafts/{id}, POST /v1/matters, PATCH /v1/matters/{id}, POST …/items, PATCH …/items/{itemId}, PUT /v1/settings, POST /v1/deadlines/compute, POST /v1/ai/analyze-document, POST /v1/ai/draft-paragraph (+ the pre-existing OCR 413) | operations |
| `500 INTAKE_FAILED` (with `detail` + `correlationId`) on POST /v1/files; DELETE /v1/files/{id} 404 note for non-16-hex ids | `/v1/files` |
| GET /v1/drafts/{id}/export 500 description: `correlationId`, file-name contract "<Belge> - <Dosya> - v<N>.<ext>" + `filename*`, local time, `DRAFT_ID_RE` → 404 | `/v1/drafts/{draftId}/export` |
| PATCH /v1/matters/{id}/items/{itemId}: description + 400 text for `REF_ID_IMMUTABLE` | matters |
| POST /v1/ai/draft-paragraph: description + 400 text for the AI-locked sections (`ek-dogrulama`, `karsi-ictihat`) | ai |

Already present before this pass (verified, not duplicated):
`Draft.persisted`, `AnswerResult.persisted`, `QuestionCoverage.partiallyCovered`.
**Not added:** `matterTitle` on the exporter input — that JSON is handed to
`export.cli` by the drafting router (server → child process), not an HTTP
body, so it is documented in `W12-FIX2.md` #9 and `export/draft.py` rather
than in the API contract; the only HTTP `matterTitle` (on
`/v1/matters/deadlines` rows) already existed.

Verification (this machine, 02.09.2026):

```
.venv/Scripts/python.exe <scratch>/openapi_check.py control-plane/src/api/openapi.yaml
→ {"paths": 35, "operations": 44, "version": "1.0.0-w12", "unresolved_refs": [], "ops_with_413": 18,
   "has": {"DraftTemplate.domain": true, "DraftEvidence.unusedReason": true,
           "EvidenceView.quoteTruncated": true, "ApiError.correlationId": true,
           "responses.PayloadTooLarge": true}}   (exit 0; pyyaml safe_load + a walk over every "$ref")

cd control-plane && npx vitest run tests/api.test.ts tests/pipeline/retrievalProvenance.test.ts
→ 2 files, 41 passed (api 34, retrievalProvenance 7), exit 0
```

`retrievalProvenance.test.ts` is the only test that reads `openapi.yaml`
(`grep -rn openapi control-plane/tests`); `api.test.ts` pins the frozen
response shapes the schema describes.

## 3. Counts CLOSEOUT measured itself (small files only)

To fill S15 and the row #45/#56 test names exactly:

```
cd control-plane && npx vitest run tests/pipeline/console.test.ts tests/drafting/relevance.test.ts tests/integration/launcher.test.ts
→ console 74 · relevance 9 · launcher 7 (3 files, 90 passed, exit 0)
```

`W12-FIX2.md` §1 says "relevance (8)"; the file holds 9 tests, and STATUS
S18 / TRACEABILITY #45 / ADR-022 say 9. No other suite was run; every other
number is FIX-2's (`W12-FIX2.md` §2).

## 4. Stale-count evidence

Pattern from the task, run after every edit (`grep -rn -E`):

```
'1507|1535|1555|1561|1579|1169|1174|1176|1178|79 files|79 dosya'
  over  docs  CLAUDE.md  control-plane/src/api/openapi.yaml
```

- **Outside `docs/implementation/waves/`: 0 hits.** Before this pass there
  were 13 (STATUS S2/S3, RUNBOOK §1/§3 ×4, CLAUDE.md ×3, FINAL_REPORT §3,
  overview.md, COMPETITIVE.md, PLAN.md ×2) — all replaced by the FIX-2
  numbers or by a STATUS row id.
- Inside the wave reports the pattern still matches, as intended, only in
  dated historical lines: `W12-API2`, `W12-B`, `W12-B2`, `W12-DOCS1`,
  `W12-DOCS2`, `W12-FIX`, `W12-INTEGRATION`, `W12-UI1`, `W12-UI2` (each
  states the date of its own measurement; `W12-DOCS2.md` §1 is the
  pre-FIX-2 table it wrote and says so).
- Naming sweep over the Turkish documents (`Bulut Yapay Zek`, lower-case
  and upper-case "ai" label, "zeka" without circumflex, the English label)
  in `KULLANIM-ColleX.md`, `DEMO.md`, `AI.md`, `STATUS.md`,
  `FINAL_REPORT.md`: 0 hits (the rule in `AI.md` describes the forbidden
  forms without spelling them).
- `netstat` outside the wave reports now appears only in sentences saying
  the port-based kill was removed (DEMO §5, RUNBOOK §15, CLAUDE.md,
  TRACEABILITY #56) and in STATUS's "netstat temiz" verification note.
- `docs/README.md` links: `W12-FIX2.md` and `W12-CLOSEOUT.md` both exist
  now; the DOCS-2 forward reference is resolved.

## 5. Open items after CLOSEOUT (nothing hidden)

1. The 60 s answer budget is checked between stages; one slow port call is
   not interrupted mid-call (`W12-FIX2` §4; STATUS Known risks; ADR-022 is
   unaffected).
2. The relevance gate's legislation-number tables cover the common codes;
   an unknown number is `genel`; the gate is unmeasured on real law
   (ADR-022 known limits; RISKS #18 applies).
3. Cloud AI never live-tested (`liveTested:false`), UDF never opened in
   UYAP (`deneysel`), 30 deadline rules `dogrulanmadi` — user actions
   (STATUS "Next actions" 2–4).
4. Brave/Tavily rotation (SEC-2026-08-26-001) still OPEN — user action.
5. `RISKS.md` was not renumbered; if a maintainer wants the budget and
   relevance limits as their own risk rows, add #24/#25 there and point
   STATUS "Known risks" at them.
6. The full suites were not re-run by this pass (the orchestrator ran
   them); STATUS's numbers are FIX-2's measurement of the same code.
