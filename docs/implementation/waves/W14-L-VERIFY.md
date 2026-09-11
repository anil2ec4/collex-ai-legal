# W14 — L-VERIFY (Faz B3): ölçüm, ölçek, felaket tatbikatı ve avukat yürüyüşü

**Tarih:** 02.09.2026 · **Tip:** DENETİM — bu hat **hiçbir ürün dosyasına
dokunmadı**; tek yazılan dosya bu rapordur. Hiçbir git işlemi yapılmadı,
`.env` okunmadı, Supabase/Resend'e dokunulmadı.
**Portlar:** 8953 (sunucu) · 8963 (MCP geçidi) — 8787/8898'e hiç dokunulmadı.
**Veritabanları:** `collex_demo` (yeniden kuruldu) · `collex_verify_test`
(bu hattın kendi probe'u; kuruldu, ölçüldü, **düşürüldü**).
`collex_local`'a **hiç bağlanılmadı**.
**Ekran görüntüleri:** 9 adet, `…/scratchpad/w14b-L-VERIFY/shots/` (depo dışı).

> Bu raporda yazan her sayı **bu koşuda bu makinede ölçüldü**. Ölçmediğim hiçbir
> şey için hüküm vermedim; ölçemediğim yerleri "ölçülmedi" diye yazdım.
> Ölçek sayıları **SENTETİK** probe korpusundadır ve hukukî kalite ölçüsü
> değildir.

---

## 0. Yönetici özeti

Sekiz komutun **sekizi de exit 0** verdi ve tek bir düşen test yok — Faz B2
kapanışında (STATUS S2) duran bir düşük test artık geçiyor. Ürünün W14'te
söz verdiği en sert şeyler **gerçekten çalışıyor**: alıntı bütünlüğü kapısı
tarayıcıda tahrifatı yakaladı (`QUOTE_ALTERED`), nihai DOCX **A4 ve
biçimli** çıktı ve içinde tek bir makine dizesi yok, uyarı bütçesi gerçek bir
cevap ekranında **3 blok / 7 cümle / 0 tekrar** ölçüldü, çözülemeyen künye
hücresi **boş**, ve **felaket tatbikatı ilk kez uçtan uca koştu**: veri
yazıldı, yedeklendi, veritabanı **yok edildi**, geri yüklendi, asıllar
**bayt bayt** ve bütün tablolar **satır satır** aynı geldi.

Buna karşılık ölçek ve seam tarafında beş gerçek kusur var. En ağırı yeni
değil ama **ilk kez uçtan uca HTTP'de ölçüldü**: 20 000 parçalık bir korpusta
yaygın bir sözcükle sorulan korpus sorusu **47,1 sn** sürüyor ve **hiçbir
cevap dönmüyor** (`ABSTAIN`). Yeni olan dördü şunlar: B-32'nin GIN indeksi
üründe **hiç kullanılmıyor**; `--with-mcp` açıkken bile "Karar ara" ekranı
**502** dönüyor ve avukata zaten yaptığı şeyi tavsiye ediyor;
`COLLEX_DATA_DIR` kullanan bir kurulumda **"Aslını indir" her zaman 404**;
ve aktif dosya seçilmemişken hesaplanan süre **kaybediliyor**, ekranda
yalnız `HTTP 404` yazıyor.

---

## 1. Tam ölçüm turu (sıralı ve tek başına)

Sekiz komut sırayla, başka hiçbir şey koşmadan çalıştırıldı. **Hiçbiri
düşmedi**, dolayısıyla "üç kez tekrarla, gerçek mi çekişme mi ayır" adımına
gerek kalmadı.

| # | Komut | Ölçülen çıktı | Exit |
|---|---|---|---:|
| V1 | `cd control-plane && npx tsc --noEmit` | **temiz** (çıktı yok) | 0 |
| V2 | `cd control-plane && npx vitest run` | **102 dosya · 2 047 geçti · 0 DÜŞTÜ · 6 atlandı (2 053)** · 26,71 sn | 0 |
| V3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 339 passed** · 133,52 sn | 0 |
| V4 | `.venv/Scripts/python.exe scripts/smoke_check.py` | `offline smoke checks passed: 54 tools, court inventory, shared limiter, disabled-key errors, HTTP auth` | 0 |
| V5 | `.venv/Scripts/python.exe scripts/http_e2e_check.py` | `authenticated HTTP MCP handshake passed: 54 tools` | 0 |
| V6 | `.venv/Scripts/python.exe scripts/live_local_gateway_check.py` | `PASS tools/list — exactly 54 tools (offline surface)`; `/health tools_count:54` | 0 |
| V7 | `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 PASS** (`collex_mig_test`, 13 migrasyon) · `RESULT: PASS` | 0 |
| V8 | `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS** (aşağıda ayrıntı) | 0 |
| V9 | `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** (S1 8/8 · S2 8/8 · S3 7/7 · S4 7/7 · S5 7/7 · S6 10/10) | 0 |

### 1.1 vitest'in 6 atlaması — ters işaretleyicilerin doğrulaması

Atlayan 6 test tam olarak beklenen altı dosyadadır ve her biri o dosyanın
**"ortam yok" işaretleyicisidir**; gerçek süitler koştu:

```
tests/matters/pg.test.ts            10 tests | 1 skipped   2 175 ms
tests/drafting/real-export.test.ts   2 tests | 1 skipped   3 015 ms
tests/store/persistence.test.ts     23 tests | 1 skipped   4 242 ms
tests/integration/backup.test.ts    11 tests | 1 skipped   4 620 ms
tests/integration/real-exec.test.ts  3 tests | 1 skipped   5 268 ms
tests/integration/serve.test.ts      5 tests | 1 skipped  25 732 ms
```

**STATUS S2 ile fark:** L-DOCS turunda `console.test.ts > W14 B-21 … ships the
grid view` düşüyordu (eşzamanlı konsol hattı yüzünden). Bu turda **düşen test
yok** ve toplam 2 028 → **2 047**.

### 1.2 Eval kapısı (V8) — altı sert kapı ve rapor amaçlı satırlar

| Ölçüm | Değer |
|---|---|
| Recall@5 / @10 / @20 | **0,9429 / 1,0000 / 1,0000** |
| Karşıt otorite recall (n=3) | 1,0000 |
| Çekimserlik recall (n=13) | 92,3 % |
| Cevap katmanı çekimserlik recall | **100 %**, `missed=none` |
| Cevap katmanı YANLIŞ çekimserlik (TRIPWIRE) | **0** |
| Atıf çözülebilirliği (KAPI) | **%100**, 128 sıralı isabet |
| Alıntı/hash bütünlüğü | **35/35** |
| Uydurma kimlik / kiracı sızıntısı | **0 / 0** |
| Cevap düzeyi durumlar | ABSTAIN=13 · COMPLETE=12 · PARTIAL=3 · QUALIFIED=6 |
| Kesinleştirilebilir oran (rapor amaçlı) | **%85,7 (18/21)** |
| Beklenen gold birimi atıfta | %95,2 |
| Retrieval p50 / p95 | **8,5 / 20,8 ms** |
| Kanıt paketi p50 / p95 | 0,3 / 1,3 ms |
| Şerit dağılımı | exact=36 · lexical=67 · trigram=5 · dense=0 · relation=17 · citation=12 |

**STATUS S6 ile fark:** L-DOCS turu %81,0 (17/21) ve **1 yanlış çekimserlik**
(`fx-amend-002`) ölçmüştü; bu turda **%85,7 (18/21)** ve **0 yanlış
çekimserlik**. Faz B'de inen bir düzeltme bu satırı kapatmış görünüyor;
kök nedeni bu hatta izlenmedi, yalnız yeniden ölçüldü.

---

## 2. Ölçek — 20 000 parçalık kendi probe'um

**Probe kurulumu** (`collex_verify_test`, koşu sonunda düşürüldü):
2 000 kiracı `UPLOAD` belgesi × 10 parça = **20 000 parça**, ortalama
`search_text` **4 976 kod noktası**, `legal.chunks` yığın **5 000 kB**,
toplam (TOAST dâhil) **301 MB**, `chunks_search_trgm` **31 MB**;
**2 000** `app_private.answers` satırı (her biri `result.fileScope.fileIds`
taşır); **200** dosya × 5 kayıt.

> Bu korpus **üretilmiştir**. Sözcük dağarcığı 200 sözcüklük bir listeden
> gelir, yani trigram çeşitliliği gerçek Türk hukuk metninin çeşitliliği
> **değildir**; doymuş uçta ölçtüğüm her sayı bu yüzden bir **üst sınır**
> senaryosudur, bir "üründe böyle olacak" iddiası değildir.

### 2.1 B-06 — `/v1/answer`, gerçek HTTP, n=5

| Sorgu şekli | p50 | p95 | durum | gövde |
|---|---:|---:|---|---:|
| `Belge 17 paragraf 3 kaydi` (işaret cümlesi) | **47 242 ms** | 48 136 ms | ABSTAIN | 6 110 B |
| `depozito iadesi` (yaygın) | **47 068 ms** | 47 695 ms | ABSTAIN | 5 941 B |
| `zamanasimi suresi` (yaygın) | **47 662 ms** | 47 766 ms | ABSTAIN | 5 976 B |
| `kira sozlesmesinde depozito ne zaman iade edilir` (uzun) | **47 145 ms** | 48 047 ms | ABSTAIN | 6 048 B |

Tek bir cevabın işlem izi (13 aşama): `retrieve` **47 135,68 ms**, kalan on iki
aşama toplam **0,53 ms**. Uyarılar (birebir):

```
RETRIEVAL_LANE_DEGRADED:primary:lane trigram failed: canceling statement due to statement timeout
RETRIEVAL_LANE_DEGRADED:contrary:issue-1:outcome_flip:lane trigram failed: …
RETRIEVAL_LANE_DEGRADED:contrary:issue-1:dissent:lane trigram failed: …
```

**Belge kapsamlı soru aynı veritabanında hızlıdır:**
`filters.fileIds=[…], includeCorpus:false` → **145 / 147 / 221 ms** (3 koşu).
Yani avukatın günlük yolu (yüklediği belgeye soru) ölçekten etkilenmiyor;
etkilenen **korpus sorusu**dur.

### 2.2 B-06 — `EXPLAIN (ANALYZE, BUFFERS)`, ürünün kendi sorgusu

`statement_timeout` planın tamamlanabilmesi için işlem-yerel 300 sn'ye
çekildi; eşik `pg_trgm.word_similarity_threshold = 0.5`.

| Sorgu / ayar | Plan | Execution Time |
|---|---|---:|
| `depozito iadesi`, `enable_seqscan=off` (**ürün yolu**) | `Bitmap Index Scan on chunks_search_trgm rows=20000` → `Bitmap Heap Scan`, `Rows Removed by Filter: 289` | **34 154 ms** |
| aynı, `enable_seqscan` **açık** | aynı bitmap yolu | 33 789 ms |
| `zamanasimi suresi`, `enable_seqscan=off` | `Bitmap Index Scan rows=20000`, `Rows Removed: 363` | 33 950 ms |
| **seçici** (`kuantum mekaniginde dalga fonksiyonu`), `enable_seqscan=off` | `Bitmap Index Scan rows=0` | **1,87 ms** |
| aynı seçici sorgu, `enable_seqscan` **açık** | `Seq Scan`, `Rows Removed by Filter: 20000` | **18 210 ms** |

**Üç bağımsız korpusta üçüncü kez aynı sonuç.** `TRIGRAM_SEQSCAN_SETTING`
çekici:

* **seçici** sorguda **18 210 ms → 1,87 ms** (≈ 9 700×) — L-ANSWER'ın seçici
  korpusta ölçtüğü ≈490×'in aynı yönde, daha keskin hâli;
* **doymuş** sorguda **maddi fark yok** (34,2 sn açık ↔ 33,8 sn kapalı) —
  L-FIX §6'nın "aday kümesi zaten 20 000/20 000" tespiti aynen doğrulandı.

Yani çekicin kalması doğrudur ve kaldırmak ölçülmüş bir vakayı geriletir.
Ama **B-06'nın kapanmayan yarısı ölçekte bir P0 gibi davranıyor** — §5, V-1.

> **[03.09.2026 · W14-C-FINAL eşik çekincesi — sonradan eklendi; yukarıdaki
> metin ve sayılar DEĞİŞTİRİLMEDİ.]**
> Bu tablonun bütün satırları **`pg_trgm.word_similarity_threshold = 0,5`**
> ile ölçüldü (§2.2'nin kendi giriş cümlesi bunu söylüyor).
> **Ürünün cevap yolu bu eşikle koşmaz:**
> `DEFAULT_ANSWER_LIMITS.trigramMinSimilarity`
> (`control-plane/src/api/answerService.ts`) **0,35**'tir ve
> `clampAnswerLimits` onu yalnız YUKARI çekebilir — yani `/v1/answer` şeridi
> hiçbir zaman 0,5 ile çalışmaz. F-VERIFY §2.3 aynı şekildeki 20 000 parçalık
> korpusu ürünün kendi eşiğinde yeniden ölçtü: seçici sorgu orada
> `Bitmap Index Scan rows=20000` ile **18 069 ms** sürdü. Dolayısıyla
> yukarıdaki **1,87 ms** ve ondan türeyen **≈9 700×** kazanç, **ürünün cevap
> yolu için geçerli bir sayı değildir**; yalnız 0,5 eşiğiyle çağıran yollar
> için doğrudur. C-SRV §6.2 üçüncü bir korpusta bunun tersini ölçtü (her iki
> eşikte de `rows=0`, 1–8 ms; `enable_seqscan` hiçbir hücrede fark
> yaratmadı). Üç ölçümün birlikte söylediği şey şudur: bu rakamlar **belirli
> bir korpusun belirli bir sorguyla trigram örtüşmesinin** özelliğidir —
> eşiğin ya da `TRIGRAM_SEQSCAN_SETTING` çekicinin özelliği değildir ve
> hiçbiri ürün sayısı olarak alıntılanamaz. Güncel satır: STATUS **S26⁗**.

### 2.3 B-32 — liste uçları (2 000 belge / 2 000 cevap / 200 dosya)

n=5 (ilk çağrı soğuk; p95 çoğu satırda o soğuk çağrıdır).

| Uç | p50 | p95 | gövde |
|---|---:|---:|---:|
| `GET /v1/health` | 5,3 ms | 46,4 ms | 611 B |
| `GET /v1/files` (varsayılan 50) | **8,6 ms** | 57,6 ms | **12 328 B** |
| `GET /v1/files?limit=200` | 9,6 ms | 14,4 ms | 49 421 B |
| `GET /v1/matters` (200 dosya) | 10,8 ms | 17,9 ms | **120 813 B** |
| `GET /v1/matters/deadlines` | 4,1 ms | 5,8 ms | 67 527 B |
| `GET /v1/answers?limit=20` | 3,4 ms | 8,9 ms | 5 083 B |
| `GET /v1/answers?fileId=…` | **2,2 ms** | 2,9 ms | 266 B |
| `GET /v1/search/all?q=kira` | 16,9 ms | 29,4 ms | 14 479 B |
| `GET /` (konsol) | 6,7 ms | 12,4 ms | 573 074 B |
| `GET /v1/matters?q=kira` | 12,5 ms | — | 120 813 B |
| `GET /v1/drafts?limit=20` | 3,3 ms | — | 13 B |

**ENGRISK'in kabul ölçütlerine göre** (STATUS "dokuz doğrulanmamış yüzey" #9
bu ölçümün **yapılmadığını** söylüyordu — artık yapıldı):

| Ölçüt | Önce (ENGRISK) | Şimdi | Hüküm |
|---|---:|---:|---|
| `/v1/files` < 60 ms | 231 / 255 / 265 ms · 486 904 B | **8,6 ms · 12 328 B** | **GEÇTİ** |
| `GET /v1/answers?fileId=` < 5 ms | 15,5 ms | **2,2 ms** | **GEÇTİ (süre)** |
| …ve planda indeks | `Seq Scan` | **hâlâ `Seq Scan`** | **DÜŞTÜ** — §5, V-2 |
| `/v1/matters` (200) | 6,2 / 8,9 ms · 73 505 B | 10,8 ms · 120 813 B | geçti (gövde büyüdü: `nextDeadline`/`overdueCount` alanları) |
| `POST /v1/answer` (korpus) | 45 030 – 45 875 ms | **47 068 – 48 136 ms** | **kapanmadı** — §5, V-1 |

### 2.4 B-32 — sorgu planları (`EXPLAIN ANALYZE`)

```
-- (a) ÜRÜNÜN BUGÜN GÖNDERDİĞİ predikat (answerStore.ts:184)
   Seq Scan on answers a  (rows=1) Rows Removed by Filter: 2019
   Filter: ((result @> '{"fileScope": {"fileIds": ["…"]}}'::jsonb) AND (tenant_id = …))
   Execution Time: 1.864 ms

-- (b) İNDEKSİN İSTEDİĞİ predikat
   Bitmap Index Scan on answers_filescope_gin
   Index Cond: ((result -> 'fileScope'::text) @> '{"fileIds": ["…"]}'::jsonb)
   Execution Time: 0.060 ms          <-- 31x

-- (c) Migrasyon yorumunun HARFİYEN yazdığı predikat
   Bitmap Index Scan on answers_filescope_gin
   Index Cond: ((result -> 'fileScope'::text) @> '["…"]'::jsonb)
   Execution Time: 0.036 ms   ama rows=0  <-- YANLIŞ ŞEKİL, hiçbir satır eşleşmez
```

`pg_stat_user_indexes`: `answers_filescope_gin` **208 kB**, `idx_scan = 2` —
o iki tarama **benim probe sorgularım**. Ürün onu hiç kullanmadı.

`GET /v1/files` sayfası (50/2 000): `Seq Scan on documents` + `Seq Scan on
document_versions` + `Index Only Scan using chunks_no_overlap_within_version`
(50 loop) → **6,3 ms**. `chars` artık `metadata`'dan okunuyor, `canonical_text`
detoast'ı **planda yok** (B-32'nin E7 yarısı gerçekten kapanmış).

---

## 3. Felaket tatbikatı — ürünün hiç yapmadığı P0

**Sadece kendi probe veritabanım ve kendi scratch veri dizinim kullanıldı.**
Yıkıcı yarısı `collex_local`'a hiçbir noktada bakmadı.

### 3.1 Avukatın çalıştıracağı komutlar (birebir)

```bat
:: 1) YEDEK AL  (ColleX-Yedekle.cmd bunu sarar)
node control-plane\scripts\backup.mjs --database collex_local --out "%USERPROFILE%\ColleX-Yedek"

:: 2) YEDEĞİ DOĞRULA  (yazmadan önce; ColleX-Geri-Yukle.cmd ilk işi budur)
node control-plane\scripts\backup.mjs --verify "%USERPROFILE%\ColleX-Yedek\20260902-195326"

:: 3) GERİ YÜKLE  (EVET yazmayı ister; mevcut veritabanını ASLA düşürmez, ADLANDIRIR)
ColleX-Geri-Yukle.cmd "%USERPROFILE%\ColleX-Yedek\20260902-195326"
```

### 3.2 Tatbikatın adımları ve ölçülen sonuç

| Adım | Komut / eylem | Sonuç |
|---|---|---|
| 1 | `collex_verify_test` kuruldu, 13 migrasyon uygulandı | `rls.present = 18` |
| 2 | Sunucu `COLLEX_DATA_DIR=<scratch>/drill/data` ile açıldı; **2 belge yüklendi**, 1 dosya açıldı, 1 soru soruldu | asıllar `<data>/uploads/<sha256>.txt` |
| 3 | Temel alındı: her aslın SHA-256'sı + 9 tablonun satır sayısı ve **md5(satırların tam metni)** | `baseline.json` |
| 4 | `backup.mjs --database collex_verify_test --out …` | **exit 0**, 90,6 KB, 2 belge aslı, `yedek.json` `collex.backup.manifest/v1` |
| 5 | `backup.mjs --verify …` | `Yedek doğrulandı: 3 dosyanın tamamı eksiksiz.` **exit 0** |
| 5b | **Bozuk yedek denemesi:** kopyalanan yedekte bir dosyaya 1 bayt eklendi, yeniden doğrulandı | `Yedek BOZUK — eksik: 0, bozulmuş: 1` + dosya adı, **exit 1** ✔ |
| 6 | **YOK ETME:** sunucu kapatıldı, `drop database collex_verify_test with (force)`, `<data>/uploads` **silindi** | `pg_database` listesinde yok |
| 7 | Geri yükleme: önce `--verify`, sonra boş veritabanı, sonra `pg_restore --no-owner --no-privileges --exit-on-error` | **exit 0** |
| 8 | Asıllar geri kopyalandı (birleştir, silme) | 2 dosya |

### 3.3 Kanıt — bayt ve satır eşitliği

```
=== ASIL BELGE BAYT EŞİTLİĞİ ===
  MATCH  ab386ea4…687.txt  1301 B  sha256 ab386ea464f5e5f4…
  MATCH  eb21eb21…fff8.txt 1370 B  sha256 eb21eb21650ada91…
  önce 2 dosya, sonra 2 dosya -> BAYT BAYT AYNI

=== TABLO SATIR EŞİTLİĞİ (her satır metne çevrilip md5) ===
  MATCH  legal.documents            2 ->   2   15ceb57e0d48 -> 15ceb57e0d48
  MATCH  legal.document_versions    2 ->   2   19b03f3956e1 -> 19b03f3956e1
  MATCH  legal.chunks              19 ->  19   2cd4c77b1cdf -> 2cd4c77b1cdf
  MATCH  legal.source_snapshots     2 ->   2   f50a9a1daf18 -> f50a9a1daf18
  MATCH  app_private.matters        1 ->   1   5895d5fe4c86 -> 5895d5fe4c86
  MATCH  app_private.matter_items   0 ->   0   d41d8cd98f00 -> d41d8cd98f00
  MATCH  app_private.answers        1 ->   1   4eec1fb25c31 -> 4eec1fb25c31
  MATCH  app_private.drafts         0 ->   0   d41d8cd98f00 -> d41d8cd98f00
  MATCH  app_private.settings       0 ->   0   d41d8cd98f00 -> d41d8cd98f00
  RLS politikası önce 18, sonra 18

TATBİKAT SONUCU: GEÇTİ
```

Geri yüklenen veritabanının üstünde sunucu açıldı: `/v1/health` `db:"ok"`,
`migrations 13/13`, `rls 18/18`; `GET /v1/files` iki belgeyi, `GET /v1/matters`
dosyayı döndürdü. **Tek istisna:** `GET /v1/files/{id}/original` **404** verdi —
bu geri yüklemenin değil, bir seam kusurunun sonucudur (§5, V-4).

### 3.4 Tatbikatta çıkan iki not

1. **Yedek dosyasının adı her zaman `collex_local.dump`.** `yedek.json`
   `"database": "collex_verify_test"` yazıyor ama arşiv dosyası varsayılan adı
   taşıyor. `ColleX-Geri-Yukle.cmd`'nin `if not exist "%SRC%\collex_local.dump"`
   kontrolü bu yüzden **tesadüfen** çalışıyor. (P2, V-14.)
2. `icindekiler.txt` `pg_restore -l` çıktısıdır ve `dbname: collex_verify_test`
   satırını taşır — doğru veritabanı adı **orada** görünüyor.

---

## 4. Tarayıcı yürüyüşü — W13-UXAUDIT / W13-DAILYFLOW kalem kalem

Kurulum: `serve.mjs --port 8953 --mcp-port 8963 --with-mcp --dsn …collex_demo`;
`/v1/health` → `db:"ok"`, `dbName:"collex_demo"`, `migrations 13/13`,
`rls {expected:18, present:18}`, `mcp:"ok"`, `ai.configured:false`,
`templates:13`, `deadlineRules:41`, `version:"1.0.0"`.
`/v1/research/health` → `{"gateway":"ok","toolCount":54,"state":"ok"}`.

**Konsol kapısı.** Bu sunucuya ait konsol satırları: **yakalanmamış JS
istisnası 0**. Kaydedilen üç HTTP hata satırının üçü de bilerek üretildi:
`422 /v1/files` (taranmış PDF — beklenen), `502 /v1/sources/search` (kusur
V-3), `404 /v1/matters//items` (kusur V-5). Ayrıca oturumda **önceki hattın
ölü sunucusuna** (8952) ait 184 `ERR_CONNECTION_REFUSED` satırı vardı; bunlar
benim sayfama ait değil, ama konsolun yeniden bağlanma yoklamasının
**sınırsız** olduğunu gösteriyor (P2 gözlemi, ayrı kalem açmadım).

### 4.1 W13-UXAUDIT bulguları — tek tek hüküm

| # | Bulgu | Hüküm | Bu koşuda ölçülen kanıt |
|---|---|---|---|
| **P0-1** | Editörde alıntı bozulabiliyor, sistem fark etmiyor | **KAPANDI** | K-3 alıntısı eklendi, içindeki `157/1→158/2` ve `hileli→basit` değiştirildi. Canlı linter anında `⚠ KAYNAKSIZ` bastı; `Kaydet` → `PUT` 200 ve `issues[0].code = "QUOTE_ALTERED"`, mesaj: *"…alıntısı paragraf metninde birebir bulunamadı: alıntı değiştirildi — kanıt bağı koptu (QUOTE_ALTERED). Atıf yazılmadı; paragraf KAYNAKSIZ işaretlendi."* Editör başlığında **"Kayıt uyarıları (1) — sunucu yeniden doğruladı"** |
| **P0-2** | Taranmış PDF sessizce düşüyor | **KAPANDI** | PDF **tek başına, dosya sayfasından** yüklendi → görünür kırmızı hata kartı (`class="err"`) + `toast bad`. Metin birebir: *"Bu PDF taranmış görüntüden ibaret; içinde seçilebilir metin yok. …"* |
| **P1-1** | "aktif dosya" tanımsız | **KAPANDI (ipucu olarak)** | `#matterselect[title]` = *"Aktif dosya: üst çubuktan seçtiğiniz dava dosyası — bu ekranda ürettiğiniz cevap ve taslak ile yüklediğiniz belge otomatik olarak ona bağlanır."* Görünür bir tanım cümlesi yok; dokunmatikte `title` görünmez |
| **P1-2** | Çift tık ikiz dosya yaratıyor | **KAPANDI** | 3 tık → **1 POST**, `GET /v1/matters` **1 satır**; düğme tıklandığı anda `disabled` |
| **P1-3** | Ölü aktif dosya | **KAPANDI (kod yolu)** | `parseJson` → `noticeMatterNotFound` her yanıtı süzüyor, `MATTER_NOT_FOUND` görünce aktif dosyayı temizliyor. Ölü kimlik üretemedim (liste ucu artık uydurma kimlik döndürmüyor); **canlı tetiklenmedi** |
| **P1-4** | Sürüm tarihleri aynı | **KISMEN** | `/versions` artık `updatedAt` taşıyor ve **farklı** (16:36:32 ↔ 16:42:21). `createdAt` iki satırda da aynı; "ne değişti" sütunu ve KAYNAKSIZ farkı hâlâ yok |
| **P1-5** | Şablon seçmek görünürde bir şey yapmıyor | **KISMEN** | Kart artık `class="tpl sel"` alıyor ve form alanları değişiyor (`tpl-esasNo`, `tpl-ekBilgiler-karar` belirdi) — **ama sayfa kaydırılmıyor** (`scrollY 0`, form 1 319 px'te). Katalog açık kalıyor. Kart yüksekliği düştüğü için mesafe 2 581 → 1 319 px |
| **P1-6** | Cevap kartı çok uzun ve tekrarlı | **KISMEN** | Korpus cevabı `#out` = **5 842 px (6,5 ekran)**; UXAUDIT 6 804 px ölçmüştü. **Tekrar 0** (aşağıda B-27). Tespit kartları hâlâ katlanmıyor; karşıt otorite kartı büyük |
| **P1-7** | Karşıt otorite tablosunda tekrar | **KAPANDI** | Tablo **belge bazında tekil**: 4 satır, 4 farklı belge, ayrı **"Kaç aramada"** sütunu (1/2/1/1) |
| **P1-8** | Makine sözlüğü avukatın önünde | **BÜYÜK ÖLÇÜDE KAPANDI** | Belge sayfası görünür metninde **UUID 0**, `konum N-M` **0** (ikisi de "Teknik ayrıntılar" katlanır bloğunda). Cevap ekranında **makine kodu 0**. Araştır formunda `--with-mcp`/`ColleX-Baslat.cmd`/`ANTHROPIC_API_KEY` **yok**. Kalan tek kalem: belge sayfasında `ANTHROPIC_API_KEY tanımlı değil — Ayarlar › Sistem durumu` (V-18) |
| **P1-9** | `KAYNAKSIZ`, `K-n`, `sürüm`, `deneysel` tanımsız | **KAPANDI (ipucu olarak)** | `TERM_TR` sözlüğü dördünü de bir cümleyle tanımlıyor ve `defineTerm()` ile `title` olarak asıyor |
| **P1-10** | `deneysel` etiketi dar ekranda gizleniyor | **KAPANDI** | 390 px'te editör düğmesi `UDF deneysel` yazıyor (etiket görünür) |
| **P1-11** | Koyu temada `GECİKMİŞ` çipi 2,76:1 | **KAPANDI** | Koyu temada süre çipi (`.days.red`, 14 px): `rgb(227,128,116)` / `rgb(32,27,21)` → **6,19:1** (WCAG bağıl parlaklıkla hesapladım) |
| **P1-12** | Klavye odağı görünmüyor (≈1,4:1) | **KAPANDI** | Gerçek `Tab` ile: `box-shadow 0 0 0 2px rgb(32,27,21), 0 0 0 4px rgb(205,122,131)` → halka/zemin **5,46:1** (eşik 3) |
| **P1-13** | %150 yakınlaştırmada yatay kayma | **KAPANDI** | 960 px'te **13 görünümün 13'ünde** `scrollWidth ≤ 960` (12'si 945, `#harc` 960) |
| **P1-14** | Araştır kutusu demo sorusuyla dolu | **KAPANDI** | `#q.value === ""`, demo cümlesi yalnız `placeholder` |
| **P1-15** | Modal kaydırılınca "Kapat" erişilemez | **AÇIK** | Süre sonucu penceresinde `Kapat (Esc)` düğmesinin `getBoundingClientRect().top = **-560**` — UXAUDIT'in ölçtüğü sayının aynısı. Başlık hâlâ `sticky` değil |
| **P1-16** | Geri tuşu modal açıkken alttaki ekranı değiştiriyor | **AÇIK** | `#taslak → #dosyalarim → modal aç → history.back()`: hash `#taslak` oldu, görünüm `view-taslak`'a döndü, **modal açık kaldı** |
| **P1-17** | 390 px'te dosya tablosu kullanılamıyor | **KISMEN** | Gövde kaymıyor (375 ≤ 390 ✔) ve **"Sonraki süre" artık akışta** ("08.09.2026 — Cevap dilekçesi süresi … 6 gün kaldı"). Ama tablo hâlâ tablo: 554 px'lik tablo 345 px'lik kapta yatay kayıyor, başlık hücresi 6 satıra sarıyor |
| **P1-18** | Ön inceleme yanlış kesiyor, talepleri kaçırıyor | **KAPANDI** | Tarih bağlamları **sözcük sınırında**; `Talepler` üç numaralı SONUÇ VE İSTEM maddesini de buldu (fesih / tahliye / **148.500,00 TL**); atıflar **"Eşleşen"** / **"Belirsiz"** diye ayrıldı ve belirsizlere *"Kanun bağlamı bulunamadı — sözleşme madde numarası olabilir."* yazıldı; taraflar **ikisi de** çıkarıldı (`Ali Yılmaz — kiralayan`, `Veli Kaya — kiracı`) |
| **P1-19** | Çekimser cevabın dili suçlayıcı | **KAPANDI** | *"ÇEKİMSER — Bu soru elinizdeki kaynaklarda karşılık bulmuyor — aşağıdaki yollardan biriyle kaynağı genişletebilirsiniz."* + dört yol (Canlı kaynaklarda ara / Belge yükle / Soruyu daralt / Değerlendirme tarihini değiştir). `"en az bir doğrulama başarısız"` ifadesi **yok** |
| **P1-20** | Kanıt seçiminde UUID | **KAPANDI (uçta)** | `POST /v1/drafts` `evidence.runId` alıyor; konsolda UUID görünmüyor. Formun "Son araştırma" satırını bu koşuda ayrıca açmadım |
| **P1-21** | "Alıntı ekle" penceresi elenmiş kanıdı uyarısız sunuyor | **AÇIK** | Alaka kapısı 8 kanıdın 8'ini `DOMAIN_MISMATCH` ile `unusedEvidence`'a düşürdü; aynı kanıtlar `HUKUKÎ SEBEPLER` paragrafının "Alıntı ekle" penceresinde **K-1…K-6 olarak, hiçbir uyarı olmadan** listelendi ve tek tıkla eklendi (`/alakas|uyuşmuyor|hukuk alanı/` regex'i pencerede **eşleşmiyor**) |
| P2-1 | Şablon kartlarında dikey kayma | **KAPANDI** | Bir satırdaki üç kartın üstü de **y=546** |
| P2-2 | Şablon kartları hukuk metni | **KAPANDI** | Kart = başlık + tek satır amaç + `Dilekçe · 3 zorunlu alan`; üstte arama ve tür süzgeci — ama amaç satırı yanlış kesiliyor (V-11) |
| P2-8 | "Bugün / Bu hafta" başlığı | **KAPANDI** | Başlık **"Yaklaşan ve geciken süreler"**, liste `Gecikmiş (N)` / `Önümüzdeki 14 gün` |
| P2-15 | Kaydetmede yerleşim sıçraması | **AÇIK ve KÖTÜLEŞMİŞ** | `Kaydet` düğmesinin görünüm içi üst kenarı tık anında 1 157 → 708 px: **449 px** sıçrama (UXAUDIT ~360 px ölçmüştü) |
| P2-19 | `Belge deposu: collex_demo` avukata gösteriliyor | **AÇIK** | Dosya sayfası künye satırı: *"Bu çalışma alanı yereldir; UYAP ile eşitlenmez. **Belge deposu: collex_demo** · açılış 02.09.2026"* |

### 4.2 W13-DAILYFLOW bulguları — tek tek hüküm

| # | Bulgu | Hüküm | Bu koşuda ölçülen kanıt |
|---|---|---|---|
| **P0-1** | Çıplak kanun kısaltması çekimserliği deviriyor | **KAPANDI** | `…depozito iadesi ne zaman yapilir` → ABSTAIN (0 kanıt). Aynı soru **+ "tbk ya gore"** → **hâlâ ABSTAIN**, `evidence 0`, `claims 0`, `coverage.ratio 0`, `gate "failed"`. `TCK bakimindan isyerinde mobbing suc mudur?` → ABSTAIN, 0 kanıt (önce 7 tespit dönüyordu) |
| **P0-2** | Uzun soruda retrieval çöküyor | **KISMEN** | Kısa soru: COMPLETE, 5 kanıt, `coverage 0,714`. 1 251 karakterlik olay örgüsü hâli: **ABSTAIN, 0 kanıt**. Yanıltıcı KISMİ gitti (iyi), ama uzun soru hâlâ kısa sorunun bulduğunu bulmuyor |
| **P0-3** | Zamansal soru cevaplanmadan TAM ilan ediliyor | **KISMEN** | `asOf 2024-06-01` + "2026 öncesi mi sonrası mı" → **ABSTAIN** (önce COMPLETE + kesinleştirilebilirdi). Yani yanlış `COMPLETE` gitti; B-09'un asıl vaadi olan **iki metnin yan yana gösterimi** bu soruda görülmedi (retrieval hiç kanıt getirmedi) |
| **P0-4** | Dışa aktarılan dilekçe dosyalanabilir değil | **KAPANDI** | python-docx ile açıldı — §4.3 |
| P1-1 | Belgeye soruda alakasız pasajlar "SUPPORTED" | **DÜZELDİ (bu örnekte)** | "Depozito ne zaman iade edilir?" → **1 pasaj, 1 tespit**, doğru MADDE 3; `coverage %100` |
| P1-3 | `nextDeadline` geçmiş süreyi gösteriyor | **KAPANDI** | Tablo hücresi *"SONRAKİ SÜRE 08.09.2026 — … 6 gün kaldı"*; panel `Gecikmiş` / `Önümüzdeki 14 gün` ayrı |
| **P1-5** | Süzgeçler sessizce yok sayılıyor | **YARIM** | `/v1/files?bogusparam=1` → **400** (düzeldi). Ama `GET /v1/answers?q=zzzzunlikely&limit=5` → **5 satır** (`q` yok sayıldı), `?status=COMPLETE` → dönen 6 satırın 5'i ABSTAIN, `?bogus=1` → **200**. Kusur V-6 |
| P1-6 | Cevap/taslak silinemiyor | **KAPANDI** | `DELETE /v1/answers/{id}` ve `DELETE /v1/drafts/{id}` var (bilinmeyen kimlikte 404) |
| P1-7 | Eski sürüm metni okunamıyor | **KAPANDI** | `GET /v1/drafts/{id}/versions/1` → **200** |
| P2-4 | `.strict()` reddi hangi alanı söylemiyor | **AÇIK** | `POST /v1/drafts` yanlış gövdeyle: `{"path":"matter","label":"Dosya bilgileri","message":"Tanınmayan alan."}` ve **`{"path":"","label":"","message":"Tanınmayan alan."}`** — ikinci satır hiçbir alana işaret edemiyor |
| P2-7 | Liste satırlarında eksik alanlar | **KAPANDI** | `GET /v1/files` satırı `matterId` **ve** `matterTitle` taşıyor; `GET /v1/drafts` satırı `updatedAt` taşıyor |
| P2-8 | Konu dışı soruda karşı-otorite taraması koşuyor | **AÇIK** | "en iyi balık restoranı" sorusunda: *"Karşıt otorite tarandı: 2 ayrı arama yapıldı, aleyhe karar bulunamadı."* |
| P2-12 | Süre listesinde kira/tahliye kuralları yok | **KAPANDI** | 41 kural (W12: 30); listede İİK m.62/m.168, İYUK, CMK ve HMK kalemleri var |

### 4.3 Nihai DOCX — python-docx ile açıldı (B-02 / DAILYFLOW P0-4)

`GET /v1/drafts/{id}/export?format=docx&annex=none&marks=none` → **200**,
39 177 B, `Content-Disposition: attachment; filename="… - v2 - NIHAI.docx";
filename*=UTF-8''…N%C4%B0HA%C4%B0.docx`.

| Ölçüm | TASLAK kopya | **NİHAİ kopya** | DAILYFLOW'un ölçtüğü |
|---|---:|---:|---|
| Sayfa | **21,0 × 29,7 cm (A4)** | **21,0 × 29,7 cm (A4)** | 21,59 × 27,94 cm (US Letter) |
| Kenar boşlukları | 2,5 / 2,5 / **3,0** / 2,5 cm | aynı | tanımsız |
| Paragraf | 46 (1 tablo) | **30 (0 tablo)** | 236 (47 gövde / 189 ek) |
| `bold` run | 13 | **9** | **0** |
| Hizalanmış paragraf | 36 | **23** | **0** |
| `[K-n]` · `SHA-256` · `collex.` · `hmk-` · `kiracı yüklemesi` | 0 · 0 · 0 · 0 · 0 | **0 · 0 · 0 · 0 · 0** | hepsi vardı |
| `EK — DOĞRULAMA` / `DAYANAK KAYNAKLARI` | 0 / 1 | **0 / 0** | ikisi de vardı |

Nihai kopyanın gövdesi (30 paragraf) bir Türk dilekçesi gibi duruyor:
mahkeme hitabı **CENTER**, TARAFLAR/KONU/AÇIKLAMALAR/HUKUKÎ SEBEPLER/DELİLLER/
SONUÇ VE İSTEM başlıkları, gövde **JUSTIFY**, imza bloğu **RIGHT**, numaralı
talepler ve tek kapanış cümlesi. Zorunlu inceleme bandı (3 satır) **nihai
modda da duruyor** — ADR-024'ün "mürekkebi silmek disiplini silmez" kuralı
sahada tuttu.

**Ölçmediğim:** `409 EXPORT_REFUSED` yolunu tarayıcıdan **üretemedim**, çünkü
`PUT` katmanı bağı zaten kopardığı için mağazaya bozuk alıntılı bir taslak
giremiyor. İkinci katman (`export/draft.py`) yalnız deponun kendi testiyle
kanıtlıdır; ben uçtan uca görmedim.

### 4.4 Yeni ekranlar

**`#karar-ara` (B-16).** Form doğru çiziliyor: 26 kaynak üç aile başlığında
(İçtihat 8 · Mevzuat 10 · Kurul 8), desteklenmeyen süzgeçler **devre dışı ve
nedeni yazılı** ("Seçili kaynaklarda karar türü süzgeci yok."), üstte birebir
*"sonuçlar kanıt değildir; kanıt, 'Tam metni getir' ile alınan belgedir."*
**Ama arama çalışmıyor** — §5, V-3.

**`#denetim` (B-13).** Belge sayfasından açıldı. `asOf` boş başlıyor ve
zorunlu; doldurmadan "Denetimi çalıştır" **devre dışı**. Ön izleme 5 atıf
buldu; tam denetim üç kovayı da çizdi:
`Bulundu (0)` · `Bulunamadı (0)` · `Belirsiz (5)`, boş kovaların **kendi
cümlesiyle**. Çözülemeyen **künye hücresi gerçekten BOŞ** (`td.kunye` metni
`""`, `title` = *"Künye çözümlenemedi — sistem künye uydurmaz."*). Dürüstlük
satırı ekranda: *"Denetlenen metin, belgenin BÖLÜM ÖNİZLEMELERİDİR … ön
incelemesi TAM metinde 5 atıf saymıştı…"*

**`#takvim` (B-17).** Ay ızgarası, bugünün hücresi çerçeveli, 08.09.2026
süresi hücrede, dört renkli lejant, `.ics` düğmesinin yanında dürüst not.
`.ics` gövdesi doğrulandı: **yalnız CRLF** (37 satır sonu, 0 çıplak LF),
`VTIMEZONE Europe/Istanbul`, tüm-gün `DTSTART;VALUE=DATE:20260908` /
`DTEND:20260909`, `VALARM TRIGGER:-P7D`, ve `DESCRIPTION` içinde
`DEADLINE_DISCLAIMER` **birebir**, RFC 5545 §3.3.11 kaçışlarıyla
(`\;` `\,` `\n`), 75 oktetlik UTF-8 farkındalı katlama. **Gerçek bir takvim
istemcisinde açılmadı** (bu makinede yok) — STATUS'un 6 numaralı
doğrulanmamış yüzeyi aynen duruyor.

**Yedekleme kartı (B-03).** Ayarlar'da; hiç yedek yokken kırmızı *"Henüz hiç
yedek alınmadı — verileriniz tek bir diskte."* + geri yüklemenin Türkçe
anlatımı. Konsoldan **"Yedek al"a basmadım** (kullanıcının `~\ColleX-Yedek`
klasörüne yazıyor); yedekleme yolunu kendi probe'umda CLI ile koşturdum (§3).

**Kalıcılık (yeniden başlatma).** Sunucu `Stop-Process` ile öldürüldü ve
yeniden açıldı. Öncesi/sonrası birebir aynı: dosya öğeleri
`{files:1, drafts:1, deadlines:1}`, `GET /v1/answers` **9**, `GET /v1/drafts`
**1** (v2, 8 bölüm), `settings.profile.ad` yerinde.

---

## 5. Ayakta kalan kusurlar — P0/P1/P2, tekrar üretme adımlarıyla

### P0

**V-1 · 20 000 parçada korpus sorusu 47 saniye sürüyor ve cevap dönmüyor.**
*(B-06'nın kapanmayan yarısı; L-FIX §6 dürüstçe "güvenli düzeltme yok" demişti
— buradaki yenilik, sonucun ilk kez **uçtan uca HTTP'de** ölçülmesidir.)*

Tekrar üretme: 20 000 parçalık (ort. ~4 900 kod noktası) bir korpus kurun,
`POST /v1/answer {"question":"depozito iadesi","asOf":"2026-09-02"}`.
Ölçülen: **p50 47 068 ms / p95 47 695 ms**, `status:"ABSTAIN"`,
`trace.retrieve = 47 135,68 ms`, üç `RETRIEVAL_LANE_DEGRADED` uyarısı.
Kök neden zinciri: `<%` GIN adayı **20 000/20 000** satır getiriyor →
recheck satır başına ~0,84 ms → tek şerit sorgusu **34 sn** →
`createDb`'nin **15 sn** `statement_timeout`'u şeridi öldürüyor → üç şerit
(primary + iki karşıt otorite) × 15 sn ≈ 45 sn.
Etki: 60 sn'lik cevap bütçesinin **altında** kaldığı için `PARTIAL` bile
olmuyor; avukat 47 saniye bekleyip "ÇEKİMSER" görüyor.
Not: **belge kapsamlı soru etkilenmiyor** (145–221 ms), yani günlük akış
ayakta; kırılan, korpus araması.

### P1

**V-2 · `answers_filescope_gin` üründe hiç kullanılmıyor; migrasyon
yorumundaki predikat da yanlış.**
`control-plane/src/store/answerStore.ts:184` `a.result @> {"fileScope":
{"fileIds":[id]}}` gönderiyor; indeks `gin ((result -> 'fileScope')
jsonb_path_ops)` üzerinde. Ölçülen: ürün predikatı `Seq Scan on answers`
(**1,864 ms**, `Rows Removed by Filter: 2019`), indeksin istediği predikat
`Bitmap Index Scan` (**0,060 ms**). `pg_stat_user_indexes.idx_scan = 2` ve o
iki tarama benim probe sorgularım.
Ayrıca `supabase/migrations/20260903100000_ai_audit_and_scale_indexes.sql`
(satır ~76 ve `comment on index`) predikatı **`result -> 'fileScope' @>
'["<id>"]'::jsonb`** diye yazıyor; bu ifade indeksi kullanır ama
`result->'fileScope'` bir **nesne** (`{"fileIds":[…]}`) olduğu için **0 satır**
döndürür. Doğrusu `result -> 'fileScope' @> '{"fileIds":["<id>"]}'::jsonb`.
Bugün 2 000 cevapta maliyet 2 ms, yani acil değil — ama B-32'nin kabul
ölçütünün "planda indeks" yarısı **karşılanmamıştır** ve yorum bir sonraki
düzelteni yanlış yöne gönderir.

**V-3 · `--with-mcp` açıkken bile "Karar ara" 502 dönüyor; ekran tam
etkin çiziliyor ve hata metni avukatı zaten yaptığı şeye yönlendiriyor.**
Tekrar üretme: `serve.mjs --with-mcp` (bu koşuda `/v1/health mcp:"ok"`,
`/v1/research/health {"gateway":"ok","toolCount":54,"state":"ok"}`), sonra
`POST /v1/sources/search {"query":"tahliye taahhüdü","sources":["yargitay"]}`
→ **502** `UPSTREAM_UNAVAILABLE`, mesaj: *"Resmî kaynak geçidi bu sunucuda
yapılandırılmamış (sunucuyu `--with-mcp` ile başlatın); kaynak araması
yapılamaz."*
Kök neden: `control-plane/src/api/server.ts:1216-1222` canlı geçidi
`deps.mcp`'den **`researchGateway`** olarak kuruyor ve yalnız
`createResearchRouter`'a veriyor; `createSourcesRouter` satır **1360**'ta
`deps.gateway`'i bekliyor ve `serve.mjs` onu **hiç göndermiyor**.
`sources/routes.ts:213` `deps.gateway === undefined` görüp 502 veriyor.
Etki: B-16 ekranı bu dağıtım şeklinde **hiçbir künye döndüremez**, ama ekran
tam etkin, süzgeçleri açık ve "Ara" düğmesi birincil renkte çiziliyor —
W13-BACKLOG §G.3.4'ün vaporware kapısının fiilen ihlâli. Devlet
upstream'lerine bu makineden erişilemediği için "bağlansaydı çalışır mıydı"
sorusunu **ölçemedim**; ölçebildiğim, geçidin hiç bağlanmadığıdır.

**V-4 · `COLLEX_DATA_DIR` ayarlıysa "Aslını indir" her zaman 404.**
Tekrar üretme: `COLLEX_DATA_DIR=<klasör>` ile `serve.mjs`, bir belge yükleyin
(asıl `<klasör>/uploads/<sha256>.txt` olarak yazılır — doğruladım), sonra
`GET /v1/files/{id}/original` → **404** `ORIGINAL_NOT_FOUND`, mesaj *"…
(var/uploads klasöründe yok)"*.
Kök neden: `control-plane/src/files/routes.ts:450`
`const uploadsDir = deps.uploadsDir ?? join(repoRoot, "var", "uploads")`;
`control-plane/src/api/server.ts:1204-1210` `createFilesRouter`'a
**`uploadsDir` hiç geçirmiyor**; `serve.mjs:481` `path.join(VAR_DIR,"uploads")`
değerini yalnız **yedekleme** portuna veriyor.
Etki: intake `<COLLEX_DATA_DIR>/uploads`'a yazıyor, yedek oradan okuyor,
`ColleX-Geri-Yukle.cmd` oraya geri yazıyor — indirme ucu ise `<repo>/var/
uploads`'a bakıyor. Yani yedekleme kartının kendi tavsiyesini ("şifreli bir
diske koyun", yani `COLLEX_DATA_DIR`) uygulayan avukat B-30'un "Aslını indir"
düğmesini ve dosya paketinin asıllarını kaybeder. Varsayılan kurulumda
(`COLLEX_DATA_DIR` yok) kusur görünmez.

**V-5 · Aktif dosya seçili değilken hesaplanan süre kayboluyor; ekranda
yalnız `HTTP 404` yazıyor.**
Tekrar üretme: en az bir dava dosyası varken üst çubukta **"Dosyasız
çalışma"** seçili olsun. Dosyalarım → **Süre hesapla** → kural + başlangıç
25.08.2026 → **Hesapla** (sonuç doğru: 08.09.2026 Salı) → **Dosyaya kaydet**.
Ölçülen: `#dl-matter` seçicisinin **tek seçeneği var ve değeri `""`**; konsol
`POST /v1/matters//items` gönderiyor → **404**; pencere **kapanıyor**; tek
geri bildirim `toast bad` içinde **"HTTP 404"**. Hesap kayboluyor.
Aktif dosya seçiliyken aynı akış çalışıyor (`POST /v1/matters/<uuid>/items`,
*"Süre dosyaya kaydedildi: 08.09.2026"*).
İki kusur bir arada: (a) boş kimlikle istek gönderiliyor, (b) avukatın önüne
**çıplak makine dizesi** çıkıyor — B-27'nin "makine kodu tek başına durmaz"
kuralının ihlâli.

**V-6 · `GET /v1/answers` `q` ve `status` süzgeçlerini sessizce yok
sayıyor, bilinmeyen parametreyi de kabul ediyor.**
Ölçülen: `?q=zzzzunlikely&limit=5` → **5 satır** (süzgeçsizle aynı),
`?status=COMPLETE&limit=10` → dönen 6 satırın 5'i `ABSTAIN`, `?bogus=1` →
**200**. `/v1/files?bogusparam=1` ise doğru şekilde **400** veriyor.
Kök neden: `control-plane/src/api/server.ts:920-946` yalnız `matterId`,
`fileId`, `limit` okuyor; `PgAnswerStore.list` `q`/`status` şeritlerini
**uyguluyor** ama HTTP'den hiç beslenmiyor. DAILYFLOW P1-5'in yarısı açık.

**V-7 · "Alıntı ekle" penceresi alaka kapısının elediği kanıtı uyarısız
sunuyor.** (UXAUDIT P1-21, aynen duruyor — §4.1.)

**V-8 · Modal açıkken tarayıcı "geri" tuşu alttaki ekranı değiştiriyor,
pencere açık kalıyor.** (UXAUDIT P1-16 — §4.1.)

**V-9 · Modal başlığı yapışkan değil: pencere kaydırılınca "Kapat (Esc)"
`top = -560 px` ile görünüm dışına çıkıyor.** (UXAUDIT P1-15 — §4.1.)

### P2

| # | Kusur | Kanıt |
|---|---|---|
| V-10 | Profil kaydedilince **449 px** yerleşim sıçraması (başlık kompakta geçiyor) | `Kaydet` düğmesi görünüm içi 1 157 → 708 px |
| V-11 | Şablon kartının tek satır amacı **ilk noktada** kesiliyor ve kesme noktası künyenin içine düşüyor: *"…dava dilekçesi taslağı (HMK m."* — yedi dilekçe şablonunun yedisinde | `console.html:5075` `firstSentence()` `^[^.!?]{3,120}[.!?]` — "HMK m.119"un noktası cümle sonu sayılıyor |
| V-12 | "Kayıtlı taslaklar" listesi tek seferlik: görünüme geri dönüldüğünde yenilenmiyor; başka yerde açılan taslak sert yenilemeye kadar görünmüyor | `renderSavedDrafts()` yalnız `console.html:4966` (şablon fetch'inin `.then`'i) ve `5755` (`closeEditor`) çağrılıyor |
| V-13 | "Karar ara"da boş sorguyla **Ara** → hiçbir istek, hiçbir doğrulama mesajı, hiçbir görsel değişiklik | iki kez ölçüldü; `fetch` sayacı 0 |
| V-14 | Yedek arşivi her zaman `collex_local.dump` adını taşıyor | `yedek.json` `"database":"collex_verify_test"` derken dosya adı varsayılan |
| V-15 | Koyu temada dosya satırı alt metni **4,37:1 / 12,5 px** (AA 4,5 altında) — UXAUDIT'in ölçtüğü sayının aynısı | `rgb(138,128,105)` / `rgb(32,27,21)` |
| V-16 | Dosya sayfası künyesinde **"Belge deposu: collex_demo"** (veritabanı adı arayüzde) | UXAUDIT P2-19 |
| V-17 | Şablon seçilince forma kaydırma yok (form 1 319 px'te, `scrollY 0`) | UXAUDIT P1-5'in ikinci yarısı |
| V-18 | Belge sayfasında `ANTHROPIC_API_KEY tanımlı değil — Ayarlar › Sistem durumu` — Türkçe cümlenin **içinde** çıplak makine adı | tek kalan makine dizesi |
| V-19 | `.strict()` reddinde bir `issue`'nun `path` ve `label`'ı **boş** | `POST /v1/drafts` 400 gövdesi |
| V-20 | 390 px'te dosya tablosu hâlâ tablo (554 px içerik / 345 px kap) | kart listesi önerisi uygulanmadı |
| V-21 | Konu dışı soruda karşı-otorite taraması koşuyor ("2 ayrı arama yapıldı") | DAILYFLOW P2-8 |
| V-22 | İlk açılışta içerik hâlâ **537 px**'te başlıyor (900 px ekranın %60'ı künye) | UXAUDIT U8 ile birebir aynı |

---

## 6. Dürüstlük denetimi

### 6.1 Sayı iddiası taraması

`control-plane/public/console.html`, `control-plane/src/**`,
`docs/KULLANIM-ColleX.md`, `KULLANIM-REHBERI.md` üzerinde:
`halüsinasyon` · `hallucination-free` · `%N doğru` · `başarı oranı` ·
`kazandırır` · `en iyi` · `avukata gerek kalmadan` · `garanti` →
**sıfır eşleşme**.

Konsolda geçen beş `%N`: `%150` (yakınlaştırma yorumu), `%100` (iki yerde,
biri "asla %100 gösterme" gerekçesi), `%70` (`QUOTE_OVERLAP_FLOOR`), `%85`
(entailment eşiği). Hepsi **belgelenmiş kapı sabitleri**, yayımlanmış
performans iddiası değil.

Ekranda görünen tek yüzde ailesi cevap kartının kendi ölçerleridir
(`Soru kapsamı: %100`) ve bunlar **o cevaptan hesaplanır**, bir ürün iddiası
değildir.

`doğrulandı` geçen 12 satırın hepsi ya kapsamlıdır ("alıntı … doğrulandı,
belgenin doğruluğu denetlenmedi") ya da avukatın kendi işaretidir
(`console.html:8154`: *"…'doğrulandı' sayılmaz; yeşil çip yalnız 'Doğrulandı
işaretle' ile…"*).

### 6.2 Yedi tuzak

| # | Tuzak | Hüküm | Kanıt |
|---|---|---|---|
| 1 | Sayı iddiası | **RESPEKT** | §6.1 |
| 2 | Kapıları gevşetmek | **RESPEKT** | `DEFAULT_COVERAGE_FLOOR = 0.4` · `ENTAILMENT_THRESHOLD = 0.85` (iki yerde) · `DEFAULT_LEXICAL_MIN_COVERAGE = 0.25` · `QUOTE_OVERLAP_FLOOR = 0.7` — hepsi yerinde |
| 3 | UYAP/UETS kimlik entegrasyonu | **RESPEKT** | `uyap.*(giriş\|login\|şifre\|e-imza\|token)` → 0 eşleşme; konsol *"UYAP ile eşitlenmez"* diyor |
| 4 | Bulut bağımlılığı | **RESPEKT** | `package.json` bağımlılıkları değişmemiş: `hono`, `@hono/node-server`, `postgres@^3.4.9`, `zod` (+ dev: `typescript`, `vitest`, `@types/node`). `ai.configured:false` ile bütün P0/P1 yüzeyleri çalıştı |
| 5 | Yanlış eksende parite | **RESPEKT** | doktrin havuzu / mobil uygulama / SEO metni → 0 eşleşme; `#kapsam` manifestosu boşlukları ilan ediyor |
| 6 | Dürüstlüğü gürültüye çevirmek | **RESPEKT** | `WARN_BUDGET_BLOCKS = 4`, `WARN_BUDGET_SENTENCES = 8`; §6.3'te ölçüldü |
| 7 | Reklam yasağı + makine metni | **RESPEKT** | §6.1; nihai DOCX'te `hmk-` kural kimliği, `collex.` şema etiketi ve "kiracı yüklemesi" **0 kez** (§4.3) |

### 6.3 Uyarı bütçesi — gerçek cevap ekranlarında ölçüldü

`.warnblock` ve `.warnline` sınıfları sayıldı (konsolun kendi muhasebesi):

| Ekran | Blok (≤4) | Cümle (≤8) | Birebir tekrar | Ana akışta makine kodu | UUID |
|---|---:|---:|---:|---:|---:|
| Belge sorusu (COMPLETE, 1 kanıt) | **3** | **7** | **0** | 0 | 0 |
| Korpus sorusu (QUALIFIED, karşıt otorite) | **3** | **5** | **0** | 0 | 0 |

Bütçe **tutuyor**. UXAUDIT'in ölçtüğü "aynı feragat cümlesi 6 kez" ve
"~40 makine kodu geçişi" tablosu bu ekranlarda **tamamen** kalkmış.

### 6.4 Uydurma künye

`citationAudit.ts:369` `const kunye = resolution?.kunye?.trim() ?? ""` ve
satır 408'in üstündeki *"THE RULE: no resolution, no künye. An empty cell,
never a guess."* yorumu; çözümlenemeyen atıf **`UNCERTAIN`**, asla
`NOT_FOUND` (resolver istisna atarsa da `UNCERTAIN`). Konsol tarafı
`el("td","kunye", r.kunye || "")` ve boş hücreye çapraz tarama + `title`.
Python tarafı `export/audit.py:411-414` yazılan DOCX hücresini **geri
okuyup** boş olması gerekirken doluysa reddediyor.
**Ekranda doğrulandı:** 5 belirsiz satırın 5'inde künye hücresi boş; hiçbir
yerde `?`, `—` veya `bilinmiyor` yok. (`Yürürlük` sütunundaki `bilinmiyor`
bir **durum** etiketidir, uydurulmuş bir kimlik değil.)

### 6.5 Doğrulanmamış yüzeylerin etiketleri yerinde

`GET /v1/deadlines/rules` → **41** kural, **16 `dogrulandi`**, **25
`dogrulanmadi`**, **7** `adliTatileTabi:"belirsiz"`.
`GET /v1/fees/tariffs?year=2026` → **20** kalem, **5 `dogrulandi`**,
**17 `amount: null`**, `disclaimer` dolu.
Ayarlar ekranı bunu avukata birebir yazıyor: *"41 kural · 25 doğrulanmadı ·
16 doğrulandı — madde metniyle kontrol edin"*. STATUS S10/S11 ile **tam
uyum**.

---

## 7. STATUS.md'ye hazır ölçülen sayılar tablosu

> L-DOCS'a: aşağıdaki satırlar bu koşuda ölçüldü. `S2` ve `S6` mevcut
> satırların **yenilenmiş** hâlidir; `S25`–`S29` yeni satır önerisidir.

| # | Komut / yüzey | Ölçülen çıktı (02.09.2026, L-VERIFY) | Exit |
|---|---|---|---:|
| S1 | `control-plane> npx tsc --noEmit` | temiz | 0 |
| **S2′** | `control-plane> npx vitest run` | **102 dosya · 2 047 geçti · 0 düştü · 6 atlandı (2 053)** · 26,71 sn; 6 atlamanın altısı da ters işaretleyici | 0 |
| S3 | `pytest tests evals/tests -q` | **1 339 passed** · 133,52 sn | 0 |
| S4 | `scripts/smoke_check.py` | **54 tool** | 0 |
| S5 | `scripts/db_local_check.py` | **19/19 PASS** | 0 |
| **S6′** | `scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS**; atıf çözülebilirliği %100 (128), alıntı/hash 35/35, uydurma kimlik 0, sızıntı 0; Recall@5 **0,9429**; retrieval p50/p95 **8,5 / 20,8 ms**; kesinleştirilebilir **%85,7 (18/21)**; **cevap düzeyi yanlış çekimserlik 0** | 0 |
| S7 | `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** | 0 |
| S10 | `GET /v1/deadlines/rules` | **41 kural · 16 dogrulandi · 25 dogrulanmadi · 7 belirsiz** | — |
| S11 | `GET /v1/fees/tariffs?year=2026` | **20 kalem · 5 dogrulandi · 17 `amount:null`** | — |
| S13 | `GET /v1/health` | `registeredToolCount 54` · `migrations 13/13` · **`rls {expected:18, present:18}`** · `mcp:"ok"` (`--with-mcp`) · `ai.liveTested:false` · `version "1.0.0"` | — |
| **S25** | **B-06 · `/v1/answer`, 20 000 parçalık probe (`collex_verify_test`, ort. 4 976 kod noktası), gerçek HTTP, n=5** | Yaygın sözcük: **p50 47 068 ms / p95 47 695 ms**, `ABSTAIN`, `retrieve` 47 136 ms, 3 × `RETRIEVAL_LANE_DEGRADED`. **Belge kapsamlı soru aynı veritabanında 145–221 ms.** ENGRISK'in 45 030–45 875 ms'i **kapanmadı** | — |
| **S26** | **B-06 · trigram şeridi planı, aynı probe** | Doymuş sorgu `Bitmap Index Scan rows=20000` → recheck **34 154 ms** (`enable_seqscan` açık: 33 789 ms — **fark yok**). Seçici sorgu: **18 210 ms → 1,87 ms** (≈9 700×). Çekiç seçici vakada haklı, doymuş vakada etkisiz | — |
| **S27** | **B-32 · liste uçları (2 000 belge / 2 000 cevap / 200 dosya), n=5, p50** | `/v1/files` **8,6 ms · 12 328 B** (ENGRISK 231–265 ms · 486 904 B) · `/v1/files?limit=200` 9,6 ms · `/v1/matters` 10,8 ms · 120 813 B · `/v1/answers?fileId=` **2,2 ms** · `/v1/matters/deadlines` 4,1 ms · `/v1/search/all` 16,9 ms. **Süre ölçütleri geçti; `answers_filescope_gin` planda YOK** (`Seq Scan`, 1,864 ms; indeksli şekil 0,060 ms) | — |
| **S28** | **B-03 · felaket tatbikatı (`collex_verify_test` + scratch veri dizini)** | Veri yaz → `backup.mjs` (90,6 KB, 2 asıl, manifest) → `--verify` **exit 0** → 1 bayt bozulan kopya **exit 1** → **veritabanı `drop … with (force)` + `uploads` silindi** → `pg_restore --exit-on-error` **exit 0** → **2/2 asıl bayt bayt aynı**, **9/9 tablo satır satır aynı**, **RLS 18 → 18** | 0 |
| **S29** | **B-27 · uyarı bütçesi, gerçek cevap ekranları (tarayıcı)** | Belge sorusu **3 blok / 7 cümle**; korpus sorusu **3 blok / 5 cümle**; her ikisinde **0 tekrar**, ana akışta **0 makine kodu**, **0 UUID**. Tavan 4/8 | — |
| **S30** | **B-28 · erişilebilirlik, tarayıcıda hesaplandı** | Odak halkası (gerçek `Tab`) koyu temada **5,46:1** (eşik 3) · süre çipi koyu temada **6,19:1** (eşik 4,5; UXAUDIT 2,76) · 960 px'te **13/13 görünümde yatay taşma yok** · 390 px'te **11/11 görünümde taşma yok**. **Kalan:** dosya satırı alt metni koyu temada **4,37:1 / 12,5 px** | — |

---

## 8. W13 backlog kalemleri — indiği iddia edilenlere hüküm

Sütun anlamı: **DOĞRULANDI** = bu koşuda kendi gözümle/ölçümümle gördüm ·
**TEST GEÇTİ** = yalnız süitin yeşilliğine dayanıyor · **AÇIK** = kusurlu.

| Kalem | Hüküm | Dayanak |
|---|---|---|
| B-01 alıntı bütünlüğü | **DOĞRULANDI** | Tarayıcıda tahrifat → `QUOTE_ALTERED` (§4.1 P0-1). `409 EXPORT_REFUSED` yolunu üretemedim — yalnız TEST GEÇTİ |
| B-02 dosyalanabilir çıktı | **DOĞRULANDI** | A4, biçim, nihai kopyada 0 makine dizesi (§4.3) |
| B-03 yedek/geri yükleme | **DOĞRULANDI** | Tam tatbikat (§3) |
| B-04 `localGuard` | TEST GEÇTİ | `vitest` yeşil; ayrı bir 421/403 probu koşmadım |
| B-05 ledger + `rls` | **DOĞRULANDI** | `db_local_check` 19/19 · `/v1/health rls 18/18` · geri yüklemede 18 politika |
| B-06 trigram indeksi | **KISMEN** | İndeks kullanılıyor (§2.2) ama doymuş korpusta cevap 47 sn — **V-1** |
| B-07 çıplak kanun atfı | **DOĞRULANDI** | "tbk ya gore" artık ABSTAIN (§4.2 P0-1) |
| B-08 uzun soruda kapsam | **KISMEN** | Yanıltıcı KISMİ gitti, ama uzun soru **0 kanıt** getiriyor (§4.2 P0-2) |
| B-09 zamansal `COMPLETE` yasağı | **KISMEN** | Artık `COMPLETE` demiyor; iki metni yan yana göstermesi **görülmedi** (§4.2 P0-3) |
| B-10 sessiz yükleme / çift tık / ölü dosya | **DOĞRULANDI** (ilk ikisi) | §4.1 P0-2, P1-2. Ölü aktif dosya yolu tetiklenmedi |
| B-11 süre kuralları | **DOĞRULANDI** | 41 / 16 / 25 / 7 (§6.5); hesap ekranı doğru (§4.4) |
| B-13 atıf denetim raporu | **DOĞRULANDI** | Üç kova, boş künye, dürüstlük satırı (§4.4). `NOT_FOUND` kovasının **dolu hâli görülemez** (bilinen sınır) |
| B-14 kapsam manifestosu | **DOĞRULANDI** (uç) | `GET /v1/sources/manifest` 200, 21 174 B; `#kapsam` ekranı çiziliyor |
| B-16 karar arama | **AÇIK** | Ekran var, arama **hiç çalışmıyor** — **V-3** |
| B-17 takvim + `.ics` | **DOĞRULANDI (dosya)** | Takvim ekranı + RFC 5545 uyumlu `.ics` (§4.4). Gerçek istemcide **açılmadı** |
| B-19 klasör intake | TEST GEÇTİ | Klasör bırakma denenmedi (Playwright'ta klasör bırakma yok) |
| B-24 sözleşme incelemesi | TEST GEÇTİ | `GET /v1/contracts/checklists` 200; ekranı bu koşuda sürmedim |
| B-26 silme/süzgeç/alan | **KISMEN** | `DELETE`ler, `/versions/{n}`, `matterId`+`matterTitle`, `updatedAt`, `/v1/files` 400 → indi; **`/v1/answers` `q`/`status` hâlâ yok sayılıyor** — **V-6** |
| B-27 uyarı bütçesi + sözlük | **DOĞRULANDI** | 3 blok / 5–7 cümle / 0 tekrar / 0 makine kodu (§6.3); `TERM_TR` dört terimi tanımlıyor. Kalan: V-5'in `HTTP 404` toast'ı ve V-18 |
| B-28 erişilebilirlik | **DOĞRULANDI (üç kalemde)** | Odak 5,46 · çip 6,19 · 960/390 px taşma yok. **Kalan:** 4,37:1 alt metin (V-15) |
| B-29 genel arama | **DOĞRULANDI (uç)** | `GET /v1/search/all?q=kira` 200, 16,9 ms · 14 479 B (20 000 parçalı probe'ta) |
| B-30 dosya paketi / aslını indir | **AÇIK** | `COLLEX_DATA_DIR` ile "Aslını indir" 404 — **V-4**; paket düğmesi konsola konmamış (L-CONSOLE-B §9.5) |
| B-32 liste ölçeği | **KISMEN** | Süre ölçütleri geçti, **plan ölçütü düştü** — **V-2** |
| B-34 sürüm / veri dizini | **DOĞRULANDI** | `/v1/health version "1.0.0"`; `COLLEX_DATA_DIR` sunucuda saygı görüyor (dosya indirmede görmüyor — V-4) |
| B-35 harç | **DOĞRULANDI** | 20 kalem / 5 dogrulandi / 17 `amount:null` (§6.5) |
| B-37 belge ön incelemesi | **DOĞRULANDI** | Taraflar, sözcük sınırı, numaralı talepler, `Eşleşen`/`Belirsiz` atıflar (§4.1 P1-18) |
| B-39/B-40/B-41 cila | **KISMEN** | Şablon kartları ve hizalama düzeldi (P2-1/P2-2); modal geçmişi ve yapışkan başlık **açık** (V-8, V-9) |
| B-44 depo temizliği | TEST GEÇTİ | `test_repo_hygiene` süiti yeşil |

---

## 9. "Apilex ve De Jure'den daha iyi mi?" — tek paragraflık dürüst cevap

**Bu avukat için, bu makinede: iki iş için evet, bir iş için hayır.** ColleX'in
yaptığı ve rakiplerinin yapmadığı iki şey ölçülebilir biçimde gerçek: (1) her
cümlenin arkasındaki alıntıyı kimliğe bağlıyor ve avukat o alıntıyı bozarsa
**bağı koparıp dışa aktarımı reddediyor** — bunu bu koşuda tarayıcıda tahrifat
üreterek doğruladım; (2) müvekkil verisi bu bilgisayardan çıkmıyor, ve artık
**yedeği alınıp geri yüklenebiliyor** — veritabanını gerçekten yok edip
asılları bayt bayt geri getirdim. Buna cevabın **çekimser kalmayı bilmesi**
(uydurma kısaltmayla bile devrilmiyor), **41 kurallık süre hesabının**
maddesini ve doğrulanmamışlığını söyleyerek çalışması, künye uydurmaması ve
nihai dilekçenin **A4 ve biçimli** çıkması eklenince, tek kişilik bir bürodaki
"bu cümlenin dayanağı ne, süre ne zaman doluyor, bu dilekçe imzaya hazır mı"
işleri için ColleX bugün rakiplerinden **daha güvenilir** bir araçtır.
**Ama arama tarafında hâlâ geride.** Apilex ve De Jure'nin asıl sattığı şey
geniş bir içtihat havuzunda hızlı ve iyi arama; ColleX'te bu tarafın iki ayağı
da topal: yeni "Karar ara" ekranı bu dağıtımda **tek bir künye bile
döndüremiyor** (V-3) ve yerel korpusta 20 000 parçaya çıkıldığında yaygın bir
sözcükle sorulan soru **47 saniye sürüp boş dönüyor** (V-1). Yani avukat
"dayanağımı doğrula" için ColleX'i açar, "hangi karar var" için hâlâ rakibi
açar. Bir de kapsam gerçeği var: buradaki her ölçüm **sentetik** korpusta
yapıldı; ColleX'in hukukî isabeti gerçek Türk mevzuatı ve içtihadı üzerinde
**hiç ölçülmedi**, ve o ölçüm yapılana kadar "daha iyi" sözü yalnız
*disiplin* için geçerlidir, *kapsam* için değil.

---

## 10. Hijyen

* Açtığım her sunucu kapatıldı. `netstat`: **8953 ve 8963'te dinleyici yok**;
  **8787/8898'e hiç dokunulmadı**. Oluşturduğum pid dosyaları silindi;
  `var/*.pid` **yok**.
* `collex_verify_test` kuruldu, ölçüldü, tatbikat için yok edildi, geri
  yüklendi ve koşu sonunda **düşürüldü** (`pg_database` listesiyle
  doğrulandı).
* `collex_demo` `demo.mjs --force-drop-uploads` ile **yeniden kuruldu**
  (`--force-drop-uploads` yalnız **kendi** probe yüklemem için kullanıldı):
  6/6 senaryo PASS, `legal.documents` 7 (6 korpus + demo'nun kendi kiracı
  fikstürü), `matters/answers/drafts` **0**.
* **`collex_local`'a hiç bağlanılmadı**, hiç yazılmadı, düşürülmedi.
  Depo `var/uploads` klasörü koşu öncesi ve sonrası **0 dosya**.
* Tarayıcının yazabildiği tek yere (`<workspace>/.playwright-mcp/w14b-verify/`)
  düşen 9 ekran görüntüsü ve 2 test belgesi scratchpad'e kopyalandı, klasör
  **silindi**. Bütün geçici dosyalar
  `…/scratchpad/w14b-L-VERIFY/` altında.
* Devlet upstream'lerine **tek bir istek gitmedi** (`POST /v1/sources/search`
  sunucuda 502 ile durdu; MCP araçları çağrılmadı). `.env` okunmadı,
  Supabase/Resend kullanılmadı, git işlemi yapılmadı.
* **Değişen depo dosyası: yalnız `docs/implementation/waves/W14-L-VERIFY.md`
  (bu dosya).**

---

## 11. Bir sonraki (düzeltme) hattına önerilen sıra

1. **V-3** — `serve.mjs`/`createApp` canlı MCP geçidini `createSourcesRouter`'a
   da versin (`researchGateway` zaten kuruluyor). Bağlanana kadar B-16 ekranı
   vaporware kapısına göre **devre dışı** çizilmeli ve hata metni
   `--with-mcp` tavsiyesini yalnız geçit gerçekten yokken vermeli.
2. **V-4** — `createFilesRouter`'a `uploadsDir` geçir (`serve.mjs`'te değer
   zaten hesaplı: `path.join(VAR_DIR,"uploads")`). Tek satırlık seam.
3. **V-5** — süre penceresindeki dosya seçicisi boşken "Dosyaya kaydet"
   ya devre dışı olsun ya da dosya listesini yüklesin; ve hiçbir `toast`
   `HTTP <kod>` yazmasın (B-27).
4. **V-2** — `answerStore.list`'in predikatını
   `result -> 'fileScope' @> {"fileIds":[id]}` yap **ve** migrasyon
   yorumundaki yanlış şekli düzelt; plan gerileme testi ekle.
5. **V-6** — `/v1/answers` `q`/`status`'ü mağazaya geçirsin, tanınmayan
   sorgu parametresine 400 versin (`/v1/files` deseni hazır).
6. **V-7, V-8, V-9** — alaka uyarısını "Alıntı ekle" penceresine taşı;
   modalları `history.pushState`'e bağla; modal başlığını `sticky` yap.
7. **V-1** — kapatılamıyorsa **arayüzde söylensin**: korpus araması bu
   boyutta uzun sürebilir; ilerleme satırı ve iptal düğmesi konsun.
   (Ölçüm bu hattın; çözüm bu hattın değil.)
8. P2 kalemleri (V-10…V-22) tek bir cila dalgasında; V-11 (`firstSentence`)
   ve V-12 (`renderSavedDrafts`) birer satırlık.
