# W14 — C-FINAL (Faz C kapanışı): son bağımsız ölçüm ve belge uzlaştırması

**Tarih:** 03.09.2026 · **Tip:** ÖLÇÜM + BELGE — bu hat **hiçbir koda ve
hiçbir teste dokunmadı**. Dokunduğu dosyalar: `docs/**`, `CLAUDE.md` ve
`control-plane/src/api/openapi.yaml` (yalnız **eklemeli** alanlar ve
açıklama metinleri).
**Portlar:** 8977 (sunucu) · 8987 (MCP geçidi) — koşu sonunda ikisinde de
dinleyici yok; **8787/8898'e hiç dokunulmadı**.
**Veritabanları:** `collex_demo` (probe; `demo.mjs` düşürüp yeniden kurdu),
`collex_eval_test` (`run_evals.py`'nin kendi veritabanı), `collex_mig_test`
(`db_local_check.py`'nin kendi veritabanı), vitest süitlerinin kendi
veritabanları. **`collex_local`'a hiç bağlanılmadı, hiç yazılmadı,
düşürülmedi.**
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, dış ağa
hiçbir istek gitmedi, MCP yüzeyi (54) değişmedi.

> Bu raporda **kendi ölçümüm** olarak yazdığım her sayı 03.09.2026'da bu
> makinede ölçüldü. Başka bir hattın sayısını aktardığım her yerde hattın
> adı yazılıdır ve o sayı **benim ölçümüm değildir**. Ölçek sayıları
> **SENTETİK** probe korpuslarındadır; hiçbiri hukukî kalite ölçüsü
> değildir.

---

## 0. Yönetici özeti

**Ölçüm turunda dokuz komutun dokuzu da exit 0** ve düşen tek bir test yok.
Ama "üç kez tekrarla, gerçek mi çekişme mi ayır" adımı **yine de gerekti** —
sadece beklenmedik bir sebeple: iki ölçüm aracının kendisi koşudan koşuya
oynadı. Her ikisini de tekrarlayarak karakterize ettim (`run_evals.py` 4 kez,
`vitest` 6 kez + tek dosya 6 kez) ve ikisi de **çekişme değil**.

**Ama iki ölçüm aracı oynadı ve bu turun yeni bulguları onlardır.** `run_evals.py`'yi
aynı ağaçta, tek başıma, arka arkaya **dört kez** koşturdum. Altı sert kapı
dördünde de PASS; retrieval metrikleri ve şerit dağılımı dördünde de rakam
rakam aynı. **Rapor amaçlı cevap katmanı ise oynadı:** COMPLETE 12–14,
QUALIFIED 4–6, kesinleştirilebilir oran **%85,7 üç kez, %81,0 bir kez**, ve
**bir koşuda bir yanlış çekimserlik** (`fx-amend-002`). Bu, bu belge setinin
birkaç cümlesini zayıflatıyor ve **N-7** olarak kaydedildi (§2).

**Faz C'nin iki hattının kapattığı üç kalemi kendi elimle yeniden ölçtüm**
(V-14, V-19, V-21) ve üçü de kapalı çıktı (§3). C-UI'nin tarayıcı ölçümlerini
**yeniden üretmedim** ve bunu STATUS'ta açıkça yazdım; onların yerine o
düzeltmeleri pinleyen `console.test.ts` süitinin **165/165 geçtiğini** ölçtüm
ve ilgili dizeleri konsol dosyasında grep ile doğruladım.

**İkincisi: `npx vitest run`'ın kendisi de deterministik değil.** Altı tam
koşunun **altısı yeşil, biri kırmızı**; düşen tek test `trigramBudgetMs: 1`
verip şeridin kesilmesini bekliyor ve sorgu bir kez 1 ms'nin altında bitti.
Aynı dosya tek başına altı kez koştu ve altısında da geçti. **Ürün doğru
davrandı; test duvar saatine yaslanıyor.** Bu **N-7**'nin kardeşi olan
**N-8**'dir (§2.2) ve teste dokunmadığım için düzeltilmedi.

**Bugünkü sayım:** V-1..V-22 = **21 kapandı · 1 iyileşti, kapanmadı (V-1)** ·
N-1..N-6 = **4 kapandı · 1 kısmî (N-4) · 1 belgelendi, kapanmadı (N-1)** ·
**N-7 ve N-8 açık**. Statü sözcüğü **PARTIAL** ve bu turda da
yükseltilmedi.

---

## 1. Tam ölçüm turu (sıralı, tek başına, 00:50–00:56)

| # | Komut | Ölçülen çıktı | Süre | Exit |
|---|---|---|---:|---:|
| 1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | 7,2 sn | **0** |
| 2 | `control-plane> npx vitest run` | **103 dosya · 2 114 geçti · 0 DÜŞTÜ · 6 atlandı (2 120)** | 22,76 sn | **0** |
| 3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 347 passed** | 129,92 sn | **0** |
| 4 | `scripts/smoke_check.py` | `offline smoke checks passed: 54 tools, court inventory, shared limiter, disabled-key errors, HTTP auth` | 7,3 sn | **0** |
| 5 | `scripts/http_e2e_check.py` | `authenticated HTTP MCP handshake passed: 54 tools` | 9,2 sn | **0** |
| 6 | `scripts/live_local_gateway_check.py` | `PASS tools/list — exactly 54 tools (offline surface)`; 401 without token | 8,0 sn | **0** |
| 7 | `scripts/db_local_check.py` | **19/19 PASS** (`collex_mig_test`, 13 migrasyon; c15 `hearing` kabulü + `expense` reddi + 3 indeks) · `RESULT: PASS` | 3,1 sn | **0** |
| 8 | `scripts/run_evals.py --run-date 2026-09-02` | **RESULT: PASS** (6/6 sert kapı) — §2 | 3,2 sn | **0** |
| 9 | `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** (S1 8/8 · S2 8/8 · S3 7/7 · S4 7/7 · S5 7/7 · S6 10/10) | 3,9 sn | **0** |

Süreler benim sarmalayıcımın duvar saatidir; komutların kendi bildirdiği
süreler (vitest 22,76 sn, pytest 129,92 sn) tablodadır.

**Düzenlemeden sonra ikinci kapı.** `openapi.yaml`'a ve `CLAUDE.md`'ye
dokunduğum ve ikisini de **okuyan testler olduğu** için
(`tests/files/dataFolderWording.test.ts`,
`tests/pipeline/retrievalProvenance.test.ts`, `tests/integration/lfix.test.ts`),
düzenleme bittikten sonra `npx tsc --noEmit` ve `npx vitest run` **yeniden
koşuldu**. `pytest` yeniden koşulmadı — Python süitinde `docs/**` ya da
`openapi.yaml` okuyan **tek bir dosya yok** (grep ile doğrulandı), yani bu bir
çıkarım değil, dosya bağımlılığının yokluğudur.

**Ve tam bu ikinci kapıda süit bir kez kırmızıya döndü.** Bu, bu turun
**ikinci** yeni bulgusudur ve §2.2'de ölçüldü (**N-8**). Kısaca: altı tam
koşunun altısı yeşil, biri kırmızı; düşen tek test **kendi duvar saatine
yaslanan** bir testtir ve ürün her iki koşuda da doğru davrandı. Süit
sayıları tablosu (S2) o koşuyu değil, **altı yeşil koşunun ortak sonucunu**
yazıyor ve çekinceyi satırın içinde söylüyor. Kapanış turunda `tsc` temiz ve
süit **103 dosya · 2 114 geçti · 0 düştü · 6 atlandı** ile yeşil bitti.

### 1.1 vitest'in seyri ve 6 atlaması

**2 086 → 2 114 (+28)** ve **102 → 103 dosya**. Artışın kaynağı iki cila
hattıdır: C-SRV vitest'e 14 test + 1 yeni dosya
(`tests/files/dataFolderWording.test.ts`), C-UI 13 test ekledi. Atlayan 6
test bilinen **ters işaretleyicilerdir** ("environment unavailable"); altı
gerçek süitin altısı da koştu ve çıktıda görülüyor:
`integration/real-exec` 3 test (1 atlanan işaretleyici, 4,76 sn),
`integration/serve` 6 test (`--with-mcp` süreç-listesi kontrolü dâhil,
22,02 sn), `store/persistence` 24 test, `integration/backup` 13 test,
`store/retrieval` 47 test, `matters/pg`.

Faz C'nin kendi süitleri de yeşil: `tests/pipeline/console.test.ts` **165**,
`tests/api.test.ts` **58**, `tests/pipeline/answerPipeline.test.ts` **43**,
`tests/integration/backup.test.ts` **13**,
`tests/files/dataFolderWording.test.ts` **3**.

pytest **1 339 → 1 347 (+8)**: C-SRV'nin
`tests/export/test_marked_copy_discipline.py` dosyası.

---

## 2. İki ölçüm aracı çekincesi — N-7 ve N-8

Bu turun iki yeni bulgusu da **ürün kusuru değil, ölçüm aracı kusurudur**.
İkisini de burada tutuyorum çünkü ikisi de aynı aileden — bir eşitliği
**duvar saatine** bağlamak — ve ikisi de bu belge setinin iddialarını
doğrudan zayıflatıyor.

### 2.1 N-7 — eval kapısının cevap katmanı koşudan koşuya oynuyor (P1)

**Yöntem.** `run_evals.py --run-date 2026-09-02`, aynı ağaç, aynı komut,
**dört ardışık koşu**, her biri tek başına ve ön planda. Aralarında hiçbir
dosya değişmedi.

| Ölçüm | Koşu 1 | Koşu 2 | Koşu 3 | Koşu 4 |
|---|---|---|---|---|
| **Altı sert kapı** | PASS | PASS | PASS | PASS |
| Recall@5 / @10 / @20 | 0,9429 / 1,0000 / 1,0000 | aynı | aynı | aynı |
| nDCG@10 · MRR | 0,9156 · 0,9024 | aynı | aynı | aynı |
| Karşıt otorite recall (n=3) | 1,0000 | aynı | aynı | aynı |
| Atıf çözülebilirliği · alıntı/hash | %100 (128) · 35/35 | aynı | aynı | aynı |
| Uydurma kimlik · kiracı sızıntısı | 0 · 0 | aynı | aynı | aynı |
| Şerit dağılımı | `exact=36, lexical=67, trigram=5, dense=0, relation=17, citation=12` | aynı | aynı | aynı |
| Cevap katmanı çekimserlik kesinlik/recall | %100 / %100 | aynı | aynı | aynı |
| Cevap katmanı **TRIPWIRE** yanlış çekimserlik | 0 | 0 | 0 | 0 |
| Beklenen gold birimi atıfta | %95,2 | aynı | aynı | aynı |
| **Cevap düzeyi durumlar** | ABSTAIN 13 · COMPLETE **14** · PARTIAL 3 · QUALIFIED **4** | ABSTAIN **14** · COMPLETE 12 · PARTIAL 3 · QUALIFIED 5 | ABSTAIN 13 · COMPLETE 12 · PARTIAL 3 · QUALIFIED **6** | ABSTAIN 13 · COMPLETE 12 · PARTIAL 3 · QUALIFIED **6** |
| **Cevap düzeyi yanlış çekimserlik** | 0 | **1 (`fx-amend-002`)** | 0 | 0 |
| **Kesinleştirilebilir** | %85,7 (18/21) | **%81,0 (17/21)** | %85,7 (18/21) | %85,7 (18/21) |
| Retrieval p50 / p95 | 7,2 / 19,6 ms | **11,5 / 23,5 ms** | 7,5 / 19,1 ms | 8,2 / 19,3 ms |

**Okunması.** Gerileme yakalayacak olan her şey **kararlıdır**: altı sert
kapı, atıf çözülebilirliği, alıntı/hash bütünlüğü, uydurma kimlik, kiracı
sızıntısı, şerit dağılımı, retrieval sıralaması ve cevap katmanının kendi
TRIPWIRE'ı. Oynayan tek şey, raporun **"REPORT ONLY"** diye işaretlediği
`AnswerPipeline` durum dağılımıdır.

**Mekanizma: ilişkilendirildi, kanıtlanmadı.** Yanlış çekimserliğin çıktığı
koşu, aynı zamanda retrieval p50'sinin **en yüksek** olduğu koşudur
(11,5 ms ↔ 7,2–8,2 ms). Cevap hattının iki duvar bütçesi vardır (şerit
2 500 ms, cevap 60 000 ms) ve kesilen bir şerit bir pasajı düşürür; bu, bir
gold satırının kapsam kapısını geçememesi için yeterlidir. **Bunu ölçmedim**
— yalnız korelasyonu gördüm ve buraya öyle yazıyorum.

**Gerçek mi, paylaşılan küme çekişmesi mi?** Dört koşu da **benim**,
**sıralı** ve **ön planda**; bu turda başka bir hattın süreci çalışmıyordu.
Yani bu **çekişme değil**, aracın kendi davranışıdır. İşletim sistemi
düzeyinde arka plan yükünü dışlayamam; ama bir ölçüm dört ardışık koşuda
oynuyorsa, **tek koşu o satırlar için ölçüm sayılmaz** — bu, kaynağı ne
olursa olsun geçerlidir.

**Sonuçları (üçü de belgelere işlendi):**

1. **STATUS S6** cevap katmanını artık **bant** olarak yazıyor, tek sayı
   olarak değil; diskteki rapor dosyasının hangi koşuya ait olduğu da yazılı.
2. **`W14-C-SRV` §6.3'ün eşik gerekçesinin bir yarısı** — "0,5'e çıkınca
   `fx-amend-003` bir şerhi kaybediyor" — bu bandın **içindedir** ve tek
   koşuyla gürültüden ayrılamaz. **Kararın kendisi değişmiyor:** eşik
   yükseltilmedi, yani yapılan şey "hiçbir şeyi değiştirmemek"ti, ve onu
   taşıyan diğer yarı (ölçülebilir zaman kazancı yok) sağlam.
3. **`W14-F-PERF`'in "trigram fallback kapısının ölçülen kaybı
   `fx-amend-003`'tür"** cümlesi de aynı şekilde tek koşuya dayanıyor.
   Kapının bir **recall değişikliği** olduğu tespiti duruyor (o yapısaldır);
   **hangi gold satırının hangi yöne kaydığı** yeniden ölçülmelidir.

**Bu hattın işi olmayan öneri:** cevap katmanı ya duvar bütçelerinden
bağımsız hâle getirilmeli (ölçüm koşusunda bütçeler kapatılabilir), ya da
rapor N koşuluk bir bant basmalı ve kapı banda bakmalı.

---

### 2.2 N-8 — `npx vitest run` deterministik değil (6 koşuda 1 kırmızı)

**Nasıl bulundu.** Belge düzenlemelerinden sonraki doğrulama koşusunda süit
**kırmızıya döndü**. Düşen tek test:

```
FAIL tests/store/retrieval.test.ts
     > (k) trigram lane query plan at corpus scale
     > (l) the lane has its own wall budget and says so when it is cut
AssertionError: expected 'EXECUTED_FOUND' to be 'BUDGET_EXCEEDED'
  tests/store/retrieval.test.ts:1568
    limits: { trigramBudgetMs: 1 }
    expect(degraded.trigram.outcome).toBe("BUDGET_EXCEEDED")
```

**Karakterizasyon (görev kuralı: üç kez tekrarla).**

| Koşu tipi | Sonuç |
|---|---|
| Tam süit, **7 koşu** | **6 yeşil · 1 kırmızı** (00:51 ✓ · 01:31 ✓ · 01:37 **✗** · 01:38 ✓ · ✓ · ✓ · kapanış turu ✓) |
| Yalnız `tests/store/retrieval.test.ts`, 6 koşu | **6 yeşil** (her birinde 47/47) |

**Gerçek mi, çekişme mi?** İkisi de değil — **sıcak önbellek**. Test şeride
`trigramBudgetMs: **1**` verip **kesilmesini** bekliyor; o koşuda sorgu
1 ms'nin **altında** bitti ve şerit dürüstçe `EXECUTED_FOUND` dedi. Yani
yük altında değil, **hızlı** olduğu için düştü. Dosya tek başına koşunca hiç
düşmedi, bu yüzden bir paralellik/çekişme etkisi de değil.

**Önemli ayrım: ürün doğru davrandı.** Bütçe aşılmadığı için şerit
kesilmedi ve `TrigramReport` dört ayrı cevabı (`SKIPPED_PRIMARY_SUFFICIENT` /
`EXECUTED_NONE_FOUND` / `EXECUTED_FOUND` / `BUDGET_EXCEEDED`) zaten ayırt
ediyor — CLAUDE.md'nin "bulamadı ≠ hiç koşmadı" değişmezi tam olarak bunun
için var. Yanlış olan, bir eşitliği **duvar saatine** bağlayan testtir.

**Ne yapmadım.** Testi değiştirmedim, atlamadım, silmedim — bu hat teste
dokunmuyor ve zaten **hiçbir testin zayıflatılmaması** bu dalganın kuralı.
§7 IR-7 olarak bildirildi; önerilen düzeltme, çıktıyı **enjekte edilen bir
saate** göre iddia etmek ya da bütçeyi mümkün olan en hızlı sorgudan
**kanıtlanabilir biçimde küçük** seçmek — yarışmak değil.

**S2 satırı ne diyor?** Altı yeşil koşunun ortak sonucunu (**103 dosya ·
2 114 geçti · 0 düştü · 6 atlandı**) ve **yanında bu çekinceyi**. "Süit
yeşil" cümlesi bundan sonra **bir koşuya** dayanamaz.

---

## 3. Faz C'nin kapattıklarını kendi elimle yeniden ölçtüm

Gerçek bir sunucuda (`serve.mjs --port 8977 --mcp-port 8987 --with-mcp
--dsn …collex_demo`, `COLLEX_DATA_DIR` scratch'te).

### 3.1 Sunucunun kendi beyanı (S13/S14)

```
/v1/health          registeredToolCount 54 · db "ok" · dbName "collex_demo"
                    migrations {applied 13, expected 13, missing [], unknown []}
                    rls {expected 18, present 18} · backup null
                    mcp "starting" -> "ok" (~8 sn) · ai {configured:false, model:null, liveTested:false}
                    corpus {publicDocuments 6, uploads 0} · templates 13 · deadlineRules 41
                    version "1.0.0"
/v1/research/health {"gateway":"ok","toolCount":54,"state":"ok"}
```

### 3.2 V-19 — reddedilen alan artık adıyla söyleniyor

```
POST /v1/drafts {"template":"dava-dilekcesi","bogusAlan":1,"fields":{}}
-> 400 INVALID_REQUEST, issues:
   {"path":"kind",      "label":"Belge türü",                "message":"Belge türü zorunludur."}
   {"path":"matter",    "label":"Dosya bilgileri",           "message":"Bu alan zorunludur."}
   {"path":"bogusAlan", "label":"Fazladan alan (bogusAlan)", "message":"Tanınmayan alan."}
   {"path":"fields",    "label":"Fazladan alan (fields)",    "message":"Tanınmayan alan."}
```

**Yanıttaki hiçbir satırın `path`'i boş değil** ve iki fazladan alan **iki
ayrı satır**. F-VERIFY'ın §6'da kaydettiği `{"path":"","label":""}` satırı
yeniden üretilemedi. **V-14, V-19 KAPALI.**

### 3.3 V-21 — konu dışı soruda tarama koşmuyor, dayanaklı soruda koşuyor

```
POST /v1/answer {"question":"en iyi balik restorani hangisi"}
-> status ABSTAIN
   contraryCoverage {executed:false, skipped:true, usable:false}
   note: "Bu soruda dayanak olabilecek pasaj bulunamadığı için karşıt otorite
          taraması gerekmedi ve yapılmadı; hiçbir tespitte çelişki tespit edilmedi."

POST /v1/answer {"question":"dolandiricilik sucunda nitelikli hal var midir"}
-> status QUALIFIED · 8 kanıt · 6 tespit
   contraryCoverage {executed:true, skipped:false, lanes:2}
```

Kapının **daralttığı yer yok**: dayanağı olan bir cevapta iki şerit de
koşuyor. **V-21 KAPALI.**

### 3.4 V-14 — arşiv yedeklediği veritabanının adını taşıyor

```
backup.mjs --database collex_demo --out <scratch>
  -> exit 0 · arşiv dosyası: collex_demo.dump · 110,5 KB
  klasör: collex_demo.dump · icindekiler.txt · uploads/ · yedek.json
  yedek.json  schema collex.backup.manifest/v1 · database collex_demo
              dump.path collex_demo.dump
backup.mjs --dump-name <klasör>  -> "collex_demo.dump"                     exit 0
backup.mjs --verify   <klasör>  -> "Yedek doğrulandı: 1 dosyanın tamamı eksiksiz."
                                    veritabanı: collex_demo
                                    arşiv dosyası: collex_demo.dump          exit 0
```

`collex_local.dump` sabiti yok. **V-14 KAPALI.** (`collex_local` için ad
değişmiyor, yani avukatın elindeki eski yedek klasörleri çalışmaya devam
ediyor — C-SRV'nin bilerek koruduğu davranış.)

### 3.5 Yeniden ÜRETMEDİĞİM ölçümler — açık kayıt

C-UI'nin tarayıcı ölçümleri (224 px → 0 px, 336 → 220 px, 6 108 → 5 051 px,
`#matterselect.value`, 13/13 eşleşen cümle satırı) **benim ölçümüm
değildir**; bir Playwright turu bu hattın kapsamında değildi. Onların
yerine iki dolaylı kanıt aldım:

* `console.test.ts` **165/165 geçti** (§1), ve C-UI'nin raporu her yeni
  testin kusuru geri konunca düştüğünü tek tek gösteriyor;
* `console.html` üzerinde grep: `Eşleşen cümle sağlanmadı` **1**,
  `titleAddsNothing` **2**, `Sıralamayı kaynak sunucu belirler` **1**,
  `Tümünü aç`/`Tümünü kapat` **1/1**, `<veri klasörü>/uploads` **1**,
  `varsayılan: var/uploads` **2**, `aria-expanded` **2**; ve hâlâ **yok**
  olanlar: `Dosya paketini indir` **0**, `Nerede kalmıştım` **0**.

Bu ayrımı STATUS'a da yazdım: S32″ satırının kaynağı C-UI'dir, S2'nin test
sayısı benimdir.

---

## 4. `openapi.yaml` — Faz C deltası (eklemeli)

**Yeni yol, işlem ya da şema yok.** Sayılar düzenleme öncesi ve sonrası
**birebir aynı** (pyyaml ayrıştırması + `$ref` yürüyüşü):

| Ölçüm | Değer |
|---|---|
| Yol | **65** |
| İşlem | **80** |
| Şema | **126** |
| Ayrık `$ref` | 127 · **çözülmeyen 0** |
| Referans verilmeyen şema | **0** |
| Eksik / tekrar eden `operationId` | **0 / 0** |
| `info.version` · `openapi` | **1.0.0** · 3.1.0 |
| CR baytı | **0** |

Yazdığım dört değişiklik:

1. **`BackupResult.dumpFile`** (yeni, isteğe bağlı) — arşivin `path` içindeki
   dosya adı, `database`'den türetilir. **`required`'a eklenmedi**, çünkü Faz
   C öncesi kaydedilmiş bir sonuç bunu taşımaz; okuyucuya `yedek.json`'ın
   `dump.path`'i öneriliyor (o alan her zaman vardı).
2. **`ContraryCoverage.skipped`** (yeni, isteğe bağlı) — şeritlerin
   planlanıp bilerek koşturulmadığını `executed:false`'tan ayırır; skip
   koşulu ve "dayanağı olan cevapta hiçbir şey değişmez" güvencesi açıklamada
   yazılı. Aynı sebeple `required` değil: Faz C öncesi kaydedilmiş cevaplar
   bu alanı taşımaz.
3. **`ApiError.error.issues.path` / `.label`** — açıklama düzeltmesi (V-19):
   `path` **hiçbir zaman boş değildir**, zod'un `unrecognized_keys` davranışı
   ve tek yardımcı anlatılıyor; `label` fazladan alan için
   `Fazladan alan (<anahtar>)` yazıyor.
4. **`POST /v1/backup` açıklaması** — arşiv `collex_local.dump` değil
   `<veritabanı>.dump`; adın türetildiği ve neden güvenilmediği, ve
   `collex_local` için adın değişmediği yazılı.

Şema ve kod uyumu: `runner.ts:130/154` `dumpFile: string`,
`pipeline/types.ts:358` `skipped: boolean` — ikisi de üründe var, yani
`openapi.yaml` var olmayan bir alan ilan etmiyor.

**Yazmadıklarım (bilerek).** C-UI'nin IR-1 (`/v1/health.uploadsDir`) ve IR-2
(`sources/search` yanıtında `totalRecords`) istekleri **openapi'ye
yazılmadı**, çünkü sunucu o alanları göndermiyor; spesifikasyona sunucunun
göndermediği bir alan yazmak, bu projenin yasakladığı türden bir iddiadır.
İkisi de §7'de integrationRequest olarak duruyor.

---

## 5. Belgelerde ne değişti

| Dosya | Ne yapıldı |
|---|---|
| `docs/implementation/STATUS.md` | Tarih 03.09.2026 / Faz C. **"Ölçülen sayılar" tablosu yeniden kuruldu:** S1–S14 bu turda ölçüldü; S25‴/S26⁗/S27″/S28‴/S29″/S30″/S31″/S32″ F-VERIFY ve Faz C değerlerine güncellendi; **S33–S36 yeni** (`.ics`, gerçek kaynak araması, nihai DOCX, doğrulanmamış yüzeylerin etiketleri). F-VERIFY'ın **16/3/3** düzeltmesi ve "19 kapandı yanlıştır" notu eklendi. Doğrulanmamış sekiz yüzey listesi **kesinleştirildi** (#5 dürüstçe yeniden yazıldı: erişim ölçüldü, isabet ölçülmedi). "Bir ölçülmüş tavan" **iki tavana** çıktı, ve **N-7 için ayrı bir bölüm** açıldı. Statü sözcüğü **PARTIAL** kaldı |
| `docs/implementation/TRACEABILITY.md` | V-blokunun başlığı ve girişi audited verdict'i anlatıyor; V-14 / V-19 / V-21 satırları **CLOSED** (fix, dosyalar, gerileme testi, yeniden ölçüm); V-10 ve V-22 satırları iki aşamalı hikâyeyle **CLOSED**. **Yeni N-1..N-7 tablosu.** Ertelenenler listesi güncellendi (üç kalem DONE; N-1, N-4'ün sıralama yarısı, N-7, IR-1 ve `petition.py` satırı eklendi) |
| `CLAUDE.md` | Dateline 03.09.2026 / Faz C; "read the verdict, not the lane's claim" paragrafı; sayımlar (103 dosya, 1 347, 165); **dört yeni değişmez**: iki trigram eşiği ve "9 700×'i `/v1/answer` için alıntılama", yedek arşivi adının türetilmesi, `.strict()` reddinin alanı adlandırması, karşıt tarama skip koşulu; N-7 uyarısı ("bir komutun sayıları bant"); B-16 etiketi dürüstçe yeniden yazıldı; iki yeni probe veritabanı; wave listesi |
| `docs/implementation/RISKS.md` | Dateline; **#27 yeniden yazıldı** (arama çalışıyor, isabet ölçülmedi); **#32 emekliye ayrıldı** ve emekli tablosuna kanıtıyla girdi; **#34 yeni** (N-7); #26'ya "tek koşu yeterli değil" çekincesi |
| `docs/implementation/DECISIONS.md` | Dateline; **sekiz yeni non-ADR karar satırı** (bandı yazmak, lane raporlarını annote etmek, eşiğin 0,35 kalması, arşiv adının türetilmesi, tek zod yardımcısı, karşıt tarama skip koşulu, kanıt kimliğinin parantezlenmesi, tam-ifade varsayılanı ve katlama) |
| `docs/implementation/FINAL_REPORT.md` | Dateline; §13 girişine **denetimin sayımı düzelttiği** paragraf; **§13.3b Faz C'nin kapattıkları**; §13.4 "bir kusur, iki tavan, bir ölçüm aracı çekincesi" olarak yeniden yazıldı; §13.6'nın son paragrafı arama konusunda dürüstçe güncellendi |
| `docs/README.md` | Dateline; 16/3/3 düzeltme kutusu; W14-F-VERIFY / W14-C-SRV / W14-C-UI / W14-C-FINAL satırları; STATUS, TRACEABILITY ve RISKS açıklamaları; vaporware kutusu (hâlâ olmayanlar **grep ile doğrulandı**) |
| `docs/architecture/overview.md` | Dateline; "Faz C mimariyi değiştirmedi" paragrafı; §8 başlığı ve kaynakları; **§8.2 yeni** — "bir düzeltme hattı kendi işine not veremez" ve "probe korpusunda ölçülen sayı o korpusun özelliğidir" |
| `docs/implementation/AI.md` | Dateline; Faz F/C'nin bu hatta yalnız `zodIssues` bağlamasıyla dokunduğu, `liveTested:false`'ın **aynen durduğu** |
| `docs/implementation/EXPORT.md` | Dateline; **N-3 kutusu** (`presentable_warning`, ölçüm, ve açık kalan `petition.py` sınır kalemi) |
| `docs/KULLANIM-ColleX.md` | Sürüm tarihi; **§8.0 yeni** ("bu son turda ekranda ne değişti", beş madde + karşıt tarama); **§8.1 yeniden yazıldı** (tam ifade kutusu ve 116 090 ↔ 758, sayfanın şekli, eşleşen cümle, ve "arama çalışıyor, isabeti ölçülmedi"); §10'da bugün çalışan **14 ekranın tam listesi**, düğmesi olmayanlar ayrı madde, ölçek maddesi (3,8 sn ↔ 7,5 sn boş) ve arama maddesi güncellendi |
| `docs/DEMO.md` | Dateline; **Faz C notu** (konsolda ve sunucuda değişen altı+üç şey); §9'da `sources/search`'ün artık canlı koştuğu; §10'da arama, ölçek, trigram ve N-7 maddeleri |
| `docs/implementation/RUNBOOK.md` | Dateline; "dokuz komutun dokuzu da exit 0" + **N-7 çekincesi** (tek koşu ölçüm değildir); §14'te arşiv adının türetilmesi, `--dump-name` kipi ve `collex_local` için adın değişmediği |
| `docs/COMPETITIVE.md` | Dürüstlük kutusu ve 6 numaralı parite satırı: "canlı upstream'e karşı hiç koşmadı" → **ulaşıyor, gerçek künye getiriyor, isabet ölçülmedi**; ölçek cümlesi 3,8 sn ↔ 7,5 sn |
| `docs/implementation/PLAN.md` | Faz 3 satırındaki ölçek cümlesi (15–17 sn → 3,8 sn, ve 7,5 sn'lik boş sonuç) |
| `control-plane/src/api/openapi.yaml` | §4 |
| `docs/implementation/waves/W14-L-VERIFY.md` | **§2.2'ye tarihli eşik notu eklendi** (metin ve sayılar değiştirilmedi) |
| `docs/implementation/waves/W14-F-PERF.md` | **§2'ye tarihli eşik notu eklendi** (metin ve sayılar değiştirilmedi) |

### 5.1 İki aşırı iddianın annotasyonu (görev kalemi 4)

`W14-L-VERIFY` §2.2 ve `W14-F-PERF` §2, seçici trigram sorgusu için
**1,87 ms** ve **0,329 ms** yazıyor ve buradan **≈9 700×** bir kazanç
türetiyor. Her iki ölçüm de `pg_trgm.word_similarity_threshold = **0,5**` ile
alınmıştır — her iki bölümün kendi giriş cümlesi bunu söylüyor — ama
**ürünün cevap yolu o eşikle koşmaz**:
`DEFAULT_ANSWER_LIMITS.trigramMinSimilarity = 0.35`
(`control-plane/src/api/answerService.ts:128`) ve `clampAnswerLimits` onu
yalnız yukarı çekebilir. F-VERIFY §2.3 aynı sorguyu 0,35'te ölçtü:
**18 069 ms**.

Her iki bölümün sonuna, **metne ve sayılara dokunmadan**, tarihli bir not
bloğu eklendi. Not üç şeyi söylüyor: (a) sayı hangi eşikte alındı, (b) ürün
hangi eşikle koşar ve orada ne ölçüldü, (c) C-SRV'nin üçüncü korpusta
**tersini** ölçtüğü — yani bu rakamlar korpus ve sorgu özelliğidir, eşiğin ya
da `TRIGRAM_SEQSCAN_SETTING` çekicinin değil, ve **hiçbiri ürün sayısı olarak
alıntılanamaz**. Her iki notun sonunda güncel satır: STATUS **S26⁗**.

**Lane raporları tarihsel kayıttır ve yeniden yazılmadı.** Bir sonraki
denetçinin görmesi gereken şey, yalnız doğru sayı değil, **yanlış sayının bir
dalga boyunca nasıl hayatta kaldığıdır**.

---

## 6. Tutarlılık denetimi (görev kalemi "Consistency rule")

**Her sayı STATUS'ta ölçülmüş bir satıra iz sürüyor mu?** Tarama yaptım:
`S1–S32` aralığı **S1–S36** yapıldı (10 dosya); STATUS içindeki güncellenmiş
satırlara yapılan bütün eski atıflar (`S25`, `S26`, `S28`, `S29`, `S30`,
`S31`, `S32`) yeni kimliklerine (`S25‴`, `S26⁗`, …) çevrildi; STATUS'ta
kimliksiz kalan `S25`–`S32` atfı **0**.

**Her özellik cümlesi kodda grep ile doğrulanıyor mu?** Konsolun bugün
çizdiği görünümler `console.html`'den okundu: beş sekme (`dosyalarim`,
`arastir`, `belgeler`, `taslak`, `ayarlar`) ve dokuz gizli görünüm
(`dosya/<id>`, `belge/<fileId>`, `izgara`, `karar-ara`, `denetim`, `harc`,
`sozlesme`, `takvim`, `kapsam`). KULLANIM §10'daki liste tam olarak budur.
Hâlâ olmayan düğmeler (`Dosya paketini indir`, `Nerede kalmıştım`) grep ile
**0 eşleşme** verdi ve belgeler onları hâlâ "yok" diye anlatıyor.

**Çalışmayan bir ekranı anlatan bir yer var mı?** Bulamadım. Tersine, bir
yerde **çalışan** bir şey "hiç çalışmadı" diye anlatılıyordu: karar arama.
Üç belgede (STATUS doğrulanmamış yüzey #5, KULLANIM §8.1 ve §10, DEMO §10)
o cümle, **erişim ölçüldü / isabet ölçülmedi** ayrımıyla değiştirildi.

**Kaynak/rakam tutarsızlığı bulup düzelttiklerim:**

* "Faz F 19 kapattı" → **16/3/3 + 6** (STATUS, TRACEABILITY, CLAUDE.md,
  README, FINAL_REPORT).
* "karar arama canlı upstream'e karşı hiç koşmadı" → yanlış; yedi gerçek
  arama yapıldı (STATUS, KULLANIM, DEMO, RISKS #27, CLAUDE.md).
* "20 000 parçada 15–17 sn" → o ölçüm F-PERF'in korpusundaydı; F-VERIFY aynı
  şekli 9,5 sn, gerçekçi şekli **3,8 sn** ölçtü ve **7,5 sn/boş** olan yeni
  en kötü hâli buldu (STATUS, RISKS, KULLANIM, DEMO, FINAL_REPORT).
* `console.test.ts` "152" → **165**.
* `openapi.yaml` "backup: `collex_local.dump`" → `<veritabanı>.dump`.

---

## 7. Diğer hatlara istekler (integrationRequests)

Bu hat koda dokunmadığı için hepsi başkasının dosyasıdır.

1. **`export/petition.py`** — ek künye bloğundaki `Kanıt kimliği: ev-…`
   satırı N-3'ün kuralına birebir uysun (`Kanıt kimliği (ev-…)` ya da
   eşdeğeri). Bugünkü hâli etiketli, Türkçesi önde ve NİHAİ kopyada zaten
   yok; sınırda bir kalem. (C-SRV §10(5) de bildirmişti.)
2. **`control-plane/src/api/healthReport.ts` (+ `server.ts` bağlaması)** —
   `/v1/health`'e **eklemeli** `uploadsDir` (ya da `dataDir`) alanı;
   `createApp` bu değeri zaten tek elden çözüyor. Alan gelirse Ayarlar ›
   "Verilerim nerede?" klasörün **yerini** yazabilir, bugün yalnız **nerede
   yazdığını** söyleyebiliyor. Alan indiğinde `openapi.yaml`'a ben yazarım.
   (C-UI IR-1.)
3. **`control-plane/src/sources/searchService.ts` + `src/research/payloads.ts`**
   — kaynak başına **eklemeli** `totalRecords` (Bedesten'in `total_records`'u;
   yoksa `null`, asla 0). Ölçüldü: aynı sorgu tırnaksız **116 090**, tırnaklı
   **758**. Avukat 20 satırın buzdağının ucu olup olmadığını göremiyor.
   (C-UI IR-2.)
7. **`control-plane/tests/store/retrieval.test.ts` bloğu (l)** — N-8: satır
   ~1568'deki `expect(degraded.trigram.outcome).toBe("BUDGET_EXCEEDED")`
   iddiası `trigramBudgetMs: 1` ile **duvar saatine yarışıyor** ve altı tam
   koşuda bir kez kaybediyor. Enjekte edilen bir saatle iddia edilsin, ya da
   bütçe mümkün olan en hızlı sorgudan kanıtlanabilir biçimde küçük seçilsin.
   **Test silinmesin ya da atlanmasın** — gerçek bir güvenceyi pinliyor.
4. **`scripts/run_evals.py` (ve/veya `control-plane/src/pipeline/answerPipeline.ts`)**
   — N-7: cevap katmanı ya duvar bütçelerinden bağımsız ölçülmeli (ölçüm
   koşusunda `DEFAULT_TRIGRAM_BUDGET_MS`/`DEFAULT_ANSWER_TIME_BUDGET_MS`
   kapatılabilir), ya da rapor **N koşuluk bir bant** basmalı. Bugün tek koşu
   bir gerileme iddiasını taşıyamıyor.
5. **`control-plane/src/store/chunkStore.ts` + `tests/store/retrieval.test.ts`**
   — N-1: şeridin planını **ürünün kendi eşiğinde (0,35)** pinleyen bir
   gerileme testi. Üç probe üç farklı tablo verdi; test olmadan bir sonraki
   hat yine kendi korpusunun sayısına inanacak.
6. **Konsol hattı** — seçici korpus sorusunun 7,5 saniyesi ya kapatılsın ya
   da **arayüzde söylensin** (ilerleme satırı + iptal). Bugün avukat en uzun
   beklemeyi en boş sonuç için yapıyor ve ekranda bunu haber veren bir şey
   yok.

---

## 8. Hijyen

* Açtığım tek sunucu (8977 + MCP 8987) **nazikçe** kapatıldı
  (`<veri>/collex.stop`; pid dosyası kayboldu). Koşu sonunda `netstat`:
  **8977, 8987, 8974, 8975, 8976, 8984, 8985, 8986 ve 8787/8898'de dinleyici
  yok**. 8787/8898'e **hiç dokunulmadı**.
* `COLLEX_DATA_DIR` scratch'e verildi; depo `var/` altına **hiçbir pid dosyası
  yazılmadı**, `var/uploads` koşu öncesi ve sonrası **0 dosya**.
* **`collex_local`'a hiç bağlanılmadı, hiç yazılmadı, düşürülmedi.**
  `collex_demo` `demo.mjs` tarafından yeniden kuruldu (probe veritabanı, 8
  belge / 55 parça, 6/6 senaryo PASS). Aldığım yedek scratch'e yazıldı.
* **Kendi adıma yeni bir veritabanı yaratmadım ve düşürmedim.**
  `collex_eval_test`, `collex_mig_test` ve vitest süitlerinin veritabanlarını
  kendi betikleri yönetti. Koşu sonunda `pg_database`: `collex_demo`,
  `collex_eval_test`, `collex_intake_test`, `collex_local`, `collex_mig_test`,
  `collex_quality_test`, `collex_retrieval_test` — Faz C'nin probe'ları
  (`collex_srv_test`) ve F-VERIFY'ınki (`collex_final_test`) kendi hatları
  tarafından düşürülmüş; kalan `collex_intake_test` vitest'in `real-exec`
  süitinin kendi veritabanıdır.
* Dış ağa **hiçbir istek** yapılmadı. `.env` okunmadı, Supabase/Resend
  kullanılmadı, **hiçbir git işlemi yapılmadı**, MCP araç yüzeyi (54)
  değişmedi, API değişiklikleri **eklemeli**.
* Hiçbir test zayıflatılmadı, atlanmadı ya da silinmedi — bu hat teste hiç
  dokunmadı.
* Bütün geçici dosyalar `…/scratchpad/w14c-C-FINAL/` altında.

### Değişen depo dosyaları

```
docs/implementation/STATUS.md
docs/implementation/TRACEABILITY.md
docs/implementation/RISKS.md
docs/implementation/DECISIONS.md
docs/implementation/FINAL_REPORT.md
docs/implementation/AI.md
docs/implementation/EXPORT.md
docs/implementation/RUNBOOK.md            (satır aralığı + dateline/dokuz komut + N-7 çekincesi
                                           + §14 yedek arşivi adı)
docs/implementation/PLAN.md               (satır aralığı + Faz 3 satırındaki ölçek cümlesi)
docs/README.md
docs/DEMO.md
docs/KULLANIM-ColleX.md
docs/COMPETITIVE.md                       (satır aralığı + dürüstlük kutusu ve parite satırı 6:
                                           "canlı upstream'e karşı hiç koşmadı" → "ulaşıyor,
                                           künye getiriyor, isabet ölçülmedi")
docs/architecture/overview.md
docs/implementation/waves/W14-L-VERIFY.md (§2.2'ye tarihli NOT eklendi)
docs/implementation/waves/W14-F-PERF.md   (§2'ye tarihli NOT eklendi)
docs/implementation/waves/W14-C-FINAL.md  (bu rapor)
CLAUDE.md
control-plane/src/api/openapi.yaml        (eklemeli: 2 isteğe bağlı alan + 4 açıklama)
evals/reports/fixture_baseline_2026-09-02.{json,md}   (run_evals.py'nin KENDİ çıktısı, 4 koşu)
demo-output/report.md                     (demo.mjs'in KENDİ çıktısı)
```

---

## 9. Bugün itibarıyla dürüst durum

### Avukatın bugün güvenebileceği şeyler

**Dayanak disiplini.** Bir paragraf, atıf yaptığı alıntıyı birebir içermek
zorundadır; içermiyorsa bağ **anında** kopar, atıf yazılmaz ve paragraf
KAYNAKSIZ işaretlenir. Bu tarayıcıda gerçek bir tahrifatla üretilerek
doğrulandı (F-VERIFY §4.3) ve kapı **iki bağımsız katmandadır**. Çözemediği
künyeyi **boş bırakır**; "?" ya da "bilinmiyor" yazmaz.

**Nihai çıktı.** İmzaya giden DOCX **A4, biçimli ve içinde tek bir makine
dizesi yok** — python-docx ile açılarak sayıldı (S35). Faz C, TASLAK
kopyadaki son iki makine dizesini de temizledi.

**Süre hesabı ve dürüstlüğü.** 41 kural, her biri hangi maddeye dayandığını
ve **doğrulanıp doğrulanmadığını** söylüyor; 25'i doğrulanmadı ve her hesap
bunu yazıyor. Yanlış bir sayı uydurmaktansa "doğrulanmadı" demeyi seçiyor.
Aynı disiplin harçta: 20 kalemin 17'sinde tutar yok ve toplam **null**
kalıyor.

**Veri güvenliği ve geri dönüş.** Müvekkil verisi bu bilgisayardan çıkmıyor
(bulut AI kapalı, `ai.configured:false`). Yedek alınabiliyor,
doğrulanabiliyor ve **bozulmuş bir yedeği reddediyor**; veritabanı gerçekten
yok edilip geri yüklendi ve asıllar bayt bayt, tablolar satır satır aynı
geldi (S28‴).

**Ekranın dürüstlüğü.** Uyarılar bütçeli (3 blok / 5–7 cümle, 0 tekrar, 0
makine kodu), veritabanı adı avukatın önünde yok, hiçbir toast çıplak bir
HTTP kodu yazmıyor, ve arkasında çalışan bir şey olmayan hiçbir düğme
çizilmiyor.

**Günlük hız.** Yüklediği belgeye sorduğu soru **71–73 ms**. Kayıtlar
yeniden başlatmada geri geliyor.

### Bugün hâlâ doğrulanmamış olanlar

1. **Karar aramanın isabeti.** Arama çalışıyor ve gerçek künye getiriyor —
   bu wave'de değişen en büyük şey — ama **sıralamayı kaynak sunucu yapıyor**,
   ColleX elindeki 20 satırı dizebiliyor, kaynakta kaç kayıt olduğunu
   gösteremiyor, ve dönen kararların işe yarayıp yaramadığı **hiç ölçülmedi**.
2. **25 süre kuralı** madde metniyle karşılaştırılmadı. Bu, listenin en
   yüksek etkili kalemidir: kaçırılan bir süre geri alınamaz.
3. **17 harç kalemi** tutarsız; bu yılın Resmî Gazete rakamları elde değil.
4. **Bulut AI** canlı API'ye tek bir istek bile göndermedi.
5. **UDF** UYAP editöründe hiç açılmadı; **`.ics`** gerçek bir takvim
   istemcisinde hiç açılmadı.
6. **Yerel kütüphane** hiçbir şeyi `collex_local`'a yazmıyor.
7. **Atıf denetimi** bugün "bulunamadı" diyemiyor — bir **kapsam beyanıdır**.
8. **Ve en geniş sınır:** buradaki her kalite ölçümü **sentetik** korpustadır.
   ColleX'in hukukî isabeti gerçek Türk mevzuatı ve içtihadı üzerinde **hiç
   ölçülmedi**. O ölçüm yapılana kadar "daha iyi" sözü yalnız **disiplin**
   için geçerlidir, kapsam ve isabet için değil.

Bunlara bu turda bir dokuzuncu eklendi: **ölçüm araçlarının kendisi**
(N-7 ve N-8). Eval kapısının cevap katmanı metrikleri koşudan koşuya
oynuyor (sert kapılar oynamıyor), ve vitest süiti altı koşunun birinde
kırmızıya döndü — ikisi de bir eşitliği duvar saatine bağlamaktan
kaynaklanıyor ve ikisinde de **ürün doğru davrandı**. Bir aracın kendi
gürültüsünü bilmemek, ölçtüğü şeyi bilmemektir.

### Ürünü en çok iyileştirecek üç şey

**1 · Gerçek Türk hukuk metniyle bir kalite ölçümü.** Bugün ölçülen her şey
mekanizma hakkındadır; hiçbiri isabet hakkında değildir. İki bağımsız
hukukçunun etiketlediği bir gold set olmadan kapsam kapısının 0,4'ü,
entailment'ın 0,85'i ve alaka kapısı **tahmindir** — çalıştıkları
gösterilmiştir, doğru ayarlandıkları gösterilmemiştir. Bu tek adım, bu belge
setindeki en büyük belirsizliği kapatır ve diğer ikisinin de ölçülebilmesini
sağlar.

**2 · Aramada sunucu tarafı ilgililik.** Avukatın rakiplere gittiği tek eksen
budur. Bugünkü hâl: kaynak sunucu birkaç yüz bin kaydı tarihe göre sıralıyor,
ColleX 20 satır alıyor ve dürüstçe "bu bir ilgililik sıralaması değildir"
diyor. Birden çok sayfa çekip **ColleX'in kendi kanıt disiplinine göre**
yeniden puanlamak — ve satıra kaynağın kendi eşleşen cümlesini koymak —
ürünü "bakmam gerekenleri getirdi"den "aradığımı buldu"ya taşır.

**3 · Boş sonucun 7,5 saniyesi.** Avukatın en sık yaşayacağı olumsuz durum
(aradığı şey arşivde yok) bugün en pahalı durumdur ve ekran bu sırada hiçbir
şey söylemiyor. İki çözüm de küçüktür: şeridi erken kesmek, ya da bir
ilerleme satırı + "vazgeç" düğmesi. İkincisi bir günlük iştir ve ürünün
**hissini** en çok değiştirecek tek değişikliktir — çünkü bir aracın yavaş
olması ile ne yaptığını söylememesi aynı şey değildir.
