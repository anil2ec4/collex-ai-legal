# W14 — L-FIX (Faz B1): yedi hattı tek ürün yapmak

**Tarih:** 02.09.2026 · **Kapsam:** bütün depo (bu fazda başka ajan düzenleme
yapmadı) · **Probe portları:** 8951 / 8961 · **Probe veritabanı:**
`collex_fix_test` (koşu sonunda düşürüldü)

Bu hattın işi yeni özellik değil, **dikiş yeri**ydi. Faz A'nın yedi hattı
kendi dosyalarında doğru kodu yazdı; aralarındaki boşluklar boş kaldı ve
boşluklar test tarafından görülmedi, çünkü her iki taraf da kendi birim
testinde yeşildi. Aşağıdaki kusurların **hiçbiri** bir hattın hatası değil;
hepsi "iki hattın arasında kimsenin sahibi olmadığı satır"dır.

---

## 0. Özet — ölçülen sonuç

| Komut | Sonuç |
|---|---|
| `cd control-plane && npx tsc --noEmit` | **temiz** (çıktı yok, exit 0) |
| `cd control-plane && npx vitest run` | **102 dosya · 2028 geçti · 6 atlandı (2034)** |
| `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1339 passed** (129,60 s) |
| `.venv/Scripts/python.exe scripts/smoke_check.py` | **exit 0** — 54 araç |
| `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 · RESULT: PASS** |
| `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS** (6/6 sert kapı) |
| `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** |

Faz A sonu → şimdi: vitest **100 dosya / 1993** → **102 dosya / 2028**
(+35 test, +2 dosya); pytest **1337** → **1339**; `db_local_check`
**18/18** → **19/19**.

**6 atlamanın hepsi ters işaretleyicidir** ("environment unavailable"): altı
gerçek süitin altısı da KOŞTU — `matters/pg` (10), `drafting/real-export` (2),
`integration/backup` (11), `store/persistence` (23), `integration/real-exec`
(3), `integration/serve` (5).

---

## 1. Mount'lar ve bağımlılıklar

L-SAFE dalga sonunda üç router'ı (`/v1/sources/*`, `/v1/contracts/*` +
`/v1/citation-audit`, `/v1/fees/*`) ve `/v1/backup`'ı zaten mount etmişti.
**Eksik olan mount değil, bağımlılıklardı**: her router isteğe bağlı
bağımlılıkla mount edilmişti, yani uçlar açıktı ama arkalarında hiçbir şey
yoktu ve dürüstçe "bağlı değil" diyorlardı. Faz B1'de bağlananlar:

| Bağlanan | Nereye | Neden |
|---|---|---|
| `filesStore` → `createMattersRouter({ documents })` | `server.ts` | B-29'un belge gövdesi yarısı; `documentsSearched` artık `true` |
| `PgContactStore` / `InMemoryContactStore` → `contacts` | `server.ts` | B-42; bağımlılık verilmezse `/v1/contacts` hiç mount edilmiyordu |
| `health` + `sourcesLibrary` → `createSourcesRouter` | `server.ts` | L-SOURCES IR-3/IR-4; manifest "durum" sütunu artık `/v1/health` ile aynı kaynağı okuyor |
| `createCorpusCitationResolver` → `createContractsRouter` | `server.ts` | B-13; **§4** |
| `PgChecklistStore` → `createContractsRouter` | `server.ts` | B-24'ün "kontrol listesi kaydedilir" kabulü; DDL gerekmedi |
| `FileLocalLibrary` (`--library-dir`, vars. `var/library`) | `serve.mjs` | L-SOURCES IR-4 |
| `q` → `store.list({ q })` | `drafting/routes.ts` | §3(g) |
| yeni `createMatterPackageRouter` | `server.ts` | B-30 HTTP ucu, §5 |

`server.ts` içinde `filesStore` artık fabrikanın **başında** çözülüyor: cevap
yolu (B-26 ön denetimi) onu `/v1/files` mount satırından önce kullanıyor.

### 1.1 Gerçek HTTP üzerinde ölçülen durum kodları

`node control-plane/scripts/serve.mjs --port 8951 --dsn …/collex_demo`
(13/13 migrasyon; sunucu koşu sonunda öldürüldü, port boş, `var/*.pid` yok):

| Yöntem · yol | Kod |
|---|---:|
| `GET /v1/health` | 200 |
| `GET /v1/sources/catalog` | 200 |
| `GET /v1/sources/manifest` | 200 |
| `GET /v1/fees/tariffs` | 200 |
| `POST /v1/fees/compute` | 200 |
| `GET /v1/contracts/checklists` | 200 |
| `PUT /v1/contracts/checklists/{id}` | 200 |
| `POST /v1/contracts/review` | 200 |
| `POST /v1/citation-audit` | 200 |
| `POST /v1/citation-audit/preview` (yalnız `text`) | 200 |
| `POST /v1/citation-audit/preview` (fazladan alanla) | 400 |
| `GET /v1/contacts` | 200 |
| `GET /v1/matters/search?q=…` | 200 (`documentsSearched: true`) |
| `GET /v1/drafts?q=…` | 200 |
| `GET /v1/drafts?bogus=1` | 400 |
| `POST /v1/matters/{bilinmeyen}/package` | 404 |
| `POST /v1/answer` (silinmiş `fileId`) | 404 `FILE_NOT_FOUND` |

`PUT` sonrası `GET /v1/contracts/checklists` listeyi geri verdi ve
`app_private.settings` içinde `contractChecklists` anahtarı 1 kayıtla
göründü — B-24'ün kalıcılık kabulü artık gerçek.

---

## 2. Migration — `20260904090000_hearing_kind_and_search_indexes.sql`

Tek yeni dosya, çoklu sentinel, idempotent, RLS değişmiyor (18 politika
sabit).

**(a) `matter_items.kind` artık `'hearing'` kabul ediyor.** L-MATTER'ın 1
numaralı isteği. B-17 takvimi, duruşma öğesini ve `.ics` akışını teslim
etmişti; veritabanı etmemişti, bu yüzden Pg kipinde — yani her gerçek
kurulumda — hiçbir duruşma kaydedilemiyordu (tipli 503). Süit yeşildi çünkü
bellek deposunda CHECK yok.

**Kapsam kararı:** yalnız `'hearing'` eklendi. L-LEGAL §5.5 `'expense'`
**önerdi**, ama hiçbir hat uygulamadı: `MATTER_ITEM_KINDS` onu taşımıyor,
dolayısıyla router'ın zod enum'u `expense`'i INSERT'e varmadan 400 ile
reddediyor. API'nin gönderemeyeceği bir değer için şemayı genişletmek şema
vaporware'i olurdu. `'task'`/`'correspondence'` için de aynı; `'contact'`
zaten öğe değil, B-42'nin kendi tablosu.

**(b) Üç indeks** (L-MATTER isteği 2): `answers_question_trgm`,
`drafts_title_trgm`, `matter_items_hearing_date_idx` (kısmî,
`kind = 'hearing'`). `answers_filescope_gin` W14 AI-audit migration'ıyla
zaten inmişti.

**(c) Yeni sentinel kind: `constraint`.** Bu dosyanın birincil etkisi bir
ALTER'dır ve ALTER hiçbir ilişki yaratmaz. Eski gramerle buradaki tek
probe'lanabilir nesneler alttaki üç indeks olurdu — ve indeksleri olup ESKİ
altı değerli CHECK'i taşıyan bir veritabanı "uygulanmış" diye okunurdu:
B-05'in matters migration'ı için kapattığı yarım-uygulama körlüğünün
birebir aynısı. `ingestion/migrations.py` ve `control-plane/src/store/health.ts`
`pg_constraint` üzerinden `policy` ile aynı üç parçalı biçimi alan
`constraint` kind'ını kazandı (iki runtime, tek CASE, aynı gramer).

**Ölçülen kanıt.**

```
# probe veritabanı collex_fix_test
constraint:app_private.matter_items.matter_items_kind_check  -> True
regclass:app_private.answers_question_trgm                   -> True
regclass:app_private.drafts_title_trgm                       -> True
regclass:app_private.matter_items_hearing_date_idx           -> True
constraint:app_private.matter_items.nope                     -> False
CHECK: kind = ANY (ARRAY['file','answer','draft','note','event','deadline','hearing'])
HEARING PERSISTED: (ff31d03e-…, 'hearing', '2026-10-14')
'expense' reddedildi: SQLSTATE 23514
yeniden uygulama: applied=[] bootstrapped=[]      # idempotent
rls politikaları: 18
```

**Gerçek `collex_local`'a uygulandı** (create-only yol):

```json
{"ensureDb": {"database": "collex_local", "created": false,
  "migrationsApplied": ["20260903100000_ai_audit_and_scale_indexes.sql",
                        "20260904090000_hearing_kind_and_search_indexes.sql"],
  "migrationsBootstrapped": [], "migrationsAlreadyApplied": 11}}
```

Sonrası: CHECK `'hearing'` taşıyor, üç indeks var, ledger 13 satır, RLS 18,
`matters/matter_items/answers/drafts/settings` **hepsi 0 satır** — tek satır
test verisi yazılmadı.

`scripts/db_local_check.py` yeni **c15** kontrolünü aldı (kabul + reddetme +
indeksler + idempotans): **19/19 PASS**.

---

## 3. Hatlar arası kusurlar

### (a) `tests/research/{researchService,routes}.test.ts` — teşhis ve karar

**Bulgu: kod tarafı zaten doğruydu, testler haklıydı, eksik olan testti.**
L-SOURCES bu iki hatayı ölçtüğünde sebep B-31'in ilk halinde karşıt pasajın
**kendi E./K.** numarasını "mesele" belirtecine katmasıydı. L-ANSWER bunu
dalga içinde düzeltti (`evidenceReferenceTokens`, W14-L-ANSWER §8.6) ve iki
test yeşile döndü. Yani **ne testi güncellemek ne de kodu değiştirmek**
gerekiyordu; gereken, düzeltmenin **nerede** yaşadığını sabitleyen bir
gerileme testiydi — kural yeniden bozulursa hata, sebebin yanında değil iki
dosya ötede bir canlı-araştırma sözleşme testinde patlıyordu.

`tests/answer/entailmentSegments.test.ts` yeni vaka:
*"a passage does NOT conflict with a claim drafted FROM that same decision"*.
Bir karara ATIF YAPAN iddia elle kuruluyor (kural tabanlı yazıcı bu şekli
üretmiyor) ve karşıt pasaj o kararın kendisi; sözcüksel kapı
`conflictOverlapFloor: 1.01` ile kapatılıyor ki yalnız referans kuralı
ölçülsün.

**Boşluk denetimi (yapıldı, iki kez).** Kusur `verifier.ts`'e geçici olarak
geri kondu:
- ilk denemede yeni test **yeşil kaldı** → test boştu, atılmadı, düzeltildi
  (karşıt metnin de aynı maddeyi anması iki mekanizmayı karıştırıyordu);
- düzeltilmiş haliyle kusur geri konduğunda test **kırmızıya döndü**
  (`expected [ 'ev-7eb…' ] to deeply equal []`), ve aynı koşuda
  `research/{researchService,routes}` de tarihsel biçimde düştü. Kusur
  kaldırıldı, üçü de yeşil.

### (b) B-26 · silinmiş belgeye sorulan soru

`POST /v1/answer` `filters.fileIds` içinde artık var olmayan bir kimlik
taşıyorsa **retrieval'dan önce** `404 FILE_NOT_FOUND` dönüyor
(`"Belge kaydı bulunamadı; silinmiş olabilir."` + `missingFileIds[]`).
Öncesinde dosya kapsamı boş kümeye düşüyor, bütün şeritler boş dönüyor ve
cevap ABSTAIN oluyordu — ekranda "bu belge sorunuzu desteklemiyor" diye
okunan, yani **belge hakkında** bir cümle, oysa gerçek "o belge yok".

`PostgresFilesStore.existingFileIds(ids)` (tek sorgu, `originalRef` ile aynı
görünürlük yüklemi). **Denetim asla yeni bir başarısızlık yolu değildir:**
`existingFileIds` yoksa ya da bağlantı patlarsa istek geçer.

### (c) `DELETE /v1/drafts` ve `/versions/{n}`

Rapor edilen kusur "bellek kipinde 501" idi. Ölçülen kusur **daha büyüktü**:
`linkedDraftStore` / `linkedAnswerStore` sarmalayıcıları `remove` ve
`getVersionBody`'yi **hiç iletmiyordu** ve router'lara giden şey sarmalayıcı.
Yani `DELETE /v1/drafts/{id}`, `DELETE /v1/answers/{runId}` ve
`GET /v1/drafts/{id}/versions/{n}` gerçek PostgreSQL'e karşı da 501
dönüyordu — `PgDraftStore` ikisini de uyguladığı hâlde. Bir arayüzün
**bir kısmını** ileten sarmalayıcı, çalışan bir uygulamanın "yok" diye
raporlanma biçimidir.

Yapılan: `InMemoryDraftStore.remove` / `.getVersionBody` (versiyonlar zaten
bellekteydi) + iki sarmalayıcının ilettikleri + `DraftStore` arayüzünde iki
additive imza. Artık bellek kipinde DELETE 204 / ikinci çağrı 404, eski sürüm
gövdesi 200, olmayan sürüm 404.

### (d) B-24 DOCX ve B-30 HTTP → §5

### (e) Kilidi açılan diğer kalemler

- **`GET /v1/drafts?q=`** artık depoya geçiyor (iki depo da başından beri
  başlığa göre süzüyordu; yalnız route parametreyi düşürüyordu — sessizce
  süzülmemiş liste dönüyordu). Tanınmayan sorgu parametresi artık **400**.
  `InMemoryDraftStore.list` `shadowFold` ile süzüyor (Türkçe İ/I).
- **B-16 süzgeçleri `/v1/answer`'a ulaştı** (L-SOURCES IR-5):
  `chambers` / `yearFrom` / `yearTo` / `excludeTerms`. `passesCourtDateFilters`
  bunları faz A'dan beri uyguluyordu ve `/v1/search` kabul ediyordu; cevap
  şeması `.strict()` olduğu için `/v1/answer` 400 veriyordu. Şema `.strict()`
  kalmaya devam ediyor.
- **`scripts/gen_reference_fixtures.py`** artık `SHORT_FORM_CASES`'i ekliyor
  (L-SOURCES IR-1). Öncesinde fixture yeniden üretildiğinde B-38'in 8 vakası
  **sessizce** düşüyordu. Yeniden üretildi: 108 vaka / 160 referans, 108'i
  benzersiz, 8 short-form vakası yerinde; iki runtime'ın parity süitleri
  yeşil (Python 698, TS 129).

---

## 4. B-13'ün çözümleyicisi — ve çekilen sınır

`createCorpusCitationResolver` (`src/contracts/corpusResolver.ts`)
`exactPinLookup` üzerinden korpusa soruyor. İki şey gerekti:

1. **Çıplak maddenin kanununa bağlanması** (`pairArticlesWithTheirLaw`).
   `parseReferences` "6098 sayılı Kanun m. 299"u İKİ referans olarak veriyor;
   denetim bunları iki AYRI atıf sanıyordu, yani Türk dilekçesinin en yaygın
   biçimi çözümleyiciye "kanunsuz madde" olarak varıyordu. Eşleştirme kuralı
   `retrieval/hybrid.ts`'in atıf genişletmesinde kullandığı kuralın aynısı.
2. **Çiftin şeride geri kurulması**: `exactPinLookup` `legislation_no` VE
   `article_no` üzerine ancak kendisine hem bir `legislation` hem bir
   `article` referansı verildiğinde pinliyor.

**Ölçülen kanıt (gerçek HTTP, `collex_demo`):**

```
totals: {FOUND: 3, NOT_FOUND: 0, UNCERTAIN: 3}
  FOUND      6098 sayılı Kanun   6098 sayılı Türk Borçlar Kanunu (…)   IN_FORCE
  UNCERTAIN  m. 5                (BOŞ)                                 6098 … m. 5 bu metinde bulunamadı …
  FOUND      5237 sayılı Kanun   5237 sayılı Türk Ceza Kanunu (…)      IN_FORCE
  FOUND      m. 157              5237 sayılı Türk Ceza Kanunu (…)      IN_FORCE
  UNCERTAIN  m. 900              (BOŞ)                                 5237 … m. 900 bu metinde bulunamadı …
  UNCERTAIN  Yargıtay 15. CD …   (BOŞ)                                 Mahkeme kararları yerel korpusta tam değildir …
```

### Bu çözümleyici ASLA "bulunamadı" demiyor — ve sebebi ölçüldü

Tasarım tek istisnayla başladı: *"kanunun dilekçe tarihindeki metni korpusta
VAR ve o madde metinde yok"* gerçek bir olumlu bulgu gibi duruyordu, çünkü
ingest bir mevzuatı tek belge sürümü olarak saklar. **Demo korpusuna karşı
denetlendi (02.09.2026) ve öncül tutmadı:** `kanun-6098` orada
{1, 2, 12, 49, 50, 51} maddelerini taşıyor — SENTETİK bir **alıntı**, kanun
değil. "6098 m. 5" bu kuralla **"bulunamadı"** raporlanacaktı; yani rapor bir
avukata gerçek bir hükmün **uydurma göründüğünü** söyleyecekti.

Şemada bir mevzuatın tam mı yoksa parça mı saklandığını söyleyen hiçbir şey
yok, dolayısıyla öncül koşum zamanında denetlenemez, dolayısıyla sonuç
çıkarılamaz. Vaka hâlâ elde edilebilecek en yararlı cümleyi üretiyor —
hangi kanun, hangi tarihe göre okundu, hangi madde bulunamadı — ama
**belirsiz** kovasında, yani kapsamımız hakkındaki bir cümlenin ait olduğu
yerde. `absent: true` sözleşmede duruyor; tamlığı beyan EDEBİLEN bir
çözümleyici (resmî tam metin kaynağı) için. Bu çözümleyici edemiyor ve
ediyormuş gibi yapmıyor.

Yeni süit: `control-plane/tests/contracts/corpusResolver.test.ts` (11 test),
`lookup` dikişi üzerinden (sahte bir `Sql`, postgres.js fragment
kompozisyonunu taklit edemiyor — `visibilityFilter` sorguyu KURMAK için de
tag'i çağırıyor, yani konserve satır kuyruğunu sorgu inşası tüketirdi ve test
sahteyi ölçerdi).

Ek olarak `citationAudit.ts`: `NOT_FOUND` satırı artık çözümleyicinin
gerekçesini taşıyor (bir suçlama satırının dayanağı okunabilmeli).

---

## 5. B-24 DOCX ve B-30 HTTP ucu

### `export/review.py` + `--review` + `inceleme-docx`

`export/audit.py`'nin deseni birebir: katı ayrıştır → kur → geçici ada yaz →
yeniden aç → **üründe kendini denetle** → yayımla. Üç kural artefaktta
zorlanıyor:

1. **"yok" metin hakkındadır**, hukuk hakkında değil — sözlük satırı birebir
   yazılı;
2. **kaynaksız gözlem "risk" sözcüğünü taşıyamaz** — sözlük satırı ve
   `notices` kimlikle muaf (kuralın kendisi kuralı söylemek zorunda:
   *"… 'risk' olarak adlandırılmaz"*), diğer her etiketli satır bir gözlemdir
   ve sözcüğü hiç kullanamaz;
3. **rapor kural tabanlı olduğunu yüzünde söylüyor** (üstte ve altta).

Reddedilen bir dışa aktarım **hiçbir dosya bırakmıyor** (geçici dosya dahil;
test bunu `tmp_path` boş mu diye bakarak sabitliyor). Yeni süit:
`tests/export/test_review_report.py` (12 test).

### `POST /v1/matters/{id}/package`

`src/matters/packageRoutes.ts`. Üç hattın verisini birleştirip
`collex.matter-package/v1` planı yazıyor ve `python -m export.cli --package`
çağırıyor (taslak yazıcısının `execFile` + argüman dizisi deseni). **Kendisi
hiçbir baytı okumuyor ve hiçbir özet hesaplamıyor**: planda mutlak yol +
ingest'te KAYDEDİLEN sha256 var, Python paketleyici özeti yeniden hesaplayıp
tutmazsa bütün arşivi reddediyor → `500 EXPORT_REFUSED` + `correlationId`,
hiçbir şey yazılmıyor, çocuk sürecin stderr'i gövdeye **girmiyor** (test
bunu da sabitliyor). Pakete konamayan kayıt `notes`'a yazılıyor, sessizce
düşürülmüyor. 404 (bilinmeyen dosya) / 422 `PACKAGE_EMPTY` / 503 tipli.

---

## 6. B-06'nın ikinci yarısı — ölçüldü, ve dürüst cevap "güvenli düzeltme yok"

**Probe yeniden kuruldu:** `collex_fix_test`, **20 000 parça**, ortalama
`search_text` **4 903 kod noktası**, yığın **39 MB**, TOAST **119 MB**,
`chunks_search_trgm` **23 MB**.

### Ölçüm 1 — bugünkü ürün yolu (`<%` + işlem-yerel `enable_seqscan=off`)

| Sorgu | Süre | Satır |
|---|---:|---:|
| `depozito iadesi` | 16 925 ms | 20 |
| `zamanaşımı süresi` | 33 048 ms | 24 |
| `haksız fiil sorumluluğu` | 33 143 ms | 24 |
| `Depozito ne zaman iade edilir?` | 17 446 ms | 1 |

`EXPLAIN (ANALYZE)` planı indeksi **kullanıyor** ve asıl maliyeti gösteriyor:

```
Bitmap Index Scan on chunks_search_trgm (actual time=4.677 rows=20000.00 loops=50)
Bitmap Heap Scan on chunks c            (actual time=355.951..362.401 rows=0.40 loops=50)
   Filter: ('depozito iadesi' OPERATOR(extensions.<%) search_text)
   Rows Removed by Filter: 400
Execution Time: 18141.215 ms
```

Aday kümesi **20 000/20 000**. Yani zaman planda değil, **recheck**te.

### Ölçüm 2 — maliyet modeli (aynı 20 000 satır, yalnız metin uzunluğu değişiyor)

| `<%` şuna karşı | Süre |
|---|---:|
| `left(search_text, 250)` | 791 ms |
| `left(search_text, 500)` | 1 597 ms |
| `left(search_text, 1000)` | 3 363 ms |
| `left(search_text, 2000)` | 6 855 ms |
| tam `search_text` (~4 903) | 16 746 ms |

**Kesinlikle doğrusal: satır başına kod noktası başına ~0,17 µs**, yani bu
boyutta satır başına ~0,84 ms. Bu, aday metin üzerinde trigram çıkarımıdır;
hiçbir şema ya da depolama kararı onu kaldırmaz.

### Denenen ve BAŞARISIZ olan kalıcı çözüm: gerçekçi operatör maliyeti

`alter function extensions.word_similarity_op(text,text) cost N`, N = 1, 10,
100, 1 000, 10 000:

```
cost=     1  selective -> SEQSCAN (349.8)   common -> SEQSCAN (349.8)
cost=    10  selective -> SEQSCAN (349.9)   common -> SEQSCAN (349.9)
cost=   100  selective -> SEQSCAN (351.0)   common -> SEQSCAN (351.0)
cost=  1000  selective -> SEQSCAN (362.3)   common -> SEQSCAN (362.3)
cost= 10000  selective -> SEQSCAN (474.8)   common -> SEQSCAN (474.8)
```

Plan **hiçbir değerde değişmedi**: planlayıcı operatörü parça taramasının
kendi satır TAHMİNİNE karşı fiyatlıyor ve o tahmin küçük. Planı
oynatamayan bir maliyet, ayarın yerini alamaz. (DDL geri alındı; depoya
girmedi.)

### Aday sınırı: **sağlam değil**, pahalı değil

GIN `%>` koşulu `a <% b` için zaten **en dar gerekli koşuldur**, ve sıralama
anahtarı skordur — skor ise ancak recheck'ten SONRA bilinir. Dolayısıyla
daha ileri her kırpma, sonuç kümesinin gerektirdiği satırları düşürür.
KABUL ölçütü ("sonuç kümesi bugünküyle aynı kalır") bunu yasaklıyor.

### Karar: çekiç KALIYOR

Bu doymuş probe korpusunda ayar **maddi fark yaratmadı** (16,9 s açık /
17,9 s kapalı — aday kümesi zaten her satır); L-ANSWER'ın seçici korpusunda
**~490×** ölçmüştü. Kaldırmak **ölçülmüş bir vakayı geriletir** ve hiçbirini
iyileştirmez. Gerekçenin tamamı ölçümlerle birlikte
`chunkStore.ts::TRIGRAM_SEQSCAN_SETTING` başlığına yazıldı.

### Şeridi asıl sınırlayan şey — ve eksik olan

Plan değil: `createDb`'nin **15 s `statement_timeout`**'u doymuş şeridi
kesiyor, kesinti bir şerit arızası oluyor, cevap ayakta kalan şeritlerden
`RETRIEVAL_LANE_DEGRADED` uyarısıyla dönüyor. Bu yolun tamamı kodda vardı ve
**hiçbir testi yoktu** (L-CONSOLE entegrasyon isteği 3: konsol satırı
çizmeye hazır). Ölçülen süreler (17–34 s) 15 s'yi aştığı için bu, kuramsal
değil koşulan yoldur. `tests/integration/lfix.test.ts` artık sabitliyor:
şerit düşüyor, cevap 200 dönüyor, uyarı görünüyor, gövdede bağlantı dizesi
yok.

**Sentetik veri uyarısı:** bu bölümdeki her sayı, üretilmiş bir probe
korpusu üzerindedir ve hiçbiri hukukî kalite ölçüsü değildir. Korpusun her
parçası aynı 105 sözcüklük dağarcıktan kurulduğu için trigram çeşitliliği
gerçekçi değildir; aday kümesinin her satır olması bunun sonucudur.
Gerçek hukuk metninde aday kümesinin ne olacağı **bu makinede ölçülmedi**.

---

## 7. NUL baytları

`control-plane/src/retrieval/hybrid.ts` (ayrılmış `stableKey` birleştirici,
artık adlandırılmış sabit `SEP`) ve
`control-plane/tests/capabilities/localLibrary.test.ts` (hatalı yol testi)
ham 0x00 yerine `\u0000` kaçışını yazıyor — JavaScript motoru için **birebir
aynı dize**, ama dosya artık grep/diff/editör için metin.
`tests/test_repo_hygiene.py`'deki `NUL_BYTE_ALLOWLIST` **boşaltıldı**.

Bu arada bu hattın kendi yeni dosyası `packageRoutes.ts` de aynı hataya
düştü (bir regex sınıfında ham 0x00) ve **hijyen testi tarafından yakalandı**
— muafiyet listesi boş olduğu için. Aynı kaçışla düzeltildi.

---

## 8. integrationRequests — madde madde

**Yapıldı:** L-EVID 9.1 (çözümleyici bağlandı) · 9.3 (kontrol listesi
kalıcılığı, DDL'siz) · 9.4 (paket ucu) · §13.1 (B-24 DOCX) · §13.2 (B-30
HTTP) · §13.6 (B-13 çözümleyicisi) — L-MATTER 12.1 (hearing) · 12.2
(indeksler) · 12.4 (documents + contacts) · 12.6 (`FILE_NOT_FOUND`) · 12.7
(`?q=` + 400) · 12.8 (`remove`/`getVersionBody`, ve sarmalayıcı kusuru) —
L-SOURCES IR-1 (fixture üreteci) · IR-3 (sources health) · IR-4
(`--library-dir`) · IR-5 (cevap süzgeçleri) — L-CONSOLE 3
(`RETRIEVAL_LANE_DEGRADED` yolu doğrulandı ve teste bağlandı) — L-SAFE §2
(mount'lar faz A'da inmişti; bağımlılıkları bu fazda).

**Ertelendi, gerekçesiyle:**

| İstek | Neden ertelendi |
|---|---|
| L-EVID 9.5, 9.6 · L-MATTER 12.10 · L-LEGAL 5.3 · L-ANSWER 8.1 · L-CONSOLE 2 | Hepsi `control-plane/public/console.html`. Bu hattın görevi arka uç dikişiydi; konsol tek `<style>`/tek `<script>`/CSP-hash sözleşmesi altında ve kendi süiti (`console.test.ts`, 110 test) ile birlikte tek elden düzenlenmeli. |
| L-EVID 9.7 · L-MATTER 12.11 · L-SOURCES IR-6 · L-ANSWER 8.2–8.4 · L-LEGAL 5.7 · L-SAFE §4 | `openapi.yaml` + `STATUS.md` + `CLAUDE.md` + `ADRS.md` — L-DOCS'un faz B işi. Bu hat bu dosyalara dokunmadı; **bu raporda ölçülen hiçbir sayı STATUS'a kendisi yazılmadı.** |
| L-EVID 9.8, 9.9 · L-LEGAL 5.6 | `templates.ts` kapanış cümleleri, EK sıralaması, `kararOzeti` fixture'ı — hukukî **içerik** kararları (L-LEGAL/L-EVID); teknik dikiş değil. |
| L-EVID §13.3 (`annex=none` tekrar eden atıf satırı) | `appendix.ts` ↔ `petition.py` koordinasyonu + COPY hattının dili gerekiyor; yanlış değil, gereksiz. |
| L-LEGAL 5.4 (`belirsiz` iki tarih) · 5.5 (`expense` öğesi) | 5.4 `calc.ts` sözleşme genişletmesi (L-MATTER kalemi). 5.5 arkasında uygulama yok — §2'deki kapsam kararı. |
| L-SOURCES IR-2 (`ingestion/live_library.py` + `--ingest-library`) | B-20'nin ikinci yarısı: yeni bir `SourcePort`, yeni CLI kipi ve kendi testleri olan bağımsız bir kalem; dikiş işi değil. IR-4 indiği için kütüphane **yazılıyor**, henüz ingest edilmiyor. |
| L-MATTER 12.9 (kronoloji DOCX) · L-CONSOLE 2 (`POST /v1/exports/grid`) | İki yeni dışa aktarım yüzeyi; B-24/B-30 gibi kendi kabul ölçütleri ve kendi self-check'leri gerekiyor. |

---

## 9. Değişen dosyalar

**Yeni:** `supabase/migrations/20260904090000_hearing_kind_and_search_indexes.sql` ·
`export/review.py` · `control-plane/src/contracts/corpusResolver.ts` ·
`control-plane/src/contracts/checklistStore.ts` ·
`control-plane/src/matters/packageRoutes.ts` ·
`tests/export/test_review_report.py` ·
`control-plane/tests/contracts/corpusResolver.test.ts` ·
`control-plane/tests/integration/lfix.test.ts`

**Değişen:** `ingestion/migrations.py` (constraint kind) ·
`control-plane/src/store/health.ts` (aynı kindin aynası) ·
`control-plane/src/api/server.ts` (bağımlılıklar, `FILE_NOT_FOUND`, paket
mount'u) · `control-plane/src/api/matterLink.ts` (iletilmeyen iki metot) ·
`control-plane/src/api/answerService.ts` (B-16 süzgeçleri) ·
`control-plane/src/drafting/{store,routes}.ts` · `control-plane/src/files/store.ts` ·
`control-plane/src/contracts/{citationAudit,routes}.ts` ·
`control-plane/src/store/chunkStore.ts` (yalnız B-06 gerekçesi) ·
`control-plane/src/retrieval/hybrid.ts` (NUL) · `control-plane/scripts/serve.mjs` ·
`export/cli.py` · `scripts/db_local_check.py` (c15) ·
`scripts/gen_reference_fixtures.py` · `evals/fixtures/reference_parity.json`
(yeniden üretildi) · `tests/test_repo_hygiene.py` ·
`tests/ingestion/test_migrations_ledger.py` · `tests/intake/test_ensure_db.py` ·
`control-plane/tests/{answer/entailmentSegments,capabilities/localLibrary}.test.ts`

**Zayıflatılan test: yok.** Değişen üç test dosyası yeni bir migration'ın
varlığını kaydediyor (`test_migrations_ledger.py`, `test_ensure_db.py`) ya da
yeni bir vaka ekliyor; hiçbir iddia gevşetilmedi, hiçbir test atlanmadı ya
da silinmedi.

---

## 10. Hijyen

`collex_fix_test` kuruldu ve **düşürüldü** (`pg_database` listesiyle
doğrulandı). `collex_local`'a yalnızca migration uygulandı — beş
`app_private` tablosu da **0 satır**. 8951'de bırakılan dinleyici yok,
`var/*.pid` yok, 8787/8898'e dokunulmadı. Geçici dosyaların tamamı
scratchpad'de. Hiçbir git işlemi yapılmadı. `.env` okunmadı.

---

## 11. Açık konular — dürüst liste

1. **B-06'nın kalan maliyeti kapanmadı ve kapatılamadı.** Ölçüldü,
   modellendi (satır × uzunluk × 0,17 µs), üç kalıcı yol denendi
   (operatör maliyeti — başarısız; aday sınırı — sonuç kümesini değiştirir;
   depolama — baskın terim trigram çıkarımı). Şeridi sınırlayan şey
   `statement_timeout` ve görünür uyarıdır; artık testlidir. **Bir hız
   iddiası yapılmıyor.**
2. **B-06 ölçümleri sentetik korpustadır** ve o korpusun trigram çeşitliliği
   gerçekçi değildir (§6 sonu). Gerçek hukuk metninde aday kümesi
   ölçülmedi.
3. **`absent: true` artık hiçbir yerde üretilmiyor**, yani `NOT_FOUND`
   kovası B-13'te şu an ulaşılamaz. Bu bilinçlidir (§4) ve kovanın
   kendisi kaldırılmadı: tamlığı beyan edebilen bir kaynak bağlanınca
   doldurulacak. Bugünkü rapor bir **kapsam beyanı + çözümlenen künyeler**
   raporudur, hâlâ tam bir atıf doğrulaması değildir.
4. **Konsol tarafı bu fazda hiç düzenlenmedi** (§8). Yeni uçların hiçbiri
   arayüzde çizili değil; vaporware kapısı gereği çizilmeden önce
   L-CONSOLE'un geçmesi gerekir.
5. **`openapi.yaml` bu fazda da dokunulmadı.** Bu hattın açtığı yollar
   (`POST /v1/matters/{id}/package`) ve genişlettiği şemalar
   (`answerFiltersSchema` dört alan, `FILE_NOT_FOUND.missingFileIds`,
   `GET /v1/drafts?q=`) L-DOCS'un deltasına eklenmelidir.
6. **`inceleme-docx`in HTTP ucu yok.** CLI ve modül hazır; konsolun DOCX'i
   indirebilmesi için `/v1/contracts/review` yanında bir dışa aktarım ucu
   gerekiyor (denetim raporunun `/v1/drafts/{id}/export?format=denetim-docx`
   deseni taslak kapsamlı, sözleşme incelemesi değil).
7. **`POST /v1/matters/{id}/package` gerçek bir dosya üzerinde uçtan uca
   koşturulmadı.** Testler sahte bir dışa aktarıcıyla planı ve hata yollarını
   sabitliyor; gerçek Python paketleyici `tests/export/test_matter_package.py`
   tarafından ayrıca sınanıyor, ama ikisi **birlikte** bir yükleme üzerinde
   koşmadı.
8. **Bulut AI hâlâ canlı sınanmadı** ve **hiçbir devlet upstream'ine
   bağlanılmadı**; bu hattın hiçbir kalemi ağa çıkmadı.
9. **Paylaşılan PostgreSQL çekişmesi görülmedi** (bu faz tek hat). L-SAFE'in
   gözlemi (paralel yedi hat) bu koşuda yeniden üretilemedi.
