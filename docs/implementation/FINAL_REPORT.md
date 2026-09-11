# Final Report — ColleX / Yargı-Mevzuat Master Build

Rapor tarihi: **2026-09-03**, **W14 Faz C kapanışı**. Biçim: brief §18.
Son durum: **PARTIAL** (§12 ve §13.6'da gerekçelendirildi).
Katman katman okunur: 27.08.2026 dalgası §1.5–§1.7/§2/§5/§11'de özetlidir,
**W12 farkı §0–§1.4**, **W13+W14, Faz F ve Faz C farkı §13**'tedir. §0–§12'nin
gövdesi W12 turunun kaydıdır ve tarihsel olarak korunmuştur; bir sayısı
sonradan değiştiyse §13 onu söyler.

> **Üç dürüstlük kaydı, raporun tamamı için geçerlidir.**
>
> 1. Bu depoda ölçülen bütün retrieval/citation/cevap sayıları **SENTETİK**
>    bir korpus üzerindedir (`evals/fixtures/corpus/`, sekiz dosya, bu proje
>    tarafından yazılmış test verisi). **Hiçbiri hukukî kalite ölçüsü olarak
>    sunulamaz.**
> 2. **Hiçbir şey canlı bir Supabase projesine uygulanmadı ve hiçbir aşamada
>    Supabase veya Resend MCP aracı kullanılmadı.** Bütün veritabanı işi yerel
>    PostgreSQL 18 (`127.0.0.1:55432`) üzerindedir.
> 3. **Bu raporda hiçbir ölçüm sayısı tekrarlanmaz.** Tek kaynak
>    `STATUS.md` → **"Ölçülen sayılar (03.09.2026, W14 Faz C kapanışı)"**
>    tablosudur (satırlar **S1–S40**). Aşağıda "S2", "S25" gibi kısaltmalar o
>    tabloya işaret eder. **Uyarı:** §0–§12 W12 turunda yazıldı ve o turun
>    satır kimliklerini kullanır (W12 tablosunda `S7` `db_local_check`,
>    `S9` `demo.mjs` demekti). Bir W12 satırındaki `S…` atfı "aynı satırda
>    adı geçen komut" diye okunmalıdır; §13'ün atıfları bugünün kimlikleridir.

---

## 0. Yönetici özeti — W12 ne yaptı

02.09.2026 denetimi, 27.08 ürününün avukat için üç kırık noktasını
`collex_demo` üzerinde **kanıtladı**: (1) cevaplar ve taslaklar yalnız
bellekteydi (33. sorudan sonra ve her yeniden başlatmada kayboluyordu),
dava dosyası / profil / süre kavramı yoktu; (2) "kira sözleşmesinde depozito
iadesi" sorusu, korpusta yalnız TCK olduğu hâlde **ŞERHLİ ve kesinleştirilebilir**
bir cevap alıyordu (sözcük benzerliği dayanak sayılıyordu); (3) taslak
üreticisi çok satırlı alanları yutuyor, her kanıtı dayanak yazıyor,
yüklenen belgeyi hukukî değerlendirme sanıyor, ISO tarih ve hash'i gövdeye
basıyor, düzenleme/sürüm/UDF sunmuyordu.

W12 bunu şu sırayla kapattı:

| Aşama | Ne oldu | Rapor |
|---|---|---|
| Denetim | Üç bulgu HTTP üzerinde reprodüklendi; altı hat tanımlandı | (denetim notları hat raporlarının §1'lerinde) |
| Hat A | Dava dosyası, kalıcı cevap/taslak/ayar, migration **ledger**, `--ensure-db` mevcut DB'ye eksik migration | `waves/W12-A.md` |
| Hat B | Soru-kapsam kapısı (ÇEKİMSER + `QUESTION_NOT_COVERED`), sabitlenmemiş atıf genişletmesi, belge kapsamlı cevap, tipli `CORPUS_UNAVAILABLE`, `useCloudAi` anahtarı, 34 gold satır | `waves/W12-B.md` |
| Hat C | Taslak v2: 13 şablon, çok satırlı listeler, sebepler süzgeci, çelişki işaretçisi, yüklemeler yalnız Ek-n, GG.AA.YYYY, `K-n`, `ek-dogrulama`, PUT/sürüm, **UDF deneysel** | `waves/W12-C.md` |
| Hat D | Süre hesabı: 30 kural, tatil takvimi, adli tatil, disclaimer — **tamamı `dogrulanmadi`** | `waves/W12-D.md` |
| Hat E | Bulut AI (Anthropic): belge analizi, OCR, paragraf yazıcı; varsayılan KAPALI, istek başına onay; **canlı sınanmadı** | `waves/W12-E.md`, `AI.md` |
| Hat F | Dayanıklılık: bağlantı zaman aşımı, sayfa başına tarama kapısı, toplu ekleme, dosya sayfalama/503/504, canlı araştırma kalıcılığı + ilerleme + zaman aşımı, `serve.mjs`/başlatıcı yaşam döngüsü | `waves/W12-F.md` |
| Entegrasyon | Tek uygulama: paylaşılan `answerStore`/`draftStore`, otomatik dosyalama, `/v1/health` bileşimi, `openapi.yaml` 18 → 35 yol, demo S6 | `waves/W12-INTEGRATION.md` |
| B2 / API-2 | Yüklemede yürürlük `NOT_APPLICABLE`, canlı `origin`, **cevap düzeyi eval** (rapor amaçlı); `?fileId=`, liste `pages`, koşu `warnings`, iki hata düzeltmesi (linker yarışı, postgres.js jsonb) | `waves/W12-B2.md`, `waves/W12-API2.md` |
| UI-1 / UI-2 | Konsol beş sekmeli avukat masası oldu; dosya sayfası, belge sayfası, süre modali, Taslak editörü, Bulut AI yüzeyleri, kompakt başlık, yazdırma | `waves/W12-UI1.md`, `waves/W12-UI2.md` |
| İnceleme + düzeltme | Üç inceleyici: 2 P0 + 20 P1 + 45 P2. **P0-1** (atıf içeren her soruda kapsam kapısının toptan atlanması) ve **P0-2** (dosya silinince taslak sürümlerinin FK hatasıyla sessizce kaybı) reprodüklenip düzeltildi; 17 P1 düzeltildi, P1-9 (ledger bootstrap) gerekçesiyle FIX-2'ye bırakıldı; 20 regresyon testi (S16) | `waves/W12-FIX.md` |
| İkinci düzeltme (FIX-2) | Ertelenen P1'ler ve güvenlik/dayanıklılık P2'leri, 12/12 (S19): taslak **alaka kapısı** (ADR-022), ledger **dosya başına probe** + tek transaction (ADR-020 değişikliği), cevap **süre/boyut bütçesi**, istek gövdesi sınırları (413), stderr yerine `correlationId`, MCP token yalnız ortamdan, başlatıcı DB hatasında durur / durdurucu yalnız ColleX süreçlerini kapatır, AI-kilitli bölümler + PATCH `refId`, yerel saat + "Belge - Dosya - vN" dosya adları, "Son araştırma" ön-seçimi + ön inceleme tekilleştirme, 390 px, "Bulut AI" adlandırması; 45 regresyon testi (S18); her sayı yeniden ölçüldü (S1–S9) | `waves/W12-FIX2.md` |
| Belgeler | DOCS-1 (mühendislik belgeleri, ADR-016..021) ve DOCS-2 (bu rapor, STATUS, TRACEABILITY, DEMO, Türkçe kullanım kılavuzu); **CLOSEOUT** FIX-2 sonrası uzlaştırma (STATUS tablosu, TRACEABILITY satırları, RUNBOOK/CLAUDE.md, ADR-022, `openapi.yaml` ek alanları) | `waves/W12-DOCS1.md`, `waves/W12-DOCS2.md`, `waves/W12-CLOSEOUT.md` |

Sonuç, sayılarla: S1–S9 (hepsi exit 0), S10–S22. Sonuç, sözle: avukat
`ColleX-Baslat.cmd`'ye çift tıklar, dosya açar, belge yükler, belgeye soru
sorar, süre hesaplar, taslak üretip düzenler, DOCX/UDF indirir; her şey
`collex_local`'da kalıcıdır; kural tabanlı çekirdek kaynaksız hiçbir tespit
yazmaz, kaynak yoksa ÇEKİMSER kalır. Doğrulanmamış üç yüzey (AI, UDF, süre
kuralları) her yerde öyle etiketlidir.

---

## 1. Gerçekte teslim edilenler

### 1.1 W12'nin iki P0 düzeltmesi (inceleme)

- **P0-1 — kapsam kapısı atıfla toptan atlanıyordu.** "TCK m.157 uyarınca
  kira sözleşmesinde depozito iadesi ne zaman yapılır?" → ŞERHLİ,
  kesinleştirilebilir, 8 kanıt (7'si sabitlenmemiş komşu hüküm ve karar), 7
  tespit ÇELİŞEN OTORİTELER. Düzeltme (`answer/coverage.ts`
  `admitUnderReferenceBypass` + `pipeline/answerPipeline.ts` yapısal kapanış):
  atıf yapılan hüküm hakkıyla alınır, öteki her pasaj soru sözcükleriyle tek
  tek sınanır; kabul edilen pasajdan kenarla ulaşılan pasaj kalır, kenara
  alınandan hiçbir şey kabul edilmez; kapsam kabul kümesi üzerinden yeniden
  ölçülür; UYGULAMA sorusunda taban altında kalırsa `partiallyCovered` →
  **PARTIAL / KESİNLEŞTİRİLEMEZ** (`QUESTION_PARTIALLY_COVERED`). Sonra: aynı
  soru → PARTIAL, yalnız m.157, 7 pasaj kenarda. Testler: `coverage.test.ts`
  (+4), `answerHonesty.test.ts` (+3).
- **P0-2 — dosya silinince taslak sürümü sessizce kayboluyordu.** `DELETE
  /v1/matters/{id}` → `PUT /v1/drafts/{id}` 200 `version 2` dönüyor, sunucu
  günlüğü `23503 drafts_matter_id_fkey`, `/versions` yalnız v1. Düzeltme:
  `DraftStore.detachMatter` (dosya silinince taslaklar dosyasız kalır),
  `PgDraftStore`/`PgAnswerStore` 23503'te `matterId`'yi boşaltıp sürümü yazar,
  `persisted(id)` + her yazma rotasında `persisted:boolean` ve tek Türkçe
  uyarı (`persistNotice.ts`); konsol "Taslak veritabanına YAZILAMADI" der,
  "kaydedildi" demez; "Kayıtlı taslaklar" listesi öksüz taslağa yol verir.
  Testler: gerçek-PG `persistence.test.ts` (+2), matters/drafting routes.

### 1.2 Yeni katmanlar (W12)

| Katman | Dizin | Ne yapar |
|---|---|---|
| Dava dosyası + kalıcılık | `control-plane/src/{matters,settings,store}/`, `supabase/migrations/20260902120000_*`, `ingestion/migrations.py` | 5 `app_private` tablosu, RLS, ledger (`schema_migrations`; FIX-2 sonrası her koşulabilir migration'da `[LEDGER SENTINEL] <kind>:<name>` probe'u, bootstrap yalnız probe'u çözülen dosyayı kaydeder, tek transaction), write-through Pg depoları, bellek içi yedek, otomatik dosyalama |
| Cevap dürüstlüğü | `control-plane/src/answer/coverage.ts`, `retrieval/corpusErrors.ts`, `pipeline/answerPipeline.ts` | Sözcüksel kapsam kapısı (taban 0.4), pasaj pasaj kabul, `citation` şeridi, belge kapsamı, yürürlük `NOT_APPLICABLE`, tipli korpus hatası |
| Taslak v2 | `control-plane/src/drafting/`, `export/{draft,petition,udf}.py` | 13 şablon, kanıt disiplini (beyan / bağlı / KAYNAKSIZ), sebepler süzgeci, `K-n`, `ek-dogrulama`, `reviseDraft` + sürümler + 409, uploads = Ek-n, DOCX + UDF deneysel |
| Süre hesabı | `control-plane/src/deadlines/` | Saf TS, I/O yok; 30 kural, takvim, adli tatil, m.92/2 kırpma, disclaimer |
| Bulut AI | `control-plane/src/ai/`, `llm/anthropicAdapter.ts` | Onaylı, anahtar gizli, alıntı doğrulaması, OCR ön-koruma, entailment 0.85 fail-closed |
| Dosyalar / araştırma | `control-plane/src/{files,research}/` | Sayfalama, 503/504, `?q=`, `pages`; async koşu 202 + ilerleme + 54 Türkçe etiket + zaman aşımı + kalıcılık + `warnings` |
| Avukat masası | `control-plane/public/console.html` | Beş sekme + dosya/belge sayfaları + editör; tek style/script, LF, textContent |
| Başlatıcı | `ColleX-Baslat.cmd`, `ColleX-Durdur.cmd`, `control-plane/scripts/{serve,serve-mcp,demo}.mjs` | PG → ensure-db → sunucu → health → tarayıcı; pid dosyaları; MCP çocuğu arka planda; demo S6 + yükleme koruması |

### 1.3 Ölçümle bulunan ve düzeltilen W12 defektleri (P0'lar dışında)

- Yüklenen belgeye dayalı cevap **her zaman PARTIAL** (`OUT_OF_DATE_SOURCE`,
  yürürlük bilgisi olmayan belge "güncel değil" sayılıyordu) → `NOT_APPLICABLE`
  + `UPLOAD_ONLY_EVIDENCE`; karışık cevapta korpus kısmı sıkı kural
  (`W12-B2` §1).
- Kapsam farkında top-8 sınırı: soru sözcüklerini taşıyan pasaj kapasite
  yüzünden düşüyordu → `coverageAwareCap` (`W12-B` §1; `fx-amend-003` yanlış
  çekimserdi).
- `MatterLinker.settle` hızlı başarısızlığı kaybediyordu (yarış) → son 128
  sonuç hatırlanır (`W12-API2` §3.1).
- postgres.js `::jsonb` ile ön-dizeleştirilmiş değeri iki kez kodluyordu →
  `sql.json(...)` (`W12-API2` §3.2).
- 3,4 MB TXT tek chunk oluyordu → `MAX_GENERIC_CHUNK_CHARS = 4000`
  (`W12-FIX` P1-5); 30k paragraf referans analizi 111 s → 3,6 s (`W12-F`).
- "Dosyaya ekle" aynı belgeyi çoğaltıyordu → `(kind, refId)` tekilliği
  (`W12-FIX` P1-6).
- Konsolda "Doğrulanmış pasajlar" başlığı, "hiçbir şey makineden çıkmaz"
  vaadi, 2025-06-01'e sabit as-of, İngilizce "Failed to fetch", hukukî yanlış
  şablon cümleleri (HMK m.116 ilk itiraz listesi, TBK m.603 kefalet, mülga
  "500 TL" tebliğ) → `W12-FIX` P1-3/P1-4/P1-8/P1-13..P1-19.
- **FIX-2 (`W12-FIX2` §1):** S1 araştırmasından üretilen kira cevap
  dilekçesi TCK m.155/156/158/159/168'i dayanak yazıyordu → alaka kapısı
  (`drafting/relevance.ts`, ADR-022; `sebepler []`, 4 × `DOMAIN_MISMATCH`);
  ledger bootstrap zaman damgasıyla ve iki adımda yazıyordu → dosya başına
  probe + tek transaction (ADR-020 değişikliği; psql ile eksik kurulmuş DB
  9 bootstrap + 2 uygulama); 3 MB TXT'de `/v1/answer` sınırsızdı → 60 s
  bütçe (PARTIAL + `TIME_BUDGET_EXCEEDED`), 4 000 kod noktası alıntı
  penceresi (`quoteTruncated`), 5 MiB üstü kayıtta metin yok
  (`STORED_WITHOUT_TEXTS`); gövde sınırı yoktu → 1 MiB JSON / 40 MiB
  multipart / 64 KiB matter kaydı (413); `INTAKE_FAILED`/`EXPORT_FAILED`
  stderr'i (DSN, traceback) gövdeye basıyordu → `correlationId`; MCP token
  `--token` ile süreç listesinde görünüyordu → yalnız ortam; başlatıcı DB
  hatasını yutuyor, durdurucu porttaki her süreci öldürüyordu → durur /
  yalnız ColleX süreçleri; AI paragrafı `ek-dogrulama`/`karsi-ictihat`'a
  yazılabiliyordu → 400; PATCH ile kayıt başka cevaba bağlanabiliyordu →
  `refId` değişmez; UTC/UUID dosya adları → yerel saat, "Belge - Dosya -
  vN.ext"; ön inceleme aynı atfı yineliyordu → tekilleştirme + `count` +
  taraf etiketi; 390 px'te başlık ~440 px → 198 px; "Bulut AI" adlandırması
  tekilleşti.

### 1.4 Doğrulanmamış üç yüzey (sınır, defekt değil) — W12 hâli

Bulut AI (`liveTested:false`), UDF (`deneysel`), 30 süre kuralı
(`dogrulanmadi`). Her biri kodda, `/v1/health`/`/v1/ai/status` cevabında,
konsolda ve dışa aktarımda etiketlidir.

> **Bugün üç değil sekizdir** ve listesi `STATUS.md` "`DEPLOYMENT_READY`
> önündeki sekiz doğrulanmamış yüzey" tablosundadır: W14 yeni yüzeyler
> (harç, canlı karar arama, `.ics`, yerel kütüphane, atıf denetimi) getirdi
> ve her birini kendi etiketiyle getirdi. Süre kuralları da 30 değil **41**;
> 16'sı madde metniyle doğrulandı, **25'i doğrulanmadı** (S10).

### 1.5 27.08.2026 dalgasından devralınanlar (özet)

İki P0 (cross-tenant RLS sızıntısı — ADR-011; `'infinity'` ile ölü temporal
sürümleme — ADR-012), ölçümle bulunan lexical şerit defekti (ADR-007) ve
simetrik karşıt otorite (ADR-008), tek sıçramalı atıf genişletmesi (ADR-009),
deterministik tie-break (ADR-010), chunk çakışmazlığı (ADR-013), tek
evidence-bundle sözleşmesi ve doğrulanamayan atıfta dışa aktarım reddi
(ADR-014), citator şeridi (ADR-015); ingestion/store/retrieval/answer/export/
eval katmanları; 54 araçlık MCP yüzeyi gerçek transport üzerinde; CI beş
job. Ayrıntı: `waves/` öncesi tarihçe `TRACEABILITY.md` #1–#30 ve
`evals/reports/BASELINE.md`.

---

## 2. Mimari ve ADR farkı

Tam kayıt: `docs/architecture/ADRS.md` (001–022), resim
`docs/architecture/overview.md` (§7 W12 zinciri). W12'nin yedi ADR'si (022
FIX-2 ile; 016/020/021 FIX-2 sonrası değişiklik notu taşır):

| ADR | Karar | Sonuç |
|---|---|---|
| **016** | Dayanıklı dava dosyası çalışma alanı: write-through Pg depoları + otomatik dosyalama + bellek içi yedek | Cevap/taslak/ayar yeniden başlatmada kalır; `db down` iken ürün yine kalkar ve bunu söyler |
| **017** | Soru-kapsam çekimserlik kapısı: sözcüksel, taban 0.4, atıfla bypass, çapa kuralı; **P0-1** ile pasaj pasaj kabul | Sözcük benzerliği dayanak değildir; kapı gerçek hukukta ölçülmemiştir (bilinen sınır) |
| **018** | Bulut AI istek başına onay, varsayılan kapalı, anahtar asla `.env`'de, çıktılar kanıta bağlı | Modelin sözü kendi otoritesiyle "kaynaklı" olmaz; canlı sınanmadı |
| **019** | UDF deneysel: UTF-16 ofset (ADR-003'e dosya-yerel istisna), imzasız, UYAP'ta açılmadı | Avukat "deneysel" etiketiyle indirir, UYAP editöründe doğrular |
| **020** | Migration ledger: `schema_migrations`; **FIX-2 değişikliği**: her koşulabilir migration'da `[LEDGER SENTINEL] <kind>:<name>` probe'u (regclass · regprocedure · extension · column · trigger; çıplak ad = regclass), bootstrap yalnız probe'u çözülen dosyayı kaydeder (zaman damgası kuralı yok), ledger + bootstrap tek transaction, TS aynı CASE ile `/v1/health`'i türetir | Mevcut `collex_local` yeni migration alır; psql ile eksik yüklenmiş DB eksik dosyaları alır, tam yüklenmiş DB tekrar oynatılmaz |
| **021** | Yüklenen belge parçaları **delildir**, hukukî değerlendirme değil (`Ek-n`, `suggestedFacts`) | Avukatın kendi dilekçesi asla "dayanak" olarak yazılmaz |
| **022** | **Taslak alaka kapısı** (FIX-2): şablon `domain` × kanıt alanı (mahkeme → kanun no → başlık → kaynak ailesi) + matter metniyle sözcüksel örtüşme; açıkça atıf yapılan kanıt asla düşmez; `unusedEvidence` + `unusedReason`; `evidenceUse:true` geri alır | Kira cevap dilekçesi ceza maddesi yazmaz; kapı sözcüksel + üst veri tabanlı, gerçek hukukta ölçülmedi, yaygın kanun numaralarını tanır |

Değişmeyen omurga: Python/FastMCP sağlayıcı katmanı (54 araç), TS
control-plane, NFC kod noktası ofsetleri (ADR-003), sahibi belgeden çözülen
RLS (ADR-011), DB'de close-on-append (ADR-012).

---

## 3. Değişen dosyalar / migrations (W12)

- **Migration:** `supabase/migrations/20260902120000_matters_persistence.sql`
  (13. dosya; 5 tablo, RLS, indeksler, `-- [LEDGER SENTINEL] app_private.settings`).
  Yerelde koşan migration sayısı S14.
- **Python:** `ingestion/migrations.py` (ledger), `ingestion/{pipeline,indexer,chunking}.py`,
  `intake/{cli,ingest,extract,analysis,errors,quarantine}.py`,
  `export/{draft,udf,petition,cli,text}.py`, `mcp_server_main.py` +
  `mevzuat_client.py` (`COLLEX_NO_DOTENV`), `scripts/{db_local_check,run_evals}.py`,
  `evals/{retrieval/gates.py,answer/measure_answers.ts,datasets/fixture_corpus_gold.jsonl}`.
- **TypeScript:** yeni `src/{matters,settings,deadlines,ai}/`,
  `src/store/{answerStore,draftStore,health,persistNotice}.ts`,
  `src/answer/coverage.ts`, `src/retrieval/corpusErrors.ts`,
  `src/api/{matterLink,healthReport}.ts`, `src/research/progress.ts`,
  `src/drafting/{input,revise,store,evidence,appendix}.ts`; düzenlenen
  `src/api/{server,answerService,openapi.yaml}`, `src/pipeline/*`,
  `src/answer/*`, `src/retrieval/*`, `src/store/chunkStore.ts`,
  `src/files/*`, `src/research/*`, `src/drafting/*`, `src/llm/{anthropicAdapter,ruleDrafter}.ts`.
- **Konsol:** `control-plane/public/console.html` (289 KB → 377 KB, 8 223
  satır; sözleşme korundu — S15).
- **Betikler/başlatıcı:** `control-plane/scripts/{serve,serve-mcp,demo,ai-live-smoke}.mjs`,
  `ColleX-Baslat.cmd`, `ColleX-Durdur.cmd`.
- **Testler:** vitest (S2), pytest (S3); yeni `tests/{answer/coverage,answer/answerHonesty,store/corpusErrors,matters,settings,deadlines,ai,files/uploadCap,store/persistence}` vb.; `tests/ingestion/test_migrations_ledger.py`, `tests/intake/test_ensure_db.py`, `tests/export/test_udf_export.py`; FIX-2 ile `tests/drafting/relevance.test.ts`, `tests/integration/launcher.test.ts`, `tests/answer/evidencePack.test.ts` ve `W12-FIX2.md` §2'deki yeniden sabitlemeler (S18).
- **FIX-2 dosyaları:** `ingestion/migrations.py` + 10 migration başlığı, `control-plane/src/store/health.ts`, `drafting/{relevance.ts (yeni), composer, templates, types, routes, markdown, input}.ts`, `answer/{evidencePack,renderer}.ts`, `pipeline/{answerPipeline,types}.ts`, `api/{server,answerService}.ts`, `files/routes.ts`, `matters/routes.ts`, `ai/routes.ts`, `scripts/{serve,serve-mcp}.mjs`, `public/console.html`, `intake/analysis.py`, `export/{text,draft,petition,udf}.py`, `ColleX-Baslat.cmd`, `ColleX-Durdur.cmd`; CLOSEOUT yalnız `src/api/openapi.yaml`'a (ek alanlar) ve belgelere dokundu.
- Hiçbir şey commit edilmedi (kullanıcı kararı); hiçbir kullanıcı değişikliği
  geri alınmadı; `package.json` ve MCP yüzeyi değişmedi.

---

## 4. Çalıştırılan doğrulama komutları, exit code ve sonuç

**Tek kaynak:** `STATUS.md` → "Ölçülen sayılar (02.09.2026, W12 sonrası)",
satırlar S1–S9 (komut, beklenen çıktı, exit, kaynak rapor). Bu rapor tabloyu
kopyalamaz. Ek kanıtlar (Playwright yürüyüşleri, HTTP probe transkriptleri,
`--with-mcp` ölçümü) `STATUS.md` "Last successful verification" bölümünde
işaret edilir.

---

## 5. Eval metrikleri ve baseline

Kaynak dosya: `evals/reports/fixture_baseline_2026-09-02.{json,md}`
(`scripts/run_evals.py --run-date 2026-09-02`, exit 0). Özet: S8.

- **Altı sert kapı** PASS ve kodla zorlanıyor (`evals/tests/test_gates.py`
  her kapıyı FAIL'e çevirir; `content_sha256` bozulduğunda exit 1).
- **Kapsam kapısı** (W12-B, rapor satırı): cevap katmanı çekimserlik
  precision/recall 100 %/100 % (13 `no_answer` satırı), yanlış çekimser 0;
  retrieval düzeyi recall 92,3 % (`fx-nearmiss-003` yapısı gereği 3 lexical
  hit).
- **Cevap düzeyi (W12-B2, RAPOR AMAÇLI, eşik yok):** gerçek `AnswerPipeline`
  34 gold sorguda; durum sayıları, yanlış çekimser/cevap 0/0,
  kesinleştirilebilir oranı, beklenen birim atıfı — S8. Bulgu: 9 PARTIAL
  satırının tamamı **mekanik** (birleştirilmiş madde tespiti × tek pasaj
  entailment) — düzeltilmedi, görünür kılındı.
- Retrieval metrikleri 27.08 → 02.09 **değişmedi** (Recall@10 1.0000 /
  nDCG@10 0.9156 / MRR 0.9024); şerit dağılımı artık `citation` şeridini
  dürüstçe ayırır (12 genişletme).

**Bu sayılar ne DEĞİLDİR:** Türk hukuku kalite ölçüsü değil; hibrit
(dense) retrieval sonucu değil (`NoopDenseLane`); LLM cevap kalitesi değil
(kural tabanlı taslakçı + sözcüksel hakem); hukukçu doğrulamalı gold set
hâlâ yok.

---

## 6. Source / legal / privacy / security bulguları

- **Açık P0:** SEC-2026-08-26-001 (gömülü Brave/Tavily anahtarları, upstream
  public) — rotasyon kullanıcı eylemi, **hâlâ AÇIK**.
- **Bulut AI ve KVKK:** varsayılan kapalı; onaylı istekte Anthropic'e giden
  veri uç uç `AI.md` §3'te; konsol altbilgisi, yükleme alanı ve Ayarlar
  "makineden çıkan iki istisna"yı (canlı araştırma → resmî kaynak sunucuları;
  Bulut AI → Anthropic) açıkça yazar (`W12-FIX` P1-16). Anahtar hiçbir
  günlükte/JSON'da görünmez (test-pinli).
- **Kaynak hakkı:** `source-register.yaml` 17 kaynak `blocked`; üretim
  backfill kapalı.
- **Tenant:** yeni beş tabloda RLS + politika (c14 probe rolüyle); yerelde
  owner bağlantısı bypass eder (belgeli tek kullanıcı duruşu).
- **Konsol:** CSP hash'li tek style/script, textContent; yalnız 127.0.0.1,
  kimlik doğrulaması yok. İnceleme P2-13..15 (gövde sınırı, stderr yankısı,
  komut satırında token) FIX-2'de kapatıldı: her rotadan önce
  `hono/body-limit` (1 MiB JSON / 40 MiB multipart → 413), çocuk süreç
  stderr'i yalnız sunucu günlüğünde (`correlationId`), MCP token yalnız
  çocuğun ortamında (`serve-mcp.mjs --token` fırlatır; gerçek süreç listesi
  testle denetlenir). P2-16: durdurucu yalnız komut satırı ColleX'e ait
  süreçleri kapatır; P2-17: AI paragrafı `ek-dogrulama`/`karsi-ictihat`'a
  yazılamaz; P2-19: dosyalanmış kaydın `refId`'si değişmez.
- **KVKK/uyum şablonları** `docs/legal/` — hepsi "HUKUKÇU İNCELEMESİ GEREKLİ".

---

## 7. Cost / latency / capacity / SLO

Production maliyet/kapasite ölçümü **yapılmadı**. Yerel mekanizma ölçümleri
(sentetik korpus, PG 18): `searchLegalCorpus` p50/p95 ~7/~20 ms;
`buildEvidencePack` ~0,5/~1,3 ms; cevap düzeyi sürücü 34 cevap 1,15 s
(`W12-B2`); intake 30k paragraf ~16 s (`W12-F`); `/v1/health` db açıkken
< 100 ms, kapalıyken en kötü ~3 s; `--with-mcp` MCP çocuğu `ok` ~4,7 s
(`W12-INTEGRATION` §6). Bulut AI maliyeti: hiç çağrı yapılmadığı için **sıfır
ölçüm**; `usage` alanları hazır. Tek worker zorunlu (süreç içi limiter).

---

## 8. Kalan TODO / bilinen sınırlar (dürüst liste)

1. Bulut AI canlı sınanmadı; UDF UYAP'ta açılmadı; **41 süre kuralının 25'i**
   doğrulanmadı; 20 harç kaleminin 17'sinde tutar yok; canlı karar aramanın
   **isabeti ölçülmedi** (uç artık çalışıyor ve gerçek künye getiriyor —
   S34 — ama sıralamayı kaynak sunucu yapar); `.ics` gerçek takvim
   istemcisinde
   açılmadı; yerel kütüphane ingest edilmiyor; atıf denetimi `NOT_FOUND`
   diyemiyor (§13.5 ve STATUS'un sekiz yüzey tablosu).
2. Kapsam kapısı ve pasaj kabulü sözcüksel; taban 0.4, entailment 0.85 ve
   lexical 0.25 sentetik korpusta ölçüldü (RISKS #18).
3. Birleştirilmiş madde tespiti entailment'ta düşüyor (9/21) — mekanik
   (`W12-B2` §3.3).
4. Cevap süre bütçesi (60 s) **aşamalar arasında** denetlenir; tek bir yavaş
   port çağrısı yarıda kesilmez (`W12-FIX2` §4).
5. Taslak alaka kapısının kanun-numarası tabloları yaygın kodları kapsar;
   bilinmeyen numara "genel" sayılır (yalnız sözcüksel kural uygulanır); kapı
   gerçek hukukta ölçülmedi (ADR-022).
6. "Korpusta doğrula" koşuları Araştırmalar'da görünür (P2-10, ürün
   sahibinin kararı; `W12-FIX` §1). Diğer FIX-2 kalemleri kapandı
   (`W12-FIX2` §1, STATUS S19).
7. (kapandı — FIX-2) ledger bootstrap, cevap bütçesi, gövde sınırı, "Bulut
   AI" adlandırması, yerel saat dosya adları, 390 px, ön inceleme, AI bölüm
   kilidi, PATCH `refId`.
8. Dense şerit atıl; pgvector migration'ları hiç koşmadı.
9. `collex_local`'da sentetik korpus yoktur; yerel korpus cevapları demo
   DB'sinde görülür.
10. pid dosyaları sert kill'de kalır (başlatıcı `/v1/health`'e bakar, pid'e
    değil).
11. CI bu makineden hiç yeşil görülmedi (PG 18 yerel vs `postgres:16`
    servis).
12. `uv sync` non-ASCII yol yüzünden düşer (belgeli fallback).

---

## 9. Dış blocker'lar ve gereken en küçük kullanıcı eylemi

`STATUS.md` "Blockers" tablosu (rotasyon, pgvector hedefi, Supabase projesi,
AI canlı sınama, süre kuralı doğrulaması, UDF UYAP doğrulaması, hukukçu gold
set, canlı regression, production deploy, worktree commit kararı).

---

## 10. Local çalıştırma ve staging

Avukat yolu: `ColleX-Baslat.cmd` / `ColleX-Durdur.cmd` (RUNBOOK §15);
kullanım kılavuzu **`docs/KULLANIM-ColleX.md`** (Türkçe, mühendislik
sözcüksüz). Operatör yolu: `RUNBOOK.md` (setup, sunucu bayrakları, süitler,
DB sahipliği, demo, export CLI, canlı loopback, bulut AI §16, süre kuralı
§17). Demo anlatımı: `DEMO.md`. Staging: **yok** (`SUPABASE-SETUP.md`
uygulanmadı).

---

## 11. Rollback ve restore

- **Kod:** `../_baseline-backup/2026-08-26/` (dirty patch + untracked
  kopyalar) önceki duruma dönüşü mümkün kılar; patch eski secret değerlerini
  içerir — rotasyondan sonra imha/güvenli saklama.
- **Veritabanı:** her betik yalnız kendi `collex_*` adını düşürür (sahiplik
  tablosu `CLAUDE.md`); `collex_local` hiçbir betik tarafından düşürülmez.
  W12 migration'ı idempotent; ledger `--ensure-db` ile mevcut DB'ye eksikleri
  uygular. Geri alma: `app_private.{matters,matter_items,answers,drafts,settings,schema_migrations}`
  tabloları atılır (elle; betik yok).
- **Taslak sürümleri:** her `PUT` yeni satır; eski sürüm metni API'den
  okunmaz (künye listelenir) — geri alma editörden değil, DB'den.

---

## 12. Son durum (W12 turunun kaydı)

**PARTIAL.**

- `COMPLETE` değil: production credential/yetki yok; açık P0 secret olayı.
- `DEPLOYMENT_READY` değil: staging yok, pgvector migration'ları koşmadı,
  eval yalnız sentetik korpusta, hukukçu gold set yok; ayrıca **W12'nin üç
  yüzeyi doğrulanmadı** (AI canlı, UDF UYAP, süre kuralları) ve kapsam kapısı
  gerçek hukukta ölçülmedi.
- `BLOCKED` değil: 2 P0 + 18 P1 + FIX-2'nin 12 kalemi düzeltildi; FIX-2 ve
  CLOSEOUT tamamlandı, kalan işler kullanıcı eylemi (STATUS "Next actions")
  ya da belgeli sınırdır.

"Ürün hazır" ifadesi bu rapor tarafından **desteklenmiyor** ve
kullanılmıyor. Rekabet karşılaştırması `docs/COMPETITIVE.md`'dedir.

**Bu bölüm 02.09.2026 W12 turuna aittir. Bugünkü hüküm §13.6'dadır.**

---

## 13. W13 + W14 ve Faz F — bu raporun üstüne inen dalga

### 13.1 Ne oldu, sırayla

`W13` bir **istihbarat ve tasarım** dalgasıydı (rakip profilleri, 22 satırlık
parite matrisi, yedi tuzak, günlük akış denetimi, UX denetimi ve 46 kalemlik
`W13-BACKLOG`). `W14` onu inşa etti: **yedi paralel Faz A hattı**, bir **Faz
B1 entegrasyon** hattı, **Faz B2**'de konsol ve belge turları, ardından
**bağımsız bir doğrulama hattı** (`W14-L-VERIFY.md`), **dört Faz F hattı**
(`W14-F-PERF`, `W14-F-API`, `W14-F-UI`, `W14-F-DOCS`), **bağımsız bir kapanış
denetimi** (`W14-F-VERIFY.md`) ve **iki Faz C cila hattı**
(`W14-C-SRV`, `W14-C-UI`) ile son ölçüm (`W14-C-FINAL`).

Doğrulama hattının varlığı bu raporun en önemli yapısal kaydıdır: ürünü
**gerçek bir sunucuda ve gerçek bir tarayıcıda**, hiçbir ürün dosyasına
dokunmadan ölçtü ve **22 kusur** bıraktı (V-1..V-22).

**İkinci yapısal kayıt, ve bu raporun kendi kendini düzelttiği yer:** Faz F
hatları "19'unu kapattık" dedi; **bağımsız kapanış denetimi bu sayımı
onaylamadı.** Her kalemi kendi yöntemiyle yeniden üretmeye çalıştı ve
**16 kapandı · 3 iyileşti (V-1, V-10, V-22) · 3 açık (V-14, V-19, V-21)**
buldu; üç "kapandı" iddiasını sayıyla reddetti ve **altı yeni kusur**
(N-1..N-6) ekledi. Faz C sonra açık üçünü, iyileşen ikisini ve yeni
altının dördünü kapattı. **Bugünkü sayım: V-1..V-22 = 21 kapandı, 1
iyileşti (V-1); N-1..N-6 = 4 kapandı, 1 kısmî (N-4), 1 belgelendi (N-1);
N-7 açık.** Bir hattin kendi notunu vermesi ile bağımsız bir hattin not
vermesi arasındaki fark, bu dalgada **üç kalem** etti.

### 13.2 Ürünün en sert sözleri — gerçekten çalıştığı ölçülenler

| İddia | Nasıl ölçüldü |
|---|---|
| Alıntıyı bozarsanız bağ kopar | Tarayıcıda gerçek bir alıntı tahrif edildi; `PUT` `QUOTE_ALTERED` döndü, paragraf KAYNAKSIZ'a düştü |
| Nihai dilekçe **dosyalanabilir** | Üretilen DOCX python-docx ile açıldı: A4, biçimli, içinde tek bir makine dizesi yok |
| Uyarı gürültüye dönmüyor | Gerçek cevap ekranlarında 3 blok / 5–7 cümle / 0 tekrar / 0 makine kodu (S29) |
| Künye uydurulmuyor | Çözülemeyen 5 atıfın 5'inde künye hücresi **boş**; `?`, `—`, "bilinmiyor" yok |
| Veriniz geri gelir | Veritabanı gerçekten yok edildi ve geri yüklendi: asıllar **bayt bayt**, 9 tablo **satır satır** aynı (S28) |

### 13.3 Faz F'in kapattıkları

**F-PERF (V-1, V-2).** 20 000 parçalık bir korpusta yaygın bir sözcükle
sorulan soru **cevap dönmüyordu** (47–59 sn, `ABSTAIN`, üç bozuk şerit).
Çözüm şeridi ucuzlatmak değil, **ne zaman koşacağını sormak** oldu: trigram
şeridi artık gerçek bir fallback (eşik 8 ayrık pasaj) ve kendi 2 500 ms
bütçesi altında. Sonuç **49 368 → 15 756 ms** ve **COMPLETE / 8 kanıt / 0
bozuk şerit** (S25). Ayrıca `answers_filescope_gin` ilk kez ürünün kendi
sorgusuyla kullanılıyor (S27″). **Dürüst yarı — ve bağımsız denetimin
düzelttiği yer:** F-PERF kendi probe'unda 15–17 sn ölçtü ve V-1'i "kapandı"
saydı; denetim aynı kalemi **İYİLEŞTİ, KAPANMADI** olarak dereceledi ve
kendi probe'unda gerçekçi korpus şeklinde **3,8 sn** ölçtü — ama aynı
turda **korpusta hiç geçmeyen bir ifadenin 7,5 sn sürüp boş döndüğünü**
buldu (S25‴). Yani bu bir **iyileşmedir, bitiş değildir** ve en kötü hâli
yer değiştirmiştir.

**F-API (V-3, V-4, V-6).** Üçü de **dikiş** kusuruydu: `--with-mcp` açık bir
sunucu "Karar ara"ya geçidi vermiyor ve avukata zaten yaptığı şeyi tavsiye
ediyordu; `COLLEX_DATA_DIR` kurulu bir makinede "Aslını indir" **her belgede
404** veriyordu; `GET /v1/answers` `q` ve `status` süzgeçlerini sessizce
düşürüyordu. Üçü de gerçek bir sunucuda önce yeniden üretildi, sonra ölçüldü
(S31).

**F-UI (on beş kalem).** Aktif dosya yokken **hesaplanan süre kayboluyordu**
ve ekranda yalnız `HTTP 404` yazıyordu — artık istek hiç gitmiyor, hesap
ekranda kalıyor ve hiçbir toast çıplak bir HTTP kodu yazmıyor. Bunun yanında
modallar kendi geçmiş girdilerini alıyor, başlıkları yapışıyor, elenmiş kanıt
uyarısız sunulmuyor, veritabanı adı avukatın önünden kalktı ve 390 px'te
dosya tablosu kart listesine döndü (S32).

### 13.3b Faz C'nin kapattıkları

**C-SRV.** Denetimin açık bıraktığı üç kalem kapandı: yedek arşivinin adı
artık **yedeklediği veritabanının adıdır** ve ad türetilir, güvenilmez
(hiçbir veritabanı adı yol ayracı ya da gizli dosya üretemez); geri yükleyici
adı `yedek.json`'dan okur (V-14). Her `.strict()` reddi artık **alanı adıyla**
söyler ve iki fazladan alan **iki satırdır** (V-19). Karşıt otorite taraması,
**hiçbir birincil pasaj soruyla tek bir içerik sözcüğü paylaşmıyorsa ve
hiçbir şey sabitlenmemişse** koşmuyor — kapsam kapısının zaten her pasajı
kenara alacağı durum; dayanağı **olan** her cevapta şeritler eskisi gibi
koşuyor ve iki koruma testi bunu ölçüyor (V-21). Ayrıca TASLAK DOCX'teki
çıplak kanıt kimliği parantezin içine taşındı (N-3) ve belge aslının yeri
dört yüzeyde aynı cümleyle anlatılıyor (N-2).

**C-UI.** "Karar ara" listesinin neden ilgisiz göründüğü **ölçülerek**
bulundu: tırnaksız bir sorgu kaynakta 116 090 karara açılıyor ve karar
tarihine göre sıralanıyor; aynı sorgu tırnak içinde 758 kayda düşüyor ve
daireler konuya oturuyor. Şimdi "Tam ifade" varsayılan açık, her satırda
eşleşen cümle ya da "sağlanmadı" yazıyor, sayfanın şekli sayıyla
söyleniyor ve **sınırın kendisi ekranda**: "Sıralamayı kaynak sunucu
belirler … Bu bir ilgililik sıralaması değildir" (N-4). Tespit kartları
katlanıyor (N-5), yeni açılan dosya aktif dosya oluyor (N-6), ve V-10 ile
V-22'nin kalıntıları kapandı.

### 13.4 Açık kalanlar: bir kusur, iki tavan, bir ölçüm aracı çekincesi

* **V-1** — iyileşti, kapanmadı (aşağıdaki birinci tavan).
* **N-1** — ürünün kendi trigram eşiğinde (0,35) ölçen bir plan gerileme
  testi yok; üç probe korpusu üç farklı tablo verdi.
* **N-4'ün sıralama yarısı** — gerçek ilgililik sıralaması sunucu işidir ve
  yapılmadı; konsol yalnız elindeki 20 satırı dizer ve bunu söyler.
* **Tavan 1:** ölçekte korpus sorusu; yaygın bir sözcük **3,8 sn** ve cevap
  dönüyor, ama **korpusta hiç geçmeyen bir ifade 7,5 sn sürüp boş dönüyor**
  ve arayüzde ilerleme satırı ya da iptal düğmesi yok (RISKS #25).
* **Tavan 2:** trigram şeridinin plan davranışı korpustan korpusa değişiyor;
  bu belge setindeki hiçbir hızlanma sayısı `/v1/answer` için
  alıntılanamaz (STATUS S26⁐).
* **N-7 (ölçüm aracı):** `run_evals.py`'nin **cevap katmanı** metrikleri
  koşudan koşuya oynuyor (dört koşu: kesinleştirilebilir %85,7 ↔ %81,0, bir
  koşuda bir yanlış çekimserlik), sert kapılar ise dördünde de PASS. Bu, bu
  rapordaki birçok "şu satır kaydı" cümlesini zayıflatır ve öyle
  işaretlenmiştir (RISKS #34).

### 13.5 Doğrulanmamış yüzeyler: üç değil sekiz

Bulut AI · UDF · **25 süre kuralı** · **17 harç kalemi** · canlı karar arama ·
`.ics` · yerel kütüphane · atıf denetiminin `NOT_FOUND` kovası. Sekizinin de
etiketi kendi yüzeyindedir ve `STATUS.md` her birinin **ne yapılmadığını**
tek tek yazar. Buna ek olarak on iki konsol sözleşmesinin ucu hazır, **ekranı
yok** — ve hiçbiri var gibi çizilmiyor (vaporware kapısı).

### 13.6 Bugünkü hüküm

**PARTIAL — değişmedi, ama gerekçesi daraldı.**

W12 turunda "doğrulanmamış üç yüzey" vardı; bugün sekiz var, çünkü W14 daha
çok yüzey inşa etti ve her birini kendi etiketiyle getirdi. Buna karşılık
W12'de **ölçülmemiş** olan iki şey artık ölçüldü: felaket tatbikatı gerçekten
koştu (S28) ve 2 000 belgelik ölçek kabulü hem süre hem plan tarafında
karşılandı (S27). `DEPLOYMENT_READY`'ye giden yol `STATUS.md`'de dokuz
maddede yazılıdır ve **çoğu kullanıcı eylemidir**, mühendislik değil.

Dürüst tek cümle: **ColleX bugün "bu cümlenin dayanağı ne, süre ne zaman
doluyor, bu dilekçe imzaya hazır mı" işlerinde disiplinli ve ölçülmüş bir
araçtır; "hangi karar var" işinde hâlâ geridedir** — ama artık başka bir
sebeple. Canlı karar arama **çalışıyor**: yedi gerçek arama gerçek künye
döndürdü ve üç tam metin çekildi (S34); L-VERIFY'ın "tek bir künye bile
döndüremiyor" cümlesi artık geçerli değildir. **Ölçülmeyen şey isabettir:**
sıralamayı kaynak sunucu yapıyor, ColleX elindeki 20 satırı dizebiliyor ve
bunu ekranda söylüyor. Yerel korpusta ise ölçek sorusu yaygın bir sözcükte
**3,8 saniye** ve cevap dönüyor, korpusta hiç geçmeyen bir ifadede **7,5
saniye ve boş**. Ve buradaki her kalite ölçümü **sentetik** korpustadır:
ColleX'in hukukî isabeti gerçek Türk mevzuatı ve içtihadı üzerinde **hiç
ölçülmedi**, ve o ölçüm yapılana kadar "daha iyi" sözü yalnız **disiplin**
için geçerlidir, **kapsam ve isabet** için değil.
