# W12-FIX — review findings: verification, fixes, deferrals (02.09.2026)

Three reviewers (R1 lawyer walkthrough, R2 adversarial code/security, R3
language/honesty) reported 2 P0, 20 P1 and 45 P2 findings against the landed
W12 wave. This lane reproduced every P0/P1 first (server on port 8871 against
`collex_demo`, plus unit-level reproduction where the API path was not
enough), fixed the confirmed ones with a regression test each, applied the
unambiguous P2 language/polish items, and deferred the rest with a reason.
Nothing in this report was measured on real law: the corpus is SENTETİK.

Evidence of the two P0 reproductions (before the fix, port 8871):

- `POST /v1/answer {"question":"TCK m.157 uyarınca kira sözleşmesinde depozito
  iadesi ne zaman yapılır?"}` → `status QUALIFIED, finalizable true,
  coverage.gate bypassed-by-reference, coverage.missing [kira, depozito]`,
  8 evidence items of which 7 `retrieval.pinned:false` (Yargıtay 15. CD ×3,
  7999 s.K. m.1, TCK m.155/156/158), 7 claims all CONFLICTING_AUTHORITIES.
- `POST /v1/matters` → `POST /v1/drafts (matter.matterId)` → `DELETE
  /v1/matters/{id}` → `PUT /v1/drafts/{id}` → 200 `version 2`; server log
  `DRAFT_PERSIST_FAILED … 23503 … drafts_matter_id_fkey`; `GET
  /v1/drafts/{id}/versions` → only v1.

After the fix (same server, same requests): first request → `PARTIAL,
finalizable false, gate bypassed-by-reference, partiallyCovered true,
evidence = [TCK m.157 (pinned)] only, setAside 7, reasons
[NOT_FINALIZABLE, QUESTION_PARTIALLY_COVERED]`; second → PUT 200 `version 2,
matterId null, persisted true`, versions `[v1, v2]`, no log line. A Playwright
pass on the rebuilt console opened the orphaned draft from the new "Kayıtlı
taslaklar" list and saved it ("Taslak kaydedildi — v3", `GET /v1/drafts`
shows v3); as-of initialises to today; footer/dropzone carry the new privacy
sentences; zero console errors. Screenshot:
`scratchpad/fix/fix-01-taslak-orphan-draft-editor.png`.

## 1. Findings table

Verdict: **confirmed** = reproduced and fixed here; **refuted** = the code
does not do what the finding says; **deferred** = real but not done in this
lane, with the reason; **partial** = the hazard is closed, a secondary
recommendation is not.

### P0

| # | Finding | Verdict | What changed | Test |
|---|---|---|---|---|
| P0-1 | Coverage gate bypassed wholesale by any citation in the question | **confirmed** | `answer/coverage.ts`: `admitUnderReferenceBypass` — under a bypass the PINNED text is admitted by right, every other passage must anchor the question on its own (≥2 distinct content lexemes or all of them, AND share ≥ floor) — plus, in `pipeline/answerPipeline.ts`, a structural closure: a passage reached from an ADMITTED passage by a stored edge (relation `viaChunkId`, citation `citedByChunkId`, divergence `opposesChunkId`) stays; edges from set-aside passages admit nothing. Set-aside passages are reported by identity (`QUESTION_NOT_COVERED:<n>`, `contraryCoverage.observed`), never quoted. Coverage is re-measured over the admitted set; when an APPLICATION question's admitted text still covers < floor the report carries `partiallyCovered:true` and `answer/verifier.ts` refuses to finalize (status PARTIAL, reason `QUESTION_PARTIALLY_COVERED`, warning of the same name). A NORM_CONTENT question ("m.157'nin cezası nedir?") is never partial — the cited text IS the answer. Renderer/console: "Kapsam kapısı: atıf yapılan hüküm doğrudan alındı; öteki pasajlar tek tek soru sözcükleriyle sınandı", `COVERAGE_PARTIAL_TEXT`, missing-word line before the tespitler. `openapi.yaml` `QuestionCoverage.partiallyCovered`. | `tests/answer/coverage.test.ts` "per-passage admission" (4); `tests/answer/answerHonesty.test.ts` "the reference bypass admits passage by passage" (3: audit question + citation → only m.157, PARTIAL, not finalizable; edge from a set-aside passage admits nothing; an anchoring non-pinned passage is still admitted); `retrievalProvenance.test.ts` (relation/citation closure) unchanged and green; `answerPipeline.test.ts` S3 assertion updated (lane outage → no RETRIEVAL_DEGRADED; the cited statute alone is now QUESTION_PARTIALLY_COVERED for the kapora application question) |
| P0-2 | Draft revisions unpersistable after the matter is deleted (FK 23503, stderr only) | **confirmed** | (1) `DraftStore.detachMatter(matterId)` (interface + `InMemoryDraftStore` + `PgDraftStore`: column AND `body.matterId` nulled, cache updated); `DELETE /v1/matters/{id}` calls it best-effort. (2) `PgDraftStore.persist` catches 23503, logs `DRAFT_MATTER_GONE`, nulls the cached entry's matterId and inserts the version without the matter; `PgAnswerStore.persist` does the same (`ANSWER_MATTER_GONE`) for the "matter deleted during /v1/research/start" race. (3) `persisted(id)` on both stores (outcome of the LAST write, awaited); `POST/PUT /v1/drafts`, `POST /v1/ai/draft-paragraph` and `POST /v1/answer` carry `persisted:boolean` and, on failure, ONE Turkish warning (`DRAFT_PERSIST_FAILED` / `ANSWER_PERSIST_FAILED` in the machine list); the console toasts "Taslak veritabanına YAZILAMADI …" instead of "kaydedildi". `src/store/persistNotice.ts` holds the sentences; `openapi.yaml` documents `persisted` on Draft and AnswerResult. | REAL PG `tests/store/persistence.test.ts` (2 new: draft v2 after matter delete is stored + detachMatter nulls rows/body + dead connection → `persisted()` false; answer FK retry); `tests/matters/routes.test.ts` (DELETE calls `detachMatter`, failing detach never fails the delete); `tests/drafting/routes.test.ts` (`persisted:false` + warning through a failing store); `tests/drafting/store.test.ts` (in-memory detach) |

### P1

| # | Finding | Verdict | What changed | Test |
|---|---|---|---|---|
| P1-1 | Drafter turns every evidence item into a green Dayanak (kira cevap dilekçesi argues TCK m.155/156/158/159/168) | **confirmed** | `drafting/evidence.ts`: in an answer that has a PINNED passage, a claim resting only on non-pinned passages is context (the answer itself folds it under "Bağlam için getirilen komşu hükümler") — not reused as hukukî değerlendirme; its evidence lands in `unusedEvidence` ("Dayanak olarak kullan" OFF), one Turkish warning + `CONTEXT_ONLY` machine line. `AnswerResultLike.evidence[].retrieval.pinned` added (additive). P0-1 also removes the lexical-noise neighbours before they reach the answer. Not done: a template-kind ↔ question-intent relevance gate (a TCK research seeding a hukuk davası cevap dilekçesi) — see §3. | `tests/drafting/evidence.test.ts` "a claim resting only on non-pinned neighbour passages is context" |
| P1-2 | "Bu belgeye sor" answers off-topic questions ŞERHLİ and marks the document's own SONUÇ paragraph as karşıt otorite | **confirmed** (by code: `classifyStance` ran over uploads) | `answerPipeline.ts`: an upload's stance is neutral by construction (no outcome to classify); in upload-only scope (`fileIds` without `includeCorpus`) passages sharing NO content word with the question are set aside (`admitUploadOnlyPassages`) and listed by identity. Console: `CONFLICTING_AUTHORITIES:claim-…` ids were already translated by `WARN_PATTERNS`; the verdict block no longer prints "Karşıt otorite tarandı" for upload-only answers. | `tests/answer/coverage.test.ts` "over uploads alone…"; S7 upload tests unchanged and green |
| P1-3 | "TAM — Tüm tespitler doğrulanmış kaynağa bağlı" on document questions; otorite/yön meters on the lawyer's own dilekçe | **confirmed** | `console.html render()`: upload-only answers headline "N pasaj bulundu" + "alıntılar birebir doğrulandı; bu bir hukukî değerlendirme değildir … (Teknik durum: TAM)"; `claimCard` skips the confidence sentence and the meters for upload-backed claims; `sourceCard` hides "Sonuç yönü" for `origin:'upload'`. Extractive one-line answer: not done (§3). | `console.test.ts` (contract suite green); Playwright pass |
| P1-4 | As-of hardcoded to 2025-06-01 | **confirmed** (`<input value="2025-06-01">`) | Value attribute removed; `initAsOf()` at boot (today, or `settings.preferences.defaultAsOf` when it is a date), label "Değerlendirme tarihi (hangi tarihteki hukuka göre)"; scenario buttons still set their own date explicitly; the document Q&A box prints "değerlendirme tarihi: GG.AA.YYYY". Warning when as-of is earlier than dates in the document: not done. | Playwright: `#asof === today` on a fresh page |
| P1-5 | 3.4 MB TXT becomes one chunk; 349 s / 20 MB answer | **confirmed** (by code: `chunk_generic` had no cap) | `ingestion/chunking.py`: `MAX_GENERIC_CHUNK_CHARS = 4000`; an oversize paragraph is split at line ends, then sentence ends, then spaces, then hard — code-point offsets, non-overlapping, exact slices. Server time budget and quote cap: deferred (§3). | `tests/ingestion/test_chunking.py` (2 new: 30k-line file → >500 pieces ≤ 4000 chars, line-boundary cuts; endless sentence stream) |
| P1-6 | "Dosyaya ekle" on an already-linked document duplicates matter items | **confirmed** (no uniqueness on `(kind, refId)`) | Server: `POST /v1/matters/{id}/items` for kind file/answer/draft with an existing `(kind, refId)` merges the payload and answers 200 with the EXISTING item (notes/events/deadlines still append). Console: `matterAttachButton` — one button per document based on the active matter's membership ("Dosyaya ekle" ↔ "Dosyadan çıkar") in Belgeler and on the document page. | `tests/matters/routes.test.ts` "filing the same record twice is idempotent" |
| P1-7 | Deleting a matter silently orphans drafts; no UI path to them | **confirmed** | Confirm text now says the drafts stay but become dosyasız; Taslak view gains a "Kayıtlı taslaklar" card (GET /v1/drafts, 20 newest, "dosyasız" chip, "Aç" → editor) refreshed on closeEditor; server detaches the drafts on delete (P0-2). Block-delete-while-drafts-exist: not done (deliberate — the drafts are reachable now). | Playwright: orphan draft opened and saved as v3 |
| P1-8 | Server down: pills stay green, English "Failed to fetch" | **confirmed** | `humanError(error)` replaces every raw `error.message` print (29 sites): a network failure yields "Sunucuya ulaşılamadı — ColleX kapalı görünüyor; ColleX-Baslat.cmd ile yeniden başlatın…"; `markServerDown()` sets all three pills to the down state, puts the sentence in the top notice and polls `/v1/health` every 5 s, re-loading matters and the open view when the server is back. | `console.test.ts` string pins updated |
| P1-9 | Ledger bootstrap marks every pre-boundary migration applied by timestamp alone | **deferred** | Reviewer's probe is credible (the rule is exactly `timestamp <= boundary`), and `collex_local` is verified unaffected (trigger present, full ledger). A safe fix needs a per-file probe grammar beyond `to_regclass` (the RLS file creates policies and a function, the extensions file creates extensions), the same table mirrored in `store/health.ts`, and re-pinning `tests/ingestion/test_migrations_ledger.py` + `tests/store/persistence.test.ts` — too wide for this lane and touching the ledger contract (ADR-020). Recommendation kept in §3. | — |
| P1-10 | Client-chosen `role` launders a legal assertion into an unmarked beyan inside HUKUKÎ SEBEPLER | **confirmed** | `drafting/revise.ts`: a section whose template slots are all legal (and `hukuki-sebepler` by id) forces the legal role (issue reported; KAYNAKSIZ without evidence); an existing legal paragraph cannot be downgraded to a beyan role (issue reported, role kept). Mixed sections (AÇIKLAMALAR) still accept olaylar. Python exporter flagging: not needed once the TS side refuses. | `tests/drafting/revise.test.ts` (2 new) |
| P1-11 | PUT /v1/drafts/{id} has no optimistic-concurrency token | **confirmed** | `baseVersion` (optional) in `draftPatchSchema`; mismatch → 409 `VERSION_CONFLICT` with `currentVersion`/`baseVersion` + Turkish message, nothing written; the stored draft is now read AFTER the body arrives so two in-process requests cannot interleave between read and put. Console sends `baseVersion = editor.draft.version` and on 409 shows "Yeni sürümü yükle". `ON CONFLICT DO UPDATE` kept on purpose: the idempotent re-put of the SAME version is what a detach/attach re-persist relies on, and the route now guarantees a new version number per save. | `tests/drafting/routes.test.ts` "baseVersion…409" |
| P1-12 | Console Kaydet destroys every AI entailment binding | **confirmed** (by code) | `revise.ts`: the server keeps ITS OWN stored entailment binding on a paragraph whose text and evidence are unchanged (compared against the STORED draft, never the patch), regardless of `trustEntailment`; an edited AI paragraph is re-judged lexically. Console sends the stored binding back explicitly; chip text corrected. | `tests/drafting/revise.test.ts` "keeps the server's own entailment binding on an UNTOUCHED paragraph" |
| P1-13 | LEGAL-1: görev/derdestlik/teminat listed as HMK m.116 ilk itiraz | **confirmed** | `templates.ts` cevap-dilekcesi description, field help and section lead rewritten: ilk itirazlar = kesin olmayan yetki + tahkim (m.116, m.117/1); görev/derdestlik = dava şartı (m.114–115), her aşamada. | `tests/drafting/templates.test.ts` green |
| P1-14 | LEGAL-2: kefil clause invents a three-year cap citing TBK m.603 | **confirmed** | Clause rewritten: TBK m.583 (el yazısı azami tutar, kefalet tarihi), uzayan dönemler/azami süre ayrıca yazılır, TBK m.598/3 on-year ceiling. Separate `kefaletSuresi` field: not added (the sentence now tells the lawyer to write it). | templates tests green |
| P1-15 | LEGAL-3: repealed "500 TL'yi aşan ödemeler banka aracılığıyla" | **confirmed** | "tutarına bakılmaksızın banka veya PTT aracılığıyla ödenir, elden ödeme yapılmaz (GVK GT Seri No 268, Seri No 323 ile değişik — tebliğ numarasını güncel metinden doğrulayın)". | templates tests green |
| P1-16 | HON-1: console promises nothing leaves the machine | **confirmed** | Footer, dropzone, Ayarlar note and welcome card now name the two exceptions (Canlı araştırma → resmî kaynak sunucuları; Bulut AI → Anthropic, only when opened). | `console.test.ts` pins the new sentences and forbids the old ones |
| P1-17 | UI overclaim-1: "Doğrulanmış pasajlar" heading | **confirmed** | Heading → "Tespitler" (TOC, Markdown and cards agree). | `console.test.ts` |
| P1-18 | UI overclaim-2: AI-analysis rows get a green "doğrulandı" | **confirmed** | Chip → "alıntı belgede var — tespit AI metnidir" (mute); KAYNAKSIZ negative kept. | — (no key on this machine; string change) |
| P1-19 | LANG-4: "10 sayfanın 9'inde metin yok" | **confirmed** | "N sayfanın M tanesinde metin yok — …" (no numeral suffix). | `console.test.ts` green |
| P1-20 | HON-2: STATUS.md / TRACEABILITY.md pre-W12 while CLAUDE.md calls them "the live state" | **partial** | Dated notices at the top of both files name what they do NOT cover and point to the lane reports + this file; CLAUDE.md §Docs and the PARTIAL bullet say the same; RISKS #23 retired; COMPETITIVE/DEMO/RUNBOOK/README counts corrected. The full 02.09 refresh of STATUS/TRACEABILITY (rows for every W12 requirement) is a docs lane, deferred. | — |

### P2

| # | Finding | Verdict | What changed |
|---|---|---|---|
| P2-1 | Raw machine codes / English enums on the answer surface | **partial** | `QUESTION_PARTIALLY_COVERED` and `VERSION_CONFLICT` added to the dictionaries; progress rows print the Turkish error before the code; issue paths are humanised (`issuePathTR`). Intent/stance/doc-kind labels ("APPLICATION", "yargitay_karari", "AFFIRMATIVE") still print the code in parentheses by the dictionary rule — not changed. |
| P2-2 | Engineering internals on the document page (chunk UUIDs, offsets, MIME, ANTHROPIC_API_KEY) | **partial** | MIME → "Word belgesi (DOCX) / PDF / Düz metin (TXT) / UYAP belgesi (UDF)" (`mimeLabelTR`). Chunk ids/offsets and the key name in AI hints: not changed (the key name is what the lawyer must set — see AI.md). |
| P2-3 | Otomatik ön inceleme noisy (duplicates, mid-word snippets, adversary's talep offered for transfer) | **deferred** | Heuristic v1 lives in `intake/analysis.py`; only the heading now warns "karşı tarafın talebi de burada görünebilir". Dedupe/word-boundary/party tagging is an analysis-lane change. |
| P2-4 | Editor status line contradicts the KAYNAKSIZ badge on a broken quote | **confirmed** | `onParagraphEdited` rewrites the note to "kanıt bağı koptu — alıntı metinle örtüşmüyor (geri alın ya da KAYNAKSIZ bırakın)" while the binding is broken. |
| P2-5 | Exports/versions use UTC, UUID file names, matter UUID | **deferred** | Cross-cutting (Python DOCX/UDF + TS Markdown + console); needs one shared formatter and a naming contract. |
| P2-6 | Taslak dead ends after refresh | **partial** | "Kayıtlı taslaklar" list (P1-7) is the way back; "Son araştırma" preselect, fieldset label and legacy party hint: not changed. |
| P2-7 | Two tabs disagree on the active matter | **confirmed** | `storage` event → re-read + `syncMatterUi()` + toast "Aktif dosya başka sekmede değişti". |
| P2-8 | 390 px header/toolbar height | **deferred** | Layout work; no functional defect (no horizontal scroll). |
| P2-9 | Empty-file error headline | **confirmed** | `INVALID_REQUEST` + "boş" → "Belge boş — içeriği olan bir belge seçin." |
| P2-10 | "Korpusta doğrula" and gibberish runs pollute Araştırmalar | **deferred** | Needs a `source` tag on stored answers (API change on `/v1/answer` and the list filter). |
| P2-11 | Karşıt otorite / Otorite %40 on upload-only answers | **confirmed** | Covered by P1-2/P1-3 (stance neutral, contrary note replaced, meters hidden). |
| P2-12 | Ledger bootstrap not atomic | **deferred** | Same module as P1-9; do together. |
| P2-13 | No request-body limit | **deferred** | Loopback-only, single user; `bodyLimit` + payload caps are an API-lane change with test updates across routers. |
| P2-14 | Child-process stderr echoed in `detail` | **deferred** | Needs a correlation-id logging convention in files/drafting routes; `fileId` validation before shelling out is the cheap half — not done here. |
| P2-15 | MCP bearer token on the child's command line | **deferred** | `serve.mjs`/`serve-mcp.mjs` launcher change; loopback, single user. |
| P2-16 | Stopper kills by stale pid / launcher swallows ensure-db failures | **deferred** | `.cmd` launcher work, out of this lane. |
| P2-17 | AI draft-paragraph accepts ek-dogrulama/karsi-ictihat sections | **deferred** | No key on this machine to verify; cheap 400 guard recommended in §3. |
| P2-18 | Background write-through hides persistence failures | **confirmed** | `persisted` + warnings on every write route (P0-2). |
| P2-19 | PATCH of an answer item's refId does not re-attach | **deferred** | Small; not reached. |
| P2-20 | HON-3 stale test counts | **confirmed** | CLAUDE.md, RUNBOOK, README, COMPETITIVE updated to the counts in §2. |
| P2-21 | HON-4 `control-plane/test/` never executed | **confirmed (docs)** | CLAUDE.md no longer lists the directory as a suite and says why; the untracked stale files were NOT deleted (user's working tree). |
| P2-22 | HON-5 COMPETITIVE/RISKS #23 stale | **confirmed** | COMPETITIVE cell rewritten; RISKS #23 retired with B2 + FIX evidence. |
| P2-23 | HON-6 AI.md "henüz bağlanmadı" | **confirmed** | §5 OCR hand-off and §8 items 5–6 marked bağlandı. |
| P2-24 | HON-7 AI.md per-request chip vs session toggle | **confirmed (docs)** | AI.md §3 now describes the chip honestly as a session toggle with the visible "Bulut AI: açık" lines; the chip itself was left a session toggle (making it auto-reset would change UI-2's contract). |
| P2-25 | HON-8 CLAUDE.md "UI lanes in flight" | **confirmed** | Dateline rewritten. |
| P2-26 | HON-9 UDF embeds "Bu belge DOCX/Markdown olarak üretilir" | **confirmed** | `export/text.py` `UDF_FILE_NOTICE` used inside `.udf`; `UDF_NOTICE` says "UYAP Doküman Editörü". |
| P2-27 | HON-10 "tümü DOĞRULANMADI" hardcoded | **confirmed** | Ayarlar derives "N doğrulanmadı / N doğrulandı" from `GET /v1/deadlines/rules`. |
| P2-28 | HON-11 manual events auto-"doğrulandı" | **confirmed** | Manual events are `verified:false` with chip "elle girildi — doğrulanmadı"; only "Doğrulandı işaretle" turns it green. |
| P2-29 | LANG-5 finalizable sentence differs | **confirmed** | Console `FINALIZE_TR.yes` = renderer sentence ("KESİNLEŞTİRİLEBİLİR — …"). `export/text.py` FINALIZE_OK left (pinned by export tests; Markdown from the renderer already carries the word). |
| P2-30 | LANG-6 two UPLOAD_ONLY sentences | **confirmed** | `WARN_PATTERNS` points at `UPLOAD_ONLY_EVIDENCE_TEXT`. |
| P2-31 | LANG-7 "Bulut AI" vs "Bulut yapay zekâ" | **deferred** | ~30 console sites + server messages + pinned tests; a naming decision for the product owner. |
| P2-32 | LANG-8 "dosya" for documents | **partial** | Console: "Henüz belge yok", "belge silindi", "Belge yüklenemedi/okunamadı", "Belgeyi çıkar", "Belge türü", "Ekli belgeler", "Bu belge türü desteklenmiyor"; `files/routes.ts` messages capitalised/terminated ("Belge deposu bu sunucuda yapılandırılmamış.", "Belge işleme aracı beklenmedik biçimde sonlandı.", "Belge boyutu sınırı aşıldı: N MB > 25 MB.", "Belge kaydı bulunamadı."); `ai/routes.ts` "Belge kaydı bulunamadı.". |
| P2-33 | LANG-9 "As-of tarihi" | **confirmed** | Label "Değerlendirme tarihi (hangi tarihteki hukuka göre)". |
| P2-34 | LANG-10 "entailment" in dialogs | **partial** | Console dialogs say "anlamsal doğrulama (entailment)" / "anlamsal doğrulama sonucu"; `NOTE_AI_KAYNAKLI` left (pinned verbatim by `tests/ai/routes.test.ts`). |
| P2-35 | LANG-11 snippet/fetch/upstream | **confirmed** | `LIVE_CORPUS_NOTICE` and the trace line reworded ("arama özeti", "tam belge getirme", "resmî kaynak sunucuları"). |
| P2-36 | LANG-12 double "(isteğe bağlı)" | **confirmed** | Labels de-duplicated in templates; the console skips the suffix when the label already carries it. |
| P2-37 | LANG-13 İYUK m.61 for the recess extension | **confirmed** | Checkbox label "HMK m.104 / İYUK m.8/3 (ara verme: HMK m.102 / İYUK m.61)". |
| P2-38 | LANG-14 İş K. m.53 tiers | **confirmed** | Boundaries rewritten (beş dahil 14; beşten fazla on beşten az 20; on beş dahil ve fazlası 26). |
| P2-39 | LANG-15 Avukatlık K. m.35/A | **confirmed** | Replaced with the dava şartı arabuluculuk check sentence. |
| P2-40 | LANG-16 "usul itirazı yoktur" on an empty list | **confirmed** | Visible placeholder "[Usul itirazları — doldurun veya bu bölümü silin]"; composer test updated to forbid the waiver sentence. |
| P2-41 | LANG-17 "İcra Dairesi" / "SAYIN" | **confirmed** | "İcra Müdürlüğü" placeholders; "SAYIN" dropped from the four başlık defaults. |
| P2-42 | LANG-18 "mesai/tatil saati" | **confirmed** | "mesai saati bitimine kadar". |
| P2-43 | LANG-19 "getaddrinfo failed" in rule sources | **confirmed** | "(alan adı çözümlenemedi)". |
| P2-44 | LANG-20 tooltips/paths/progress codes | **confirmed** | "Kaydet (Ctrl+S)"; `issuePathTR`; progress rows Turkish-first. `relationLine` resolver fields left. |
| P2-45 | LANG-21/22/23/24/25/26/27/28/29/30 | **confirmed** | "kontrol edin"; "N korpus belgesi · N yüklenen belge"; one `STORE_UNAVAILABLE_TEXT`; one `AI_TIMEOUT_TEXT` (console + server); "KAYNAKSIZ paragraf yok"; placeholder mentions "Senaryo" only when presets are visible; event source `belge:<fileId>` (API-2 contract); istinaf/temyiz künye no longer asserts timeliness and points to the Süreler screen; en dashes in presets and "TBK m.444–447"; "TBK m.136 vd. ifa imkânsızlığı hükümleri ve mücbir sebebe ilişkin genel ilkeler". |

## 2. Final counts (02.09.2026, this machine, sequential)

| Command | Result |
|---|---|
| `cd control-plane && npx tsc --noEmit` | exit 0 |
| `cd control-plane && npx vitest run` | exit 0 — **79 files, 1579 passed, 4 skipped** (the 4 honest "environment unavailable" markers; the real PG/venv suites ran) |
| `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | exit 0 — **1178 passed** (114 s); `tests/export` 89 |
| `.venv/Scripts/python.exe scripts/smoke_check.py` | exit 0 — 54 tools |
| `.venv/Scripts/python.exe scripts/db_local_check.py` | exit 0 — 18/18 PASS |
| `node control-plane/scripts/demo.mjs` | exit 0 — 6/6 senaryo (collex_demo rebuilt at the end; probe rows gone) |
| Playwright on port 8871 (`collex_demo`) | orphan draft opened from "Kayıtlı taslaklar", saved as v3; as-of = today; privacy sentences present; 0 console errors; server killed, `netstat` clean |

New regression tests: coverage (4), answerHonesty (3), persistence (2 real-PG), matters routes (2), drafting routes (2), drafting store (1), revise (3), evidence (1), chunking (2) = 20; updated assertions: answerHonesty bypass wording, answerPipeline S3, composer usul placeholder, console.test.ts (7 string pins).

## 3. Remaining known issues (honest list)

1. **Ledger bootstrap by timestamp** (P1-9, P2-12): a psql-built or old-ensure-db database that lacks one pre-boundary migration is recorded as complete. Fix: a filename → probe table (`to_regclass` for relations, `to_regprocedure` for `app_private.current_tenant_id()`, `pg_extension` for the extensions file) in `ingestion/migrations.py`, mirrored in `store/health.ts`, bootstrap loop inside one transaction, tests re-pinned. `collex_local` is verified unaffected today.
2. **Drafting relevance gate** (P1-1 second half): a NORM_CONTENT criminal-law research can still seed a hukuk davası cevap dilekçesi; the neighbours are gone, the pinned provision is not. A template-kind ↔ question-intent warning in `composer.ts` is the next step.
3. **Answer time/size budget** (P1-5 second half): the chunk cap bounds the input, but `/v1/answer` still has no server-side time budget and the evidence pack quotes whole chunks.
4. **Request-body limits, stderr echo, token on the command line, launcher pid checks** (P2-13..16): loopback-only, single user; listed for the API/launcher lanes.
5. **STATUS.md / TRACEABILITY.md** still carry the 27.08 rows; the dateline notices point to the lane reports until the refresh lands.
6. **"Bulut AI" naming**, UTC/UUID in exports, the 390 px layout, the ön inceleme heuristics, "Korpusta doğrula" runs in Araştırmalar, AI section-id guard, PATCH re-attach — deferred as listed above.
7. The coverage gate and the new per-passage admission remain **lexical** and unmeasured on real law (RISKS #18); the demo corpus is SENTETİK.
