# W14 — M-CLOSE (Faz M kapanışı): son yeşil ölçüm ve belge uzlaştırması

**Tarih:** 03.09.2026 · **Tip:** ÖLÇÜM + BELGE — bu hat **hiçbir koda,
hiçbir teste ve `openapi.yaml`'a dokunmadı**. Dokunduğu dosyalar: `docs/**`
ve `CLAUDE.md`.
**Portlar:** **hiçbir sunucu açılmadı** (`demo.mjs` süreç içi koşar). Koşu
sonunda `netstat`: **8787, 8898, 8977, 8978, 8987, 8988'de dinleyici yok**;
**8787/8898'e hiç dokunulmadı.**
**Veritabanları:** `collex_demo` (`demo.mjs` kendi düşürüp kurdu),
`collex_eval_test` (`run_evals.py`'nin kendi veritabanı), `collex_mig_test`
(`db_local_check.py`'nin kendi veritabanı) ve vitest süitlerinin kendi
veritabanları. **Kendi adıma hiçbir veritabanı yaratmadım ve düşürmedim.
`collex_local`'a hiç bağlanılmadı, hiç yazılmadı, düşürülmedi.**
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, dış ağa hiçbir
istek gitmedi, MCP yüzeyi **54** doğrulandı, API değişikliği yapılmadı.

> Bu raporda **kendi ölçümüm** olarak yazdığım her sayı 03.09.2026 02:38–03:05
> arasında bu makinede ölçüldü. Başka bir hattın sayısını aktardığım her yerde
> hattın adı yazılıdır ve o sayı **benim ölçümüm değildir**. Korpus
> **SENTETİK**tir; hiçbir sayı hukukî kalite ölçüsü değildir.

---

## 0. Yönetici özeti

**On komutun onu da exit 0 ve düşen tek bir test yok** — bu dalgada ilk kez
tam ölçüm turu **tamamen temiz** bitti. Ama turun asıl işi sayı toplamak
değil, Faz M'in iki iddiasını **bağımsız olarak denetlemekti**, ve denetim
ikisinden **yalnız birini** onayladı:

| Bulgu | Faz M'in yaptığı | **Bu turun hükmü** |
|---|---|---|
| **N-8** (`vitest` 7 koşunun 1'inde kırmızı) | M-SRV duvar saati yarışını kaldırdı | **KAPANDI.** Üç ardışık tam koşu, üçünde de `retrieval.test.ts` **47/47**, süit **105 dosya · 2 143 geçti · 0 düştü**. M-SRV'nin altı koşusuyla birlikte **arka arkaya dokuz yeşil tam koşu** |
| **N-7** (eval cevap katmanı oynak) | M-SRV rapora **bant** bastırdı, bir kapı ekledi, kök nedeni **ölçerek buldu** | **AÇIK — daraldı, kapanmadı.** Altı ardışık koşu: yanlış cevap **6/6'da 0** (kapı sağlam), ama COMPLETE **11–14**, kesinleştirilebilir **%81,0 ↔ %85,7**, yanlış çekimserlik **1·1·0·0·0·1**. Kök neden (`chunkStore.ts`'in `r.id asc` tie-break'i) **hâlâ ağaçta** |

**Ve bu turun kendi küçük dersi:** görev metni N-7 için "bir hat az önce
deterministik hâle getirdi, iki koşu koş ve karşılaştır" diyordu. **İki koşu
koştum ve rakam rakam aynı çıktılar.** Orada dursaydım yanlış bir "kapandı"
yazacaktım. Dört koşu daha koştum ve üçü farklı çıktı. **İki koşunun
uyuşması bir determinizm kanıtı değildir** ve bu cümle STATUS'a, RISKS'e ve
CLAUDE.md'ye yazıldı.

---

## 1. Tam ölçüm turu (sıralı, tek başına, 02:38–03:05)

| # | Komut | Ölçülen çıktı | Exit |
|---|---|---|---:|
| 1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | **0** |
| 2 | `control-plane> npx vitest run` **(1/3)** | **105 dosya · 2 143 geçti · 0 DÜŞTÜ · 6 atlandı (2 149)** · 23,52 sn | **0** |
| 3 | `control-plane> npx vitest run` **(2/3)** | **birebir aynı** · 22,61 sn | **0** |
| 4 | `control-plane> npx vitest run` **(3/3)** | **birebir aynı** · 22,81 sn | **0** |
| 5 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 352 passed** · 129,26 sn | **0** |
| 6 | `.venv/Scripts/python.exe scripts/smoke_check.py` | `offline smoke checks passed: 54 tools, court inventory, shared limiter, disabled-key errors, HTTP auth` | **0** |
| 7 | `.venv/Scripts/python.exe scripts/http_e2e_check.py` | `authenticated HTTP MCP handshake passed: 54 tools` | **0** |
| 8 | `.venv/Scripts/python.exe scripts/live_local_gateway_check.py` | `PASS tools/list — exactly 54 tools (offline surface)` · belirteçsiz istek **401** · devre dışı modül çağrı yolu canlı, **sıfır dış trafik** | **0** |
| 9 | `.venv/Scripts/python.exe scripts/db_local_check.py` | **19/19 PASS** (`collex_mig_test`, 13 migrasyon; c15 `hearing` kabulü + `expense` reddi + 3 indeks) · `RESULT: PASS` | **0** |
| 10 | `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` **(×6)** | **RESULT: PASS** altısında da; §3 | **0** |
| 11 | `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02 --repeats 4` | **RESULT: PASS**, bant `VARIED across them`; §3.3 | **0** |
| 12 | `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** (S1 8/8 · S2 8/8 · S3 7/7 · S4 7/7 · S5 7/7 · S6 10/10); `collex_demo` yeniden kuruldu: 8 belge / 55 parça / 2 ilişki (2 çözüldü) | **0** |
| 13 | `openapi.yaml` (pyyaml + `$ref` yürüyüşü) | **65 yol · 80 işlem · 126 şema · 126 ayrık şema referansı · çözülmeyen 0 · 80 `operationId`, tekrar 0 · CR baytı 0 · `info.version` 1.0.0 · `openapi` 3.1.0**; `uploadsDir` 2, `totalRecords` 3 kez geçiyor | — |

**Düzenlemeden sonra ikinci kapı.** `CLAUDE.md`'yi ve `docs/**`'ı okuyan
testler olduğu için (`tests/files/dataFolderWording.test.ts`,
`tests/pipeline/retrievalProvenance.test.ts`,
`tests/integration/lfix.test.ts`) düzenleme bittikten sonra `npx tsc --noEmit`
ve `npx vitest run` **yeniden koşuldu**: **temiz (exit 0)** ve
**105 dosya · 2 143 geçti · 0 düştü · 6 atlandı** — yani bu turun **dördüncü**
ardışık yeşil süiti. `pytest` yeniden koşulmadı: Python süitinde `docs/**` ya
da `CLAUDE.md` okuyan tek bir dosya yok.

**MCP yüzeyi 54 olarak üç bağımsız kapıda doğrulandı** (6, 7, 8).
`openapi.yaml`'ın yol/işlem/şema sayıları **Faz C'nin ölçtüğüyle birebir
aynı**: Faz M iki alan ekledi ve ikisi de mevcut şemaların içinde, isteğe
bağlı — **yeni yol, işlem ya da şema yok**. Bu, "API değişiklikleri
eklemelidir" kuralının bu turdaki kanıtıdır.

### 1.1 Süitin seyri ve 6 atlaması

**103 → 105 dosya**, **2 114 → 2 143 test (+29)**: M-SRV iki yeni dosyada 15
test (`healthUploadsDir` 5, `totalRecords` 10), M-UI `console.test.ts`'e 14
test (165 → **179**). Atlayan 6 test bilinen **ters işaretleyicilerdir**
("environment unavailable"); altı gerçek süitin altısı da koştu — çıktıda
`integration/serve` 6 test (`--with-mcp` süreç-listesi kontrolü dâhil,
22,7 sn), `store/retrieval` **47 test**, `store/persistence`,
`integration/{real-exec,backup}`, `matters/pg` görülüyor.

---

## 2. N-8'in bağımsız denetimi — KAPANDI

Faz C'nin bulgusu şuydu: `tests/store/retrieval.test.ts` bloğu (l)
`trigramBudgetMs: 1` verip şeridin **kesilmesini** bekliyor; sıcak önbellekte
sorgu 1 ms'nin altında bitiyor ve şerit dürüstçe `EXECUTED_FOUND` diyor.
**Ürün doğru, test duvar saatine yaslanmış.**

M-SRV'nin düzeltmesi (§3'ünde anlatılıyor, benim değil): şeridin kendi
`set_config('statement_timeout', …, true)` çağrısını **ayar adından** tanıyan
ince bir Proxy, aynı bağlantıda ve aynı transaction içinde
`select pg_sleep(0.05)` çalıştırıyor — bütçenin **elli katı**, yani iptal
kesin, ve iptal üretimin tam yolunu izliyor.

**Benim denetimim:**

| Koşu | `tests/store/retrieval.test.ts` | Süit |
|---|---|---|
| 1 | ✓ **47/47** (9 885 ms) | 105 dosya · 2 143 geçti · 0 düştü |
| 2 | ✓ **47/47** (10 258 ms) | aynı |
| 3 | ✓ **47/47** (10 532 ms) | aynı |

Üç koşu da paralel hattın süreçleri kapalıyken, sırayla ve ön planda alındı.
M-SRV'nin altı koşusuyla birlikte **arka arkaya dokuz yeşil tam koşu**.

**Zayıflatılmadığını neden söyleyebiliyorum.** Testi ben yazmadım ve
değiştirmedim; ama düzeltmenin şeklini okudum ve iki vakumsuzluk kanıtı
**testin içinde duruyor**: (a) `budgetMs: 0` ile şerit `set_config`'i hiç
göndermiyor, dolayısıyla yavaş ifade de enjekte edilmiyor ve **gerçek satırlar
dönüyor** — yani reddin kaynağı sarmalayıcı değil, **şeridin kendi bütçesi**;
(b) sarılmış ve sarılmamış istemcinin döndürdüğü `chunkId` listesi **birebir
aynı**. Blok hâlâ tipli `TRIGRAM_BUDGET_EXCEEDED`'ı, uygulanan sayının
mesajda olduğunu, hattın `laneFailures` içinde kapsandığını, sürücünün
"canceling statement" cümlesinin okuyucuya **hiç ulaşmadığını** ve bütçenin
tel üzerinden ayarlanamadığını pinliyor. **Hiçbir iddia daraltılmadı.**

**Bundan sonra:** o dosyada bir kırmızı, artık **gerçek bir bulgudur**.
Yeşile dönene kadar yeniden koşturmak değil, araştırmak gerekir.

---

## 3. N-7'nin bağımsız denetimi — AÇIK KALDI

### 3.1 Görev metni "deterministik oldu" diyordu; iki koşu bunu doğruladı

İlk iki koşum **rakam rakam aynı** çıktı:

```
koşu 1: ABSTAIN=14 · COMPLETE=11 · PARTIAL=3 · QUALIFIED=6
        yanlış çekimserlik 1 (fx-amend-002) · kesinleştirilebilir %81,0
koşu 2: aynı · aynı · aynı
```

**Orada dursaydım "N-7 kapandı" yazacaktım ve yanlış olacaktı.**

### 3.2 Dört koşu daha, ve üçü farklı

| Koşu | Durumlar | Yanlış çekimserlik | Kesinleştirilebilir | retrieval p50/p95 |
|---|---|---:|---|---|
| 1 | A14 · C11 · P3 · Q6 | **1** (`fx-amend-002`) | %81,0 | 7,6 / 19,6 ms |
| 2 | A14 · C11 · P3 · Q6 | **1** | %81,0 | 6,9 / 18,7 ms |
| 3 | A13 · C12 · P3 · Q6 | 0 | %85,7 | — |
| 4 | A13 · C**14** · P3 · Q4 | 0 | %85,7 | — |
| 5 | A13 · C13 · P3 · Q5 | 0 | %85,7 | — |
| 6 | A14 · C12 · P3 · Q5 | **1** | %81,0 | — |

**Altı koşuda dört farklı durum dağılımı.** Değişmeyenler ise altısında da
birebir aynı: Recall@5 **0,9429**, @10/@20 **1,0000**, nDCG@10 **0,9156**,
MRR **0,9024**, karşıt otorite recall **1,0000**, atıf çözülebilirliği
**%100** (128 aday pasaj), alıntı/hash **35/35**, uydurma kimlik **0**,
kiracı sızıntısı **0**, beklenen gold birimi atıfta **%95,2**, şerit dağılımı
`exact=36 · lexical=67 · trigram=5 · dense=0 · relation=17 · citation=12`.

**Gerileme yakalayacak olan her şey kararlı; oynayan yalnız raporun kendi
"REPORT ONLY" diye işaretlediği katman.** Ve **yanlış cevap altı koşunun
altısında da 0** — yani yeni kapının koruduğu tek şey her koşuda tuttu.

### 3.3 `--repeats 4` — bant çalışıyor ve dürüst

```
Answer-level status counts   ABSTAIN=13-14 · COMPLETE=11-14 · PARTIAL=3 · QUALIFIED=4-6
                             4 repeat(s) / 4 ingest(s), VARIED across them
Answer-level false abstentions   0-1   union over repeats: fx-amend-002
Answer-level false answers       0     GATE: must be 0 in EVERY repeat; union: none
Answer-level finalizable rate    81.0%-85.7%  (17-18/21) ... VARIED across them
  [PASS] answer-layer false answers == 0 (every repeat) -- worst repeat: 0 ... ids: none
RESULT: PASS
```

Bant kipinin yaptığı iş tam olarak budur: **raporun yalan söylemesini
bıraktırmak**. `VARIED across them` cümlesi, bu turda benim altı koşuda elle
gördüğüm şeyi tek koşuda söylüyor.

### 3.4 Hüküm: daraldı, kapanmadı — ve kalan iş tek satırlık

M-SRV kök nedeni **canlı kanıtladı** (§4.4'ünde): `chunkStore.ts`'in
citator/ilişki şeridi sıralamayı `r.id asc` ile bitiriyor ve `r.id`,
`legal.document_relations` satırının **her ingest'te yeniden üretilen**
UUID'sidir; aynı korpusun iki ingest'i arasında AMENDS kenarları yer
değiştiriyor, RRF şerit **sırasını** kullandığı için bu füzyon skorlarına ve
kapsam-duyarlı top-8 kapağına taşınıyor, ve `fx-amend-002` bir koşuda
cevaplanıp diğerinde çekimser kalıyor.

Bunu bu turda **kodda doğruladım**: satır 1301 ve 1315 hâlâ `r.id asc` ile
bitiyor, ve `stableTieBreak` (satır ~390) aynı kusuru FTS/trigram şeritleri
için **zaten düzeltmiş** durumda. Yani düzeltmenin şekli belli, yeri belli,
emsali kendi dosyasının içinde.

**Kabul ölçütü:** düzeltme indiğinde `run_evals.py --repeats 4` bandı
**sıfır genişliğe** inmeli ve rapor `identical across them` yazmalı. O gün
bu bölümün tablosu yeniden ölçülsün.

---

## 4. Yan denetimler

**N-1 hâlâ açık, ve bunu tahmin etmedim — baktım.** N-1'in isteği,
trigram şeridinin planını **ürünün kendi eşiğinde (0,35)** pinleyen bir
gerileme testiydi. `tests/store/retrieval.test.ts` bloğu (k)'da iki plan
iddiası var (`chunks_search_trgm` kullanılıyor · `chunks` üzerinde `Seq Scan`
yok), ama ikisi de `trigramSearch`/`explainTrigramSearch`'ü **varsayılan**
eşikle çağırıyor ve o varsayılan `chunkStore.ts:881` ve `:938`'de
**`options.minSimilarity ?? 0.5`**. `/v1/answer` ise 0,35 ile koşar
(`DEFAULT_ANSWER_LIMITS`). Yani plan bugün **ürünün koşmadığı bir eşikte**
pinleniyor. N-1'in satırı bu cümleyle güncellendi.

**N-4 daraldı, kapanmadı.** Kaynağın kendi kayıt sayısı artık hem sunucuda
(`totalRecords`, M-SRV) hem ekranda (M-UI) var, ve `null` **asla 0 diye
yazılmıyor**. Kalan yarı **ilgililik sıralamasıdır** ve o sunucu işidir:
birden çok sayfa çekip ColleX'in kendi kanıt disiplinine göre yeniden
puanlamak. Bu turda ona dair hiçbir kod inmedi.

**V-1'in kalıntısı ikiye ayrıldı.** Ölçüm yarısı (7,5 sn boş sonuç)
**aynen duruyor** — bu turda yeniden ölçmedim ve ölçmediğimi yazıyorum;
S25‴ F-VERIFY'ın ölçümüdür. Arayüz yarısı (ilerleme + iptal) M-UI'de
**kapandı**. Bu ayrım STATUS'un "ölçülmüş tavan 1" bölümüne bir kutu olarak
yazıldı, çünkü "artık ekranda bir çubuk var" cümlesi kolayca "artık hızlı"
diye okunur.

---

## 5. Belgelerde ne değişti

| Dosya | Ne yapıldı |
|---|---|
| `docs/implementation/STATUS.md` | Başlık **Faz M kapanışı**; S1–S8 bu turun ölçümleriyle yeniden yazıldı (S2'ye "üç koşu, N-8 çekincesi KALKTI", S6'ya altı koşuluk bant ve "iki koşunun uyuşması kanıt değildir"); **S37–S40 yeni** (`uploadsDir`, `totalRecords`, N-8 düzeltmesi, N-7 bant kipi); "iki ölçüm aracı çekincesi" bölümü **N-8 kapandı / N-7 daraldı** olarak yeniden yazıldı; "ölçülmüş tavan 1"e ilerleme/iptal kutusu; V/N hesap tablosuna **M-SRV ve M-UI satırları**; doğrulanmamış yüzey #5 (B-16) `totalRecords` ile güncellendi; "Bu turda ölçülmeyenler" bölümü Faz M hatlarının ölçümlerini **kendi ölçümümden ayırıyor**; yeni **"Faz M'de ekranda değişenler"** tablosu; "In progress" listesi ve "Last successful verification" bu tura göre |
| `docs/implementation/TRACEABILITY.md` | Başlık ve N-blok girişi; **N-8 satırı CLOSED** (düzeltmenin mekaniği + iki vakumsuzluk kanıtı + dokuz yeşil koşu); **N-7 satırı OPEN, gerekçesi tümüyle yeniden yazıldı** (üç parçadan ikisi yapıldı, üçüncüsü yapılmadı; kabul ölçütü yazılı); N-1 satırına "hâlâ 0,5'te pinleniyor" tespiti; N-4'ün sayı yarısı DONE; V-1 kalıntısı ikiye ayrıldı; IR-1 ve IR-2 **DONE** olarak işaretlendi; iki yeni ertelenen kalem (canlı araştırma iptali, dışa aktarma ilerlemesi) |
| `docs/implementation/RISKS.md` | Başlık Faz M; **#35 (N-8) emekliye ayrıldı** ve emekli tablosuna kanıtıyla girdi; **#34 (N-7) yeniden yazıldı** (ne yapıldı, ne yapılmadı, kabul ölçütü); #25'e ilerleme/iptal ve "bekleme kısalmadı"; #27'ye `totalRecords` |
| `docs/KULLANIM-ColleX.md` | Sürüm satırı; **§8.0 yeniden yazıldı** — ilerleme kartı, "Vazgeç", yüzde olmaması, üç gerekçeli istisna (yedekleme · canlı araştırma · dışa aktarma) ve iki yeni ekran bilgisi; §8.1'e kaynağın kayıt sayısı + bekleme kartı; §10'da arama ve ölçek maddeleri |
| `docs/DEMO.md` | Başlık; **Faz M notu** (ilerleme/iptal, iki eklemeli alan, N-8 kapandı / N-7 açık); §10'da arama, ölçek ve N-7 maddeleri |
| `docs/README.md` | Başlık **phase M**; hüküm kutusu (N-8 kapandı, N-7 daraldı); vaporware/ekran kutusuna ilerleme-iptal cümlesi; **üç yeni wave satırı** (`W14-M-SRV`, `W14-M-UI`, `W14-M-CLOSE`) ve okuma yolu |
| `docs/implementation/RUNBOOK.md` | Girişteki çekince ikiye ayrıldı: `vitest` **artık tekrarlanabilir** (kırmızı = bulgu), `run_evals` bir katmanda değil — `--repeats N` kullanın |
| `CLAUDE.md` | Dateline **phase M**; wave zinciri; bugünkü sayım (N-8 kapandı, N-7 açık, V-1 ve N-4 yarım); süit ve pytest sayıları; iki deterministiklik paragrafı **yeniden yazıldı**; **üç yeni değişmez**: tek `resolveUploadsDir`, "sağlayıcının yayımlamadığı sayı `null`'dır, asla 0", "uzun bekleme ne yaptığını söyler, durdurulabilir ve yüzde uydurmaz" (iki gerekçeli istisnasıyla); B-16 etiketine `totalRecords` notu; wave okuma listesi |
| `docs/architecture/overview.md`, `docs/implementation/{EXPORT,FINAL_REPORT,PLAN}.md` | Yalnız `S1–S36` → **`S1–S40`** aralık düzeltmesi |
| `docs/implementation/waves/W14-M-CLOSE.md` | Bu rapor |

**Lane raporları tarihsel kayıttır ve yeniden yazılmadı.** `W14-C-FINAL`'ın
"N-7 ve N-8 açıktır" cümlesi olduğu yerde duruyor; bugünkü hüküm STATUS'ta ve
TRACEABILITY'dedir. Bir sonraki okuyucunun görmesi gereken şey yalnız doğru
sayı değil, **hükmün nasıl değiştiğidir**.

### 5.1 Tutarlılık denetimi

* `S1–S36` yazan **sekiz** dosya `S1–S40` yapıldı; wave raporlarına
  dokunulmadı (tarihsel).
* Bu turda yazdığım her sayı STATUS'ta bir satıra iz sürüyor; STATUS'ta
  satırı olmayan hiçbir sayıyı hiçbir belgeye yazmadım.
* Başka bir hattın ölçümünü aktardığım her yerde hattın adı yazılı
  (S37'nin sunucu yarısı M-SRV, S38'in ekran yarısı ve bütün piksel değerleri
  M-UI, S25‴ F-VERIFY).
* Çalışmayan bir ekranı anlatan bir yer aramadım — bu turda ekran
  ölçmedim ve ölçmediğimi yazdım; ekran cümlelerinin dayanağı M-UI'nin
  raporu ve `console.test.ts`'in **179/179** geçmesidir.

---

## 6. Diğer hatlara istekler (integrationRequests)

Bu hat koda dokunmadığı için hepsi başkasının dosyasıdır.

1. **`control-plane/src/store/chunkStore.ts` (satır ~1301 ve ~1315) — N-7'nin
   kalan tek işi ve bugün sıradaki en küçük iş.** Citator/ilişki şeridinin
   iki sorgusu da sıralamayı `r.id asc` ile bitiriyor. Korpus kimliğiyle
   sıralansın (`r.kind::text`, hedef belgenin `source`/`external_id`'si,
   kaynak parçanın ordinal'i), `r.id` yalnız en son çare. Emsal aynı dosyada:
   `stableTieBreak`. **Kabul ölçütü ölçülebilir:** `run_evals.py --repeats 4`
   bandı sıfır genişliğe insin ve rapor `identical across them` yazsın.
2. **`control-plane/tests/store/retrieval.test.ts` bloğu (k) — N-1.** Plan
   iddiaları şeridin varsayılanı olan 0,5 ile koşuyor; ürünün cevap yolu
   0,35 ile koşar. Aynı iddia **0,35'te** de pinlensin.
3. **`export/petition.py`** — ek künye bloğundaki `Kanıt kimliği: ev-…`
   satırı N-3'ün parantez kuralına birebir uysun. (C-SRV §10(5) ve C-FINAL
   §7(1) de bildirmişti; hâlâ açık.)
4. **`evals/reports/fixture_baseline_2026-09-02.{json,md}`** — diskteki
   dosya hâlâ **tek bir koşuya** aittir (bu turun altıncısı). Bir sonraki
   resmî ölçüm turu `--repeats N` ile koşulup rapor bandıyla üretilirse
   STATUS S6 bandı doğrudan alıntılayabilir. (M-SRV §6(2) de bildirmişti.)
5. **`POST /v1/research/runs/{runId}/cancel`** — bugünkü "Vazgeç" canlı
   araştırmada yalnız beklemeyi bırakıyor ve bunu dürüstçe söylüyor; gerçek
   iptal sunucu işidir. (M-UI §7(5).)
6. **`POST /v1/backup` çıktı yolunu istekten almıyor ve `COLLEX_DATA_DIR`'i
   dinlemiyor** — M-UI bunu bir hijyen kusuru olarak kaydetti (kullanıcının
   ev dizininde klasör yarattı ve temizledi). Yol ya istekten alınmalı ya da
   veri klasörüne bağlanmalı.

---

## 7. Hijyen

* **Hiçbir sunucu açmadım.** Koşu sonunda `netstat`: **8787, 8898, 8977,
  8978, 8987, 8988'de dinleyici yok**. **8787/8898'e hiç dokunulmadı.**
* **Kendi adıma hiçbir veritabanı yaratmadım ve düşürmedim.** `collex_demo`
  `demo.mjs`'in, `collex_eval_test` `run_evals.py`'nin, `collex_mig_test`
  `db_local_check.py`'nin, kalanlar vitest süitlerinin kendi
  veritabanlarıdır. **`collex_local`'a hiç bağlanılmadı, hiç yazılmadı,
  düşürülmedi.** Koşu sonunda `pg_database`: `collex_demo`,
  `collex_eval_test`, `collex_intake_test`, `collex_local`, `collex_mig_test`,
  `collex_quality_test`, `collex_retrieval_test` — hepsi kendi sahiplerinin.
* **Dış ağa hiçbir istek yapılmadı.** `.env` okunmadı, Supabase/Resend
  kullanılmadı, **hiçbir git işlemi yapılmadı**, `npm install`
  çalıştırılmadı, `control-plane/package.json`'a dokunulmadı.
* **Hiçbir test zayıflatılmadı, atlanmadı ya da silinmedi** — bu hat teste
  hiç dokunmadı. Koda ve `openapi.yaml`'a da dokunmadı.
* MCP yüzeyi **54** olarak üç kapıda doğrulandı; API değişikliği yapılmadı.
* Bütün geçici dosyalar `…/scratchpad/w14lm-M-CLOSE/` altında.

### Değişen depo dosyaları

```
docs/implementation/STATUS.md
docs/implementation/TRACEABILITY.md
docs/implementation/RISKS.md
docs/implementation/RUNBOOK.md            (girişteki iki çekince)
docs/implementation/PLAN.md               (S aralığı)
docs/implementation/EXPORT.md             (S aralığı)
docs/implementation/FINAL_REPORT.md       (S aralığı)
docs/architecture/overview.md             (S aralığı)
docs/README.md
docs/DEMO.md
docs/KULLANIM-ColleX.md
docs/implementation/waves/W14-M-CLOSE.md  (bu rapor)
CLAUDE.md
evals/reports/fixture_baseline_2026-09-02.{json,md}   (run_evals.py'nin KENDİ çıktısı, 7 koşu)
demo-output/report.md                                 (demo.mjs'in KENDİ çıktısı)
```

---

## 8. Teslim durumu

### Avukatın bugün güvenebileceği şeyler

**Dayanak disiplini.** Bir paragraf, atıf yaptığı alıntıyı birebir içermek
zorundadır; içermiyorsa bağ **anında** kopar, atıf yazılmaz, paragraf
KAYNAKSIZ işaretlenir ve dışa aktarma **reddedilir** — hiçbir dosya
yazılmadan. Kapı iki bağımsız katmandadır ve gerçek bir tahrifatla
doğrulanmıştır. Çözemediği künyeyi **boş bırakır**: "?" yazmaz, tire
koymaz, tahmin etmez.

**Ölçmediğini söylemek.** 41 süre kuralının 25'i "doğrulanmadı" diye
işaretlidir ve her hesap bunu yazar; 20 harç kaleminin 17'sinde tutar yoktur
ve toplam **null** kalır. Yanlış bir sayı uydurmaktansa boş bırakmayı
seçiyor — ve bu turda aynı disiplin bir yenisine daha uygulandı: kaynak kaç
kayıt tuttuğunu bildirmiyorsa ekran **"bildirmedi"** der, **"0" demez**.

**Beklerken ne olduğunu görmek ve durdurabilmek.** Bu turda inen en büyük
şey budur. Uzun süren her işte ekranda hangi aşamada olduğunuz, kaç saniye
geçtiği ve bir **"Vazgeç"** düğmesi var. Yüzde yok, çünkü sunucu yüzde
bildirmiyor ve uydurulmuş bir yüzde bu ürünün yasakladığı türden bir sayı
olurdu. Yedeklemede "Vazgeç" yok ve **sebebi ekranda yazılı**; canlı
araştırmada "Vazgeç" koşuyu değil beklemeyi durdurur ve **bunu da söylüyor**.

**Veri güvenliği ve geri dönüş.** Müvekkil verisi bu bilgisayardan çıkmıyor
(bulut AI kapalı). Yedek alınabiliyor, doğrulanabiliyor, bozuk bir yedeği
**reddediyor**, ve arşiv dosyası yedeklediği veritabanının adını taşıyor.
Veritabanı gerçekten yok edilip geri yüklendi; asıllar bayt bayt, tablolar
satır satır aynı geldi.

**Günlük hız.** Yüklediği belgeye sorduğu soru **71–73 ms**. Kayıtlar
yeniden başlatmada geri geliyor.

**Ve ölçüm araçlarından biri artık güvenilir.** `npx vitest run` bu turda
üç kez arka arkaya yeşil bitti ve daha önce yarışan tek test düzeltildi:
bundan sonra o süitte bir kırmızı, **gerçek bir bulgudur**.

### Bugün hâlâ doğrulanmamış olanlar — tam liste

1. **Karar aramanın isabeti.** Arama çalışıyor, gerçek künye getiriyor, ve
   artık kaynakta kaç kayıt olduğunu da yazıyor — ama **sıralamayı kaynak
   sunucu yapıyor** ve dönen kararların işe yarayıp yaramadığı **hiç
   ölçülmedi**.
2. **25 süre kuralı** madde metniyle karşılaştırılmadı. Listenin en yüksek
   etkili kalemi: kaçırılan bir süre geri alınamaz.
3. **17 harç kalemi** tutarsız; bu yılın Resmî Gazete rakamları elde değil.
4. **Bulut AI** canlı API'ye tek bir istek bile göndermedi.
5. **UDF** UYAP editöründe hiç açılmadı; **`.ics`** gerçek bir takvim
   istemcisinde hiç açılmadı.
6. **Yerel kütüphane** hiçbir şeyi `collex_local`'a yazmıyor.
7. **Atıf denetimi** "bulunamadı" diyemiyor — bir **kapsam beyanıdır**.
8. **Ölçek tavanı.** 20 000 parçalık üretilmiş bir korpusta, korpusta hiç
   geçmeyen bir ifade **7,5 saniye sürüp boş dönüyor**. Bu turda yeniden
   ölçülmedi. **Görünür ve durdurulabilir oldu; kısalmadı.**
9. **Eval kapısının cevap katmanı (N-7).** Bugün ölçtüm: altı koşuda dört
   farklı sonuç. Rapor artık dürüst (bant basıyor, kapıyı her tekrarda
   uyguluyor), ama kusur duruyor ve kök nedeni **bilinen tek bir satırdadır**.
10. **`totalRecords` canlı upstream'den uçtan uca doğrulanmadı** — ayrıştırma
    gerçek payload şekillerine karşı çevrimdışı doğrulandı, ekran değeri
    M-UI'nin gerçek aramasından geldi, ama iki ucun aynı turda birlikte
    ölçüldüğü bir koşu yok.
11. **Ve en geniş sınır:** buradaki her kalite ölçümü **sentetik**
    korpustadır. ColleX'in hukukî isabeti gerçek Türk mevzuatı ve içtihadı
    üzerinde **hiç ölçülmedi**. O ölçüm yapılana kadar "daha iyi" sözü yalnız
    **disiplin** için geçerlidir — kapsam ve isabet için değil.

### Sırada yapılmaya değer TEK şey

**`chunkStore.ts`'in citator şeridindeki tie-break'i düzeltmek** (satır ~1301
ve ~1315: `r.id asc` yerine korpus kimliği).

Neden bu, ve neden başka bir şey değil: bu, **ölçülmüş, yeri ve şekli belli,
emsali kendi dosyasının içinde olan ve kabul ölçütü sayıyla ifade edilebilen**
tek açık kalem. Bugün bu ürünün en zayıf noktası hukukî isabeti bilmemek
değil — onu bilmek için bir hukukçu turu ve haftalar gerekiyor — **ölçüm
aracının kendi gürültüsünü taşıyor olmasıdır**. Cevap katmanı koşudan koşuya
oynadığı sürece hiçbir gerileme iddiası, hiçbir eşik kararı ve hiçbir
"iyileşti" cümlesi tek koşuyla savunulamaz; nitekim bu dalgada bir eşik
kararının gerekçesinin yarısı tam bu yüzden ölçümden ayrılamadı. Düzeltme bir
`order by` cümlesidir ve doğruluğu `--repeats 4` bandının **sıfır genişliğe
inmesiyle** ölçülür.

Ondan sonrası zaten sıraya girmiş durumda: gerçek Türk hukuk metniyle bir
kalite ölçümü (en büyük belirsizlik, ama en pahalı adım), aramada sunucu
tarafı ilgililik (avukatın rakiplere gittiği tek eksen), ve ölçek tavanının
kendisi. Ama bunların hiçbiri, ölçüm aracı oynarken güvenilir biçimde
ölçülemez.
