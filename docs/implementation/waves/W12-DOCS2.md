# W12 — DOCS-2: final documentation (STATUS, FINAL_REPORT, TRACEABILITY, DEMO, user guide)

Date: 02.09.2026. Lane: DOCS-2. Ownership honoured: only
`docs/implementation/STATUS.md`, `docs/implementation/FINAL_REPORT.md`,
`docs/implementation/TRACEABILITY.md`, `docs/DEMO.md`,
`docs/KULLANIM-ColleX.md` (new), `docs/README.md` (index rows) and this
report were written. Not touched: `KULLANIM-REHBERI.md`,
`README-INDEPENDENT.md`, `CLAUDE.md`, any code, test, migration or console
file. No server was started, no database was touched, no screenshot was
taken (the user guide describes screens in words by design).

Sources read in full before writing: `CLAUDE.md`, `W12-A..F.md`,
`W12-INTEGRATION.md`, `W12-B2.md`, `W12-API2.md`, `W12-UI1.md`,
`W12-UI2.md`, `W12-DOCS1.md`, `W12-FIX.md` (findings table, §2 final
counts, §3 remaining issues), the previous `STATUS.md` / `FINAL_REPORT.md` /
`TRACEABILITY.md` / `DEMO.md` / `README.md`, `docs/implementation/AI.md` §1–3,
`evals/reports/fixture_baseline_2026-09-02.md` (answer-level rows),
`ColleX-Baslat.cmd` / `ColleX-Durdur.cmd` (flow lines).

> **SENTETİK.** Every number carried into these documents is a mechanism
> measurement on the synthetic fixture corpus or on in-memory fakes; none is
> a legal-quality result, and each document says so.

## 1. The single counts table

Created in `docs/implementation/STATUS.md` under the heading
**`## Ölçülen sayılar (02.09.2026, W12 sonrası)`**, rows **S1–S17**:

| Row | What | Value | Source |
|---|---|---|---|
| S1 | `tsc --noEmit` | clean, exit 0 | W12-FIX §2 |
| S2 | `vitest run` | 79 files, 1579 passed, 4 skipped (env markers) | W12-FIX §2 |
| S3 | `pytest tests evals/tests -q` | 1178 passed (`tests/export` 89, `evals/tests` 74) | W12-FIX §2, W12-API2 §8, W12-B2 §4 |
| S4 | `smoke_check.py` | 54 tools | W12-FIX §2 |
| S5 | `http_e2e_check.py` | 54 tools over HTTP | CLAUDE.md §Commands (02.09) |
| S6 | `live_local_gateway_check.py` | 54 over the real MCP transport, 401 without token | CLAUDE.md §Commands (02.09) |
| S7 | `db_local_check.py` | 18/18 PASS | W12-FIX §2, W12-A §6 |
| S8 | `run_evals.py` | RESULT: PASS; six hard gates; 34 gold rows; Recall@10 1.0000 / nDCG@10 0.9156 / MRR 0.9024; coverage-gate abstention 100 %/100 %; answer-level (report-only) ABSTAIN 13 · COMPLETE 5 · QUALIFIED 7 · PARTIAL 9, false abstentions 0, false answers 0, finalizable 12/21 (57.1 %), expected unit cited 21/21 | W12-B2 §3.2, `fixture_baseline_2026-09-02` |
| S9 | `demo.mjs` | 6/6 (S1 8/8, S2 8/8, S3 7/7, S4 7/7, S5 7/7, S6 10/10) | W12-FIX §2, W12-INTEGRATION §7 |
| S10 | `openapi.yaml` | 35 paths / 44 operations, `1.0.0-w12` | W12-INTEGRATION §3, W12-API2 §4 |
| S11 | draft templates | 13 (7 dilekçe + 6 sözleşme), 7 field groups | W12-C, W12-INTEGRATION §5 |
| S12 | deadline rules | 30, all `dogrulanmadi`, 3 `computable:false` | W12-D |
| S13 | `/v1/health` | 54 tools, 13 templates, 30 rules, migrations 11/11, `liveTested:false`, `1.0.0-w12` | W12-INTEGRATION §5–6 |
| S14 | migrations | 13 files, 11 runnable locally, 2 pgvector never executed | W12-A, W12-DOCS1 |
| S15 | console contract | LF-only, single style/script, textContent; `console.test.ts` 69 | W12-UI2 §6 |
| S16 | new regression tests in W12-FIX | 20 | W12-FIX §2 |
| S17 | review findings | 2 P0 + 20 P1 + 45 P2; P0 2/2 fixed; P1 17 fixed + 1 partial + 1 deferred + 1 docs | W12-FIX §1 |

Every other owned document references these rows by id (`S2`, `S9` …) and
carries **no copied number**. When FIX-2 publishes `W12-FIX2.md`, only this
table needs patching; `STATUS.md` says so at the top of the table and in
"In progress".

## 2. What changed, per file

| File | Change |
|---|---|
| `docs/implementation/STATUS.md` | Rewritten as the live state after W12 (Turkish). Dateline 02.09.2026; phases 6–8 marked delivered LOCALLY; status stays **PARTIAL** with the four-status table extended by the three unverified W12 surfaces and the lexical gate; the **single counts table** (§1); "Yerelde teslim edilen (W12) — yüzey yüzey" (matters/persistence, answer honesty incl. P0-1, drafting v2 incl. P0-2/P1-10/11/12, deadlines, cloud AI, resilience, five-tab console, HTTP surface → pointer to W12-INTEGRATION §3); persistence promise + four caveats; the three labelled-unverified surfaces; verification commands keyed to S1–S9; launcher flow; "In progress" = FIX-2; "Next actions" = rotate Brave/Tavily, `ANTHROPIC_API_KEY` only if wanted (+ smoke), verify 30 rules, open a UDF in UYAP, commit decision, pgvector/gold set; blockers table; known risks (#18–#23); last verification pointing at W12-FIX §2 + Playwright/probe evidence |
| `docs/implementation/FINAL_REPORT.md` | Rewritten as the W12 edition of the §18 report: three honesty notes (numbers by reference only); **§0 executive summary** (audit → six lanes → integration → B2/API-2 → UI-1/UI-2 → review + fix → docs, with report pointers); §1.1 the two P0 fixes with before/after; §1.2 new layers; §1.3 measured defects fixed (upload currentness, coverage-aware cap, linker race, jsonb cast, chunk cap, item duplication, console/legal wording); §1.4 the three unverified surfaces; §1.5 the 27.08 inheritance condensed; **§2 ADR-016..021** table; §3 changed files; §4 → STATUS table; §5 eval (gates, coverage gate, answer-level finding, unchanged retrieval metrics, what the numbers are NOT); §6 security/legal incl. the two data-leaving exceptions and P2-13..15 deferral; §7 cost/latency (no AI cost measured); §8 honest limits (12 items); §9 → STATUS blockers; §10 local run incl. the new user guide; §11 rollback incl. W12 tables; §12 final status + COMPETITIVE pointer |
| `docs/implementation/TRACEABILITY.md` | Command legend now maps to STATUS rows; rows #1–#30 kept (compressed, 27.08); **new rows #31–#60**: matters, persistence, ledger (+ P1-9 deferred), health/fallback, auto-linking, coverage gate, **P0-1 reference-bypass fix**, unpinned citation expansion, file scope + `?fileId=`, upload currentness, upload-only Q&A honesty, typed corpus failure, drafting v2 inputs/composition, uploads-as-exhibits, context-only neighbours (+ relevance gate deferred), revise/versions/409/entailment binding, **P0-2 detach + persisted**, DOCX/UDF export (PARTIAL: UDF never opened in UYAP), deadline rules (PARTIAL: all `dogrulanmadi`), deadlines in the matter, cloud AI lane (NOT VERIFIABLE HERE live; local PASS), console AI surfaces (PARTIAL), intake resilience (+ answer budget deferred), files API, live research resilience, server lifecycle/launcher (+ P2-15/16 deferred), OpenAPI, five-tab console, Taslak editor, answer-level eval; a **deferred-items table** with pointers to W12-FIX §1/§3, W12-B2 §3.3, RISKS #18–#21 |
| `docs/DEMO.md` | Refreshed: numbers by reference; **six scenarios** incl. S6 (10 checks, detach behaviour); `collex_local` vs `collex_demo` table; `--force-drop-uploads` rule; launcher flow (Baslat/Durdur, health poll, start-up lines); **five-tab console walkthrough in Turkish** (Dosyalarım + matter page six tabs, Araştır three scopes + progress + result anatomy, Belgeler + document page + ön inceleme, Taslak picker/form/editor/save/versions/export/Kayıtlı taslaklar, Ayarlar + Sistem durumu + "Verilerim nerede?"), deadline modal, **what you see without `ANTHROPIC_API_KEY` / without `--with-mcp` / with the DB down**, security contract, outputs, export incl. UDF caveat, tests, known limits (lexical gate, mechanical PARTIAL, three unverified surfaces, background write) |
| `docs/KULLANIM-ColleX.md` | **New** Turkish end-user guide (~9 sections, plain lawyer language, no engineering words; codes explained where they appear): Başlangıç (çift tık, siyah pencere, ilk açılış, rozetler), Dosyalarım (dosya açma, aktif dosya, dosya sayfası + altı sekme, süreler paneli), Belgeler (yükleme, 25 MB, "zaten yüklüydü", taranmış sayfa, belgeye sor + üç kapsam, ön inceleme kartı), Araştır (üç kapsam, canlı ilerleme, TAM/ŞERHLİ/KISMİ/ÇEKİMSER, "Teknik kontroller tamamlandı — nihai değerlendirme avukatındır" explained, kapsam yüzdesi, kaynak çipleri, kenara alınan pasajlar), Taslak (13 şablon, form, "otomatik — kontrol edin", kanıt kaynağı, editör, KAYNAKSIZ, K-n, kaydet/sürüm/409, DOCX/Markdown/UDF deneysel, Bulut AI paragrafı %85, Kayıtlı taslaklar), Süreler (kural listesi, hesap adımları, DOĞRULANMADI, disclaimer verbatim), Ayarlar (profil, tema, Sistem durumu, "Verilerim nerede?", **Bulut AI'yi açmak**: `set ANTHROPIC_API_KEY=` in the server window or a user-level variable, never a file; the three AI surfaces and their consent), Sorun giderme (13-row table incl. veritabanı çalışmıyor, port kullanımda, sunucuya ulaşılamadı, canlı araştırma kapalı, "zaten yüklüydü", taranmış PDF, 3 MB metin, ÇEKİMSER on empty local corpus, YAZILAMADI, 409, AI grey), Sınırlar ve dürüstlük (SENTETİK, 30 kural doğrulanmadı, UDF deneysel, AI canlı sınanmadı, sözcüksel kapsam, uploads are exhibits, no UYAP/UETS, single user, hard kill) |
| `docs/README.md` | Dateline rewritten (W12 complete; single-table rule); two new "Start here" rows (user guide; review → FIX → FIX2); STATUS / FINAL_REPORT / TRACEABILITY rows refreshed; waves table gains **W12-B2, W12-API2, W12-UI1, W12-UI2, W12-FIX, W12-FIX2 (forward reference, published by FIX-2), W12-DOCS1, W12-DOCS2**; DEMO paragraph refreshed; new `KULLANIM-ColleX.md` paragraph; the INTEGRATION row's historical counts replaced by a pointer to the STATUS table |
| `docs/implementation/waves/W12-DOCS2.md` | this report |

## 3. Consistency checks run

| Check | Result |
|---|---|
| Every count in the owned files traces to a W12 report | All in STATUS S1–S17 with a source column; other files carry no numbers except historical 27.08 rows in TRACEABILITY #1–#30 (dated) |
| Stale-count sweep (`17/17`, `5/5`, `972`, `1046`, `1099`, `1054`, `1111`, `18 path/yol`, `5 şablon/templates/senaryo`, `1507`, `1535`, `1555`, `1561`, `1169`, `1174`, `30 requirements`) over the owned files | 0 hits after the README INTEGRATION-row fix |
| Feature statements spot-checked in code (`grep`) | `admitUnderReferenceBypass` in `answer/coverage.ts`; `partiallyCovered` in `verifier.ts` + `answerPipeline.ts`; `detachMatter` in `drafting/store.ts`, `store/draftStore.ts`, `matters/routes.ts`; `baseVersion` / `VERSION_CONFLICT` in `drafting/routes.ts`; `MAX_GENERIC_CHUNK_CHARS = 4000` in `ingestion/chunking.py`; `UPLOAD_CAP_MIB = 25` in `intake/quarantine.py`; `DEADLINE_DISCLAIMER` verbatim in `deadlines/rules.ts`; 30 rule ids; `persistNotice.ts` `persisted`; `humanError` ×31 in `console.html`; `AI_LIVE_TESTED = false`, `DEFAULT_AI_MODEL`; `DEFAULT_COVERAGE_FLOOR = 0.4`; `ENTAILMENT_THRESHOLD = 0.85` (finalize + ai/paragraph); `openapi.yaml` 35 top-level paths; `API_VERSION = "1.0.0-w12"`; `admitUploadOnlyPassages`, `CONTEXT_ONLY`; `UDF_FILE_NOTICE` / `UDF_NOTICE` in `export/text.py`; `--force-drop-uploads` and `S6` in `demo.mjs`; `INTAKE_EXEC_TIMEOUT_MS = 180_000` |
| Every screen name / sentence quoted in the user guide exists in `console.html` / `serve.mjs` (`grep -F`) | Tab names, `MATTER_TABS` (Belgeler · Araştırmalar · Taslaklar · Zaman çizelgesi · Süreler · Notlar), the three Araştır scopes ("Yerel korpus", "Canlı kaynaklar — derin araştırma", "Yüklediğim belgeler"), `STATUS_TR` (TAM/ŞERHLİ/KISMİ/ÇEKİMSER + sentences), "Değerlendirme tarihi (hangi tarihteki hukuka göre)", "Kayıtlı taslaklar", "Süre ekle/başlat", "Belgeye sor", "Dosyaya ekle/Dosyadan çıkar", "zaten yüklüydü", "DOĞRULANMADI — madde metniyle kontrol edin", "Sistem durumu", "Verilerim nerede?", "+ Yeni dosya", "Taslağı oluştur", "Alıntı ekle", "KAYNAKSIZ olarak bırak", "Bu paragrafı yaz (Bulut AI)", "Yeniden oluştur", "Sürümler", "otomatik — kontrol edin", "Analiz et", "Bulut OCR ile metne çevir", "Olaylara ekle", "Dayanak olarak kullan", "Zaman çizelgesine ekle", "Korpusta doğrula", "Taslağa talep olarak aktar", "Otomatik ön inceleme", "Belge olarak yükle", "Demo senaryoları", "Bugün / Bu hafta", "Sonraki bölümler", "Tam metni aç", "Aktif dosya başka sekmede değişti", "Dosyasız çalışma", "alıntı belgede var — tespit AI metnidir", "kaydedilmemiş değişiklik", "Ek — yüklenen belge", "Olay önerileri", "Taslak veritabanına YAZILAMADI", "Yeni sürümü yükle", "Sunucuya ulaşılamadı — ColleX kapalı görünüyor; …", "Canlı mod bu sunucuda kapalı", "ANTHROPIC_API_KEY tanımlı değil — Ayarlar › Sistem durumu", "yüklediğiniz belge — yürürlük değerlendirilemez", "Belge işleme süresi aşıldı", "Belgeden metin çıkarılamadı.", "Belge boş — içeriği olan bir belge seçin.", "korpusla birlikte — yerel korpus da taransın", settings labels (Ad Soyad, Unvan, Baro, Baro sicil no, Adres, Telefon, E-posta, UETS adresi, Vergi dairesi, Varsayılan şehir, Tema, Demo senaryoları), `serve.mjs` "veritabanı: ÇALIŞMIYOR" and "portu kullanımda — ColleX zaten çalışıyor olabilir". Two wording corrections were made after the check (scanned-PDF message; include-corpus checkbox label) |
| Markdown links in `docs/README.md` resolve | All resolve except `implementation/waves/W12-FIX2.md`, a **deliberate forward reference** to the FIX-2 report (the row says so) |
| Backticked repo paths in STATUS / FINAL_REPORT / TRACEABILITY / DEMO exist | 0 missing |
| Launcher flow quoted in DEMO / guide | read from `ColleX-Baslat.cmd` (health poll 2 s × 30, "Sunucu zaten calisiyor" branch) and `ColleX-Durdur.cmd` (pid files → netstat 8898/8787 → `pg_ctl stop`) |

Not run: vitest, pytest, demo, db_local_check, run_evals (this lane owns no
code; the counts are W12-FIX §2's 02.09 measurements). No server, no
browser, no database.

## 4. Integration requests (files this lane may not edit)

1. **`CLAUDE.md`** (owner: the user / a later docs pass): the header line
   "STATUS/TRACEABILITY refresh pending", the PARTIAL bullet's parenthetical
   ("STATUS.md and TRACEABILITY.md are dated 27.08.2026 and predate W12 …")
   and §Docs's "NOT yet refreshed" sentence are now stale — both files are
   dated 02.09.2026 and cover W12. Suggested wording: "`STATUS.md` holds the
   single counts table; `TRACEABILITY.md` rows #31–#60 trace W12."
   Also add `docs/KULLANIM-ColleX.md` to "Further reading".
2. **FIX-2 lane (`W12-FIX2.md`)**: when re-measuring, patch ONLY
   `STATUS.md` → "Ölçülen sayılar" rows S1–S9/S16/S17 (and S2's skip note if
   it changes); TRACEABILITY rows #33/#45/#53/#56/#58 carry `DEFERRED`
   markers pointing at W12-FIX §3 — flip them to PASS with the test name
   when the item lands. `docs/README.md` already links `W12-FIX2.md`.
3. **`docs/implementation/RUNBOOK.md` §1/§3** (DOCS-1/FIX's file): its
   counts already match STATUS S2/S3/S7 (W12-FIX updated them); when FIX-2
   re-measures, either patch both or replace RUNBOOK's copies with a pointer
   to STATUS S1–S9 to keep the single-table rule.
4. **`docs/COMPETITIVE.md`**: no change needed; FINAL_REPORT §12 points at
   its 02.09 addendum.

## 5. Honest notes

- The user guide describes the cloud-AI screens (Analiz et, Bulut OCR, Bu
  paragrafı yaz) from the UI-2 report and the code; those screens were only
  ever seen **disabled** on this machine (no key), and the guide says the
  lane is "canlı sınanmadı".
- "Bulut AI" is used throughout the guide because that is the console's
  current label (P2-31 naming decision deferred to the product owner); if
  FIX-2 renames it, the guide's §4/§5/§7 need a find-and-replace.
- The guide's troubleshooting row for a 3 MB text file reflects P1-5's
  state: input is chunk-capped, but `/v1/answer` still has no server-side
  time budget (W12-FIX §3.3) — the advice is to split the file.
- Section numbers of the previous FINAL_REPORT (§1–§12) were kept so that
  external references to "FINAL_REPORT §8 known limits" or "§12 final
  status" still land; §0 is new.
- `W12-FIX2.md` does not exist yet; README and STATUS refer to it as the
  place FIX-2 will publish.
