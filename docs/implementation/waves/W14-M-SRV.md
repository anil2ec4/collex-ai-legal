# W14 — M-SRV (sunucu hattı): IR-1, IR-2, N-8 ve N-7

**Tarih:** 03.09.2026 · **Tip:** KOD + ÖLÇÜM
**Portlar:** 8977 (sunucu) — koşu sonunda dinleyici yok; **8987 hiç
açılmadı**, **8787/8898'e hiç dokunulmadı**.
**Veritabanları:** `collex_eval_test` (`run_evals.py`'nin kendi veritabanı),
`collex_answer_test` / `collex_retrieval_test` (vitest süitlerinin kendi
veritabanları). Gerçek sunucu probu, var olmayan `collex_lm_test`'e
bağlanarak (db `down`) koşuldu — **hiçbir veritabanı yaratılmadı ve
düşürülmedi**. **`collex_local`'a hiç bağlanılmadı.**
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, dış ağa
hiçbir istek gitmedi, MCP yüzeyi **54** olarak doğrulandı, API değişiklikleri
**eklemeli**.

> Bu raporda **kendi ölçümüm** olarak yazdığım her sayı 03.09.2026'da bu
> makinede ölçüldü. Başka bir hattın sayısını aktardığım her yerde hattın adı
> yazılıdır. Korpus **SENTETİK**tir; hiçbir sayı hukukî kalite ölçüsü
> değildir.

---

## 0. Yönetici özeti

Dört kalem de yapıldı, ama **N-7'nin teşhisi yanlıştı ve bu turda ölçülerek
düzeltildi**.

| # | Kalem | Sonuç |
|---|---|---|
| IR-1 | `/v1/health.uploadsDir` | **YAPILDI** — eklemeli alan, `server.ts` bağlandı, `openapi.yaml`'a yazıldı, gerçek sunucuda görüldü |
| IR-2 | kaynak başına `totalRecords` | **YAPILDI** — `payloads.ts` → `sources/searchService.ts` → yanıt + iz satırları; **yoksa `null`, asla 0** |
| N-8 | `retrieval.test.ts` (l) duvar saati yarışı | **KAPANDI** — iddia artık saate yaslanmıyor; **6 tam süit koşusunun 6'sında da dosya 47/47 yeşil** |
| N-7 | eval cevap katmanı deterministik değil | **ÖLÇÜLDÜ, BANDA BAĞLANDI, KÖK NEDENİ BULUNDU** — ama kök neden **benim dosyam değil** (§4.4) |

**N-7'nin kök nedeni duvar bütçeleri DEĞİL.** C-FINAL §2.1 "duvar bütçeleri
farklı yerlerde ateşliyor olabilir" demiş ve bunu açıkça **ölçmediğini**
yazmıştı. Ölçtüm ve bu doğru değil: **aynı ingest edilmiş veritabanı üzerinde
üst üste koşan cevap sürücüsü rakam rakam aynı**, **her koşuda yeniden ingest
eden koşular ise oynuyor**. Değişen şey ingest'te üretilen **kimliklerdir** —
somut olarak `legal.document_relations.id` (UUID), ki citator/ilişki şeridinin
`order by … r.id asc` sıralamasında tie-break olarak kullanılıyor. §4 bunun
canlı kanıtını içeriyor.

---

## 1. IR-1 — `/v1/health.uploadsDir`

### 1.1 Ne yapıldı

| Dosya | Değişiklik |
|---|---|
| `control-plane/src/api/healthReport.ts` | **`resolveUploadsDir({uploadsDir, repoRoot})`** — mutlak yol döndürür; `COLLEX_DATA_DIR` verilmişse onu, verilmemişse `<repoRoot>/var/uploads`'ı çözer |
| `control-plane/src/api/server.ts` | `createApp` artık `uploadsDir`'i **bir kez** bu fonksiyonla çözüyor ve **hem** `createFilesRouter`'a **hem** `createMatterPackageRouter`'a **hem de** `/v1/health`'e AYNI dizeyi veriyor; `defaultRepoRoot()` yardımcı |
| `control-plane/src/api/openapi.yaml` | `/v1/health` yanıtına `uploadsDir` (string) — eklemeli, `required` değil |
| `control-plane/tests/integration/healthUploadsDir.test.ts` | **YENİ**, 5 test |

**Neden `healthReport.ts`'te ve neden tek yerde.** V-4, `uploadsDir`'i iki
yönlendiricinin ayrı ayrı hesaplaması yüzünden olmuştu. Alanı `/v1/health`'e
koyarken üçüncü bir bağımsız hesap açmamak için, yönlendiricilerin içindeki
`<repoRoot>/var/uploads` yedeği **createApp'e taşındı**: bugün `uploadsDir`
her zaman tanımlı ve sağlık sayfasının yazdığı dize, indirme yolunun okuduğu
dizenin **ta kendisi**. CLAUDE.md'nin "originals dizininin TEK çözücüsü
vardır" değişmezi böylece gerçekten tek çözücüyle sağlanıyor.

**Neden bir yol avukatın önüne yazılabilir.** "Ham makine dizesi" yasağı
kimlik/kod içindir; burada avukatın sorusu zaten **"dosyalarım nerede?"** ve
cevabı bir klasör yoludur. Alan mutlak yol döndürüyor ki Explorer'a
yapıştırılabilsin. Ekrana nasıl çizileceği M-UI'nin işi.

### 1.2 Gerçek sunucuda ölçüm (port 8977)

```
COLLEX_DATA_DIR=<scratch>/data  node control-plane/scripts/serve.mjs --port 8977 \
    --dsn postgres://postgres@127.0.0.1:55432/collex_lm_test

GET /v1/health -> 200
  uploadsDir  "…\scratchpad\w14lm-M-SRV\data\uploads"
  db "down" · dbName "collex_lm_test" · registeredToolCount 54
  version "1.0.0" · templates 13 · deadlineRules 41
```

`uploadsDir` veritabanından bağımsızdır (db `down` iken de doğru), çünkü
avukatın "verilerim nerede" sorusunun cevabı veritabanı ayakta değilken de
gerekir. Sunucu `<veri>/collex.stop` ile **nazikçe** kapatıldı; pid dosyası
kayboldu, 8977'de dinleyici kalmadı.

### 1.3 Gerileme testi ve vakumsuzluk

`tests/integration/healthUploadsDir.test.ts` alanın **varlığını değil,
BAĞINI** pinliyor: aynı uygulama örneğinde `/v1/health`'in yazdığı klasör,
`GET /v1/files/{id}/original`'in baytları okuduğu klasördür.

* aslı içeren `COLLEX_DATA_DIR` → health o klasörü yazıyor **ve** indirme 200;
* aslı içermeyen `COLLEX_DATA_DIR` → health o klasörü yazıyor **ve** indirme 404;
* açıkça verilen `uploadsDir` ortamı yeniyor, health bunu söylüyor;
* `COLLEX_DATA_DIR` yokken **gerçek varsayılanı** yazıyor (`<repoRoot>/var/uploads`), boş değil.

**Vakumsuzluk (ölçüldü):** `server.ts`'teki `uploadsDir,` satırı geçici olarak
silindiğinde **5 testin 4'ü düştü**; satır geri konunca 5/5 geçti.

---

## 2. IR-2 — kaynak başına `totalRecords`

### 2.1 Ne yapıldı

| Dosya | Değişiklik |
|---|---|
| `control-plane/src/research/payloads.ts` | `SearchParse` "hits" varyantına eklemeli `totalRecords?: number`; **`readTotalRecords(rec)`** okuyucusu; Bedesten, Deep-Research ve genel JSON ayrıştırıcılarına bağlandı |
| `control-plane/src/sources/searchService.ts` | `SourceSearchResult.totalRecords: number \| null` (toplam) ve `trace[].totalRecords: number \| null` (kaynak başına) |
| `control-plane/src/api/openapi.yaml` | `SourceSearchResult.totalRecords` + `trace` öğesinin alanları — eklemeli, `required` değil |
| `control-plane/tests/research/totalRecords.test.ts` | **YENİ**, 10 test |

**Bir tek kural, iki yönüyle.** Sağlayıcı bir sayı yayımlamıyorsa alan
`null`'dır — **asla 0**. "Arşivde yok" ile "öğrenemedik" farklı cümlelerdir ve
yalnız biri sayı olarak gösterilebilir. Sağlayıcının **gerçekten 0** dediği
durum ise 0 olarak korunur; o bir cevaptır. Başarısız bir kaynak her zaman
`null`'dır: bize hiçbir şey söylemedi.

Toplam, **yalnız sayı yayımlayan kaynakların** toplamıdır. Hiçbiri
yayımlamamışsa `null`; 758 + (bilinmeyen) = **758**, 758 + 0 değil.

### 2.2 Ne ölçüldüğü ve ne ölçülmediği

Ayrıştırma, gerçek payload şekillerine karşı **çevrimdışı** doğrulandı
(`bedestenSearchPayload` gerçek `search_bedesten_unified` gövdesidir;
`bedesten_mcp_module/models.py` `total_records` alanını gönderir).

**Canlı upstream'e bu turda hiç istek yapılmadı.** Rapordaki
**116 090 ↔ 758** karşılaştırması **C-FINAL §7(3)'ün ölçümüdür, benim değil**;
buraya alanın niçin gerektiğini anlatmak için alındı. `total_records`'un
gerçek Bedesten yanıtından bu alana kadar ulaştığı **canlı olarak
doğrulanmadı** — paralel hatta bir MCP geçidi çalışıyordu ve CLAUDE.md aynı
anda iki canlı Bedesten tüketicisini yasaklıyor.

### 2.3 Vakumsuzluk (ölçüldü)

* `totalRecords` toplamı `null` yerine 0'a düşürüldüğünde → **2 test düştü**;
* `readTotalRecords` bilinmeyeni `undefined` yerine `0` döndürdüğünde → **1 test düştü**;
* düzeltmeler geri alınınca 10/10 geçti.

---

## 3. N-8 — `retrieval.test.ts` bloğu (l) artık duvar saatiyle yarışmıyor

### 3.1 Kusur

Test şeride `trigramBudgetMs: 1` verip **kesilmesini** bekliyordu. Sıcak
önbellekte sorgu 1 ms'nin altında bitti ve şerit dürüstçe `EXECUTED_FOUND`
dedi: **ürün doğruydu, test yarışı kaybetti** (C-FINAL §2.2: 7 tam koşuda 1
kırmızı, dosya tek başına 6/6 yeşil).

### 3.2 Düzeltme

`tests/store/retrieval.test.ts` içinde **`withCutLaneBudget(sql)`**: gerçek
`Sql` istemcisini saran, `sql.begin`'i yakalayan ince bir Proxy. Şerit kendi
bütçesini `select set_config('statement_timeout', <budgetMs>, true)` ile
kurar; sarmalayıcı **tam o ifadeyi** tanır, tamamlanmasını bekler ve **aynı
bağlantıda, aynı transaction içinde** `select pg_sleep(0.05)` çalıştırır.
50 ms, 1 ms'lik bütçenin **elli katıdır**; PostgreSQL onu her seferinde
iptal eder (SQLSTATE 57014) ve iptal, üretimin tam yolunu izler:
`sql.begin` → `isQueryCanceled` → `TrigramBudgetExceededError` →
`searchPipeline` → `BUDGET_EXCEEDED`.

Gerçek veritabanı, gerçek transaction ve gerçek `statement_timeout` yerinde
kaldı; kaldırılan tek şey yazı-tura oldu.

**Neden fragment üreten çağrılar bozulmuyor:** sarmalayıcı sorgu METNİNE
bakmıyor, şeridin ilk enterpolasyon değeri olarak geçirdiği **ayar adına**
(`"statement_timeout"`) bakıyor. `provenanceProjection`, `visibilityFilter` ve
`stableTieBreak` fragmentleri bu değeri taşımaz ve hiç dokunulmaz.

### 3.3 Neyin zayıflamadığı — iki vakumsuzluk kanıtı testin içinde

1. **Sarmalayıcı tek başına hiçbir şeyi iptal etmiyor.** Aynı istemci, aynı
   sarmalayıcı, aynı sorgu, `budgetMs: 0`: şerit `statement_timeout`
   set_config'ini hiç göndermez, dolayısıyla yavaş ifade de enjekte edilmez ve
   **gerçek satırlar döner**. Yukarıdaki reddin kaynağı **şeridin kendi
   bütçesidir**, sarmalayıcı değil.
2. **Sarmalayıcı şeridin bulduğunu değiştirmiyor:** sarılmamış istemcinin
   döndürdüğü `chunkId` listesi ile sarılmışınki **birebir aynı**.

Testin pinlediği güvence aynen duruyor: varsayılan bütçe > 0, şerit onu
uyguluyor, kesilince **tipli** `TRIGRAM_BUDGET_EXCEEDED` ve mesajda
**uygulanan sayı** var, hat `laneFailures` içinde **kapsanıyor**, sürücünün
"statement timeout" cümlesi **okuyucuya hiç ulaşmıyor**, ve bütçe **tel
üzerinden ayarlanamıyor** (INVALID_REQUEST).

**Vakumsuzluk (ölçüldü):** `chunkStore.ts`'te iptalin
`TrigramBudgetExceededError`'a çevrilmesi geçici olarak devre dışı
bırakıldığında blok (l) **düştü**; geri alınınca 47/47 geçti. Yani iddia hâlâ
"kesilen bütçenin dürüstçe bildirilmesini" pinliyor.

### 3.4 Ölçüm: 6 tam süit koşusu

| Koşu | `tests/store/retrieval.test.ts` | Süit toplamı |
|---|---|---|
| 1 | ✓ 47/47 (11,2 sn) | 105 dosya · 2 127 geçti · **2 düştü** · 6 atlandı |
| 2 | ✓ 47/47 (10,6 sn) | aynı |
| 3 | ✓ 47/47 (10,3 sn) | aynı |
| 4 | ✓ 47/47 (10,8 sn) | aynı |
| 5 | ✓ 47/47 (10,7 sn) | aynı |
| 6 | ✓ 47/47 (9,7 sn) | aynı |

**6 koşunun 6'sında da (l) yeşil.** Bu koşular boş bir makinede değil, paralel
hat çalışırken ve eval turlarının hemen ardından alındı — yani "hızlı makine"
ve "yavaş makine" ikisi de görüldü.

**Düşen 2 test benim değil ve altı koşuda da aynı ikisi:**
`tests/pipeline/console.test.ts` › "B-13 Atıf Denetim Raporu…" ve "B-16 Karar
ara…". İkisi de `control-plane/public/console.html`'i okuyor; o dosya bu
koşular sırasında **02:07:59'da paralel hat tarafından değiştirildi**
(`ls --time-style=full-iso` ile doğrulandı). Konsol dosyası da o test dosyası
da **bu hattın sahipliğinde değil** ve bu hat ikisine de dokunmadı. **Bu
hattın dosyalarında düşen tek bir test yok.**

Süit sayısının 103 → **105** dosyaya ve 2 120 → **2 135** teste çıkmasının
sebebi bu hattın eklediği iki yeni dosyadır (5 + 10 test).

---

## 4. N-7 — eval cevap katmanı: teşhis düzeltildi, rapor banda bağlandı

### 4.1 Görev bana "duvar bütçelerini kapat" diyordu; önce ölçtüm

C-FINAL §2.1 yanlış çekimserliğin çıktığı koşunun aynı zamanda en yüksek
retrieval p50'sine sahip koşu olduğunu görmüş, duvar bütçelerini (şerit
2 500 ms, cevap 60 000 ms) sorumlu tutmuş ve **"bunu ölçmedim, yalnız
korelasyonu gördüm"** diye yazmıştı. Ölçtüm.

### 4.2 Deney A — aynı veritabanı, arka arkaya üç koşu

`--skip-ingest` ile, **hiç yeniden ingest etmeden**, üç koşu:

| Ölçüm | Koşu 1 | Koşu 2 | Koşu 3 |
|---|---|---|---|
| Cevap düzeyi durumlar | ABSTAIN 14 · COMPLETE 12 · PARTIAL 3 · QUALIFIED 5 | aynı | aynı |
| Yanlış çekimserlik | 1 (`fx-amend-002`) | aynı | aynı |
| Kesinleştirilebilir | %81,0 (17/21) | aynı | aynı |

**Rakam rakam aynı.** Duvar saati koşudan koşuya elbette değişti; sonuç
değişmedi. Duvar bütçesi hipotezi burada zaten zayıflıyor: şerit bütçesi
2 500 ms, ölçülen retrieval p50 ise 7–12 ms — bütçeye iki buçuk mertebe uzak.

### 4.3 Deney B — her koşuda yeniden ingest, dört koşu

| Ölçüm | Koşu 4 | Koşu 5 | Koşu 6 | Koşu 7 |
|---|---|---|---|---|
| Durumlar | A13 · C**14** · P3 · Q4 | A**14** · C13 · P3 · Q4 | A**14** · C13 · P3 · Q4 | A13 · C12 · P3 · Q**6** |
| Yanlış çekimserlik | 0 | **1** (`fx-amend-002`) | **1** | 0 |
| Kesinleştirilebilir | %85,7 | **%81,0** | **%81,0** | %85,7 |

Dördünde de: korpus **8 dosya / 7 belge / 8 sürüm / 55 parça**, şerit dağılımı
`exact=36, lexical=67, trigram=5, dense=0, relation=17, citation=12`, altı sert
kapı PASS — **hepsi birebir aynı**. Oynayan tek katman cevap katmanı.

**Sonuç: oynaklık ingest'e bağlı, duvar saatine değil.**

### 4.4 Kök neden (canlı olarak kanıtlandı) — ve o benim dosyam değil

`fx-amend-002` bir **değişiklik (amendment)** sorusudur, yani citator/ilişki
şeridinin beslediği satırdır. `control-plane/src/store/chunkStore.ts`'te o
şeridin iki sorgusu da sıralamayı **UUID ile** bitiriyor:

```
order by lower(fv.effective_period) desc nulls last,
         fv.publication_date desc nulls last,
         r.id asc          -- satır ~1299
...
order by r.kind::text asc, r.id asc                -- satır ~1315
```

`r.id`, `legal.document_relations` satırının **her ingest'te yeniden üretilen**
UUID'sidir. Doğrudan ölçtüm: aynı korpusu iki kez ingest edip ilişki
satırlarını tam bu sıralamayla okudum ve **sıra değişti** —

```
ingest A                              ingest B
AMENDS kanun-7999#1 -> kanun-6098     AMENDS kanun-7999#1 -> kanun-5237
AMENDS kanun-7999#1 -> kanun-5237     AMENDS kanun-7999#1 -> kanun-6098
```

Aynı kaynak parçadan çıkan iki AMENDS kenarı yer değiştiriyor. RRF şerit
**sırasını** kullandığı için bu, füzyon skorlarını ve dolayısıyla
kapsam-duyarlı top-8 kapağının hangi pasajı tuttuğunu değiştiriyor;
`fx-amend-002`'de bir koşuda bir pasaj kalıyor (`bypassed-by-reference`,
kapsam 0,5), diğerinde sekizinin sekizi de bir kenara konuyor (kapsam 0).

Bu, `stableTieBreak`'in (chunkStore satır ~390) **tam olarak önlemek için var
olduğu** kusurun ilişki şeridinde kalmış hâlidir: o yorum "uuid tie-break iki
ingest arasında sıralamayı değiştirdi" diyor ve FTS/trigram şeritlerini
düzeltiyor; citator şeridi düzeltilmemiş.

**`chunkStore.ts` bu hattın sahipliğinde değil.** §6'da integrationRequest
olarak bildirdim.

### 4.5 Bu hattın yaptığı: rapor bant basıyor, kapı banda bakıyor

| Dosya | Değişiklik |
|---|---|
| `evals/retrieval/gates.py` | **`answer_level_band(runs, ingests)`** (min/max/values/stable + oynayan gold kimliklerinin birleşimi) ve **`_answer_band_gate(band)`**; `evaluate_gates(...)` üçüncü, isteğe bağlı `answer_band` parametresini aldı |
| `scripts/run_evals.py` | **`--repeats N`** (varsayılan 1): ingest + cevap sürücüsü N kez koşar; retrieval ölçümü **son ingest** üzerinde bir kez alınır. Metrik tablosu ve markdown bölümü artık **bant** basıyor; modül docstring'i teşhisi anlatıyor |
| `evals/tests/test_gates.py` | **5 yeni test** (bant, kararlılık bayrağı, kapı iki yönde, `evaluate_gates` bağlanışı) |

**Neden bant, neden bu kapı.** Bu katmandaki hiçbir sayı bir sürümü
kırdıracak kadar tekrarlanabilir değil — biri hariç: **`acceptable_abstention`
işaretli bir gold satırı hiçbir koşuda cevaplanmamalıdır.** Dayanağı olmayan
bir soruya cevap vermek, bu ürünün var olma sebebi olan kusurdur ve "dört
koşunun yalnız birinde oldu" bir savunma değildir. Kapı bu yüzden bandın **en
kötü koşusuna** bakar ve düşerse **kusurlu gold kimliklerini adıyla** yazar.
Geri kalan her satır rapor amaçlıdır, ama artık tek sayı olarak değil,
**aralık + oynayan satırların adı** olarak.

`--repeats 1` (CI'ın kullandığı hâl) da bant basar — genişliği 1 olan bir bant
— ki hiçbir okuyucu tek koşuyu kararlı bir sayı sanmasın.

### 4.6 Kanıt: arka arkaya 4 koşu, her biri 4 tekrarlı bant (16 ingest)

| Koşu | Durumlar (bant) | Yanlış çekimserlik | Kesinleştirilebilir | Kapı |
|---|---|---|---|---|
| 1 | A13 · C**12-14** · P3 · Q**4-6** | 0 | %85,7 | **PASS** (0/4 tekrar) |
| 2 | A**13-14** · C**12-14** · P3 · Q**4-5** | **0-1** (`fx-amend-002`) | **%81,0-85,7** | **PASS** (0/4) |
| 3 | A**13-14** · C**12-13** · P3 · Q**4-5** | **0-1** (`fx-amend-002`) | **%81,0-85,7** | **PASS** (0/4) |
| 4 | A13 · C**12-14** · P3 · Q**4-6** | 0 | %85,7 | **PASS** (0/4) |

Dördünde de `RESULT: PASS`, altı eski sert kapı + yeni bant kapısı.

**Dürüst okunuşu — ve bu bandın sınırı.** Bant sayıları **aynı yapmıyor**;
raporun onların aynı olduğunu iddia etmesini bırakıyor. Dört bandın ikisi
`0`, ikisi `0-1` çıktı: yani **4 tekrarlık bir bant bile oynaklığı
kaçırabiliyor**. Bu, "bant yeterli bir çözümdür" demediğim yerdir —
**gerileme iddiası taşıyacak tek gerçek çözüm §4.4'teki tie-break
düzeltmesidir**; bant, o gelene kadar raporun yalan söylememesini sağlar.
Ölçek için: 16 tekrarın 16'sında da **yanlış cevap 0**; oynayan tek gold satırı
`fx-amend-002`, ve yönü hep aynı (cevap ↔ çekimserlik).

**Kalite eşiğine dokunulmadı, gold sete dokunulmadı.** Kapsam kapısı 0,4,
entailment 0,85, alaka kapısı ve `fixture_corpus_gold.jsonl` aynen duruyor.

---

## 5. Tam ölçüm turu (bu ağaçta, bu turda)

| # | Komut | Ölçülen çıktı | Exit |
|---|---|---|---:|
| 1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | **0** |
| 2 | `control-plane> npx vitest run` ×6 | **105 dosya · 2 127 geçti · 2 düştü · 6 atlandı (2 135)**, altı koşuda da AYNI; düşen ikisi paralel hattın `console.test.ts`'i (§3.4) | 1 |
| 3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 352 passed** (1 347 + bu hattın 5 yeni gates testi) | **0** |
| 4 | `scripts/run_evals.py --repeats 4` ×4 | **RESULT: PASS** dördünde de; §4.6 | **0** |
| 5 | `scripts/run_evals.py --fixture-only` | **RESULT: PASS**, 55/55 kanıt | **0** |
| 6 | `openapi.yaml` (pyyaml + `$ref` yürüyüşü) | **65 yol · 80 işlem · 126 şema · `info.version` 1.0.0** — düzenleme öncesiyle **birebir aynı** | — |
| 7 | Gerçek sunucu, port 8977 | `/v1/health` 200 · `uploadsDir` doğru · `registeredToolCount` **54** | — |

**MCP yüzeyi değişmedi (54).** API değişikliklerinin üçü de eklemeli ve
hiçbiri `required` değil; `openapi.yaml`'a **yeni yol, işlem ya da şema
eklenmedi**.

---

## 6. Diğer hatlara istekler (integrationRequests)

1. **`control-plane/src/store/chunkStore.ts` (satır ~1299 ve ~1315) — N-7'nin
   KÖK NEDENİ.** İlişki/citator şeridinin iki sorgusu da sıralamayı `r.id asc`
   ile, yani **her ingest'te yeniden üretilen bir UUID** ile bitiriyor. Bu, aynı
   korpusun iki ingest'i arasında kenar sırasını değiştiriyor (§4.4'te canlı
   ölçüldü) ve RRF üzerinden cevap katmanının çıktısını oynatıyor. Düzeltme,
   `stableTieBreak`'in aynısıdır: **korpus kimliğiyle** sırala — örneğin
   `r.kind::text, <hedef belgenin source/external_id'si>, <kaynak parçanın
   ordinal'i>`, `r.id` yalnız en son çare olarak. Bu düzeltme gelince
   `run_evals.py --repeats 4` bandı **sıfır genişliğe** inmeli; o gün bu
   raporun §4.6 tablosu yeniden ölçülsün.
2. **`evals/reports/fixture_baseline_2026-09-0{2,3}.{json,md}`** — bu iki dosya
   bant alanı olmayan eski şemayla yazılmış. Bu hat **tarihsel çıktıyı
   yeniden yazmadı**; bir sonraki resmî ölçüm turu `--repeats N` ile koşulup
   yeni raporlar üretilirse STATUS S6 satırı bandı doğrudan alıntılayabilir.
3. **STATUS/TRACEABILITY sahibi hatta:** N-7 satırının gerekçesi
   güncellenmeli. Bugünkü metin ("duvar bütçeleri farklı ateşliyor") **ölçümle
   çürütüldü**; doğrusu "ingest'te üretilen ilişki kimlikleri sıralamayı
   değiştiriyor". N-8 satırı **kapalı** yazılabilir (§3).
4. **M-UI hattına:** `/v1/health.uploadsDir` (mutlak yol) ve
   `POST /v1/sources/search` yanıtındaki `totalRecords` (+ `trace[].totalRecords`)
   artık geliyor; ikisi de `null` olabilir — `totalRecords: null` ekranda
   **"kaynak kaç kayıt tuttuğunu bildirmiyor"** diye okunmalı, **0 diye
   değil**.

---

## 7. Hijyen

* Açtığım tek sunucu (8977) `<veri>/collex.stop` ile **nazikçe** kapatıldı; pid
  dosyası kayboldu. Koşu sonunda `netstat`: **8977, 8987, 8787 ve 8898'de
  dinleyici yok**. **8987 hiç açılmadı; 8787/8898'e hiç dokunulmadı.**
* `COLLEX_DATA_DIR` scratch'e verildi; depo `var/uploads` koşu öncesi ve
  sonrası **0 dosya**, `var/` altına pid dosyası yazılmadı.
* **`collex_local`'a hiç bağlanılmadı, hiç yazılmadı, düşürülmedi.**
  Kendi adıma **hiçbir veritabanı yaratmadım ve düşürmedim**: `collex_eval_test`
  `run_evals.py`'nin, `collex_answer_test`/`collex_retrieval_test` vitest
  süitlerinin kendi veritabanlarıdır. Gerçek sunucu probu var olmayan
  `collex_lm_test`'e bağlandı (db `down`) ve onu **yaratmadı**.
  Koşu sonunda `pg_database`: `collex_demo`, `collex_eval_test`, `collex_local`,
  `collex_mig_test`, `collex_quality_test`, `collex_retrieval_test`.
* **Dış ağa hiçbir istek yapılmadı.** `.env` okunmadı, Supabase/Resend
  kullanılmadı, **hiçbir git işlemi yapılmadı**, `npm install` çalıştırılmadı,
  `control-plane/package.json`'a dokunulmadı.
* **Hiçbir test zayıflatılmadı, atlanmadı ya da silinmedi.** Değiştirilen tek
  mevcut test bloğu (l)'dir ve pinlediği güvence §3.3'te iki vakumsuzluk
  kanıtıyla korunmuştur.
* Bütün geçici dosyalar `…/scratchpad/w14lm-M-SRV/` altında.

### Değişen depo dosyaları

```
control-plane/src/api/healthReport.ts                    (IR-1: resolveUploadsDir)
control-plane/src/api/server.ts                          (IR-1: tek çözücü + /v1/health alanı)
control-plane/src/api/openapi.yaml                       (eklemeli: uploadsDir, totalRecords, trace alanları)
control-plane/src/research/payloads.ts                   (IR-2: readTotalRecords + üç ayrıştırıcı)
control-plane/src/sources/searchService.ts               (IR-2: sonuç + iz satırı alanları)
control-plane/tests/integration/healthUploadsDir.test.ts (YENİ, 5 test)
control-plane/tests/research/totalRecords.test.ts        (YENİ, 10 test)
control-plane/tests/store/retrieval.test.ts              (N-8: withCutLaneBudget + blok (l))
scripts/run_evals.py                                     (N-7: --repeats, bant, docstring)
evals/retrieval/gates.py                                 (N-7: answer_level_band + bant kapısı)
evals/tests/test_gates.py                                (N-7: 5 yeni test)
docs/implementation/waves/W14-M-SRV.md                   (bu rapor)
```
