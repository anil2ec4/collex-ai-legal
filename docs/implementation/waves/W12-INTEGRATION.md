# W12 — Entegrasyon (A–F hatlarının tek uygulamaya bağlanması)

Tarih: 02.09.2026 · Hat: INTEGRATION · Durum: **teslim edildi, aşağıdaki
komutlarla doğrulandı** (bu makine; tüm sayılar gerçek çıktı).

Bu belge "as implemented" raporudur. Altı hattın raporları (`W12-A.md` …
`W12-F.md`) bağlayıcı sözleşmelerdir; burada yalnız ONLARIN nasıl
bağlandığı, bağlarken ne bulunduğu ve arayüz hattının neye güvenebileceği
yazılıdır. Konsol (`public/console.html`) ve `console.test.ts` bu hatta
DOKUNULMADI; UI hattı bunun üstüne gelir.

## 1. Ne bağlandı (dosya bazında)

| Dosya | Değişiklik |
|---|---|
| `control-plane/src/api/server.ts` | `ApiDependencies` ek alanlar (§2); TEK `draftStore` ve TEK `answerStore` örneği (matter bağlayıcı sarmalayıcılarla) her router'a; `/v1/health` bileşimi (§5); `/v1/answer` + `/v1/evidence-bundle`: `useCloudAi` boru hattına, `mode:'local'`+`question`+`matterId` depoya, `matterId` ön-kontrolü; `GET /v1/answers` listesi; `GET /v1/answers/{runId}` ve `/evidence-bundle` önce `warm?()`; matter ön-kontrol/bağlama ara katmanları (§4); mount: matters, settings, deadlines, ai, research (`answerStore` sink + `mcpState`), drafting (`store: draftStore`) |
| `control-plane/src/api/matterLink.ts` (**yeni**) | `MatterLinker` (`exists`, `link`, `settle`), `linkedAnswerStore`, `linkedDraftStore`, `answerLinkPayload`, `draftLinkPayload`, `MATTER_LINK_FAILED` + Türkçe mesajlar |
| `control-plane/src/api/healthReport.ts` (**yeni**) | `reportDatabaseHealth(sql?)` → `{db, dbName, migrations, corpus}`; `countCorpus` (sınırlı sorgu); `sql` yoksa `db:'off'` |
| `control-plane/src/api/answerService.ts` | `answerFiltersSchema += fileIds (≤50×≤200), includeCorpus`; `answerRequestSchema += useCloudAi, matterId (uuid)` |
| `control-plane/scripts/serve.mjs` | `mcpState: getMcpState` (TODO kapatıldı); `sql`, `dbName`, `demoCorpus`; db `ok` iken `PgAnswerStore/PgDraftStore/PgMatterStore/PgSettingsStore`, değilse bellek içi + Türkçe satır; `resolveAiConfig` → `ai` + `AnswerPipeline({cloud})`; `[collex] db/kayıt/ai` satırları; kapanışta `flush()` sonra `sql.end` |
| `control-plane/scripts/demo.mjs` | **S6 DOSYA BAĞI** senaryosu (10 kontrol) + `env.json/env.raw` yardımcıları; `createApp`'e `python`+`dbName` |
| `control-plane/src/api/openapi.yaml` | **18 → 35 yol, 44 işlem** (§3); sürüm `1.0.0-w12`; tüm yeni şema/alanlar (§3) |
| `control-plane/tests/api.test.ts` | +4 test (health [H], liste, matter bağlama + 404, useCloudAi/fileIds geçişi) |
| `control-plane/tests/integration/app.test.ts` | "lists the 5 templates" → 13 (yeniden adlandırıldı) + **12 yeni** mounted-app testi (§7) |
| `mevzuat_client.py` | `load_dotenv` artık `COLLEX_NO_DOTENV=1` ile atlanır (F hattı isteği; `mcp_server_main.py` ile aynı kural). Araç yüzeyi: **54** (smoke) |

Hiçbir hattın kaynak dosyası (A–F) değiştirilmedi. `package.json`, konsol,
`console.test.ts`, migrasyonlar, MCP yüzeyi: dokunulmadı.

## 2. `ApiDependencies` — nihai şekil (additive)

```ts
export interface ApiDependencies {
  // mevcut
  gateway?, runStore?, planner?, verifier?, capabilities?, budgets?,
  answerPipeline?: AnswerPort, answerLimits?, serveConsole?, now?,
  filesDsn?, filesStore?, filesExec?, mcp?, researchGateway?, researchProbe?,
  python?, draftingExec?, draftStore?: DraftStore,
  answerStore?: AnswerStore,          // TİP DEĞİŞTİ: InMemoryAnswerStore → AnswerStore arayüzü (PgAnswerStore geçer)
  // W12
  matterStore?: MatterStore;          // varsayılan InMemoryMatterStore(now)
  settingsStore?: SettingsStore;      // varsayılan InMemorySettingsStore
  sql?: Sql;                          // /v1/health db/migrations/corpus
  mcpState?: () => 'off'|'starting'|'ok'|'down';
  ai?: AiConfig | null;               // null/yok = KAPALI
  dbName?: string;
  demoCorpus?: boolean;               // varsayılan dbName === 'collex_demo'
}
export const API_VERSION = "1.0.0-w12";
```

`createApp` içinde: `linker = new MatterLinker(matterStore)`;
`answerStore = linkedAnswerStore(deps.answerStore ?? new InMemoryAnswerStore(), linker)`;
`draftStore = linkedDraftStore(deps.draftStore ?? new InMemoryDraftStore(), linker)`.
Bu iki örnek drafting router (`store`), AI router (`drafts`), matters
router (`answers`, `drafts`) ve research router (`answerStore` sink)
tarafından PAYLAŞILIR — E hattının şartı ("AI paragrafı `GET /v1/drafts/{id}`
ile aynı depoya düşmeli") böyle sağlanır. AI router'a `revise` lane C'nin
`reviseDraft`'ıdır (tip köprüsü: `draft as Draft`).

## 3. Uç listesi (UI hattı için) — 35 yol / 44 işlem

Hepsi `openapi.yaml`'da (pyyaml ile parse edildi; tüm `$ref`'ler çözülüyor).

| Yol | İşlemler | Kaynak |
|---|---|---|
| `/`, `/console` | GET | konsol |
| `/v1/health` | GET | §5 |
| `/v1/search` | POST | mevcut |
| `/v1/answer` | POST (`filters.fileIds`, `filters.includeCorpus`, `useCloudAi`, `matterId`) | B/A/E |
| `/v1/evidence-bundle` | POST (aynı istek) | mevcut |
| `/v1/answers` | GET `?matterId=&limit=` → `{answers: AnswerSummary[]}` | **yeni** |
| `/v1/answers/{runId}` | GET (warm) | A |
| `/v1/answers/{runId}/evidence-bundle` | GET `?texts=true` (warm) | A |
| `/v1/research-runs`, `/v1/research-runs/{id}` | POST, GET | mevcut |
| `/v1/files` | POST (multipart `file` + **`matterId`**), GET `?q=` | F |
| `/v1/files/{fileId}` | GET `?chunks=&offset=`, DELETE | F |
| `/v1/research` | POST (`matterId`) | F |
| `/v1/research/start` | POST → 202 `{runId}` | F |
| `/v1/research/runs/{runId}` | GET | F |
| `/v1/research/health` | GET (`state`) | F |
| `/v1/draft-templates` | GET (13 şablon, `fieldGroups`) | C |
| `/v1/drafts` | GET `?matterId=&limit=`, POST (`matter.matterId`) | C |
| `/v1/drafts/{draftId}` | GET, **PUT** (`DraftPatch` → sürüm+1, `issues`) | C |
| `/v1/drafts/{draftId}/versions` | GET (artan sürüm) | C |
| `/v1/drafts/{draftId}/export` | GET `?format=md\|docx\|udf` (udf: `X-ColleX-Experimental: udf`) | C |
| `/v1/matters` | GET `?status=&q=`, POST | A |
| `/v1/matters/deadlines` | GET `?until=` | A |
| `/v1/matters/{id}` | GET, PATCH, DELETE | A |
| `/v1/matters/{id}/items` | POST | A |
| `/v1/matters/{id}/items/{itemId}` | PATCH, DELETE | A |
| `/v1/settings` | GET, PUT | A |
| `/v1/deadlines/rules`, `/v1/deadlines/holidays`, `/v1/deadlines/compute` | GET, GET `?year=`, POST | D |
| `/v1/ai/status`, `/v1/ai/analyze-document`, `/v1/ai/ocr`, `/v1/ai/draft-paragraph` | GET, POST, POST(multipart), POST | E |

Şemalara eklenenler: `AnswerSummary`, `QuestionCoverage`, `AiUsed`,
`FileScope`, `EvidenceView.origin`, `lanes += citation`, `AnswerResult.
coverage/aiUsed/fileScope`, `ResearchRequest.matterId`, `ResearchToolCall.
status/errorKind`, `ResearchProgressStep`, `ResearchRunView`,
`ResearchHealth.state`, `FilePageStats`, `FileUploadResult.action/message/
pages`, `FileDetail.chunkWindow/pages`, `TemplateField.kind/options/help/
group`, `DraftVekil`, `DraftParty.tckn/vkn/adres/vekil`, `DraftMatter.
mahkeme/esasNo/davaDegeri/arabuluculuk/vekil/matterId/tarih`, `Draft.
version/updatedAt/matterId/unusedEvidence/suggestedFacts`,
`DraftParagraph.binding`, `DraftPatch`, `DraftSummary`, `DraftSuggestedFact`,
`DraftEvidence.fileId/chunkId`, `NewMatter`, `MatterPatch`, `Matter`,
`MatterSummary`, `MatterItem`, `Settings`, `DeadlineRule`,
`ComputeDeadlineRequest`, `DeadlineComputation`, `AiUsage`, `AiStatus`,
`AiFinding`, `AiDocumentAnalysis`, `AiOcrResult`, `AiDraftParagraphResult`;
`/v1/health` cevabı (§5).

## 4. Otomatik dosyalama (matter auto-linking) kuralları

`src/api/matterLink.ts`, sözleşme [M]:

| İstek | matterId nerede | Kayıt | payload |
|---|---|---|---|
| `POST /v1/answer`, `POST /v1/evidence-bundle` | gövde `matterId` (uuid; şema) | `answer`, refId = runId | `{question, status, mode:'local'}` |
| `POST /v1/research`, `POST /v1/research/start` | gövde `matterId` (F hattı sink'e geçirir) | `answer`, refId = runId | `{question, status, mode:'live'}` |
| `POST /v1/drafts` | `matter.matterId` | `draft`, refId = draftId | `{title, template, version}` |
| `PUT /v1/drafts/{id}`, `POST /v1/ai/draft-paragraph` | saklı taslağın `matterId`'si (miras) | aynı kayıt GÜNCELLENİR (version yenilenir) | aynı |
| `POST /v1/files` | multipart alanı `matterId` | `file`, refId = fileId | `{fileName}` |

Kurallar:

1. **Ön-kontrol, iş yapılmadan önce.** `matterId` verilmişse
   `MatterLinker.exists` → yoksa `404 { error: { kind: 'MATTER_NOT_FOUND',
   message: 'Dava dosyası bulunamadı; matterId alanını kontrol edin.' } }`;
   depo cevap veremiyorsa `503 STORE_UNAVAILABLE`. Yanlış yazılmış bir
   kimlik asla sessiz "öksüz" kayıt üretmez (ölçüldü: pipeline çağrısı 0,
   intake CLI çağrısı 0, taslak 0).
2. **Bağlama asıl isteği asla düşürmez.** Kayıt oluştuktan sonra bağlama
   başarısız olursa cevap gövdesinin `warnings` dizisine
   `MATTER_LINK_FAILED:Kayıt dava dosyasına bağlanamadı; kaydın kendisi
   oluşturuldu, dosyaya elle ekleyebilirsiniz.` eklenir (taslakta ayrıca
   `machineWarnings`'e kod), stderr'e `[collex] MATTER_LINK_FAILED kind=…`
   düşer. `/v1/research/start` arka planda bağlar; uyarısı yalnız stderr'de.
3. **Tekillik.** (kind, refId) çifti varsa `updateItem` (payload sığ
   birleşim), yoksa `addItem`; aynı anahtar için bağlamalar sıraya alınır.
   PUT ile 5 sürüm = 1 kayıt, `payload.version` güncel.
4. **Depoya yazma.** Cevap girdisi `matterId` ile depolanır (`PgAnswerStore`
   `matter_id` sütunu); `attach` çağrılmaz (zaten yazılı). Matters router'ın
   elle `POST /items {kind:'answer', refId}` yolu değişmedi.
5. `matter.matterId` (taslak) şeması C hattında serbest metindir; UUID
   olmayan değer `exists` tarafından `missing` sayılır → 404.

## 5. `/v1/health` — nihai şekil (sözleşme [H])

```json
{ "status":"ok", "service":"@collex/control-plane", "time":"…", "capabilities":[…7], "registeredToolCount":54,
  "db":"ok|missing|down|off", "dbName":"collex_demo"|null,
  "migrations":{"applied":11,"expected":11,"missing":[]}|null,
  "mcp":"off|starting|ok|down",
  "ai":{"configured":false,"model":null,"liveTested":false},
  "demoCorpus":true, "corpus":{"publicDocuments":6,"uploads":0}|null,
  "templates":13, "deadlineRules":30, "version":"1.0.0-w12" }
```

- `db:'off'` = `sql` verilmemiş (test/API-only örnek); `down/missing/ok` A
  hattının `checkDatabase`'i (3 s yarış). Korpus sayımı AYNI anda, aynı
  bütçeyle koşar; `db !== 'ok'` ise `corpus:null`. Ölçülen: db kapalıyken
  en kötü ~3 s (tek zaman aşımı); db açıkken < 100 ms.
- `corpus.uploads` = `scope='tenant' AND source='UPLOAD'` — `/v1/files`'ın
  listelediği satırlar (fixture'ın kendi kiracı belgesi sayılmaz).
- `mcp` = `deps.mcpState?.() ?? (mcp || researchGateway ? 'ok' : 'off')`.
- Rota hiçbir durumda fırlatmaz.

## 6. HTTP probe transkripti (gerçek sunucu, `collex_demo`, 8821)

`node control-plane/scripts/serve.mjs --port 8821 --dsn …/collex_demo`
(demo.mjs'in kurduğu DB; ürün DB'si `collex_local`'a dokunulmadı). Başlangıç
satırları: `db : Veritabanı (collex_demo) bağlı; 11/11 migrasyon uygulanmış.`
· `kayıt : kalıcı (app_private.answers/drafts/matters/settings)` · `ai :
kapalı (ANTHROPIC_API_KEY yok)` · `mcp : kapalı`.

```
200 GET  /v1/health            db=ok dbName=collex_demo migrations=11/11 mcp=off ai={configured:false,model:null,liveTested:false}
                               demoCorpus=true corpus={publicDocuments:6,uploads:0} templates=13 deadlineRules=30 version=1.0.0-w12
201 POST /v1/matters           id=bec44ccd-… status=acik
200 POST /v1/files (+matterId) fileId=d595f1f8cb58dbc4 action=created chunkCount=4 (sentetik kira sözleşmesi TXT)
200 POST /v1/answer (filters.fileIds=[fileId], matterId)
                               status=PARTIAL finalizable=false coverage={ratio:1,gate:passed}
                               fileScope={fileIds:[…],includeCorpus:false} evidence.origin=[upload] title=probe_kira_sozlesmesi.txt
                               aiUsed.label="Kural tabanlı — yerel" reasons=[OUT_OF_DATE_SOURCE:…, NOT_FINALIZABLE]
200 POST /v1/answer (S1 TCK m.157, matterId)
                               status=COMPLETE origin=[corpus×8] coverage.gate=bypassed-by-reference
200 GET  /v1/matters/{id}      files=[{refId:d595…, fileName:probe_kira_sozlesmesi.txt}]
                               answers=[{PARTIAL,local,evidenceCount:1},{COMPLETE,local,evidenceCount:8}] drafts=0
200 GET  /v1/answers?matterId= count=2 modes=[local,local]
200 GET  /v1/answers/{runId}/evidence-bundle?texts=true   evidence=1 texts=1  (PgAnswerStore.warm yolu)
200 POST /v1/deadlines/compute {ruleId:hmk-istinaf,startDate:2026-07-15}
                               dueDate=2026-09-07 (07.09.2026 Pazartesi) adliTatil.applied=true dueDateWithoutExtension=2026-07-29 verified=dogrulanmadi
200 GET  /v1/deadlines/rules   rules=30
200 GET  /v1/ai/status         configured=false model=null liveTested=false consent=per-request
503 POST /v1/ai/analyze-document (useCloudAi:true)   AI_NOT_CONFIGURED
200 PUT  /v1/settings          profile.ad="Av. Probe Yılmaz" theme=dark showDemoPresets=true (varsayılan geri geldi)
200 GET  /v1/settings          ad/baro kalıcı (PgSettingsStore)
502 POST /v1/research/start    UPSTREAM_UNAVAILABLE "Canlı derin araştırma bu sunucuda yapılandırılmamış (sunucuyu --with-mcp ile başlatın)."
503 GET  /v1/research/health   gateway=unreachable state=off
200 POST /v1/drafts (matter.matterId, evidence:{runId:S1, fileIds:[fileId]})
                               version=1 matterId=bec44… evidence=12 unsupportedCount=0 suggestedFacts=2
200 PUT  /v1/drafts/{id}       version=2 issues=0 matterId miras
200 GET  /v1/drafts/{id}/versions   [2,1] ← PgDraftStore sırası (bkz. §9; sarmalayıcı artık [1,2] döner)
200 GET  /v1/drafts/{id}/export?format=udf
                               X-ColleX-Experimental=udf content-type=application/octet-stream 5963 bayt, PK imzası
200 GET  /v1/matters/{id}      drafts=[{refId:dft-…, version:2, template:dava-dilekcesi}] answers=2 files=1
200 GET  /v1/drafts?matterId=  [dft-…@v2]
404 POST /v1/answer (matterId=…dead)   MATTER_NOT_FOUND
204 DELETE /v1/files/{id}, 204 DELETE /v1/matters/{id}, GET /v1/files → 0  (temizlik; demo'nun yükleme koruması sessiz)
```

`--with-mcp --mcp-port 8901`:

```
109 ms   GET /v1/health.mcp = starting
4732 ms  GET /v1/health.mcp = ok
200 GET /v1/research/health  {gateway:"ok", toolCount:54, state:"ok"}
202 POST /v1/research/start {budgets:{maxToolCalls:3,maxFetches:1,maxWallTimeMs:20000}}
    → 11.35 s sonra state=failed error={kind:UPSTREAM_UNAVAILABLE, message:"Resmî kaynak geçidine hiçbir araç çağrısında ulaşılamadı; …"}
      progress.steps=["Mevzuat aranıyor:failed:UNAVAILABLE"]   (resmî upstream'ler bu makineden ulaşılamıyor — beklenen, tipli)
```

Kapanış: iki sunucu da öldürüldü (`taskkill /F`); `netstat`: 8821/8901
dinleyici yok, uvicorn pid 2080 gitti (F hattının `--parent-stdin`
watchdog'u). Sert kill pid dosyalarını bırakır (F hattı belgeledi);
elle silindi. 8787/8898'e dokunulmadı.

## 7. Test sayıları (gerçek çıktı, 02.09.2026 02:49–02:53)

| Komut | Sonuç |
|---|---|
| `control-plane> npx tsc --noEmit` | **exit 0** (temiz) |
| `control-plane> npx vitest run` | **79 dosya, 1507 passed, 4 skipped** (skip'ler: `real-export`, `store/persistence`, `integration/serve`, `integration/real-exec` içindeki "environment unavailable" işaretleyicileri — ortam VARDI, gerçek testler koştu). Önce: 1489 passed / 1 failed. |
| `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1169 passed** in 112.54 s |
| `.venv/Scripts/python.exe scripts/smoke_check.py` | `offline smoke checks passed: 54 tools, …` |
| `.venv/Scripts/python.exe scripts/db_local_check.py` | **18/18 checks passed, RESULT: PASS** |
| `node control-plane/scripts/demo.mjs` | **6/6** (S1 8/8, S2 8/8, S3 7/7, S4 7/7, S5 7/7, **S6 10/10**), iki kez (probe öncesi ve sonrası) |
| `pyyaml` ile `openapi.yaml` | parse OK; 35 yol, 44 işlem, çözülmeyen `$ref` yok; `retrievalProvenance.test.ts` alan kontrolleri geçti |
| `COLLEX_NO_DOTENV=1` ile `import mevzuat_client` | OK |

Yeni mounted-app testleri (`tests/integration/app.test.ts`, 17 → 29):
matters CRUD (201/200/PATCH/DELETE/404 MATTER_NOT_FOUND, `/v1/matters/
deadlines`); `/v1/answer + matterId` → answer kaydı (question/status/mode +
canlı evidenceCount) ve `GET /v1/answers?matterId=`; yanlış matterId → 404
+ retrieval 0 + depo 0; UUID olmayan → 400; taslak POST `matter.matterId`
→ draft kaydı v1, PUT → v2 (aynı kayıt, kopya yok), versions=2, liste
filtre; yanlış `matter.matterId` → 404, taslak yok; `/v1/files` multipart
`matterId` → file kaydı (fileName), yanlış → 404 ve CLI çağrısı 0; senkron
`/v1/research` (sahte gateway) → depoda `mode:'live'`, matter kaydı,
`GET /v1/answers/{runId}`, liste, runId ile taslak, `evidence-bundle?texts=true`;
`/v1/research/start` → 202, poll → done, depoda + dosyada, yanlış matterId
404; deadlines (30 kural, hmk-cevap 05.01→19.01.2026); AI status
`configured:false` + consent 400 + 503 AI_NOT_CONFIGURED; settings tam
değiştirme; health (db off, mcp ok/off/starting, demoCorpus, sayımlar,
sürüm; `mcpState:'starting'` → `/v1/research/health.state='starting'` 503).
`tests/api.test.ts` (27 → 31): health [H], `GET /v1/answers` (sıra, limit,
400'ler), matter bağlama + 404, `useCloudAi`/`fileIds` geçişi
(`AI_UNAVAILABLE` uyarısı, `aiUsed.drafter:false`).

## 8. Hat dosyalarında yapılan düzeltmeler

Hiçbir A–F kaynak dosyası değiştirilmedi. Hat sözleşmeleriyle ilgili
yapılanlar:

- `tests/integration/app.test.ts` şablon sayısı 5 → 13 (C hattı sözleşmesi;
  F hattı adım 3.4).
- `mevzuat_client.py` dotenv koruması (F hattı adım 3.5; hiçbir hattın
  sahipliğinde değildi).
- `PgDraftStore.versions` (A) **azalan** sürüm döner; C hattının HTTP
  sözleşmesi **artan** der (`InMemoryDraftStore` artan). Hat dosyalarına
  dokunmadan `linkedDraftStore` sarmalayıcısı çıktıyı artan sıraya
  sabitler; tel sırası artık depodan bağımsız. (Probe'daki `[2,1]` bu
  düzeltmeden önceki ölçümdür; test `versions` uzunluğunu ve sarmalayıcı
  sırasını kontrol eder.)
- E hattının `ReviseFn` tipi ile C hattının `reviseDraft(draft: Draft)`
  imzası `strictFunctionTypes` altında doğrudan atanamıyor; `server.ts`
  içinde üç satırlık köprü (`draft as Draft`). Tip düzeyi; davranış aynı.

## 9. Açık konular / dürüst notlar

1. **Yüklenen belgeye dayalı cevap `PARTIAL`** (probe): B hattı kapsam
   kapısını geçti (`ratio:1`), kanıt `origin:'upload'`, ama doğrulayıcı
   `OUT_OF_DATE_SOURCE` düşürdü — yüklemelerde yürürlük (currentness)
   değerlendirmesi tarih bilgisi olmadan "güncel değil" sayılıyor. UI
   hattı bu durumu "yüklediğiniz belge — yürürlük değerlendirilemez" diye
   göstermeli; kalıcı düzeltme B hattının (`currentness` için upload
   istisnası) — bu hatta kapsam dışı bırakıldı.
2. `POST /v1/research/start` bağlama uyarısı yalnız stderr'de (202 gövdesi
   yok); `GET /v1/research/runs/{id}` görünümüne eklenmedi (F hattı
   registry'si bu hattın dosyası değil).
3. AI canlı sınanmadı (E hattı); `ai.liveTested:false` her yerde.
4. Süre kuralları tamamen `dogrulanmadi` (D hattı); probe `hmk-istinaf`
   sonucu mekanizma kanıtıdır, hukukî doğrulama değil.
5. Sert kill sonrası `var/collex*.pid` kalır (F hattı belgeledi); bu hat
   probe sonrası elle sildi.
6. `docs/implementation/STATUS.md`, `TRACEABILITY.md`, `docs/DEMO.md`,
   `RUNBOOK.md` hâlâ "5 şablon", "18 yol", "5 senaryo" der — **docs
   hattı**. Bu rapor dışında belge değiştirilmedi.
7. `demo.mjs` S6 bellek içi depolarla çalışır (createApp varsayılanı);
   kalıcı depolar probe ile (Pg) ayrıca kanıtlandı.
8. Ara katmanlar gövdeyi hono'nun önbelleğinden okur (`json()`/`parseBody()`
   ikinci çağrıda aynı gövde) — hono 4.13.5 ile doğrulandı; hono güncellenirse
   `tests/integration/app.test.ts` "multipart matterId" testi bunu yakalar.
9. `corpus.uploads` yalnız `source='UPLOAD'` sayar (bkz. §5); UI "Belgeler"
   sayısı ile `/v1/files` tutarlıdır.
