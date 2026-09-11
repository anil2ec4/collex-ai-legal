# W14 — F-PERF (Faz F): dalganın son P0'ı (V-1) ve `answers_filescope_gin` (V-2)

**Tarih:** 02.09.2026 · **Kapsam:** `control-plane/src/store/{chunkStore.ts,answerStore.ts}`,
`control-plane/src/retrieval/hybrid.ts`,
`supabase/migrations/20260903100000_ai_audit_and_scale_indexes.sql` (**yalnız yorum**),
`control-plane/tests/store/{retrieval,persistence}.test.ts`
**Probe portu:** 8971 · **Probe veritabanı:** `collex_perf_test` (kuruldu, ölçüldü, **düşürüldü**)
`collex_local`'a hiç bağlanılmadı. 8787/8898'e hiç dokunulmadı. Git işlemi yok, `.env` okunmadı.

> Bu raporda yazan her sayı **bu koşuda bu makinede ölçüldü**. Probe korpusu
> **SENTETİK**tir (200 sözcüklük bir dağarcıktan üretilmiştir); trigram
> çeşitliliği gerçek Türk hukuk metninin çeşitliliği değildir, dolayısıyla
> doymuş uçta ölçülen her sayı bir **üst sınır** senaryosudur, "üründe böyle
> olacak" iddiası değildir. Hiçbir sayı hukukî kalite ölçüsü değildir.

---

## 0. Yönetici özeti

**V-1 kapandı — ama şeridi ucuzlatarak değil, ne zaman koşacağını sorarak.**
`<%` recheck'inin maliyeti aday metin üzerinde trigram çıkarımıdır ve
**ölçülen** oran 0,178 µs / kod noktası / satır'dır; hiçbir şema kararı onu
kaldırmıyor (L-FIX'in tespiti üçüncü kez doğrulandı). Kapanışı iki şey
sağladı:

1. **Trigram şeridi artık adının söylediği şey: FALLBACK.** Exact + lexical
   şeritleri birlikte **8**'den (cevabın kendi kanıt tavanı) az pasaj
   döndürdüğünde koşuyor. Doymuş bir sorgunun trigramları bir korpusta her
   satırda geçiyorsa, o sorgunun **sözcükleri** de her satırda geçiyordur ve
   FTS şeridi onu zaten ve tam olarak cevaplar: pahalı vaka ile fallback'in
   gereksiz olduğu vaka **aynı vakadır**.
2. **Şeridin kendi duvar bütçesi var (2 500 ms).** Bağlantının 15 sn'lik
   `statement_timeout`'u tek bir şerit için yanlış sınırdı: bir cevap trigram
   şeridini birincil soru + her karşıt otorite probu için ayrı ayrı koşuyor,
   yani 15 sn üç-dört kez ödeniyordu.

Gerçekçi korpus şeklinde (aşağıda "B"), gerçek HTTP, aynı makinede:
**49 368 ms → 15 756 ms** (yaygın sözcük; üstelik ÖNCE 3 şerit arızasıyla,
SONRA **sıfır** arızayla) ve uzun soru **64 319 ms / PARTIAL → 17 472 ms /
COMPLETE**. Şerit düzeyinde: **16 428 ms → 1 253 ms**.

**Ama dürüst yarı:** 20 000 parçada cevap hâlâ 15–17 saniye sürüyor ve
kalan maliyet **artık trigram şeridi değil**, lexical (coverage kipi)
şeridinin `tsvector_to_array` kesişimidir — çağrı başına ölçülen
**1 489–3 427 ms**, cevap başına üç çağrı. Tavanı §7'de sayıyla yazdım.

**V-2 kapandı.** Ürün predikatı indeksin ifadesine getirildi: `Seq Scan on
answers` **12,190 ms** → `Bitmap Index Scan on answers_filescope_gin`
**0,780 ms**, **aynı 16 satır** (2 140 cevaplı probe). Migrasyon yorumunun
yazdığı üçüncü şekil indeksi kullanıyor ama **0 satır** döndürüyor; yorum
düzeltildi ve testle sabitlendi.

**Gold metrikleri gerilemedi.** Aynı ağaç üzerinde varsayılanlar açık/kapalı
koşulan iki `run_evals.py` turunda **bütün retrieval metrikleri ve şerit
dağılımı birebir aynı**. Cevap katmanında 34 satırın 3'ü kımıldadı; §6'da
hepsini, kendi lehime olmayan yarısı dâhil, tek tek yazdım.

---

## 1. Önce yeniden ürettim (V-1, uçtan uca HTTP)

### 1.1 Probe korpusu

`collex_perf_test`, W14-L-VERIFY §2'nin kurulumu birebir: **2 000 kiracı
`UPLOAD` belgesi × 10 parça = 20 000 parça**, ortalama `search_text`
**4 974 kod noktası** (L-VERIFY: 4 976), `legal.chunks` yığın **26 MB**,
TOAST dâhil toplam **288 MB**, `chunks_search_trgm` **20 MB**; **2 000**
`app_private.answers` satırı, her biri `result.fileScope.fileIds` taşıyor.

İki korpus **şekli** ölçüldü, çünkü ikisi farklı şeyleri gösteriyor:

| Şekil | Ne | Neden |
|---|---|---|
| **A** | 2 000 belgenin tamamı `scope='tenant'` | L-VERIFY'ın ölçtüğü şekil. Korpus sorusu (dosya kapsamı olmadan) görünürlük süzgecinden hiçbir satır geçiremez — ama trigram recheck'i **yine de** 20 000 satırın tamamında koşar, çünkü GIN bitmap'i join'den ÖNCE gelir. Cevap 47–60 sn sürüp ABSTAIN döner. |
| **B** | 1 900 belge `scope='public'`, 100 belge kiracıda | Ürünün gerçek hâli: aranabilir bir korpus + avukatın yüklemeleri. Fallback kapısının kazandığı yer burasıdır. |

### 1.2 ÖNCE — şekil A, `POST /v1/answer`, gerçek HTTP, n=5

| Sorgu şekli | p50 | p95 | durum | `trace.retrieve` |
|---|---:|---:|---|---:|
| `Belge 17 paragraf 3 kaydi` (işaret cümlesi) | 30 906 ms | 32 281 ms | ABSTAIN | 32 274 ms |
| `depozito iadesi` (yaygın) | **59 458 ms** | 60 291 ms | ABSTAIN | 59 277 ms |
| `zamanasimi suresi` (yaygın) | 45 121 ms | 45 191 ms | ABSTAIN | 45 111 ms |
| `kira sozlesmesinde depozito ne zaman iade edilir` (uzun) | 65 978 ms | 76 579 ms | ABSTAIN | 59 859 ms |
| `kuantum mekaniginde dalga fonksiyonu` (seçici) | 1 251 ms | 1 456 ms | ABSTAIN | 1 127 ms |
| **belge kapsamlı** (`filters.fileIds`) | **125 ms** | 154 ms | COMPLETE (4 kanıt) | 74 ms |

Uyarılar birebir (yaygın sorgu):

```
RETRIEVAL_LANE_DEGRADED:primary:lane trigram failed: canceling statement due to statement timeout
RETRIEVAL_LANE_DEGRADED:contrary:issue-1:outcome_flip:lane trigram failed: …
RETRIEVAL_LANE_DEGRADED:contrary:issue-1:dissent:lane trigram failed: …
```

L-VERIFY 47 068 ms ölçmüştü; bu makinede aynı şekil **59 458 ms** çıktı
(dört şerit × 15 sn, cevabın 60 sn'lik bütçesinin tam kenarında). **Avukatın
günlük yolu etkilenmiyor** (belge kapsamlı soru 125 ms) — kırılan korpus
aramasıdır. V-1 aynen yeniden üretildi.

### 1.3 ÖNCE — şekil B, gerçek HTTP, n=3

(Bu tur için varsayılanlar geçici olarak W14 öncesine çekildi —
`trigramFallbackMinHits: 0`, `trigramBudgetMs: 0` — ölçüm alındı ve
dosyalar **birebir geri yüklendi**; `diff` ile doğrulandı.)

| Sorgu | p50 | p95 | durum | bozulan şerit |
|---|---:|---:|---|---:|
| `depozito iadesi` | **49 368 ms** | 53 467 ms | COMPLETE (8 kanıt) | 3 |
| `zamanasimi suresi` | 45 102 ms | 45 109 ms | ABSTAIN | 3 |
| uzun soru | **64 319 ms** | 65 676 ms | **PARTIAL** (60 sn cevap bütçesi aşıldı) | 3 |

---

## 2. `EXPLAIN (ANALYZE, BUFFERS)` — şeridin kendi SQL'i

Şekil A, `pg_trgm.word_similarity_threshold = 0.5`, işlem-yerel
`statement_timeout` 600 sn'ye çekildi ki plan tamamlanabilsin.

| Sorgu / ayar | Plan | Süre |
|---|---|---:|
| **doymuş** `depozito iadesi`, `enable_seqscan=off` (**ürün yolu**) | `Bitmap Index Scan on chunks_search_trgm rows=20000` → `Bitmap Heap Scan` (`Heap Blocks: exact=3334`), `Filter: 'depozito iadesi' <% search_text` | **16 916 ms** |
| aynı, `enable_seqscan` **açık** | **aynı bitmap yolu** | 18 182 ms |
| **doymuş** `zamanaşımı süresi`, `enable_seqscan=off` | `Bitmap Index Scan rows=20000` | 17 033 ms |
| **seçici** `kuantum mekaniginde dalga fonksiyonu`, `enable_seqscan=off` | `Bitmap Index Scan rows=0` | **0,329 ms** |
| aynı seçici, `enable_seqscan` **açık** | **yine bitmap** | 0,435 ms |

İki okuma:

* **Doymuş uçta `enable_seqscan` ayarının maddi bir etkisi yok** (16,9 ↔ 18,2 sn)
  — aday kümesi zaten 20 000/20 000. L-FIX §6 ve L-VERIFY §2.2 üçüncü kez
  doğrulandı.
* **Bu probe'ta seçici sorguda da planlayıcı indeksi kendiliğinden seçti**,
  yani L-VERIFY'ın seçici vakada ölçtüğü 18 210 ms → 1,87 ms (≈9 700×)
  seqscan etkisini **yeniden üretemedim** — bu korpusun istatistikleri
  farklı. Çekiç yine de **kalıyor**: kaldırmak L-ANSWER'ın ve L-VERIFY'ın
  ölçtüğü vakaları geriletir, iyileştirdiği ölçülmüş bir vaka yoktur.

> **[03.09.2026 · W14-C-FINAL eşik çekincesi — sonradan eklendi; yukarıdaki
> metin ve sayılar DEĞİŞTİRİLMEDİ.]**
> Bu tablonun bütün satırları — **seçici sorgudaki 0,329 ms dâhil** —
> §2'nin giriş cümlesinde yazdığı gibi
> **`pg_trgm.word_similarity_threshold = 0,5`** ile ölçüldü.
> **Ürünün cevap yolu bu eşikle koşmaz:**
> `DEFAULT_ANSWER_LIMITS.trigramMinSimilarity`
> (`control-plane/src/api/answerService.ts`) **0,35**'tir ve
> `clampAnswerLimits` onu yalnız YUKARI çekebilir, yani `/v1/answer` şeridi
> hiçbir zaman 0,5 ile çalışmaz. F-VERIFY §2.3 aynı sorguyu ürünün kendi
> eşiğinde ölçtü ve **18 069 ms** buldu (`Bitmap Index Scan rows=20000`,
> `Rows Removed by Filter: 20000`); orada aynı sorgunun uçtan uca maliyeti
> **≈18 sn**'dir. Dolayısıyla yukarıdaki **0,329 ms** ve L-VERIFY'ın
> **1,87 ms / ≈9 700×** satırı `/v1/answer` için alıntılanamaz.
> C-SRV §6.2 üçüncü bir korpusta bunun da tersini ölçtü (her iki eşikte de
> `rows=0`, 1–8 ms; `enable_seqscan` sekiz hücrenin hiçbirinde fark
> yaratmadı). Üç ölçümün birlikte söylediği şey: bu rakamlar **belirli bir
> korpusun belirli bir sorguyla trigram örtüşmesinin** özelliğidir, eşiğin ya
> da `TRIGRAM_SEQSCAN_SETTING` çekicinin özelliği değildir; hiçbiri ürün
> sayısı olarak sunulamaz. Bu paragrafın ana tespiti — **çekicin kalması
> doğrudur, kaldırmak ölçülmüş bir vakayı geriletir** — değişmedi.
> Güncel satır: STATUS **S26⁗**.

---

## 3. Değerlendirilen seçenekler ve seçim

### (a) Sınırlı "arama anahtarı" sütunu — **ölçüldü, GÖNDERİLMEDİ**

Aynı 20 000 satırda, yalnız taranan metin uzunluğu değişerek:

| `<%` şuna karşı | Süre |
|---|---:|
| `left(search_text, 250)` | **866 ms** |
| `left(search_text, 500)` | 1 826 ms |
| `left(search_text, 1000)` | 3 774 ms |
| `left(search_text, 2000)` | 8 235 ms |
| tam `search_text` (~4 974) | **17 725 ms** |

17 725 ms / 20 000 satır / 4 974 kod noktası = **0,178 µs / kod noktası /
satır**. L-FIX'in 0,17'si birebir doğrulandı: maliyet doğrusal ve tamamen
aday metin üzerindeki trigram çıkarımıdır.

**Neden gönderilmedi.** Hızlı, çünkü **pasajın geri kalanına bakmıyor**:
n. kod noktasından sonra geçen bir ifade artık bulunamaz — sessiz bir recall
kaybı, ve bu hattın kabul ölçütü bunu yasaklıyor. Üstelik kapı, doymuş vakada
maliyeti **866 ms'ye değil sıfıra** indiriyor (şerit hiç koşmuyor: 1 253 ms
toplam pipeline). Yani (a) hiçbir şey kazandırmadan bir recall kaybı satın
alırdı. Denendi, ölçüldü, yazıldı, **girmedi**.

### (b) Şeridi gerçek bir FALLBACK yapmak — **GÖNDERİLDİ**

`hybrid.ts`: `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS = 8`. Exact + lexical
şeritlerinin ürettiği **ayrık** pasaj sayısı 8'in altındaysa şerit koşar,
değilse koşmaz.

* **Neden sağlam.** `chunkStore.ts` bu şeridin adını zaten "(b) Trigram
  fallback lane" koymuş ve işini dar tanımlamış: **stemmer'ın** yakalayamadığı
  ifade isabetlerini, her şeyden önce Türkçe noktalı/noktasız I biçimlerini
  kurtarmak. Bir sorgunun trigramları GIN indeksini doyuruyorsa, o sorgunun
  sözcükleri de o korpusta her yerdedir ve FTS şeridi onu ilk ve tam olarak
  cevaplar. Tersine, şeridin var olma sebebi olan vaka (bir sorgu jetonunu
  stemmer eşleyemiyor) FTS şeridini **eksik** bırakır — kapıyı açan da budur.
* **Neden 8.** Cevabın kendi kanıt tavanı (`AnswerPipeline.maxEvidence = 8`).
  Birincil şeritler cevabın gösterebileceği kadar ayrık pasaj ürettikten
  sonra bir fallback şeridi okuyucunun gördüğünü ancak **yeniden sıralayarak**
  değiştirebilir, ve bu şerit onun için değil.
* **Ne kaybettiriyor, dürüstçe.** Bu bir **recall değişikliğidir**, saf bir
  optimizasyon değil: birincil şeritlerin sekiz veya daha fazla pasaj
  döndürdüğü **ve** dokuzuncu pasaja ancak bulanık eşleşmeyle ulaşılabilecek
  bir sorguda o pasaj artık gelmiyor. Gold küme üzerinde ölçülen etkisi
  §6'da.
* **Sessiz değil.** `SearchPipelineResult.trigram` (yeni, additive) her sorgu
  için `SKIPPED_PRIMARY_SUFFICIENT` / `EXECUTED_FOUND` /
  `EXECUTED_NONE_FOUND` / `BUDGET_EXCEEDED` / `FAILED` / `DISABLED` ile
  birlikte `primaryHits`, `fallbackMinHits`, `admitted`, `budgetMs` taşıyor —
  `divergence` ve `citator` raporlarının aynı kuralı: "bulamadı" ile
  "hiç koşmadı" farklı cevaplardır.

### (c) Şerit başına duvar bütçesi — **GÖNDERİLDİ**

`chunkStore.ts`: `DEFAULT_TRIGRAM_BUDGET_MS = 2 500`, işlem-yerel
`statement_timeout` olarak uygulanıyor (sadece **düşürür**; bağlantının
kendi sınırının üstünde bir bütçe yok sayılır). Kesinti tipli:
`TrigramBudgetExceededError` (`code = TRIGRAM_BUDGET_EXCEEDED`) — sürücünün
"canceling statement due to statement timeout" cümlesi artık uyarıya
geçmiyor, yerine bütçenin **kendisi** yazılıyor.

Kesintinin gerçekten anında olduğu ölçüldü (aynı sorgu, 3 koşu):

| Bütçe | Ölçülen duvar süresi |
|---|---|
| 2 500 ms | 2 549 / 2 517 / 2 511 ms |
| 1 000 ms | 1 013 / 1 008 / 1 015 ms |
| yok (bağlantının 15 sn'si) | 15 001 / 15 015 / 15 013 ms |

2 500 ms keyfi değil, **ölçülen maliyet modeline** karşı seçildi: 0,178 µs /
kod noktası / satır ile 2,5 sn kabaca 2 500 kod noktalık 6 000 satırdır — bu
makinede ölçülen her seçici sorgunun (0,33 ms) çok üstünde, avukatı
bekletmenin çok altında.

---

## 4. SONRA — ölçülen sonuç

### 4.1 Şerit düzeyi A/B (şekil B, aynı süreç, `searchPipeline`)

| Sorgu | ÖNCE (kapı yok, bütçe yok) | SONRA | `trigram.outcome` (sonra) | şerit arızası (sonra) |
|---|---:|---:|---|---:|
| `depozito iadesi` | 16 428 ms | **1 253 ms** | `SKIPPED_PRIMARY_SUFFICIENT` | 0 |
| `depozito iadesi "aksi yönde"` (karşıt şerit) | 16 338 ms | **1 335 ms** | `SKIPPED_PRIMARY_SUFFICIENT` | 0 |
| `depozito iadesi "karşı oy"` (karşıt şerit) | 16 361 ms | **5 488 ms** | `SKIPPED_PRIMARY_SUFFICIENT` | 0 |
| `zamanasimi suresi` (FTS hiçbir şey bulamıyor) | 15 035 ms | **2 538 ms** | `BUDGET_EXCEEDED` (dürüst uyarı) | 1 |
| `kuantum mekaniginde dalga fonksiyonu` (seçici) | 460 ms | **407 ms** | `EXECUTED_NONE_FOUND` | 0 |

Son satır önemli: **şerit kapatılmadı.** Birincil şeritler eli boş dönünce
trigram şeridi eskisi gibi koşuyor — fallback'in var olma sebebi orada.

### 4.2 `POST /v1/answer`, gerçek HTTP

**Şekil B (gerçekçi korpus), n=5 / doğrulama turu n=3:**

| Sorgu | ÖNCE p50 | SONRA p50 | SONRA p95 | SONRA durum | bozulan şerit |
|---|---:|---:|---:|---|---:|
| `depozito iadesi` | **49 368 ms** | **15 800 ms** (n=3 doğrulama: 15 756) | 16 626 ms | COMPLETE, 8 kanıt | **0** |
| `zamanasimi suresi` | 45 102 ms | **7 610 ms** | 7 630 ms | ABSTAIN | 3 (bütçe, dürüst) |
| uzun soru | **64 319 ms / PARTIAL** | **17 558 ms** (n=3: 17 472) | 18 212 ms | **COMPLETE, 8 kanıt** | **0** |
| seçici | — | 1 328 ms | 1 402 ms | ABSTAIN | 0 |
| belge kapsamlı | — | **64 ms** | 68 ms | COMPLETE, 4 kanıt | 0 |

**Şekil A (L-VERIFY'ın şekli — korpusta aranabilir hiçbir şey yok), n=5:**

| Sorgu | ÖNCE p50 | SONRA p50 | SONRA p95 |
|---|---:|---:|---:|
| işaret cümlesi | 30 906 ms | **7 083 ms** | 7 113 ms |
| `depozito iadesi` | 59 458 ms | **20 719 ms** | 21 967 ms |
| `zamanasimi suresi` | 45 121 ms | **7 613 ms** | 7 640 ms |
| uzun soru | 65 978 ms | **23 120 ms** | 23 577 ms |
| seçici | 1 251 ms | 1 318 ms | 1 440 ms |
| belge kapsamlı | 125 ms | **64 ms** | 69 ms |

Şekil A'da kapı **kapanmıyor** (lexical şeridi 0 satır döndürüyor, çünkü
korpusta aranabilir belge yok), yani kazancın tamamı bütçeden geliyor:
15 sn × 3–4 yerine 2,5 sn × 3–4.

---

## 5. V-2 — `answers_filescope_gin` artık kullanılıyor

### 5.1 Üç predikat şekli, ölçülmüş plan (2 140 cevaplı probe)

```
-- (a) ÜRÜNÜN ESKİ predikatı: a.result @> {"fileScope":{"fileIds":["…"]}}
   Seq Scan on answers a  (rows=16) Rows Removed by Filter: 2124
   Execution Time: 12.190 ms

-- (b) ÜRÜNÜN YENİ predikatı: a.result -> 'fileScope' @> {"fileIds":["…"]}
   Bitmap Index Scan on answers_filescope_gin
   Index Cond: ((result -> 'fileScope'::text) @> '{"fileIds": ["…"]}'::jsonb)
   Execution Time: 0.780 ms          <-- 15,6x, AYNI 16 SATIR

-- (c) MİGRASYON YORUMUNUN yazdığı predikat: a.result -> 'fileScope' @> ["…"]
   Bitmap Index Scan on answers_filescope_gin
   Execution Time: 0.296 ms   ama rows=0   <-- indeksi kullanır, HİÇBİR ŞEY EŞLEŞMEZ
```

(İlk, 2 000 cevaplı ölçüm: (a) 1,683 ms / `Rows Removed: 2024`, (b) 0,890 ms,
ikisi de aynı 6 satır; (c) 0,029 ms / 0 satır.)
`pg_stat_user_indexes.idx_scan` düzeltmeden önce **0**'dı — indeks vardı,
ürün onu hiç kullanmamıştı.

`GET /v1/answers?fileId=` uç düzeyinde, düzeltmeden sonra, n=10:
**p50 3 ms / p95 14 ms** (ilk çağrı soğuk).

### 5.2 Migrasyon yorumu: yeni dosya değil, **yorum düzeltmesi** — gerekçe

Brief iki seçenek bırakmıştı. **Yorum düzeltmesi** seçildi, çünkü:

1. **Yeni bir migrasyon bu hattın dosya sahipliğiyle mümkün değil.**
   `tests/ingestion/test_migrations_ledger.py` sınır sonrası migrasyon
   listesini **birebir** sabitliyor
   (`[MATTERS_MIGRATION, AI_AUDIT_MIGRATION, HEARING_MIGRATION]`) ve
   "hiçbir probe iki dosya arasında paylaşılmaz" diyor; bir dosya eklemek o
   testi, ayrıca `CLAUDE.md`/`STATUS.md`/`db_local_check.py`'deki **13/15**
   sayımlarını değiştirmeyi gerektirir. Bunların hiçbiri bu hattın dosyası
   değil.
2. **Yalnızca yorum içeren bir migrasyon geçerli bir ledger sentinel'i
   taşıyamaz.** ADR-020 probe'un "migrasyonun KENDİ yarattığı" bir nesneyi
   adlandırmasını şart koşuyor; bir `comment on` hiçbir şey yaratmaz. Yeni
   bir sentinel türü eklemek `ingestion/migrations.py` **ve**
   `control-plane/src/store/health.ts`'i (bu hattın dosyası değil) birlikte
   değiştirmeyi gerektirirdi — bir metin dizesi için kötü bir takas.
3. **Kusur belgedir ve okuyucusu depoyu okuyan geliştiricidir.** Dosyanın
   çalıştırılabilir SQL'i değişmedi (`create index if not exists` aynı,
   sentinel'ler aynı), ledger dosya **adına** göre kayıt tutuyor (sağlama
   yok — `ingestion/migrations.py` okundu), yani hiçbir veritabanının durumu
   bu düzenlemeye bağlı değil ve `--ensure-db` mevcut bir veritabanında yine
   hiçbir şey uygulamıyor.

**Kalan, açıkça yazıyorum:** dosyayı **zaten uygulamış** bir veritabanı
(örneğin `collex_local`) `comment on index` metnini **eski, yanlış hâliyle**
taşımaya devam eder. Bunu hiçbir kod yolu okumaz; `psql \d+` ile bakan kişi
depodaki düzeltilmiş dosyaya sahiptir. Yeniden kurulan her veritabanı doğru
yorumu alır.

Dosyanın başlığındaki yanlış şekil **silinmedi**, `[WRONG]` işaretiyle
korundu: bir sonraki okuyucu neden yanlış olduğunu yeniden keşfetmek zorunda
kalmasın diye. Test bunu da sabitliyor.

---

## 6. Gold metrikleri: gerilemedi — ve kımıldayan üç satır

`scripts/run_evals.py --run-date 2026-09-02` **aynı ağaç üzerinde** iki kez
koşuldu: bir kez varsayılanlar W14 öncesine çekilerek (`ÖNCE`), bir kez
gönderilen hâliyle (`SONRA`). Tek elmayla elma karşılaştırması budur.

**Birebir aynı olanlar (tam liste):** Recall@5 **0,9429** · Recall@10/@20
**1,0000** · nDCG@10 **0,9156** · MRR **0,9024** · exact-reference / kısaltma
/ tam ad doğruluğu **%100** · kısaltma paritesi **%100** · **temporal
doğruluk %100** (n=6) · **karşıt otorite recall 1,0000** (n=3) · çekimserlik
kesinliği %100, recall %92,3 · cevap katmanı çekimserlik kesinliği/recall
%100 · **cevap katmanı YANLIŞ çekimserlik 0** · atıf çözülebilirliği **%100**
(128 pasaj) · alıntı/hash bütünlüğü **35/35** · uydurma kimlik **0** ·
kiracı sızıntısı **0** · beklenen gold birimi atıfta **%95,2** ·
**şerit dağılımı `exact=36, lexical=67, trigram=5, dense=0, relation=17,
citation=12`** — trigram dâhil, **rakam rakam aynı**. Altı sert kapının
altısı da her iki turda **PASS**.

**Kımıldayanlar (yalnız cevap katmanı, 34 satırın 3'ü):**

| Ölçüm | ÖNCE | SONRA |
|---|---:|---:|
| Durum dağılımı | ABSTAIN 14 · COMPLETE 11 · PARTIAL 3 · QUALIFIED 6 | ABSTAIN 13 · COMPLETE 13 · PARTIAL 3 · QUALIFIED 5 |
| Cevap düzeyi yanlış çekimserlik | **1** (`fx-amend-002`) | **0** |
| Kesinleştirilebilir | 17/21 (%81,0) | 18/21 (%85,7) |

Satır satır, **kendi lehime olmayan yarısı dâhil**:

* `fx-amend-002`: ÖNCE **ABSTAIN** (yanlış çekimserlik), SONRA **COMPLETE**.
  **Ama beklenen gold birimini iki turda da atıfta göstermiyor**
  (`expected_in_evidence: false`). Yani bu satır için "düzeldi" **demiyorum**:
  yanlış bir çekimserliğin yerine, beklenen kaynağı göstermeyen bir COMPLETE
  cevap geçti. "Beklenen gold birimi atıfta" oranı bu yüzden **%95,2 ile
  değişmedi**.
* `fx-amend-003`: QUALIFIED → COMPLETE; **üç `CONFLICTING_AUTHORITIES`
  kalemi düştü**. Bu bir kayıptır ve öyle yazıyorum.
* `fx-fact-001`: QUALIFIED → QUALIFIED, ama çelişki kalemi **2 → 3**'e çıktı.
* `fx-contrary-001` ve `fx-contrary-002` (asıl karşıt otorite satırları) her
  iki turda da çelişki bildiriyor, ve n=3'lük **karşıt otorite kapısı
  1,0000 ile değişmedi**.

**Bir uyarı daha.** L-VERIFY kendi turunda (kapı henüz yokken) %85,7 ve 0
yanlış çekimserlik ölçmüştü; benim aynı-ağaç ÖNCE turum %81,0 ve 1 ölçüyor.
Yani ağaç L-VERIFY'ın turundan bu yana değişmiş (bu dalgada **iki hat daha
paralel çalışıyor**). Bu raporda karşılaştırdığım tek şey **kendi ÖNCE/SONRA
turlarımdır**; L-VERIFY'ın sayılarıyla aradaki farkı bana ait saymıyorum ve
kök nedenini izlemedim.

---

## 7. Kapanmayan yarı — tavan, sayıyla

20 000 parçalık korpusta cevap hâlâ **15–17 saniye** sürüyor ve kalan maliyet
**trigram şeridi değil**. Ölçüldü (şekil B, ürünün kendi `lexicalSearch`
çağrısı):

| Sorgu | lexical şeridi tek başına | dönen satır |
|---|---:|---:|
| `depozito iadesi` | **3 229 ms** | 50 |
| `depozito iadesi "aksi yönde"` | **3 427 ms** | 50 |
| `depozito iadesi "karşı oy"` | **1 559 ms** | 50 |

Kök neden: coverage kipi her aday satır için
`cardinality(array(select unnest(q.lex) intersect select unnest(tsvector_to_array(search_tsv_tr))))`
hesaplıyor; 5 kB'lik bir parçanın tsvector'ünü diziye çevirmek pahalı ve
`'depozito' | 'iade'` gibi bir OR tsquery aday kümesini neredeyse tüm korpusa
açıyor.

**Denedim ve gönderme değeri çıkmadı:** `matched` ifadesini `LATERAL` ile bir
kez hesaplamak — 1 291 ms → 1 226 ms (**%5**), sonuç kümesi ve coverage
değerleri **birebir aynı**. PostgreSQL zaten iki kez hesaplamıyor. Ölçüldü,
girmedi.

**Tavan, açıkça:** bu boyutta korpus araması için gereken şey bu şeridin de
aday kümesini daraltmasıdır (bir "minimum should match" indeksi ya da dense
şerit) — ikisi de bu hattın kapsamı dışında ve ikincisi bu makinede
kurulamayan pgvector'e bağlı. Şu an gönderilen hâliyle:

* **korpus sorusu 49 sn → 16 sn** ve artık cevap dönüyor (COMPLETE, 8 kanıt,
  0 bozulan şerit);
* **uzun soru 64 sn / PARTIAL → 17 sn / COMPLETE**;
* **avukatın günlük yolu (belge kapsamlı soru) 125 ms → 64 ms**;
* bir şerit yine de yetişemezse **2,5 saniyede** dürüst bir uyarıyla
  düşüyor, cevabın 60 sn'lik bütçesini yemiyor.

Kalan 15–17 saniye **ölçülmüş bir sayıdır ve iyi değildir**; kapatan hat bu
hat değildir.

---

## 8. Gerileme testleri — ve her birinin boşluk kanıtı

Kural: hiçbir test kusur geri konduğunda geçmemeli. Üçünü de fiilen geri
koydum, düşmelerini gördüm, sonra dosyaları `diff` ile birebir geri yükledim.

| Test | Neyi sabitliyor | Kusur geri konunca |
|---|---|---|
| `retrieval.test.ts` **(l) skips the lane when exact+lexical already produced enough passages** | Kapı kapanıyor: `SKIPPED_PRIMARY_SUFFICIENT`, `lanesAttempted` içinde `trigram` **yok**, şerit arızası yok, hiçbir hit trigram şeridi taşımıyor. Aynı testin içinde `trigramFallbackMinHits: 0` ile şerit **koşuyor** (boşluk kanıtı, testin kendi içinde). | `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS = 0` → **DÜŞTÜ** (`expected 'EXECUTED_FOUND' to be 'SKIPPED_PRIMARY_SUFFICIENT'`) |
| `retrieval.test.ts` **(l) still runs the lane when the primary lanes came up short** | Fallback hâlâ fallback: birincil şeritler 8'in altında kalınca şerit koşuyor, `EXECUTED_FOUND`, pasajları füzyon listesinde. | `= 0` → **DÜŞTÜ** (`expected 3 to be less than 0`) |
| `retrieval.test.ts` **(l) the lane has its own wall budget and says so when it is cut** | Varsayılan bütçe > 0 ve pipeline'ın şeride verdiği bütçe o; 1 ms bütçe `TrigramBudgetExceededError` / `TRIGRAM_BUDGET_EXCEEDED` veriyor; **aynı çağrı `budgetMs: 0` ile başarılı** (boşluk kanıtı); kesilen şerit **kapsanmış** bir arıza, uyarı metninde sürücünün "statement timeout" cümlesi **yok**. | `DEFAULT_TRIGRAM_BUDGET_MS = 0` → **DÜŞTÜ** (`expected 0 to be greater than 0`) |
| `persistence.test.ts` **answers: list({fileId}) is served by answers_filescope_gin, not a Seq Scan** | (1) **Ürünün kendi** `list({fileId})` çağrısı `pg_stat_user_indexes.idx_scan` sayacını ilerletiyor (elle yazılmış bir SQL kopyası değil, ürünün sorgusu); (2) üç predikat şekli yan yana `EXPLAIN` ediliyor — yeni şekil bitmap + 2 satır, eski şekil `Seq Scan`, migrasyon yorumunun şekli bitmap + **0 satır**; (3) migrasyondaki reçete satırı düzeltilmiş. | `answerStore.ts` predikatı eski hâline döndürüldü → **DÜŞTÜ** (`expected 0 to be greater than 0`) |

Notlar:

* (l) testleri için `collex_answer_test` probe korpusuna, dağarcıkta
  bulunmayan sözcüklerden kurulu ve **tam 3 parçada** geçen bir ifade
  (`kambiyo senedi zayi`) eklendi: kapının **açık** tarafını deterministik
  yapan şey budur. Aynı dosyadaki eski "20 parçada geçer" yorumu da
  düzeltildi — ifade 40 parçalık belgenin her 5.'sinde, yani **8** parçada
  geçiyor.
* V-2 testi 1 000 satırlık bir dolgu ekleyip `analyze` çalıştırıyor ve
  **hiçbir planlayıcı ayarı zorlamıyor**: planı ürünün gerçek bir tabloda
  kendiliğinden seçtiği hâliyle ölçüyor.
* V-2 testi kendi `max:1` bağlantısında koşuyor ve `describe` bloğunun
  **sonunda** duruyor. İlk yerleşiminde (blok ortası, paylaşılan havuz)
  `drafts: every put appends a version …` testini **deterministik olarak**
  düşürdü — sebebi §10'da, ve o bu hattın dosyası değil.

---

## 9. Bu koşuda çalıştırılan komutlar

| Komut | Sonuç | Exit |
|---|---|---:|
| `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | 0 |
| `control-plane> npx vitest run` | **102 dosya · 2 086 geçti · 0 DÜŞTÜ · 6 atlandı (2 092)** · 24,49 sn | 0 |
| `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 339 passed** · 131,79 sn | 0 |
| `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 PASS** · `RESULT: PASS` | 0 |
| `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS** (6/6 sert kapı) | 0 |

6 atlamanın altısı da bilinen **ters işaretleyicilerdir** ("ortam yok");
gerçek süitler koştu. `vitest` toplamı L-VERIFY'ın 2 047'sinden farklı çünkü
bu dalgada **iki hat daha paralel çalışıyor**; farkı kendime mal etmiyorum,
kendi eklediğim 4 testi sayıyorum.

---

## 10. Açık kalan kalemler (bu hattın dosyası değil)

1. **`PgDraftStore.put` arka plan yazımlarını anahtar başına sıraya
   koymuyor.** Aynı `(draftId, version)` için ardışık iki `put`, havuz
   zamanlaması değişince **ters sırada** commit olabiliyor ve son çağrının
   gövdesi kayboluyor. Bu hattın testini `describe` bloğunun ortasına
   koyduğumda `drafts: every put appends a version …` testi
   **deterministik olarak** düştü (`'Dava Dilekçesi v2'` ≠
   `'Dava Dilekçesi v2 (yeniden)'`, `warm` yolunda, yani **veritabanındaki
   satır** yanlıştı). Testi bloğun sonuna ve kendi bağlantısına taşıyarak
   yan etkiyi kaldırdım, **kusuru kaldırmadım**.
   Dosya: `control-plane/src/store/draftStore.ts` (aynı şekil
   `answerStore.ts`'te de var). Sahibi bu hat değil.
2. **`SearchPipelineResult.trigram` raporu hiçbir yüzeye çizilmiyor.**
   Kapı artık ölçülebilir; konsolun "Teknik ayrıntılar" bloğu
   `SKIPPED_PRIMARY_SUFFICIENT` / `BUDGET_EXCEEDED` ayrımını gösterebilir.
   B-27'nin uyarı bütçesi gereği bu **ana akışta bir uyarı bloğu olmamalı**.
   Dosyalar: `control-plane/src/pipeline/answerPipeline.ts`,
   `control-plane/public/console.html`.
3. **`STATUS.md` "Ölçülen sayılar"** bu koşunun sayılarını taşımıyor.
   Önerilen satırlar §11'de.
4. **Kalan 15–17 sn** (§7) — lexical coverage şeridi. Ölçüldü, kapatılmadı.

`searchRequestSchema` iki yeni sınırı (`trigramFallbackMinHits`,
`trigramBudgetMs`) **kabul etmiyor** ve bu **bilerek böyle**: bir çağıran
kendi bütçesini yükseltememeli. Test bunu da sabitliyor (`INVALID_REQUEST`).

---

## 11. `STATUS.md` için önerilen ölçülen sayılar

| # | Komut / yüzey | Ölçülen çıktı (02.09.2026, F-PERF) |
|---|---|---|
| **S25′** | **B-06 · `/v1/answer`, 20 000 parçalık probe (`collex_perf_test`, ort. 4 974 kod noktası), gerçek HTTP** | **Gerçekçi korpus (1 900 public belge):** yaygın sözcük **p50 49 368 → 15 756 ms**, `ABSTAIN/3 bozuk şerit` → **COMPLETE / 8 kanıt / 0 bozuk şerit**; uzun soru **64 319 ms PARTIAL → 17 472 ms COMPLETE**. **Yalnız kiracı belgesi olan korpus (L-VERIFY şekli):** **59 458 → 20 719 ms**. **Belge kapsamlı soru 125 → 64 ms.** Şerit düzeyi: **16 428 → 1 253 ms** |
| **S26′** | **B-06 · trigram şeridi, aynı probe** | Doymuş sorgu `Bitmap Index Scan rows=20000` → recheck **16 916 ms** (`enable_seqscan` açık 18 182 ms — **fark yok**). Şerit artık FALLBACK (eşik **8**) ve **2 500 ms** duvar bütçesi altında; bütçe kesintisi ölçülen 2 511–2 549 ms. Maliyet modeli **0,178 µs / kod noktası / satır** |
| **S27′** | **B-32 · `GET /v1/answers?fileId=`** | Ürün predikatı `Seq Scan` **12,190 ms** (`Rows Removed: 2124`) → `Bitmap Index Scan on answers_filescope_gin` **0,780 ms**, **aynı 16 satır**; `idx_scan` 0 → ürünün kendi çağrısıyla ilerliyor. Uçta **p50 3 ms / p95 14 ms** (n=10) |
| **S2″** | `control-plane> npx vitest run` | **102 dosya · 2 086 geçti · 0 düştü · 6 atlandı** · 24,49 sn |
| **S6″** | `scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS**; bütün retrieval metrikleri ve şerit dağılımı W14 öncesi varsayılanlarla **birebir aynı**; cevap katmanı: yanlış çekimserlik **1 → 0**, kesinleştirilebilir **17/21 → 18/21** (§6'daki üç satırlık dürüstlük notuyla birlikte okunmalı) |

---

## 12. Hijyen

* Açtığım her sunucu kapatıldı. `netstat`: **8971'de dinleyici yok**;
  **8787/8898'e hiç dokunulmadı**. `COLLEX_DATA_DIR` scratch'e verildiği için
  depo `var/` altına **hiç pid dosyası yazılmadı** (doğrulandı).
* `collex_perf_test` kuruldu, ölçüldü ve koşu sonunda **düşürüldü**
  (`pg_database` listesiyle doğrulandı: geriye `collex_demo`,
  `collex_eval_test`, `collex_local`, `collex_mig_test`,
  `collex_quality_test`, `collex_retrieval_test` kaldı — hepsi başka
  sahiplerin kalıcı/scratch adları).
* **`collex_local`'a hiç bağlanılmadı**, hiç yazılmadı, düşürülmedi.
* Ölçüm için ürün dosyalarında yapılan **geçici** varsayılan değişiklikleri
  (üç kez) `diff` ile birebir geri aldım; her geri alıştan sonra
  `npx tsc --noEmit` ve ilgili süit yeniden koşuldu.
* Bütün geçici betikler ve çıktılar scratchpad'de
  (`…/scratchpad/w14f-F-PERF/`). Depoya sızan tek geçici dosya
  `control-plane/scripts/.perf-probe.mjs` idi; **ölçüm sırasında scratch'e
  taşındı** ve `control-plane/scripts/` içeriği doğrulandı.
* Supabase/Resend'e dokunulmadı, `.env` okunmadı, git işlemi yapılmadı,
  MCP yüzeyi (54) değişmedi, API'ye yalnız **additive** alan eklendi
  (`SearchPipelineResult.trigram`).

### Değişen depo dosyaları

```
control-plane/src/store/chunkStore.ts          (bütçe + tipli hata + gerekçe)
control-plane/src/retrieval/hybrid.ts          (fallback kapısı + TrigramReport)
control-plane/src/store/answerStore.ts         (V-2 predikatı)
supabase/migrations/20260903100000_ai_audit_and_scale_indexes.sql   (YALNIZ yorum)
control-plane/tests/store/retrieval.test.ts    (blok (l), 4 test + probe ifadesi)
control-plane/tests/store/persistence.test.ts  (V-2 plan testi)
docs/implementation/waves/W14-F-PERF.md        (bu dosya)
evals/reports/fixture_baseline_2026-09-02.{json,md}   (eval kapısının kendi çıktısı)
```
