# W14 — F-VERIFY (Faz F, kapanış): bağımsız son doğrulama

**Tarih:** 02.09.2026 · **Tip:** DENETİM — bu hat **hiçbir ürün dosyasına
dokunmadı**; depoda elle yazdığım tek dosya bu rapordur.
**Portlar:** 8974 (sunucu) · 8984 (MCP geçidi) — **8787/8898'e hiç
dokunulmadı**.
**Veritabanları:** `collex_final_test` (bu hattın kendi 20 000 parçalık
probe'u; kuruldu, ölçüldü, **düşürüldü**) · `collex_demo` (koşu başında ve
koşu sonunda `demo.mjs --force-drop-uploads` ile **yeniden kuruldu**).
**`collex_local`'a hiç bağlanılmadı, hiç yazılmadı, düşürülmedi.**
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, MCP yüzeyi
(54) değişmedi.

> Bu raporda yazan her sayı **bu koşuda bu makinede ölçüldü**. Ölçemediğim
> yere "ölçmedim" yazdım; başka bir hattın sayısını kendi ölçümüm gibi
> göstermedim. Ölçek sayıları **SENTETİK** probe korpusundadır (200 sözcüklük
> bir dağarcıktan üretilmiştir); trigram ve sözcük çeşitliliği gerçek Türk
> hukuk metninin çeşitliliği **değildir** ve hiçbiri hukukî kalite ölçüsü
> değildir.

---

## 0. Yönetici özeti

**Dokuz komutun dokuzu da exit 0.** Tek bir düşen test yok, dolayısıyla
"üç kez tekrarla, gerçek mi paylaşılan küme çekişmesi mi ayır" adımına gerek
kalmadı.

**Bağımsız sayımım: 16 KAPANDI · 3 İYİLEŞTİ (V-1, V-10, V-22) · 3 AÇIK
(V-14, V-19, V-21).** Faz F hatlarının kapandı dediği kalemlerin hepsini
kendi yöntemimle yeniden ürettim; üçünde onların "kapandı" hükmünü
paylaşmıyorum ve her birini §3'te sayıyla gerekçelendirdim.

Wave'in en sert üç sözü **sahada tuttu**: tarayıcıda alıntıyı bozdum,
sunucu `QUOTE_ALTERED` ile bağı kopardı ve paragrafı KAYNAKSIZ işaretledi;
nihai DOCX **A4, biçimli ve içinde tek bir makine dizesi yok**; uyarı bütçesi
iki gerçek cevap ekranında **3 blok / 5–7 cümle / 0 tekrar / 0 makine kodu**
ölçüldü.

**Bu koşunun en büyük yeniliği:** "Karar ara" (B-16) **ilk kez gerçekten
çalıştı**. `--with-mcp` ile açılan sunucuda iki ayrı sorgu **20'şer künye**
döndürdü (0 başarısız kaynak, 6 605 / 6 643 ms) ve "Tam metni getir"
SHA-256'lı bir kaynak kartı üretti. L-VERIFY, F-API ve F-UI'nin hiçbiri bunu
ölçememişti. Ama aynı ölçüm **yeni bir kusur** da gösterdi: dönen künyeler
sorgunun kendisiyle görünür biçimde eşleşmiyor ve liste satırında eşleşen
cümle yok (§6, N-4).

**V-1 kapanmadı; ölçülebilir biçimde iyileşti.** L-VERIFY'ın şeklinde
(20 000 parça, hepsi kiracı) yaygın sözcük sorusu **47 068 → 9 483 ms**;
gerçekçi korpus şeklinde (1 900 public) **3 844 ms** ve artık **cevap
dönüyor**. Buna karşılık iki dürüst yarı var: (a) **seçici sorgu artık en
yavaş korpus sorusu** (7 536 ms, ABSTAIN) ve (b) önceki iki hattın "seçici
sorgu 1,87 ms / 0,33 ms" ölçümleri **ürünün cevap yolunun kullanmadığı bir
eşikte** (`0.5`) alınmış; ürünün gerçek eşiğinde (`0.35`) GIN indeksi
**seçici sorguda da 20 000/20 000 satır** getiriyor (§2.3).

---

## 1. Tam ölçüm turu (sıralı ve tek başına)

| # | Komut | Ölçülen çıktı | Süre | Exit |
|---|---|---|---:|---:|
| 1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | 7,2 sn | 0 |
| 2 | `control-plane> npx vitest run` | **102 dosya · 2 086 geçti · 0 DÜŞTÜ · 6 atlandı (2 092)** | 23,64 sn | 0 |
| 3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 339 passed** | 129,19 sn | 0 |
| 4 | `scripts/smoke_check.py` | `offline smoke checks passed: 54 tools, court inventory, shared limiter, disabled-key errors, HTTP auth` | — | 0 |
| 5 | `scripts/http_e2e_check.py` | `authenticated HTTP MCP handshake passed: 54 tools` | — | 0 |
| 6 | `scripts/live_local_gateway_check.py` | `PASS tools/list — exactly 54 tools (offline surface)`; `/health tools_count:54` | — | 0 |
| 7 | `scripts/db_local_check.py` | **19/19 PASS** (`collex_mig_test`, 13 migrasyon) · `RESULT: PASS` | — | 0 |
| 8 | `scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS** (6/6 sert kapı) — §1.2 | — | 0 |
| 9 | `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** (S1 8/8 · S2 8/8 · S3 7/7 · S4 7/7 · S5 7/7 · S6 10/10) | — | 0 |

**Düşen hiçbir şey olmadı**, dolayısıyla çekişme/gerçeklik ayrımı gerekmedi.
Bu dalgada başka hatların paralel çalıştığı biliniyor; yine de bu turdaki
hiçbir komut bir başkasının sürecine bağımlı değildi ve hepsi ilk denemede
geçti.

### 1.1 vitest'in 6 atlaması — ters işaretleyiciler

Toplam L-VERIFY'ın 2 047'sinden **2 086**'ya çıktı (+39). Atlayan 6 test
bilinen "ortam yok" işaretleyicileridir; gerçek süitler koştu
(`matters/pg`, `drafting/real-export`, `store/persistence`,
`integration/{backup,real-exec,serve}`) — çıktıda `serve.test.ts` **6 test |
1 skipped** ve `--with-mcp` süreç-listesi kontrolü dâhil geçti.

### 1.2 Eval kapısı (komut 8)

| Ölçüm | Değer |
|---|---|
| Recall@5 / @10 / @20 | **0,9429 / 1,0000 / 1,0000** |
| nDCG@10 · MRR | 0,9156 · 0,9024 |
| Exact-reference / kısaltma / tam ad doğruluğu · parite | %100 · %100 · %100 · %100 |
| Temporal doğruluk (n=6) · Karşıt otorite recall (n=3) | %100 · 1,0000 |
| Çekimserlik kesinliği / recall (n=13) | %100 / 92,3 % |
| Cevap katmanı çekimserlik kesinliği / recall | %100 / **%100**, `missed=none` |
| Cevap katmanı YANLIŞ çekimserlik (TRIPWIRE) | **0** |
| Atıf çözülebilirliği (KAPI) | **%100**, 128 sıralı isabet |
| Alıntı/hash bütünlüğü (KAPI) | **35/35** |
| Uydurma kimlik / kiracı sızıntısı (KAPI) | **0 / 0** |
| Cevap düzeyi durumlar | ABSTAIN=13 · **COMPLETE=13** · PARTIAL=3 · **QUALIFIED=5** |
| Kesinleştirilebilir (rapor amaçlı) | **%85,7 (18/21)** |
| Beklenen gold birimi atıfta | %95,2 |
| Retrieval p50 / p95 | **7,5 / 20,3 ms** |
| Kanıt paketi p50 / p95 | 0,4 / 1,3 ms |
| Şerit dağılımı | exact=36 · lexical=67 · **trigram=5** · dense=0 · relation=17 · citation=12 |

**F-PERF'in "gold gerilemedi" iddiası bu turda doğrulandı:** şerit dağılımı
**trigram=5 dâhil** L-VERIFY turuyla rakam rakam aynı, altı sert kapının
altısı da PASS. Durum dağılımı L-VERIFY'ın (COMPLETE=12, QUALIFIED=6)
yerine (COMPLETE=13, QUALIFIED=5) — F-PERF'in §6'da tek tek yazdığı üç
satırlık kaymayla **uyumlu**; ben de o kaymanın "kazanç değil takas" olduğunu
teyit ediyorum, çünkü **"beklenen gold birimi atıfta" oranı %95,2 ile
değişmedi**.

---

## 2. P0'ın yeniden ölçümü — 20 000 parçalık kendi probe'um

**Kurulum** (`collex_final_test`, koşu sonunda düşürüldü): 2 000 belge ×
10 parça = **20 000 parça**, ortalama `search_text` **4 976 kod noktası**,
`legal.chunks` yığın **5 000 kB**, TOAST dâhil toplam **301 MB**,
`chunks_search_trgm` **31 MB**; **2 000** `app_private.answers` satırı
(her biri `result.fileScope.fileIds` taşıyor); **200** dosya × 5 öğe.
L-VERIFY §2'nin kurulumunun **birebir aynısı** (o da 4 976 / 301 MB / 31 MB
ölçmüştü), böylece 47 saniyelik sayıyla karşılaştırma elmayla elma.

İki korpus **şekli** ölçüldü, çünkü ikisi farklı şeyi gösteriyor:
**A** = 2 000 belgenin tamamı `scope='tenant'` (L-VERIFY'ın şekli, korpusta
aranabilir hiçbir şey yok) · **B** = 1 900 belge `scope='public'`,
100 kiracıda (ürünün gerçek hâli). Şekil B'ye tek bir `update` ile geçildi,
korpus yeniden üretilmedi.

### 2.1 `POST /v1/answer`, gerçek HTTP, n=5

| Sorgu | Şekil A p50 / p95 | durum (A) | Şekil B p50 / p95 | durum (B) |
|---|---:|---|---:|---|
| `depozito iadesi` (**doymuş**) | **9 483 / 9 597 ms** | ABSTAIN | **3 844 / 3 877 ms** | **PARTIAL, 8 kanıt, 8 tespit, 0 bozuk şerit** |
| `zamanasimi suresi` (doymuş) | 9 413 / 9 464 ms | ABSTAIN | 3 675 / 3 726 ms | PARTIAL |
| `kira sozlesmesinde depozito ne zaman iade edilir` (uzun) | 9 531 / 9 543 ms | ABSTAIN | 4 072 / 4 086 ms | PARTIAL |
| `Belge 17 paragraf 3 kaydi` (işaret cümlesi) | 9 616 / 9 702 ms | ABSTAIN | 4 744 / 5 516 ms | PARTIAL |
| `kuantum mekaniginde dalga fonksiyonu` (**seçici**) | **7 534 / 7 542 ms** | ABSTAIN | **7 536 / 7 553 ms** | ABSTAIN |
| **belge kapsamlı** (`filters.fileIds`, `includeCorpus:false`) | **71 / 142 ms** | COMPLETE | **73 / 162 ms** | COMPLETE, 4 kanıt |

Şekil A'da tek bir cevabın işlem izi: `retrieve` **9 499,88 ms**, kalan on
iki aşama toplam **1,0 ms**. Uyarılar birebir:

```
RETRIEVAL_LANE_DEGRADED:primary:lane trigram failed: trigram lane exceeded its 2500 ms budget (TRIGRAM_BUDGET_EXCEEDED)
RETRIEVAL_LANE_DEGRADED:contrary:issue-1:outcome_flip:lane trigram failed: … (TRIGRAM_BUDGET_EXCEEDED)
RETRIEVAL_LANE_DEGRADED:contrary:issue-1:dissent:lane trigram failed: … (TRIGRAM_BUDGET_EXCEEDED)
```

**Sürücünün "canceling statement due to statement timeout" cümlesi
uyarılardan tamamen kalktı** — yerinde bütçenin kendi tipli adı duruyor.
F-PERF'in bu sözü tutuldu.

Şekil B'de doymuş sorguda **hiç şerit arızası yok** (kapı kapanıyor:
birincil şeritler 8'den fazla pasaj üretiyor), seçici sorguda **üç şerit de
bütçeyle kesiliyor** (kapı açık, çünkü birincil şeritler eli boş).

### 2.2 `EXPLAIN (ANALYZE, BUFFERS)` — eşik 0,5 (önceki iki hattın kullandığı)

| Sorgu / ayar | Plan | Execution Time |
|---|---|---:|
| `depozito iadesi`, `enable_seqscan=off` | `Bitmap Index Scan on chunks_search_trgm rows=20000` → Heap, `Rows Removed by Filter: 289` | **33 647 ms** |
| aynı, `enable_seqscan` açık | aynı bitmap yolu | 33 471 ms |
| `zamanasimi suresi`, off | `rows=20000`, `Rows Removed: 363` | 33 742 ms |
| işaret cümlesi, off | `rows=20000` | 35 288 ms |
| **seçici**, `enable_seqscan=off` | `Bitmap Index Scan rows=0` | **2,06 ms** |
| **seçici**, `enable_seqscan` açık | `Seq Scan`, `Rows Removed: 20000` | **18 115 ms** |

Bu tablo L-VERIFY §2.2'yi **birebir yeniden üretiyor** (o 34 154 / 33 789 /
18 210 / 1,87 ms ölçmüştü). F-PERF'in "seçici vakada seqscan etkisini
yeniden üretemedim" notu bu korpusta geçerli değil: burada etki **8 800×**.

### 2.3 `EXPLAIN` — **ürünün gerçekten kullandığı eşik: 0,35**

`DEFAULT_ANSWER_LIMITS.trigramMinSimilarity = 0.35`
(`control-plane/src/api/answerService.ts:128`) ve `clampAnswerLimits` bunu
yalnız YUKARI çekebiliyor. Yani `/v1/answer` yolunda şerit **hiçbir zaman
0,5 ile koşmuyor**. Aynı SQL, aynı korpus, eşik 0,35:

| Sorgu / ayar | Plan | Execution Time |
|---|---|---:|
| `depozito iadesi`, off | `Bitmap Index Scan rows=20000` → `Rows Removed by Filter: 5` (19 995 satır geçiyor) | **32 620 ms** |
| aynı, `enable_seqscan` açık | aynı bitmap yolu | 32 852 ms |
| `zamanaşımı süresi`, off | `rows=20000`, `Rows Removed: 363` | 32 581 ms |
| **seçici** `kuantum mekaniginde dalga fonksiyonu`, off | **`Bitmap Index Scan rows=20000`**, `Rows Removed by Filter: 20000` | **18 069 ms** |
| **seçici**, `enable_seqscan` açık | `Seq Scan`, `Rows Removed: 20000` | 17 982 ms |

**Bu, bu koşunun en önemli tek bulgusu.** Ürünün kendi eşiğinde:

* **"Seçici sorgu" diye bir şey yok.** GIN `%>` operatörü 0,35'te bu korpusun
  **her satırını** aday yapıyor; fark yalnız recheck'in kaç satırı elediğinde.
  L-VERIFY'ın ölçtüğü ≈9 700× ve F-PERF'in ölçtüğü 0,329 ms **yalnız 0,5
  eşiğinde doğrudur** ve ürünün cevap yolu o eşikle çalışmaz.
* **`TRIGRAM_SEQSCAN_SETTING` çekicinin ürün yolunda ölçülen faydası yok**
  (32 620 ↔ 32 852 ms doymuşta; 18 069 ↔ 17 982 ms seçicide). Çekiç 0,5'te
  haklı, 0,35'te etkisiz. **Kaldırılmasını önermiyorum** — 0,5 ile koşan
  başka çağıranlar için ölçülmüş bir kazanç ve kaldırmak ölçülmüş bir vakayı
  geriletir. Ama "9 700× kazandırıyor" cümlesi `/v1/answer` için
  **yanlıştır**.
* Şeridin bütçesi (2 500 ms) bu yüzden **her korpus sorusunda** devreye
  giriyor; kazanç bütçeden geliyor, planı seçmekten değil.

Maliyet modeli (aynı 20 000 satır, yalnız taranan metin uzunluğu değişerek,
eşik 0,5): `left 250` 1 021 ms / 661 satır · `left 500` 1 885 ms · `left 1000`
3 667 ms · `left 2000` 7 112 ms · tam metin **16 867 ms / 9 554 satır** —
F-PERF'in ve L-FIX'in doğrusal maliyet tespiti **dördüncü kez** doğrulandı.

### 2.4 Liste uçları (2 000 belge / 2 000+ cevap / 200 dosya), n=5, p50

| Uç | Şekil A | Şekil B | gövde (A) |
|---|---:|---:|---:|
| `GET /v1/health` | 6,3 ms | 5,2 ms | 610 B |
| `GET /v1/files` | 7,2 ms | 4,4 ms | 12 692 B |
| `GET /v1/files?limit=200` | 8,6 ms | 3,8 ms | 49 512 B |
| `GET /v1/matters` (200 dosya) | 10,6 ms | 11,0 ms | 120 813 B |
| `GET /v1/matters/deadlines` | 3,8 ms | 4,3 ms | 67 527 B |
| `GET /v1/answers?limit=20` | 3,0 ms | 2,8 ms | 5 083 B |
| **`GET /v1/answers?fileId=`** | **1,5 ms** | 3,3 ms | 267 B |
| `GET /v1/search/all?q=kira` | 15,6 ms | 19,7 ms | 14 470 B |
| `GET /` (konsol) | 5,7 ms | 5,2 ms | 598 042 B |

ENGRISK'in kabul ölçütlerinin **süre yarısı geçti** (L-VERIFY de geçmişti);
**plan yarısı da bu turda geçti** — §3, V-2.

---

## 3. V-1..V-22 — kalem kalem hüküm

Sütun: **KAPANDI** = kusuru aynı yöntemle yeniden üretmeye çalıştım ve
üretemedim · **İYİLEŞTİ** = ölçülebilir biçimde düzeldi ama kusur duruyor ·
**AÇIK** = kusuru aynen yeniden ürettim.

| # | Kusur (L-VERIFY) | Hüküm | Bu koşuda ölçülen |
|---|---|---|---|
| **V-1** | 20 000 parçada korpus sorusu 47 sn, cevap yok | **İYİLEŞTİ** | Şekil A **47 068 → 9 483 ms** (hâlâ ABSTAIN); gerçekçi şekil B **3 844 ms / PARTIAL / 8 kanıt / 0 bozuk şerit**; belge kapsamlı soru **71–73 ms**. Kalan: seçici korpus sorusu **7 536 ms / ABSTAIN**, 3 şerit bütçeyle kesiliyor (§2.1, §2.3) |
| **V-2** | `answers_filescope_gin` üründe hiç kullanılmıyor | **KAPANDI** | `answerStore.ts:197` artık `a.result -> 'fileScope' @> {...}` gönderiyor. `pg_stat_user_indexes` sayacı **sıfırlandı**, ardından **ürünün kendi 3 HTTP çağrısı** onu **3'e** taşıdı. Ürünün tam sorgusu (left join dâhil) `Bitmap Index Scan on answers_filescope_gin`, `Index Searches: 1`, **1,63 ms**; eski şekil `Seq Scan`, `Rows Removed: 2 058`, **12,37 ms**. Migrasyon yorumu düzeltilmiş ve yanlış şekil `[WRONG]` etiketiyle korunmuş |
| **V-3** | `--with-mcp` açıkken "Karar ara" 502 | **KAPANDI** | `POST /v1/sources/search` artık geçide **ulaşıyor**. **Tarayıcıda iki gerçek arama: 20 künye / 0 başarısız kaynak / 6 605 ms ve 20 künye / 0 başarısız / 6 643 ms.** "Tam metni getir" SHA-256'lı kaynak kartı üretti (1 151 karakter, sağlayıcı BEDESTEN). Ekran açılışta ucu yokluyor ve "Kaynak geçidi bağlı" şeridini çiziyor. **Yeni kusur:** dönen künyeler sorguyla görünür biçimde eşleşmiyor — §6, N-4 |
| **V-4** | `COLLEX_DATA_DIR` ile "Aslını indir" 404 | **KAPANDI** | `COLLEX_DATA_DIR=<scratch>` ile yüklenen belge `<data>/uploads/<sha256>.txt` olarak yazıldı, depo `var/uploads` **boş kaldı**, `GET /v1/files/{id}/original` **200 · 169 bayt · sha256 yüklenenle BİREBİR AYNI** |
| **V-5** | Aktif dosya yokken hesaplanan süre kayboluyor, `HTTP 404` | **KAPANDI** | "Dosyasız çalışma" seçiliyken: `dl-matter` görünür `— dosya seçin —` ile başlıyor, "Dosyaya kaydet" **0 istek** gönderiyor, pencere **açık kalıyor**, sonuç **08.09.2026 yerinde**, geri bildirim Türkçe (*"Dosyasız çalışma — hiçbir kayıt dosyaya bağlanmaz."*), **`HTTP <kod>` yok**. Mutlu yol: dosya seçilince *"Süre dosyaya kaydedildi: 08.09.2026"* ve kayıt `/v1/matters/deadlines`'ta |
| **V-6** | `/v1/answers` `q`/`status` sessizce yok sayılıyor | **KAPANDI** | `?q=zzzzunlikely` → **0 satır**; `?q=depozito` → yalnız eşleşenler; `?status=COMPLETE` → **8 satır, hepsi COMPLETE**; `?status=ABSTAIN` → hepsi ABSTAIN; `?bogus=1` → **400** (`Tanınmayan sorgu parametresi. Kullanılabilir: matterId, fileId, q, status, limit.`); `?status=TAMAMLANDI` → **400** |
| **V-7** | "Alıntı ekle" elenmiş kanıdı uyarısız sunuyor | **KAPANDI** | Pencerede *"Alaka kapısının elediği kaynaklar (7)"* başlığı, her satırda **ALAKASIZ GÖRÜNÜYOR — hukuk alanı bu belgeyle uyuşmuyor** çipi, ve **"Bu alıntıyı ekle" düğmesi onay kutusu işaretlenene kadar `disabled`** (ölçüldü: `true → false`) |
| **V-8** | Modal açıkken Geri alttaki ekranı değiştiriyor | **KAPANDI** | `#taslak → #dosyalarim → pencere aç → Geri`: **modal kapandı, hash `#dosyalarim` değişmedi, görünüm değişmedi**; ikinci Geri `#taslak`'a döndü |
| **V-9** | Modal başlığı yapışkan değil (`top = -560`) | **KAPANDI** | Panel sonuna kadar kaydırıldığında (`scrollTop 2099/2099`) `Kapat (Esc)` **`top = +77 px`, `inView: true`** |
| **V-10** | Profil kaydedince 449 px yerleşim sıçraması | **İYİLEŞTİ** | **İlk kaydetmede 224 px** (`Kaydet` 1 022 → 798 px) — künye bloğu ilk-koşu listesi tamamlanınca 235 → 108 px'e iniyor. **İkinci ve üçüncü kaydetmede 0 px** (798 → 798 → 798). Yani günlük tekrar eden sıçrama gitti; tek seferlik geçiş kaldı. F-UI'nin "0 px" ölçümünü ilk-koşu durumunda **yeniden üretemedim** |
| **V-11** | Şablon amacı ilk noktada kesiliyor | **KAPANDI** | **13/13 kartın amacı tam ifade**; `m.` / `vd.` ile biten **0** kart (`(HMK m.119)`, `(TBK m.502 vd. vekâlet veya m.470 vd. eser…)` bütün olarak duruyor) |
| **V-12** | "Kayıtlı taslaklar" yenilenmiyor | **KAPANDI** | `#taslak`'a her dönüşte **1 adet `GET /v1/drafts?…`** ölçüldü; başka görünümde oluşturulan taslak listede göründü |
| **V-13** | Boş sorguyla "Ara" hiçbir şey yapmıyor | **KAPANDI** | **0 fetch**, **41 px kalıcı doğrulama satırı** (*"Aranacak ifadeyi yazın — arama boş bir sorguyla gönderilmez."*), `aria-invalid="true"` |
| **V-14** | Yedek arşivi her zaman `collex_local.dump` | **AÇIK** | `backup.mjs --database collex_final_test` → arşiv dosyası adı **`collex_local.dump`**; `yedek.json` `"database":"collex_final_test"`, `icindekiler.txt` `dbname: collex_final_test`. Doğrulama sağlam: iyi yedek **exit 0**, 1 bayt bozulan kopya **exit 1** + bozuk dosyanın adı |
| **V-15** | Koyu temada alt metin 4,37:1 / 12,5 px | **KAPANDI (kontrast)** | `--ink-faint` koyu temada `#9a9078` (154,144,120): panel üstünde **5,40:1**, panel-2 üstünde **4,98:1**, paper üstünde **5,74:1** — üçü de AA eşiğinin (4,5) üstünde. **Punto hâlâ 12,5 px** (F-UI 13 px yazmıştı; ben 12,5 ölçtüm); WCAG AA'nın asgari punto şartı olmadığı için kusuru kapandı sayıyorum |
| **V-16** | Dosya sayfasında veritabanı adı | **KAPANDI** | Üst çubuk rozeti *"Veritabanı: bağlı"*; ilk açılış ekranı, belge sayfası ve dosya sayfası görünür metninde `collex_demo` **0 kez**. Teknik ad **yalnız Ayarlar**'da (Sistem durumu + "Verilerim nerede?") |
| **V-17** | Şablon seçilince forma kaydırma yok | **KAPANDI** | `scrollY 0 → 1 170`, `#draftform` görünümün en üstünde (`top 0`), ilk alan `tpl-mahkeme` **görünümde ve odaklı**. *(İlk denememde 0 ölçtüm; sebebi tarayıcı panelinin gizli olması ve `requestAnimationFrame`'in durmasıydı — `scroll-behavior: smooth` hiç ilerlemiyordu. Ölçüm gerçek bir Playwright oturumunda tekrarlandı; §4.0.)* |
| **V-18** | Belge sayfasında çıplak `ANTHROPIC_API_KEY` | **KAPANDI** | Belge sayfası görünür metninde **0 makine kodu, 0 UUID**. Dosyadaki tek geçiş Ayarlar › Sistem durumu satırında ve Türkçe cümlenin **ardından parantezde**: *"Bulut AI kapalı — bulut anahtarı tanımlı değil (ortam değişkeni: ANTHROPIC_API_KEY)"* |
| **V-19** | `.strict()` reddinde boş `path`/`label` | **AÇIK** | `POST /v1/drafts` 400 gövdesi hâlâ `{"path":"","label":"","message":"Tanınmayan alan."}` satırını taşıyor (aynı yanıtta 6 doğru satırla birlikte) |
| **V-20** | 390 px'te dosya tablosu tablo | **KAPANDI** | 390 px'te `table.matters` **289 px**, kabı 347 px, `thead` **gizli** (kart listesi); `documentElement.scrollWidth 375 ≤ 390` |
| **V-21** | Konu dışı soruda karşı-otorite taraması koşuyor | **AÇIK** | `"en iyi balik restorani hangisi"` → `contraryCoverage.executed:true`, iki şerit (`aksi yönde`, `karşı oy`) koştu, markdown'da *"2 karşıt otorite sorgusu çalıştırıldı; karşıt otorite pasajı bulunamadı"* |
| **V-22** | İlk açılışta içerik 537 px'te (%60) | **İYİLEŞTİ** | İlk koşuda künye **235 px**, ilk içerik kartı **336 px (%37)**; profil doldurulduktan sonra künye **108 px**, ilk kart **209 px (%23)**. F-UI'nin 369 px'i ile aynı yönde, benim ölçümüm biraz daha iyi |

**Sayım:** KAPANDI **16** (V-2, V-3, V-4, V-5, V-6, V-7, V-8, V-9, V-11,
V-12, V-13, V-15, V-16, V-17, V-18, V-20) · İYİLEŞTİ **3** (V-1, V-10,
V-22) · AÇIK **3** (V-14, V-19, V-21).

Faz F'nin kendi iddiası "19 kapandı, 1 kısmî, 3 açık" idi. Fark, F-PERF'in
"V-1 kapandı", F-UI'nin "V-10 = 0 px" ve "V-22 %41" iddialarını **kapandı
saymamamdan** geliyor; üçünü de §3'te sayıyla gerekçelendirdim.

---

## 4. Tarayıcı yürüyüşü — avukat gibi

### 4.0 Yöntem ve bir ölçüm hatasının dürüst kaydı

Kurulum: `serve.mjs --port 8974 --mcp-port 8984 --with-mcp --dsn …collex_demo`,
`COLLEX_DATA_DIR` scratch'te. `/v1/health` → `db:"ok"`, `dbName:"collex_demo"`,
`migrations 13/13`, `rls {expected:18, present:18}`, `mcp:"ok"`,
`ai.configured:false, liveTested:false`, `templates:13`, `deadlineRules:41`,
`version:"1.0.0"`, `registeredToolCount:54`.
`/v1/research/health` → `{"gateway":"ok","toolCount":54,"state":"ok"}`.

**Ölçüm hatası ve düzeltmesi.** Yürüyüşün ilk yarısını gizli bir tarayıcı
panelinde yaptım. O panelde `requestAnimationFrame` durduğu için sayfanın
`html { scroll-behavior: smooth }` kuralıyla yapılan **her kaydırma
ilerlemiyordu** (`window.scrollTo(0,400)` sonrası `scrollY 0`). Bu, V-17'yi
yanlışlıkla "açık" göstermişti. Kaydırmaya bağlı bütün ölçümler gerçek bir
Playwright oturumunda **yeniden alındı** ve rapordaki sayılar o turdandır.
Bunu yazıyorum çünkü bir sonraki denetçi aynı tuzağa düşebilir.

### 4.1 Adım adım

| Adım | Ölçülen |
|---|---|
| **İlk açılış** (1440×900, açık tema) | Künye 235 px, ilk içerik 336 px (%37); üç maddelik ilk-koşu listesi; görünür metinde `collex_demo` / UUID / makine kodu **0** |
| **Profil** | Ayarlar'da ad/unvan/baro/sicil/telefon/e-posta/şehir dolduruldu, `Kaydet` → *"Ayarlar kaydedildi."*; ilk kaydetmede 224 px yerleşim geçişi, sonraki iki kaydetmede **0 px** |
| **Dosya aç** | `+ Yeni dosya` → başlık/müvekkil/karşı taraf/mahkeme/esas no → **3 tık = 1 POST, 1 satır** (çift tık koruması tuttu) |
| **Belge yükle** | `kira-sozlesmesi.txt` yükleme alanından yüklendi; **aktif dosyaya otomatik bağlandı** (`matterId` + `matterTitle` liste satırında); ön inceleme taraflar (`Ali Yılmaz — kiralayan`, `Veli Kaya — kiracı`), **Eşleşen** (`6098 sayılı Kanun m. 342`) / **Belirsiz** atıflar ve numaralı SONUÇ VE İSTEM maddelerini (fesih / tahliye / 148.500,00 TL) çıkardı |
| **Belgeye soru** | *"Depozito ne zaman iade edilir?"* → TAM, 1 kanıt, doğru MADDE 3, `Soru kapsamı: %100`. Uyarı bütçesi **3 blok / 7 cümle / 0 tekrar / 0 makine kodu / 0 UUID** |
| **Atıf denetim raporu** | `asOf` boşken **"Denetimi çalıştır" devre dışı**; tarih girilince rapor: **1 Bulundu · 0 Bulunamadı · 5 Belirsiz**, boş kovanın kendi cümlesi var, **5 belirsiz satırın 5'inde künye hücresi BOŞ** (`title` = *"Künye çözümlenemedi — sistem künye uydurmaz."*), dürüstlük satırı (*"…BÖLÜM ÖNİZLEMELERİDİR…"*) ekranda |
| **Karar arama** | §4.2 |
| **Araştırma (korpus)** | *"dolandiricilik sucunda nitelikli hal var midir"* → ŞERHLİ, 8 kaynak / 7 tespit, `Soru kapsamı: %60`. Uyarı bütçesi **3 blok / 5 cümle / 0 tekrar / 0 makine kodu / 0 UUID**. Cevap kartı **6 135 px (6,8 ekran)** — §6, N-5 |
| **Taslak + editör + alıntı bozma** | §4.3 |
| **Nihai DOCX** | §4.4 |
| **Süre + dosyaya kaydet + takvim/.ics** | §4.5 |
| **Yedekleme kartı** | Ayarlar'da kırmızı *"Henüz hiç yedek alınmadı — verileriniz tek bir diskte."* + şifreli disk uyarısı + geri yükleme anlatımı. Yedeği konsoldan değil, **kendi probe veritabanımda CLI ile** aldım (§4.6) |
| **Yeniden başlatma** | §4.7 |

**Konsol kapısı.** Bütün yürüyüş boyunca **yakalanmamış JavaScript istisnası
0**, **yakalanmamış promise reddi 0**. Tarayıcı ağ günlüğüne düşen **tek**
hata satırı, "Karar ara" ekranının **bilerek geçersiz** geçit yoklamasıdır
(`POST /v1/sources/search` → 400) — F-UI §7.1'de zaten dürüstçe kayıtlı.

**Yatay kayma.** 1440 px: 12/12 görünümde yok (`scrollWidth` 1 425, `#harc`
1 440). **960 px (= 1440 @ %150): 13/13 görünümde yok** (945, `#harc` 960).
**390 px: açık temada 13/13, koyu temada 13/13 yok** (`scrollWidth 375`).

### 4.2 "Karar ara" — wave'in ilk gerçek künyeleri

```
POST /v1/sources/search {"query":"tahliye taahhüdü","sources":["yargitay"]}   (curl)
  -> 502 ALL_SOURCES_FAILED, failedSources[0] = Yargıtay / UNAVAILABLE
     trace: search_bedesten_unified, ok:false, 133 ms      <-- istek GEÇİDE ULAŞTI
```

Tarayıcıdan, varsayılan kaynak kümesiyle (2 kaynak):

```
"tahliye taahhüdü"        -> 2 kaynak cevap verdi · 0 başarısız · 20 künye · 6 605 ms
"kamulaştırmasız el atma" -> 2 kaynak cevap verdi · 0 başarısız · 20 künye · 6 643 ms
"Tam metni getir" (1 satır) -> kaynak kartı: SHA-256 ffe1c8474ef2…, 1 151 karakter,
                               konum 0–79, sağlayıcı BEDESTEN, "Kaynağı aç"
```

Ekranın kendi dürüstlük satırı yerinde: *"Aşağıdaki satırlar KÜNYEDİR, kanıt
değildir… Bir kararı dayanak yapacaksanız 'Tam metni getir' ile belgenin
kendisini alın."* Vaporware kapısı da yerinde: geçit yokken form kapalı,
bağlıyken açık (F-UI §4).

**Ama:** iki yapısal olarak farklı sorgu da ağırlıkla **Yargıtay 8. Ceza
Dairesi, 01.07.2026** tarihli kararlar döndürdü ve getirdiğim tek tam metin
(1 151 karakter) sorgu ifadesini **içermiyordu**. Liste satırında eşleşen
cümle olmadığı için avukat bunu ekranda göremiyor. §6, **N-4**.

### 4.3 Alıntı bütünlüğü — tarayıcıda tahrifat

Dava dilekçesi şablonuyla taslak üretildi (kanıt kaynağı: son araştırma).
Alaka kapısı TCK kaynaklarının **hepsini** özel hukuk şablonu için eledi,
bu yüzden HUKUKÎ SEBEPLER paragrafı KAYNAKSIZ çıktı — V-7 penceresinden
onay kutusuyla **K-1 bilerek eklendi** ve alıntı paragrafa **birebir**
yazıldı. Sonra alıntının içinde `157/1 → 158/2` ve `hileli → basit`
değiştirildi:

* **Canlı linter anında:** paragraf `unsup` sınıfına düştü,
  *"kanıt bağı koptu — alıntı metinle örtüşmüyor (geri alın ya da KAYNAKSIZ
  bırakın)"*.
* **`Kaydet` → sunucu:** `issues[0].code = "QUOTE_ALTERED"`, mesaj birebir:
  *"'ev-f4d62195ca825b82' alıntısı paragraf metninde birebir bulunamadı:
  alıntı değiştirildi — kanıt bağı koptu (QUOTE_ALTERED). Atıf yazılmadı;
  paragraf KAYNAKSIZ işaretlendi."* Taslak sürüm **2** oldu.

**Ölçemediğim (L-VERIFY ile aynı sınır):** `409 EXPORT_REFUSED` yolunu
tarayıcıdan **üretemedim**, çünkü PUT katmanı bağı zaten kopardığı için
mağazaya bozuk alıntılı bir taslak giremiyor. İkinci katman
(`export/draft.py`) yalnız süitle kanıtlıdır.

### 4.4 Nihai DOCX — python-docx ile açıldı

`GET /v1/drafts/{id}/export?format=docx&annex=none&marks=none` → **200**,
39 130 B, `content-disposition: … "Dava Dilekcesi - Yilmaz Kira tahliye - v2 -
NIHAI.docx"; filename*=UTF-8''…N%C4%B0HA%C4%B0.docx`.

| Ölçüm | TASLAK kopya | **NİHAİ kopya** |
|---|---:|---:|
| Sayfa | **21,0 × 29,7 cm (A4)** | **21,0 × 29,7 cm (A4)** |
| Kenar boşlukları (Ü/A/S/Sğ) | 3,0 / 2,5 / 2,5 / 2,5 cm | aynı |
| Paragraf (tablo) | 47 (1) | **30 (0)** |
| `bold` run · hizalanmış paragraf | 12 · 37 | **8 · 23** |
| `[K-n]` · `SHA-256` · `collex.` · `hmk-` · UUID | 0 · 0 · 0 · 0 · 0 | **0 · 0 · 0 · 0 · 0** |
| UPPER_SNAKE makine kodu | **1** (`QUOTE_ALTERED`) | **0** |
| Çıplak kanıt kimliği (`ev-…`) | **1** | **0** |
| `EK — DOĞRULAMA` / `DAYANAK KAYNAKLARI` | 0 / 1 | **0 / 0** |

Nihai gövde bir Türk dilekçesi gibi duruyor: mahkeme hitabı **CENTER**,
TARAFLAR / KONU / AÇIKLAMALAR başlıkları, gövde **JUSTIFY**. **Zorunlu
inceleme bandı (3 satır) nihai modda da duruyor** — ADR-024'ün "mürekkebi
silmek disiplini silmez" kuralı sahada tuttu.
TASLAK kopyadaki iki makine dizesi §6, **N-3**.

### 4.5 Süre, dosyaya kayıt, takvim ve `.ics`

HMK m.127 kuralı + başlangıç 25.08.2026 → **08.09.2026** (doğru).
Dosyaya kaydedildi (`matter_items.kind='deadline'`, `payload.ruleId
'hmk-cevap'`, `dueDate 2026-09-08`). Takvim ekranında hücre işaretli,
*"6 gün kaldı"* çipi ve dört renkli lejant var.

`GET /v1/matters/calendar.ics` → **200**, `text/calendar; charset=utf-8`,
991 B: **37 CRLF, 0 çıplak LF**, en uzun satır **75 oktet**,
`BEGIN:VTIMEZONE` + `TZID:Europe/Istanbul`, tüm-gün
`DTSTART;VALUE=DATE:20260908`, `VALARM TRIGGER:-P7D`, ve `DESCRIPTION`
içinde `DEADLINE_DISCLAIMER` **birebir**, RFC 5545 kaçışlarıyla
(`\;` `\,` `\n`). **Gerçek bir takvim istemcisinde açılmadı** (bu makinede
yok) — STATUS'un ilgili doğrulanmamış yüzeyi **aynen duruyor**.

### 4.6 Yedekleme (kendi probe veritabanımda)

```
backup.mjs --database collex_final_test --out <scratch>/yedek
  -> exit 0 · 92,2 MB · 2 belge aslı · yedek.json  collex.backup.manifest/v1
     "database":"collex_final_test" · icindekiler.txt "dbname: collex_final_test"
backup.mjs --verify <klasör>          -> "3 dosyanın tamamı eksiksiz."   exit 0
1 bayt eklenmiş kopya --verify        -> "Yedek BOZUK — eksik: 0, bozulmuş: 1"
                                          + dosya adı                    exit 1
```

Arşivin adı **`collex_local.dump`** — V-14 açık.

### 4.7 Kalıcılık (yeniden başlatma)

Sunucu `collex.stop` ile nazikçe kapatıldı (pid dosyası kayboldu), yeniden
açıldı. **Öncesi/sonrası birebir aynı:** `matters 1 · files 1 · answers 5 ·
drafts 1 (v2) · deadlines 1 · profil "Av. Anıl Eray"`.

---

## 5. Dürüstlük denetimi

### 5.1 Sayı iddiası taraması

`control-plane/public/console.html`, `control-plane/src/**`,
`docs/KULLANIM-ColleX.md`, `KULLANIM-REHBERI.md` üzerinde
`halüsinasyon` · `hallucination-free` · `%N doğru` · `başarı oranı` ·
`kazandırır` · `en iyi` · `avukata gerek kalmadan` · `garanti` →
**tek eşleşme `templates.ts`'teki satış sözleşmesi alanı "Garanti süresi"**,
yani bir dilekçe alanı; performans iddiası **yok**.

Konsolda geçen beş `%N`: `%150` (yakınlaştırma yorumu), `%100` ×2,
`%85` (entailment eşiği), `%70` (`QUOTE_OVERLAP_FLOOR`), `%60`
(bir kod yorumundaki eski ölçüm). Hepsi **kapı sabiti ya da yorum**;
yayımlanmış bir performans iddiası değil. Ekranda görünen tek yüzde ailesi
cevabın kendi ölçerleridir (`Soru kapsamı: %100` / `%60`) ve o cevaptan
hesaplanır.

### 5.2 Yedi tuzak

| # | Tuzak | Hüküm | Bu koşuda ölçülen kanıt |
|---|---|---|---|
| 1 | Sayı iddiası | **RESPEKT** | §5.1 |
| 2 | Kapıları gevşetmek | **RESPEKT** | `DEFAULT_COVERAGE_FLOOR = 0.4` · `ENTAILMENT_THRESHOLD = 0.85` (iki yerde) · `DEFAULT_LEXICAL_MIN_COVERAGE = 0.25` · `QUOTE_OVERLAP_FLOOR = 0.7` · `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS = 8` · `DEFAULT_TRIGRAM_BUDGET_MS = 2500` — hepsi belgelenmiş değerinde |
| 3 | UYAP/UETS kimlik entegrasyonu | **RESPEKT** | `uyap.*(giriş\|login\|şifre\|e-imza\|token)` → **0 eşleşme**; konsol *"Bu çalışma alanı UYAP ile eşitlenmez"* diyor |
| 4 | Bulut bağımlılığı | **RESPEKT** | `package.json` bağımlılıkları değişmemiş: `hono`, `@hono/node-server`, `postgres@^3.4.9`, `zod` (+ dev: `typescript`, `vitest`, `@types/node`). Bütün yürüyüş `ai.configured:false` ile yapıldı |
| 5 | Yanlış eksende parite | **RESPEKT** | `#kapsam` manifestosu boşlukları ilan ediyor; manifestte **32 `null` hücre** (ölçülmemiş = `null`, asla 0) |
| 6 | Dürüstlüğü gürültüye çevirmek | **RESPEKT** | `WARN_BUDGET_BLOCKS = 4`, `WARN_BUDGET_SENTENCES = 8`; §5.3'te ölçüldü |
| 7 | Reklam yasağı + makine metni | **RESPEKT (nihai çıktıda)** | Nihai DOCX'te makine dizesi **0** (§4.4). TASLAK kopyada 2 kalem — N-3 |

### 5.3 Uyarı bütçesi — gerçek cevap ekranlarında

| Ekran | Blok (≤4) | Cümle (≤8) | Birebir tekrar | Ana akışta makine kodu | UUID |
|---|---:|---:|---:|---:|---:|
| Belge sorusu (TAM, 1 kanıt) | **3** | **7** | **0** | 0 | 0 |
| Korpus sorusu (ŞERHLİ, karşıt otorite) | **3** | **5** | **0** | 0 | 0 |

Bütçe **tutuyor**; L-VERIFY'ın ölçtüğü değerlerle birebir aynı.

### 5.4 Uydurma künye imkânsız mı?

Ekranda doğrulandı: 5 çözülemeyen atfın **5'inde künye hücresi boş**,
`title` = *"Künye çözümlenemedi — sistem künye uydurmaz."*; hiçbir yerde
`?`, `—` veya "bilinmiyor" **künye olarak** geçmiyor (`Yürürlük` sütunundaki
`bilinmiyor` bir **durum** etiketidir). `Bulunamadı` kovası boşken kendi
cümlesini yazıyor; çözümlenemeyen atıf `NOT_FOUND` değil **`belirsiz`**.

### 5.5 Doğrulanmamış yüzeylerin etiketleri

`GET /v1/deadlines/rules` → **41 kural · 16 `dogrulandi` · 25 `dogrulanmadi`
· 7 `adliTatileTabi:"belirsiz"`**; her `dogrulanmadi` kaydın `source` alanı
*"…madde metni doğrulama turunda çekilmedi… mevzuat.gov.tr'de açıp
karşılaştırın."* diyor.
`GET /v1/fees/tariffs?year=2026` → **20 kalem · 5 `dogrulandi` · 15
`dogrulanmadi` · 17 `amount: null`**, `disclaimer` dolu.
`/v1/health` → `ai.liveTested:false`, `rls {expected:18, present:18}`,
`registeredToolCount:54`, `version:"1.0.0"`.
`openapi.yaml` → **65 yol · 80 işlem · `info.version` 1.0.0** (S8 sağlam).
Konsolda `deneysel` 6 kez, `canlı sınanmadı` 5 kez geçiyor; UDF her yüzeyde
`deneysel` etiketli.

### 5.6 Konsol güvenlik sözleşmesi

`console.html`: **CR baytı 0**, `<style>` **1**, `<script>` **1**.
`console.test.ts`'in yasakladığı yedi kalıbın (üç markup-atayan DOM API'si,
belgeye doğrudan yazan eski API, iki dinamik-kod çalıştırma yolu ve
`srcdoc` özniteliği) **hiçbiri dosyada geçmiyor — yedisi de 0 eşleşme**.
127.0.0.1 dışı `http(s)://` referansı **0**. Dosya boyutu 598 042 B.

---

## 6. Ayakta kalan kusurlar — sıralı, tekrar üretme adımlarıyla

### P1

**N-1 · Ürünün gerçek trigram eşiğinde (0,35) "seçici sorgu" diye bir şey
yok; seçici korpus sorusu artık en yavaş korpus sorusudur.**
Tekrar üretme: 20 000 parçalık korpus,
`POST /v1/answer {"question":"kuantum mekaniginde dalga fonksiyonu"}`.
Ölçülen: **p50 7 536 ms / p95 7 553 ms, ABSTAIN**, `retrieve 7 580 ms`,
üç şerit de `TRIGRAM_BUDGET_EXCEEDED`. Aynı SQL `EXPLAIN` ile 0,35 eşiğinde
**18 069 ms** (`Bitmap Index Scan rows=20000`, `Rows Removed by Filter:
20000`), 0,5 eşiğinde **2,06 ms** (`rows=0`).
Etki: (a) avukat, korpusta hiç geçmeyen bir ifadeyi sorduğunda **7,5 saniye
bekleyip boş cevap** alıyor; (b) `TRIGRAM_SEQSCAN_SETTING` çekicinin
`/v1/answer` yolunda ölçülen faydası yok (32 620 ↔ 32 852 ms); (c) L-VERIFY
ve F-PERF'in "seçici sorgu ≈9 700× / 0,329 ms" satırları **ürünün cevap
yolunun kullanmadığı bir eşikte** alınmıştır ve bu hâliyle yanıltıcıdır.
Önerilen (bu hattın işi değil): eşiği ürünün gerçek değerinde ölçen bir plan
gerileme testi; `trigramMinSimilarity`'nin şerit maliyetine etkisinin
belgelenmesi.
*Uyarı: bu ölçüm 200 sözcüklük bir dağarcıktan üretilmiş korpustadır. Gerçek
Türk hukuk metninde 0,35'in seçiciliği farklı olabilir; ölçmedim.*

**N-4 · "Karar ara" artık çalışıyor ama dönen künyelerin sorguyla
eşleştiği ekranda görülemiyor.**
Tekrar üretme: `--with-mcp` ile sunucu, `#karar-ara`, varsayılan iki kaynak,
sırayla `tahliye taahhüdü` ve `kamulaştırmasız el atma`.
Ölçülen: her ikisinde **20 künye / 0 başarısız kaynak**; her iki listede de
satırların çoğu **Yargıtay 8. Ceza Dairesi, karar tarihi 01.07.2026**;
getirdiğim tek tam metin (11. Hukuk Dairesi, 1 151 karakter) sorgu ifadesini
**içermiyordu**. Liste satırında eşleşen cümle yok.
Etki: avukat 20 satırın hangisinin işine yaradığını ancak tek tek tam metin
çekerek anlayabilir — rakiplerin en güçlü olduğu eksende.
**Ölçmediğim:** iki sorgu bir ilgililik denetimi değildir; sıralamayı kaynak
sunucunun kendisi mi yoksa ColleX'in gönderdiği parametreler mi belirliyor,
bu hatta izlenmedi.

**V-14 · Yedek arşivi her zaman `collex_local.dump` adını taşıyor.**
(§4.6.) Etki bugün küçük — `ColleX-Geri-Yukle.cmd`'nin
`if not exist "%SRC%\collex_local.dump"` kontrolü bu yüzden tesadüfen
çalışıyor — ama manifest başka bir veritabanı adı yazarken dosya adının
sabit olması, iki farklı kurulumun yedeğini yan yana koyan kullanıcıyı
yanıltır.

**V-19 · `.strict()` reddinde bir `issue`'nun `path` ve `label`'ı boş.**
`POST /v1/drafts` yanlış gövdeyle → `{"path":"","label":"","message":"Tanınmayan
alan."}`. Aynı kusur F-API §7(6)'da `matters/routes.ts` için de bildirilmişti.

**V-21 · Konu dışı soruda karşı-otorite taraması koşuyor.**
`"en iyi balik restorani hangisi"` → `contraryCoverage.executed:true`,
2 sorgu, ekranda *"2 karşıt otorite sorgusu çalıştırıldı"*. İki gereksiz
şerit sorgusu, ve avukata hukukî bir işlem yapılmış izlenimi.

### P2

**N-2 · Ayarlar "Verilerim nerede?" `COLLEX_DATA_DIR` kurulumunda yanlış
klasörü gösteriyor ve avukatın önüne çıplak bir yol koyuyor.**
Ölçülen: `COLLEX_DATA_DIR=<klasör>` ile açılan sunucuda asıl
`<klasör>/uploads/<sha256>.txt` olarak yazıldı (diskte doğrulandı), depo
`var/uploads` **0 dosya** kaldı; buna rağmen Ayarlar metni *"yüklediğiniz
belgelerin aslı depo klasöründeki **var/uploads** altında durur"* diyor.
F-API §7(4) bunu üç dosyada birlikte düzeltilmesi gereken kalem olarak
bildirmişti; **hâlâ açık**.

**N-3 · TASLAK modundaki DOCX gövdesinde iki makine dizesi var.**
Ölçülen (python-docx): `QUOTE_ALTERED` ×1 ve çıplak kanıt kimliği
`ev-f4d62195ca825b82` ×1, ikisi de Türkçe bir cümlenin **başında/içinde**.
NİHAİ kopyada **0**. Kural (B-27) "makine kodu tek başına durmaz" olduğu
için sınırda; yine de dışa aktarılan bir belgede çıplak `ev-…` kimliği
avukata bir şey söylemiyor.

**N-5 · Korpus cevap kartı büyümüş.** Ölçülen: `#out` **6 135 px
(6,8 ekran)**; L-VERIFY aynı sınıf cevapta 5 842 px (6,5 ekran), UXAUDIT
6 804 px ölçmüştü. UXAUDIT P1-6 "tespit kartları katlanmıyor" gözlemi
duruyor.

**N-6 · Yeni açılan dava dosyası aktif dosya olmuyor.**
Tekrar üretme: `+ Yeni dosya` → `Dosyayı aç`. Ölçülen: `#matterselect`
listede yeni dosyayı gösteriyor ama `value` **`""`** (Dosyasız çalışma)
kalıyor. Avukat üst çubuktan seçmezse bir sonraki yükleme ve cevap dosyaya
bağlanmaz. V-5'in kapatılan yarısıyla aynı aileden, küçük bir günlük-akış
tuzağı.

**V-10 kalıntısı** (ilk kaydetmede 224 px geçiş) ve **V-22 kalıntısı**
(ilk içerik %37 / %23) §3'te sayıyla yazılı; ikisi de artık cila
seviyesindedir.

---

## 7. Ölçülen sayılar tablosu (STATUS.md'ye hazır)

> L-DOCS'a: aşağıdaki satırlar **02.09.2026, F-VERIFY** koşusunda ölçüldü.

| # | Komut / yüzey | Ölçülen çıktı | Exit |
|---|---|---|---:|
| S1 | `control-plane> npx tsc --noEmit` | temiz | 0 |
| **S2‴** | `control-plane> npx vitest run` | **102 dosya · 2 086 geçti · 0 düştü · 6 atlandı (2 092)** · 23,64 sn | 0 |
| S3 | `pytest tests evals/tests -q` | **1 339 passed** · 129,19 sn | 0 |
| S4 | `scripts/smoke_check.py` | **54 tool** | 0 |
| S5 | `scripts/db_local_check.py` | **19/19 PASS** | 0 |
| **S6‴** | `scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS**; atıf çözülebilirliği %100 (128), alıntı/hash 35/35, uydurma kimlik 0, sızıntı 0; Recall@5 **0,9429**; retrieval p50/p95 **7,5 / 20,3 ms**; kesinleştirilebilir **%85,7 (18/21)**; cevap katmanı yanlış çekimserlik **0**; şerit dağılımı `exact=36, lexical=67, trigram=5, dense=0, relation=17, citation=12` | 0 |
| S7 | `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** | 0 |
| S8 | `openapi.yaml` | **65 yol · 80 işlem · `info.version` 1.0.0** | — |
| S10 | `GET /v1/deadlines/rules` | **41 kural · 16 dogrulandi · 25 dogrulanmadi · 7 belirsiz** | — |
| S11 | `GET /v1/fees/tariffs?year=2026` | **20 kalem · 5 dogrulandi · 17 `amount:null`** | — |
| S13 | `GET /v1/health` | `registeredToolCount 54` · `migrations 13/13` · `rls {expected:18, present:18}` · `mcp:"ok"` (`--with-mcp`) · `ai.liveTested:false` · `version "1.0.0"` | — |
| **S25″** | **B-06 · `/v1/answer`, 20 000 parçalık probe (`collex_final_test`, ort. 4 976 kod noktası), gerçek HTTP, n=5** | **Yalnız kiracı korpus (L-VERIFY şekli):** yaygın sözcük **p50 9 483 / p95 9 597 ms**, ABSTAIN (L-VERIFY 47 068 ms). **Gerçekçi korpus (1 900 public):** yaygın sözcük **p50 3 844 ms, PARTIAL, 8 kanıt, 0 bozuk şerit**; uzun soru **4 072 ms**. **Seçici sorgu 7 536 ms, ABSTAIN, 3 şerit bütçeyle kesildi.** **Belge kapsamlı soru 71–73 ms, COMPLETE.** Uyarılarda sürücü metni **yok**, yerinde `TRIGRAM_BUDGET_EXCEEDED` | — |
| **S26″** | **B-06 · trigram şeridi planı, aynı probe** | **Ürünün gerçek eşiği 0,35:** doymuş **32 620 ms** (`enable_seqscan` açık 32 852 — **fark yok**), **seçici de `rows=20000` ve 18 069 ms** (açık 17 982 — **fark yok**). **Eşik 0,5'te:** doymuş 33 647 ms, seçici **2,06 ms** (`enable_seqscan` açık 18 115 ms → **8 800×**). Maliyet modeli: `left 250` 1 021 ms … tam metin **16 867 ms** | — |
| **S27″** | **B-32 · `GET /v1/answers?fileId=` ve liste uçları** | Ürünün kendi sorgusu **`Bitmap Index Scan on answers_filescope_gin`, `Index Searches: 1`, 1,63 ms**; eski şekil `Seq Scan`, `Rows Removed: 2 058`, **12,37 ms**. `idx_scan` sıfırlandı → **3 ürün çağrısı → 3**. Uçta **p50 1,5 ms**. `/v1/files` **7,2 ms · 12 692 B** · `/v1/matters` (200) 10,6 ms · `/v1/search/all` 15,6 ms | — |
| **S28″** | **B-03 · yedek/doğrulama (`collex_final_test`)** | `backup.mjs` **92,2 MB · 2 asıl · `collex.backup.manifest/v1`**; `--verify` **exit 0**; 1 bayt bozulan kopya **exit 1** + bozuk dosyanın adı. Arşiv adı hâlâ `collex_local.dump` (V-14) | 0/1 |
| **S29″** | **B-27 · uyarı bütçesi, gerçek cevap ekranları (tarayıcı)** | Belge sorusu **3 blok / 7 cümle**; korpus sorusu **3 blok / 5 cümle**; her ikisinde **0 tekrar, 0 makine kodu, 0 UUID**. Tavan 4/8 | — |
| **S30″** | **B-28 · erişilebilirlik / responsive (tarayıcıda hesaplandı)** | Koyu temada `--ink-faint` **5,40 / 4,98 / 5,74 : 1** (panel / panel-2 / paper; eşik 4,5). Yatay taşma **yok**: 1440 px 12/12, **960 px 13/13**, **390 px açık 13/13 ve koyu 13/13**. Yakalanmamış JS istisnası **0**, promise reddi **0** | — |
| **S31″** | **B-02 · nihai DOCX (python-docx)** | **A4 21,0 × 29,7 cm**, kenar 3,0/2,5/2,5/2,5 cm, **30 paragraf / 0 tablo / 8 bold / 23 hizalı**; `[K-n]` · SHA-256 · `collex.` · `hmk-` · UUID · UPPER_SNAKE · `ev-…` **hepsi 0**; inceleme bandı duruyor | — |
| **S32″** | **B-16 · gerçek kaynak araması (`--with-mcp`, tarayıcı)** | İki sorgu: **20 künye / 0 başarısız kaynak / 6 605 ms** ve **20 künye / 0 başarısız / 6 643 ms**; "Tam metni getir" → SHA-256'lı kaynak kartı, 1 151 karakter, sağlayıcı BEDESTEN. **İlgililik ölçülmedi** (N-4) | — |
| **S33** (yeni) | **`.ics` akışı** | 200 · `text/calendar` · 991 B · **37 CRLF / 0 çıplak LF** · en uzun satır **75 oktet** · `VTIMEZONE Europe/Istanbul` · `DTSTART;VALUE=DATE` · `TRIGGER:-P7D` · `DEADLINE_DISCLAIMER` birebir. **Gerçek takvim istemcisinde açılmadı** | — |

---

## 8. "Apilex ve De Jure'den daha iyi mi?" — tek paragraflık dürüst cevap

**Bu avukat için, bu makinede: dayanak işinde açık ara evet, arama işinde
artık "kısmen" — ama hâlâ değil.** ColleX'in rakiplerinde bulunmayan iki
şeyi bu koşuda kendi elimle doğruladım: (1) her cümlenin arkasındaki alıntıyı
kimliğe bağlıyor ve avukat o alıntıdaki tek bir rakamı değiştirdiğinde bağı
**anında koparıyor** (`QUOTE_ALTERED`, atıf yazılmıyor, paragraf KAYNAKSIZ);
(2) müvekkil verisi bu bilgisayardan çıkmıyor, yedeği alınabiliyor,
doğrulanabiliyor ve **bozulmuş bir yedeği reddediyor**. Buna nihai dilekçenin
**A4, biçimli ve içinde tek bir makine dizesi olmadan** çıkması, 41 kurallık
süre hesabının hangi maddeye dayandığını ve **25'inin doğrulanmadığını**
söyleyerek çalışması, çözemediği künyeyi **boş bırakması** ve uyarıların
**3 blok / 7 cümle**'yi geçmemesi eklenince, tek kişilik bir büroda "bu
cümlenin dayanağı ne, süre ne zaman doluyor, bu dilekçe imzaya hazır mı"
işleri için ColleX bugün rakiplerinden **daha güvenilir** bir araçtır.
**Arama tarafında ise tablo bu wave'de gerçekten değişti ama yetmedi:**
"Karar ara" ilk kez çalıştı ve bu koşuda iki sorguda **20'şer gerçek künye**
döndürdü — L-VERIFY'ın "tek bir künye bile döndüremiyor" cümlesi artık
geçerli değil. Ne var ki dönen satırlar sorguyla görünür biçimde eşleşmiyor,
liste eşleşen cümleyi göstermiyor ve çektiğim tek tam metin aradığım ifadeyi
içermiyordu (N-4); yerel korpusta da 20 000 parçaya çıkıldığında yaygın bir
sözcük **3,8 saniye**, korpusta hiç geçmeyen bir ifade **7,5 saniye sürüp
boş** dönüyor (V-1, N-1). Yani avukat "dayanağımı doğrula, süremi hesapla,
dilekçemi imzaya hazırla" için ColleX'i açar; "bu konuda hangi kararlar var"
için hâlâ Apilex'i veya De Jure'yi açar, çünkü onların sattığı şey geniş bir
havuzda **iyi sıralanmış** aramadır ve ColleX'in bu koşuda ölçülen sıralaması
o değildir. Son ve en önemli sınır: buradaki her kalite ölçümü **sentetik**
korpusta yapıldı; ColleX'in hukukî isabeti gerçek Türk mevzuatı ve içtihadı
üzerinde **hiç ölçülmedi**, ve o ölçüm yapılana kadar "daha iyi" sözü yalnız
**disiplin** için geçerlidir, **kapsam ve isabet** için değil.

---

## 9. Bir sonraki hatta önerilen sıra

1. **N-1** — trigram şeridinin maliyetini ürünün **kendi eşiğinde** (0,35)
   ölçen bir plan gerileme testi; `trigramMinSimilarity`'nin şerit maliyetine
   etkisi belgelensin. Seçici korpus sorusunun 7,5 sn'si ya kapatılsın ya da
   **arayüzde söylensin** (ilerleme satırı + iptal).
2. **N-4** — "Karar ara" satırlarına kaynağın kendi eşleşen cümlesi konsun;
   hiç yoksa satırda "eşleşen cümle sağlanmadı" yazsın. İlgililiğin gerçekten
   ölçülmesi ayrı bir hattır.
3. **N-2** — "var/uploads" metni `files/routes.ts` + `packageRoutes.ts` +
   `openapi.yaml` + Ayarlar metninde **birlikte** `<veri klasörü>/uploads`
   olsun.
4. **V-19** — zod `.strict()` `issue.path` boş kalıyor; `/v1/drafts` ve
   `/v1/matters/{id}/items` için tek elden düzeltilsin.
5. **V-21** — karşıt otorite şeridi, birincil şerit 0 pasaj döndürdüğünde
   hiç koşmasın (konu dışı soru testi).
6. **V-14** — arşiv dosyası `<veritabanı adı>.dump` olsun; geri yükleyici
   manifestten okusun.
7. **N-3, N-5, N-6** ve V-10/V-22 kalıntıları tek bir cila dalgasında.

---

## 10. Hijyen

* Açtığım her sunucu **nazikçe** kapatıldı (`collex.stop`; pid dosyası
  kayboldu). `netstat`: **8974 ve 8984'te dinleyici yok**; **8787/8898'e hiç
  dokunulmadı**. `COLLEX_DATA_DIR` scratch'e verildiği için depo `var/`
  altına **hiçbir pid dosyası yazılmadı**; `var/uploads` koşu öncesi ve
  sonrası **0 dosya**.
* `collex_final_test` kuruldu, ölçüldü ve koşu sonunda **düşürüldü**.
  `pg_database` listesinde geriye `collex_demo`, `collex_eval_test`,
  `collex_local`, `collex_mig_test`, `collex_quality_test`,
  `collex_retrieval_test` kaldı.
* **`collex_local`'a hiç bağlanılmadı**, hiç yazılmadı, düşürülmedi.
* `collex_demo` koşu sonunda `demo.mjs --force-drop-uploads` ile **yeniden
  kuruldu** (`--force-drop-uploads` yalnız **kendi** probe yüklemem için):
  6/6 senaryo PASS; `legal.documents 7`, `matters` / `answers` / `drafts` /
  `matter_items` / `settings` **0**.
* Playwright'ın çalışma alanı köküne düşürdüğü **kendi** iki artefaktım
  scratchpad'e taşındı; başka hatlara ait eski dosyalara **dokunulmadı**.
* Devlet upstream'lerine giden istekler: `POST /v1/sources/search` × 3
  (biri curl, ikisi tarayıcıdan) ve bir tam metin çekimi. Hepsi tek tek,
  **paralel değil**. Başka hiçbir dış çağrı yapılmadı.
* `.env` okunmadı, Supabase/Resend kullanılmadı, **hiçbir git işlemi
  yapılmadı**, MCP araç yüzeyi (54) ve API sözleşmesi **değişmedi**.
* Bütün geçici dosyalar `…/scratchpad/w14f-F-VERIFY/` altında.

### Değişen depo dosyaları

```
docs/implementation/waves/W14-F-VERIFY.md              (bu dosya — TEK elle yazılan dosya)
evals/reports/fixture_baseline_2026-09-02.{json,md}    (eval kapısının KENDİ çıktısı, komut 8)
demo-output/report.md                                  (demo.mjs'in KENDİ çıktısı, komut 9)
```
