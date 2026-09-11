# W14 — L-DOCS (Faz B2): sözleşmenin ve belgelerin uzlaştırılması

**Tarih:** 02.09.2026 · **Hat:** L-DOCS · **Faz:** B2 ·
**Sahip olunan dosyalar:** `control-plane/src/api/openapi.yaml`, `CLAUDE.md`,
`docs/**`. **Kod, test ve `console.html` bu hat tarafından değiştirilmedi.**

Bu hattın işi yeni özellik değil, **kayıt**tı: yedi Faz A hattının ve Faz B1
entegrasyon hattının teslim ettiği şeyin sözleşmesini yazmak, ölçülen sayıları
tek bir tabloda uzlaştırmak ve **kapatılmayanları saklamamak**.

Bu belgedeki her sayı ya bu koşuda ölçüldü ya da kaynağını satır satır söyler.

---

## 0. Ölçülen sonuç — bu tur, bu makine

| Komut | Sonuç |
|---|---|
| `cd control-plane && npx tsc --noEmit` | **temiz** (çıktı yok, exit 0) |
| `cd control-plane && npx vitest run` | **102 dosya · 2027 geçti · 1 DÜŞTÜ · 6 atlandı (2034)** — §7 |
| `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1339 passed** (128,95 s) |
| `.venv/Scripts/python.exe scripts/smoke_check.py` | **exit 0** — 54 araç |
| `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 · RESULT: PASS** |
| `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS** (6/6 sert kapı) — §6 |
| `npx vitest run tests/pipeline/retrievalProvenance.test.ts tests/api.test.ts` | **53 passed** (openapi.yaml'ı okuyan süit + API sözleşmesi) |

`node control-plane/scripts/demo.mjs` **koşturulmadı** ve bu bilinçlidir:
`demo.mjs` `collex_demo`'yu düşürüp yeniden kurar ve o veritabanını bu sırada
eşzamanlı bir hat kullanıyor. STATUS S7 kaynağını `W14-L-FIX` §0 olarak
söylüyor.

**Hijyen:** hiçbir sunucu başlatılmadı, hiçbir veritabanı yaratılmadı ya da
düşürüldü, `collex_local`'a hiçbir şey yazılmadı (beş `app_private` tablosu da
**0 satır**, koşu sonunda doğrulandı), 8787/8898'e dokunulmadı, hiçbir git
işlemi yapılmadı, `.env` okunmadı. `var/collex.pid` bu hat tarafından
**yaratılmadı ve silinmedi** — eşzamanlı konsol hattının sunucusuna ait.
Geçici dosyaların tamamı `scratchpad/w14b-L-DOCS/`'ta.

---

## 1. `openapi.yaml` — 35/44 → **65 yol / 80 işlem**

Yedi Faz A raporunun additive deltalarının **tamamı** ve Faz B1'in mount
ettiği yolların hepsi uygulandı. Doğrulama, iddiaya değil ölçüme dayanıyor:

```
paths 65 · operations 80 · schemas 126
çözülmeyen $ref: 0 · referans verilmeyen şema: 0 · tekrar eden operationId: 0
info.version: 1.0.0        (eski: 1.0.0-w12)
```

Ayrıca **kod ↔ belge çapraz denetimi** yapıldı: `control-plane/src` içindeki
her `app.<method>("<path>")` kaydı ile `openapi.yaml`'ın yol/işlem kümesi
karşılaştırıldı.

```
kodda olup belgelenmeyen : YOK
belgelenip kodda olmayan : YOK
```

*(Tek görünen fark `POST /v1/matters/{id}/items:batch` idi ve denetim
betiğinin `:param` normalizasyonunun yan etkisiydi — iki nokta o yolun kendi
adının parçası. Yol koddadır.)*

### 1.1 Yeni yollar (30 yol / 34 işlem)

`/v1/citation-audit` · `/v1/citation-audit/preview` · `/v1/contracts/review` ·
`/v1/contracts/checklists` · `/v1/contracts/checklists/{id}` ·
`/v1/fees/tariffs` · `/v1/fees/compute` · `/v1/sources/catalog` ·
`/v1/sources/manifest` · `/v1/sources/search` · `/v1/sources/fetch` ·
`/v1/sources/within` · `/v1/backup` (GET+POST) · `/v1/ai/ledger` ·
`/v1/contacts` (GET+POST) · `/v1/contacts/{id}` (GET+PATCH+DELETE) ·
`/v1/contacts/conflict-check` · `/v1/matters/calendar.ics` ·
`/v1/matters/{id}/calendar.ics` · `/v1/matters/{id}/hearings/{itemId}/prep` ·
`/v1/matters/{id}/items:batch` · `/v1/matters/{id}/items/batch` ·
`/v1/matters/{id}/activity` · `/v1/matters/{id}/package` ·
`/v1/matters/search` · `/v1/search/all` · `/v1/files/search` ·
`/v1/files/{fileId}/original` · `/v1/files/{fileId}/usage` ·
`/v1/drafts/{draftId}/versions/{version}`

**Mevcut yollara eklenen iki işlem:** `DELETE /v1/answers/{runId}` ve
`DELETE /v1/drafts/{draftId}`.

### 1.2 Mevcut sözleşmelere additive alanlar

- `AnswerRequest.filters`: `chambers[]`, `yearFrom`, `yearTo`,
  `excludeTerms[]` (B-16, L-SOURCES IR-5) — `SearchFilters` de aynı dördü aldı.
- `QuestionCoverage.measuredOn` (B-08) · `AnswerResult.temporal` →
  yeni `TemporalView` / `TemporalVersion` / `AmendingInstrument` (B-09) ·
  `ClaimView.entailmentAggregation` + `entailmentMeasured` (B-31).
- `POST /v1/answer`: yeni **404 `FILE_NOT_FOUND`** (`missingFileIds[]`).
- `GET /v1/drafts/{id}/export`: `format` enum'una `denetim-docx`, yeni
  `annex` / `marks` parametreleri, yeni **409** (`error.code = QUOTE_ALTERED`,
  `error.paragraphs[]`).
- `PUT /v1/drafts/{id}`: `issues[].code`; `DraftPatch` ve `Draft`
  `reviewChecklist` / `evidenceReview` (yeni `ReviewMark`).
- `/v1/health`: `rls`, `backup`, `migrations.unknown`, `deadlineRules` 41,
  `version` açıklaması.
- `MatterItem.kind` enum'una `hearing`; `MatterSummary` `counts.hearings` /
  `overdueCount` / `nextHearing`; `nextDeadline` `daysLeft` / `overdue`;
  `/v1/matters/deadlines` `from` / `include` / `format` parametreleri ve
  `hearings[]` / `window` / `includedComputed`.
- `GET /v1/answers` `q` + `status`; `GET /v1/drafts` `q`;
  `DraftSummary.updatedAt`; `GET /v1/files` `matterId`/`limit`/`offset` +
  `page{}`; `FileListEntry.matterId`/`matterTitle`.
- `FileAnalysis`: `referencesAmbiguous`, `references[].count` /
  `resolvedFromContext`, `parties[].alsoRoles`, `dates[].title`/`source`/
  `verified`, `claims[].ordinal`/`fromDemandBlock` (B-37, B-18).
- `DeadlineRule.adliTatileTabi` (üç durumlu) + `nasilDogrulanir`.
- `AiStatus.limits` / `today` / `masking`; `analyze-document` gövdesinde
  **`maskMode` ZORUNLU** + `matterId`; yeni **429** ve `MaskPreview` şeması.
- `ProviderCode` enum'una `UYUSMAZLIK`.
- `ApiError.error`: `code`, `paragraphs[]`, `missingFileIds[]`,
  `failedSources[]`, `limits`, `usage`, `notes[]`; ve `kind` açıklamasında
  W14'ün bütün yeni makine kodları — **421 `FOREIGN_HOST`** ve
  **403 `FORBIDDEN_ORIGIN`** dâhil, ki bunlar HER yolda cevap olabilir.

### 1.3 Yeni şemalar (34)

`CitationAuditRequest` · `AuditBucket` · `CitationAuditRow` ·
`CitationAuditReport` · `ChecklistItem` · `Checklist` · `ReviewEvidence` ·
`ContractReviewRequest` · `ChecklistFinding` · `ClauseObservation` ·
`ClauseLine` · `ContractReviewReport` · `ReviewMark` · `FeeTariffLine` ·
`FeeTariffResponse` · `FeeComputeRequest` · `FeeStep` · `FeeComputation` ·
`SourceCatalog` · `ManifestSource` · `ManifestGap` · `ToolReachability` ·
`CoverageManifest` · `SourceSearchRequest` · `SourceSearchRow` ·
`SourceFailure` · `SourceSearchResult` · `SourceFetchRequest` ·
`SourceQuote` · `SourceCard` · `SourceCardResponse` · `SourceWithinRequest` ·
`SourceWithinResult` · `BackupResult` · `BackupSummary` · `MaskPreview` ·
`AiLedgerEntry` · `AiLedgerBody` · `ContactRole` · `Contact` · `NewContact` ·
`ContactPatch` · `ConflictHit` · `ConflictReport` · `NewMatterItem` ·
`BatchItemsResponse` · `ActivityEntry` · `ActivityResponse` · `HearingPrep` ·
`SearchAllResponse` · `FileSearchHit` · `FileUsage` · `TemporalVersion` ·
`AmendingInstrument` · `TemporalView`.

### 1.4 Belgelemenin taşıdığı disiplin

Bir şema alanı, **hangi kararı taşıdığını** da yazar. Örnek: `AuditBucket`
açıklaması `NOT_FOUND` ile `UNCERTAIN`'in aynı şey olmadığını söyler;
`FeeTariffLine.amount` `null`'ın bir kusur değil dürüst cevap olduğunu;
`SourceSearchRow` bir künye olduğunu ve kanıt olmadığını; `marks`
parametresi mürekkebi kaldırmanın disiplini kaldırmadığını. Bir istemci
yazarı bu satırları okumadan yanlış bir arayüz çizebilir.

---

## 2. `STATUS.md` — tek sayı tablosu yeniden yazıldı

Tablo **S1–S24**. Kural şu: bir sayı **sonradan yeniden ölçüldüyse tabloya
yeni ölçüm yazıldı**, Faz A raporundaki eski değeri değil. Her satır "en son
nerede ölçüldüğünü" söylüyor.

Bu turda yeniden ölçülenler: S1–S6, S8–S12, S14, S15.
Kaynağını Faz A / Faz B1 raporuna veren satırlar: S7, S13, S16–S21.

### 2.1 Bir rapor sayısı düzeltildi

`W14-L-LEGAL` §3.2 "**15 kalem `amount: null`**" diyordu. Tarife yeniden
sayıldı (`FEE_TARIFFS[0].lines.filter(l => l.amount === null).length`):
**17**'dir. 15 olan, `dogrulanmadi` kalem sayısıdır; rapor iki farklı sayıyı
aynı cümlede birleştirmiş. STATUS S11 ölçülen değeri taşıyor ve düzeltmeyi
parantez içinde kaydediyor.

### 2.2 "Dokuz doğrulanmamış yüzey"

`PARTIAL` gerekçesi W12'nin üç etiketli yüzeyinden dokuza çıktı ve tablo
hâline geldi: bulut AI · UDF · 25 süre kuralı · 17 harç kalemi · B-16 canlı
arama · `.ics` · yerel kütüphane · B-13'ün `NOT_FOUND` kovası · ölçek.
Her satır "ne yapılmadı"yı yazıyor ve `DEPLOYMENT_READY` yolu dokuz adıma
karşılık geliyor.

### 2.3 "Açık ve dürüst — W14'ün kapatmadıkları"

Dokuz madde, hiçbiri yumuşatılmadan: konsolun Faz B'de olması ve **Faz A'da
inen hiçbir ucun arayüzde çizili olmaması**; B-06'nın kalan maliyeti ve
denenip **başarısız olan** üç kalıcı çözüm; §6'daki eval gerilemesi; paylaşılan
PostgreSQL çekişmesi; `absent: true`'nun ulaşılamaz olması; B-21 DOCX /
B-18 kronoloji DOCX / `inceleme-docx` HTTP ucunun inmemesi;
`UPLOAD_CAP_MIB`'in 25'te kalması; `prefers-reduced-motion`'ın tarayıcıda
ölçülmemesi; B-03'ün "küme sıfırdan" adımının yapılmaması.

---

## 3. `TRACEABILITY.md` — B-01..B-46, satır satır

W13 backlog'unun **46 kaleminin her biri** için bir satır: ne indi · dosyası ·
testi · ölçülen sonuç (STATUS satır kimliğiyle) · durum. Durum sözlüğü
mevcut: `PASS` / `PARTIAL` / `DEFERRED` / `OPEN`. Hiçbir `DEFERRED` satırı
sessiz değil — gerekçesi ve sahibi yazılı.

Dağılım: **PASS 15 · PARTIAL 25 · DEFERRED 6** (B-32 ölçümü, B-39, B-41 ve
üç dışa aktarım yarısı).

Ayrıca bir **tuzak kapatıldı**: W12 blokundaki satırlar eski tablonun satır
kimliklerine atıf yapıyor (`S7` = db_local_check, `S8` = run_evals,
`S9` = demo), W14 tablosu ise yeniden numaralandı. Başlığa bunu söyleyen bir
uyarı kondu ve komut sözlüğü iki kimliği birden gösteriyor.

Ertelenenler listesine altı yeni satır girdi (25 süre kuralı, 17 harç kalemi,
B-16 canlı arama, `.ics`, B-20'nin ingestion yarısı, B-13'ün kovası) ve her
biri sahibini adlandırıyor: bazıları **kullanıcı** işidir, bazıları bir
sonraki dalganın.

---

## 4. `CLAUDE.md` — sözleşme

- **Altıncı kural eklendi:** *"`STATUS.md` → 'Ölçülen sayılar' bir sayının
  yazıldığı TEK yerdir"* (§C.1 tuzağı artık sözleşmenin kendisinde).
- **Dizin haritası:** `src/contracts/`, `src/sources/`, `src/fees/`,
  `src/backup/` yeni satırlar; `src/matters/` (ics, contacts, records,
  package), `src/drafting/` (quoteIntegrity, exportMode), `src/api/`
  (localGuard önde), `intake/` (`--dir`, `PDF_MAX_PAGES`, yazma sırası),
  `export/` (audit, review, package + "reddedilen dışa aktarım hiçbir dosya
  bırakmaz"), `deadlines/` (41 kural), migrations (15 dosya / 13 runnable),
  `tests/` (102 dosya, silinen `dist/` ve `test/`), `VERSION` ve iki yeni
  `.cmd`.
- **Yeni invaryantlar:** alıntı bütünlüğü kapısı (ADR-023, iki runtime tek
  kanonik biçim, "ikisi birlikte değişir") · dışa aktarım kipleri içeriği
  yönetir, doğrulamayı asla (ADR-024) · `localGuard` ilk middleware'dir ve
  iki kuralı pazarlık edilemez (ADR-025) · çoklu sentinel ledger (ADR-026) ·
  `/v1/health.rls` `expected`'a eşit olmalı · harç disiplini (yıllık tutar
  **asla uydurulmaz**) · süre kuralı disiplini (kaynaksız `dogrulandi`
  reddedilir).
- **Yasaklar:** dokuz doğrulanmamış yüzeyin hiçbiri doğrulanmış gibi
  sunulmaz · **cevap vermeyen bir uç için ekran çizilmez** (vaporware kapısı)
  · makine kodu avukatın önünde tek başına durmaz (4 blok / 8 cümle tavanı) ·
  "risk" kelimesi kaynaksız satırda duramaz · **künye uydurulmaz** ve
  bakmadığımız bir şeye `NOT_FOUND` denmez.
- **Veritabanı disiplini tablosu:** dört yeni probe adı (`collex_answer_test`,
  `collex_safe_test`, `collex_matter_test`, `collex_fix_test`), her biri
  sahibiyle. `collex_safe_test` satırı, o süitin veritabanını **bilerek yok
  ettiğini** ve başka bir adı reddettiğini yazıyor.
- **Komutlar:** yedekleme/geri yükleme, `--library-dir`, `--dir`, üç yeni
  `export.cli` kipi; nazik durdurma semantiği ("pid'in gitmesi kayıtlar
  yazıldı demektir"); beklenen çıktılar artık STATUS satır kimliğiyle.

---

## 5. `COMPETITIVE.md` — W13 istihbaratıyla değiştirildi

Belge baştan yazıldı: konumlandırma cümlesi (§A) · **doğrulanmış Apilex ve
De Jure profilleri** (tüzel kişi, ölçek, fiyat, kota, alt işleyenler, kendi
sözleşmelerindeki geri alma maddeleri) · **22 satırlık parite matrisi** (§B) ·
**yedi tuzak** (§C) · rakiplerin pazarlama ↔ sözleşme çelişkisi tablosu ·
belgenin kendi sınırları.

Her rakip hücresi etiketini (`[doğrulandı]` / `[pazarlama]` / `[çıkarım]` /
`[kullanıcı beyanı]`) ve erişim tarihini (02.09.2026) taşıyor. ColleX
hücreleri hiçbir sayıyı kopyalamıyor, STATUS satırına atıf yapıyor.

**İki düzeltme bilerek öne çıkarıldı:**

1. Önceki sürümün *"De Jure'de dosya/proje/klasör kavramı geçmiyor"* satırı
   **yanlıştır**: De Jure'de "Klasörlerim", bir UYAP workspace'i ve mobilde
   "Dava dosyalarım" var. **Ayrım varlık değil, KONUMDUR** — onlarınki
   bulutta ve en pahalı pakete kilitli, bizimki avukatın diskinde.
2. De Jure'nin doğruluk garantisi **dar kapsamlıdır** (kaynakçadaki kararların
   var olduğu iddiası). Bunu yazmadan yapılan eleştiri haksız olurdu.

---

## 6. `run_evals` — ölçülen bir gerileme, saklanmadı

Bu turun koşusu Faz A'nın ölçümünden farklı çıktı ve **olduğu gibi yazıldı**:

| Cevap düzeyi (RAPOR AMAÇLI) | `W14-L-ANSWER` §5.3 | **bu tur** |
|---|---|---|
| Durum sayıları | ABSTAIN 13 · COMPLETE 12 · PARTIAL 3 · QUALIFIED 6 | ABSTAIN **14** · COMPLETE **11** · PARTIAL 3 · QUALIFIED 6 |
| Kesinleştirilebilir oran | %85,7 (18/21) | **%81,0 (17/21)** |
| Cevap düzeyi yanlış çekimserlik | 0 | **1** (`fx-amend-002`) |
| Beklenen birim kanıtta | %95,2 | %95,2 |

**Altı sert kapının altısı da PASS** ve kapsam kapısının kendi tripwire'ı
(cevap KATMANI yanlış çekimserlik) **0**. Gerileme rapor amaçlı katmanda.

`fx-amend-002` B-07'nin çıplak kanun kuralından beri kırılgan: L-ANSWER onu
"COMPLETE ama beklenen gold birimini kaybetti" diye kaydetmişti, bu turda
ABSTAIN. **Hiçbir eşik oynatılarak "düzeltilmedi"**; ölçüm STATUS S6'ya ve
"Açık ve dürüst" 3'e yazıldı, sebebi bir sonraki turun (L-VERIFY) işidir.

---

## 7. `vitest` — düşen tek test bu hattın değil

```
Test Files  1 failed | 101 passed (102)
     Tests  1 failed | 2027 passed | 6 skipped (2034)

FAIL tests/pipeline/console.test.ts
  > W14 B-21 · document × question grid > ships the grid view, hash-routed and argument-less
  expect(html).toContain('var ARGLESS_HIDDEN = { izgara: true };')
```

`console.html` bu sırada **eşzamanlı Faz B konsol hattı tarafından
düzenleniyor**; testin beklediği satır değişmiş. Dosya da test de
L-CONSOLE'un; L-DOCS ikisine de dokunmadı. Faz B1 kapanışında (17:19) aynı
komut **2028 geçti / 0 düştü** ölçmüştü.

**Bu yüzden bu turda `console.html`'in bayt/satır sayısı hiçbir belgeye
yazılmadı.** Ölçülebilirdi, ama ölçtüğüm an bayat olurdu.

---

## 8. `ADRS.md` — altı yeni ADR

| ADR | Karar | Kaydettiği asıl şey |
|---|---|---|
| **023** | Alıntı bütünlüğü kapısı | İki runtime'ın **tek kanonik karşılaştırma biçimi** ve "ikisi birlikte değişir" kuralı; neden 409 ve 500 değil; `evidenceOverlaps`'ın neden silinmediği |
| **024** | Dışa aktarım kipleri | Kiplerin **içeriği** yönettiği, doğrulamayı asla yönetmediği; ve KABUL'ün lafzından bilinçli sapmanın gerekçesi |
| **025** | `localGuard` | Ölçülen iki delik (DNS rebinding → okuma, CORS-safelisted CSRF → yazma) ve **bunun kimlik doğrulaması OLMADIĞI** |
| **026** | Çoklu sentinel ledger | Yarım uygulanmış migration körlüğü; ve `constraint:` kindinin neden bir migration sonra **aynı körlüğü tekrar kapatmak** için gerektiği |
| **027** | Yerel kütüphane | Neden TypeScript'te ingest ETMEDİĞİMİZ (aynı belgeye runtime'a göre farklı kimlik — ADR-013'ün önlemek için var olduğu kusur) ve **büyüyen bir kütüphane ima edilmediği** |
| **028** | Atıf denetimi | Üç kova ve boş künye kuralı; ve **çekilen sınır**: demo korpusuna karşı denetlenip **tutmayan** öncül yüzünden çözümleyicinin `NOT_FOUND` diyememesi |

Her ADR bağlam / adaylar / karar / gerekçe / kanıt / sonuçlar / geri alma
biçimini koruyor ve "geri alma" satırı gerçek: ADR-023'ünki *"bunu yapmayın"*
diyor.

---

## 9. `RUNBOOK`, `DEMO`, `KULLANIM-ColleX`, `docs/README`

- **RUNBOOK §7**: `/v1/health`'in yeni alanları; sınır tablosuna **on iki yeni
  satır** (cevap önbelleği tavanı — ENGRISK'in 250 cevapta ölçtüğü 181,6 MB
  ve sızıntı yokluğu dâhil, B-45/E22 —, `PDF_MAX_PAGES`, `BATCH_MAX_FILES`,
  AI tavanları, `LONG_QUESTION_CODE_POINTS`, `MAX_CONTACTS`, batch 50,
  `MCP_START_DEADLINE_MS`, `BACKUP_STALE_AFTER_DAYS`). Yeni **§7.1 yedekleme
  ve felaket tatbikatı**, yeni **§7.2 W14 uçları ve neden henüz çizilmedikleri**.
  **§17** baştan yazıldı: iki yanlış kuralın düzeltilmesi, 16/25 ayrımı,
  `adliTatileTabi` rozeti, yeni disclaimer metni ve **neden değiştiği**
  (hukuk Türkçesinde "uygulama" = yerleşik içtihat). **§15**: nazik durdurma
  ve başlatıcının küme dizini denetimi.
- **DEMO §9 (yeni)**: W14 uçlarını `curl` ile elle denemenin yolu, üstünde
  "**ekranları henüz yok**" uyarısıyla. Taslak dışa aktarımı bölümü
  `annex`/`marks`/`denetim-docx`/409'u anlatıyor. Sınırlar dokuz yüzeye
  genişletildi.
- **KULLANIM-ColleX §8 (yeni, 14 alt başlık)**: karar arama · atıf denetim
  raporu · sözleşme kontrol listesi · takvim/duruşma/`.ics` · kapsam
  manifestosu · yedekleme ve geri yükleme · klasör yükleme · harç hesabı ·
  nihai/denetim kopyası · **"alıntıyı değiştirdiniz" reddi ve ne yapılacağı** ·
  dosya paketi · kişi kartları · genel arama · "sessizce yok sayma bitti".
  **Her başlık ekranın hazır olup olmadığını yazıyor.** §6 süreler bölümü
  41/16/25, `belirsiz` rozeti ve iki düzeltilen yanlış kuralla yeniden
  yazıldı; §10 sınırlar dokuz yüzeye genişletildi.
- **docs/README**: W13 (12 rapor) ve W14 (8 rapor) blokları, "ne yapmak
  istiyorsun" tablosuna dört yeni satır, ADR aralığı 001..028, COMPETITIVE
  tanımı yeniden yazıldı. Bütün göreli bağlantılar denetlendi: **kırık 0**.

Yeni bölümler eklenirken `KULLANIM-ColleX.md`'de 8→9 ve 9→10 yeniden
numaralandırıldı; belgede bölüm numarasına yapılan iç atıf olmadığı
`grep` ile doğrulandı.

---

## 10. Tutarlılık denetimi — ne doğrulandı

1. **Her sayı bir ölçüme dayanıyor.** Belgelerde `S1`–`S24` dışında
   ölçülmüş sayı yok; kalan üç eşleşme (`1.0.0-w12`, `35 yol / 44 işlem`,
   W12-D'nin "30 rules") **açıkça tarihsel** ve satırında öyle işaretli.
2. **Her özellik cümlesi grep ile doğrulandı.** 25 makine kodu
   (`FOREIGN_HOST`, `QUOTE_ALTERED`, `ALL_SOURCES_FAILED`, `PACKAGE_EMPTY`,
   `TEMPORAL_COMPARISON_MISSING`, `LIBRARY_WRITE_FAILED` …), 7 şema kimliği
   (`collex.citation-audit/v1` …), 16 sabit ve CLI bayrağı
   (`PDF_MAX_PAGES`, `BATCH_MAX_FILES`, `--library-dir`, `--dir`,
   `denetim-docx`, `inceleme-docx`, `dosya-paketi-zip`, `collex.stop`,
   `constraint:` …) kaynak ağacında bulundu.
3. **Var olmayan bir ekran anlatılmadı.** Faz B konsol raporu bu fazda
   yayımlanmadı; `console.html` eşzamanlı düzenleniyor. Bu yüzden W14'ün
   bütün yeni yüzeyleri **uç olarak** anlatıldı ve arayüz **"hazır değil"**
   diye işaretlendi. Yalnız L-CONSOLE'un Faz A'da fiilen teslim ettiği beş
   kalem (B-10, B-21 ızgara, B-22 iş kartları, B-27 uyarı bütçesi, B-28
   erişilebilirlik) çizili olarak anlatıldı.
4. **Sayı tablosu tek.** `TRACEABILITY`, `RUNBOOK`, `DEMO`, `COMPETITIVE`,
   `KULLANIM` ve `CLAUDE.md` sayıyı kopyalamıyor, satır kimliğine atıf
   yapıyor.

---

## 11. Açık konular — dürüst liste

1. **`console.html` bu sırada değişiyor.** S2'nin tek kırığı budur ve bu
   hattın değildir. Konsol lehine bir ölçüm (bayt, satır, test sayısı) bu
   turda **hiçbir belgeye yazılmadı**.
2. **`demo.mjs` bu turda koşmadı** (§0). STATUS S7 kaynağını Faz B1 olarak
   söylüyor; L-VERIFY tek başına bir turda yeniden ölçmeli.
3. **`run_evals` gerileme** (§6) teşhis edilmedi — bu hattın işi kod değil.
   Sebebin Faz B1'in mi yoksa eşzamanlı bir Faz B hattının mı olduğu
   bilinmiyor.
4. **`openapi.yaml` yalnız yapısal olarak doğrulandı**: pyyaml ayrıştırması,
   `$ref` çözümü, yol/işlem sayımı, kod↔belge çapraz denetimi ve onu okuyan
   testin koşması. **Şema gövdelerinin gerçek cevaplarla alan alan
   karşılaştırılması yapılmadı** — bunun için her uca gerçek bir istek atıp
   cevabı şemaya doğrulamak gerekir ve o, sunucu gerektiren bir iştir.
5. **`FINAL_REPORT.md`, `RISKS.md`, `PLAN.md`, `DECISIONS.md`, `EXPORT.md`,
   `AI.md`, `architecture/overview.md` bu turda güncellenmedi.** Görev listesi
   bunları saymıyordu ve zaman içinde W14 için de uzlaştırılmalılar; en acili
   `RISKS.md` (25 doğrulanmamış süre kuralı ve 17 tutarsız harç kalemi
   oradaki risk kaydına girmedi) ve `EXPORT.md` (üç yeni dışa aktarım kipi).
6. **Faz A raporlarının kendileri düzeltilmedi.** `W14-L-LEGAL` §3.2'deki
   "15 kalem `amount: null`" hatası olduğu yerde duruyor; lane raporları
   bağlayıcı tarihsel kayıttır ve düzeltme STATUS S11'de yapıldı (§2.1).
7. **Hiçbir devlet upstream'ine bağlanılmadı, hiçbir canlı AI çağrısı
   yapılmadı.** Bu hat ağa hiç çıkmadı.
