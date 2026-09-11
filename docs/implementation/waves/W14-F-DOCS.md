# W14 — F-DOCS (Faz F): belgeleri son ÖLÇÜLEN duruma getirmek

**Tarih:** 02.09.2026 · **Tip:** UZLAŞTIRMA — bu hat **hiçbir koda ve hiçbir
teste dokunmadı**. Sahiplendiği dosyalar: `docs/**`, `CLAUDE.md`,
`control-plane/src/api/openapi.yaml`.
**Sunucu açılmadı, veritabanı yaratılmadı ya da düşürülmedi, `collex_local`'a
bağlanılmadı, 8787/8898'e dokunulmadı, git işlemi yapılmadı, `.env` okunmadı,
Supabase/Resend kullanılmadı, devlet upstream'lerine tek bir istek gitmedi.**
MCP araç yüzeyi **54**, değişmedi. `openapi.yaml` deltası **eklemelidir** (bir
davranış değişikliğinin belgelenmesi hariç, §2).

> Bu raporda "bu turda ölçüldü" diyen her sayı **21:51–22:20 arasında bu
> makinede, üç düzeltme hattı da indikten sonra** koşuldu. Ölçmediğim hiçbir
> şeye hüküm vermedim; ölçmediğim satırların kaynağını ve **saatini** yazdım.

---

## 0. Neden bu hat var

Faz F'in üç düzeltme hattı (F-PERF, F-API, F-UI) paralel koştu ve her biri
**kendi turunda** ölçtü: F-API 20:39, F-UI 21:14, F-PERF 21:47. Yani
**hiçbiri üçünün de indiği ağacı ölçmedi** — F-API'nin tam süiti, eşzamanlı
konsol hattı yüzünden 5 düşen testle kapandı ve o beşi konsol hattının **tam
da düzelttiği** kalemlerdi.

Bu yüzden bu turun ilk işi ölçmek oldu: dört kapı, sıralı, son ağaç üzerinde.

| # | Komut | Ölçülen çıktı | Exit |
|---|---|---|---:|
| S1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | 0 |
| S2 | `control-plane> npx vitest run` | **102 dosya · 2 086 geçti · 0 DÜŞTÜ · 6 atlandı (2 092)** · 23,08 sn | 0 |
| S3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 339 passed** · 129,87 sn | 0 |
| S4 | `.venv/Scripts/python.exe scripts/smoke_check.py` | `offline smoke checks passed: 54 tools, …` | 0 |
| S8 | `openapi.yaml` (pyyaml + `$ref` yürüyüşü, **düzenlemelerden SONRA**) | **65 yol · 80 işlem · 126 şema · çözülmeyen `$ref` 0 · referanssız şema 0 · tekrar eden/eksik `operationId` 0 · `info.version 1.0.0`** | — |
| — | `control-plane> npx vitest run tests/pipeline/retrievalProvenance.test.ts tests/api.test.ts` (`openapi.yaml`'ı **okuyan** süitler, düzenlemelerden sonra) | **2 dosya · 59 geçti** | 0 |

**6 atlamanın altısı da ters işaretleyicidir** ("environment unavailable"):
`real-export`, `store/persistence`, `matters/pg`,
`integration/{serve,real-exec,backup}` gerçek süitlerinin altısı da **koştu**.
`integration/serve.test.ts` 22,3 sn'lik gerçek `--with-mcp` koşusuyla geçti.

**Yeniden koşmadıklarım, açıkça:** `run_evals.py`, `db_local_check.py`,
`demo.mjs`, `http_e2e_check.py`, `live_local_gateway_check.py`. Satırları
kaynağını ve saatini söylüyor. `demo.mjs` bilerek koşulmadı: `collex_demo`'yu
düşürüp yeniden kurar. Aralarında hiçbir ürün dosyası değişmedi (bu tur yalnız
belge dosyalarına ve `openapi.yaml`'a dokundu) — ama bu bir **çıkarımdır**,
ölçüm değildir ve STATUS'ta öyle yazıyor.

---

## 1. `STATUS.md` — tek sayı tablosu, en yeni ölçümle

Tablo **S1–S24 → S1–S32**'ye çıktı. Kural: **bir satır yeniden ölçüldüyse yeni
değer yazıldı, eskisi "önce" olarak satırın içinde bırakıldı** ki gerileme ya
da iyileşme görünsün.

### 1.1 Yenilenen satırlar

| Satır | Önce | Şimdi | Kaynak |
|---|---|---|---|
| S1–S4 | L-DOCS turu | bu tur, üç hat indikten sonra | **F-DOCS** |
| S2 | 102 dosya · 2 027 geçti · **1 DÜŞTÜ** | 102 dosya · **2 086 geçti · 0 DÜŞTÜ** · 6 atlandı | **F-DOCS**. Seyir satırın içinde: B1 2 028 → L-VERIFY 2 047 → F-UI 2 081 → 2 086 |
| S6 | kesinleştirilebilir %81,0 · **yanlış çekimserlik 1** | %85,7 (18/21) · **yanlış çekimserlik 0**; retrieval metrikleri ve şerit dağılımı W14 öncesi varsayılanlarla **birebir aynı** | `W14-F-PERF` §6 (aynı ağaçta ÖNCE/SONRA) |
| S8 | 65/80, şema sayısı yazılı değildi | 65/80/**126**, delta **alan düzeyinde** — yeni yol/işlem yok | **F-DOCS** |
| S10, S11 | L-DOCS | uçtan okundu (41/16/25/7 · 20/5/17) | `W14-L-VERIFY` §6.5 |
| S13 | Faz A raporları | gerçek sunucudan | `W14-L-VERIFY` §4 |
| S14 | L-DOCS | üç bağımsız kapı (smoke · http · gateway) | `W14-L-VERIFY` §1 |
| S16, S17, S19, S20, S21 | güncel sayılıyordu | **TARİHSEL** işaretlendi ve halefi gösterildi (S26, S28, S29, S30) | — |
| S22 | 13 sabit | + `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS` **8**, `DEFAULT_TRIGRAM_BUDGET_MS` **2 500**, `MAX_ANSWER_QUERY_CODE_POINTS` **200** | F-PERF, F-API |
| S24 | "hiçbiri gevşetilmedi" | aynı + **dürüstlük çekincesi**: F-PERF'in fallback kapısı bir **recall değişikliğidir** | `W14-F-PERF` §3(b) |

### 1.2 Yeni satırlar

**S25–S30** L-VERIFY ve F-PERF'in ölçümleri (cevap gecikmesi, trigram şeridi
planı ve bütçesi, liste uçları ölçeği, felaket tatbikatı, uyarı bütçesi,
erişilebilirlik). **S31** F-API'nin üç dikişinin önce/sonra HTTP ölçümü.
**S32** F-UI'nin tarayıcı ölçümleri.

Bir örnek, tam hâliyle yazıldı çünkü tek başına okunduğunda yanıltıcı olurdu:

> **S25.** Gerçekçi korpus şeklinde yaygın sözcük **p50 49 368 → 15 756 ms**,
> `ABSTAIN` + 3 bozuk şerit → **COMPLETE / 8 kanıt / 0 bozuk şerit**; uzun soru
> **64 319 ms PARTIAL → 17 472 ms COMPLETE**; belge kapsamlı soru **125 → 64
> ms**. **Kapanmayan yarı:** 15–17 sn hâlâ ölçülüyor ve kalan maliyet lexical
> şeridinin `tsvector_to_array` kesişimidir (çağrı başına 1 489–3 427 ms).

### 1.3 "Dokuz doğrulanmamış yüzey" → **sekiz yüzey + bir ölçülmüş tavan**

Dokuzuncu yüzey ("ölçek") ikiye ayrıldı ve **yarısı kapandı**: B-32'nin
2 000 belgelik kabul ölçümü L-VERIFY tarafından **yapıldı** ve süre ölçütü
geçti; plan ölçütü F-PERF ile geçti (S27). Kalan yarı artık bir
"doğrulanmamış yüzey" değil, **ölçülmüş bir tavandır** ve STATUS'ta kendi
başlığı altında öyle duruyor: 20 000 parçada korpus sorusu **15–17 sn**,
pgvector yok, hukukçu gold set yok, kapsam kapısı sözcüksel.

Kalan sekizin hepsi duruyor: Bulut AI · UDF · 25 süre kuralı · 17 harç kalemi
· canlı karar arama · `.ics` · yerel kütüphane · atıf denetiminin
`NOT_FOUND` kovası. **#5'in metni değişti ama yüzey kapanmadı:** F-API dikişi
düzeltti, istek artık geçide **gerçekten ulaşıyor** ve ekran geçit kapalıyken
kendini **devre dışı** çiziyor — ama devlet upstream'lerine bu makineden
erişilemiyor, dolayısıyla **hiçbir gerçek künye dönmedi**.

### 1.4 Yeni bölüm: "Faz F — L-VERIFY'ın 22 bulgusunun hesabı"

Hangi hat neyi kapattı, hangi üçü açık kaldı, hangisi kısmen kapandı — tek
tabloda ve satır satır `TRACEABILITY.md`'ye bağlı.

---

## 2. `openapi.yaml` — üç düzeltme hattının deltası

**Yeni yol ya da işlem YOK.** Sayım değişmedi (65/80/126), çünkü Faz F yeni uç
eklemedi; yaptığı, var olan sözleşmeleri **doğru anlatmaktı**.

| Nerede | Ne değişti | Kaynak |
|---|---|---|
| `GET /v1/answers` `q` | `maxLength: 200`; açıklama artık "kabul edilip **sessizce düşürülüyordu**, şimdi gerçekten süzüyor" diyor; boş/yalnız boşluk **süzgeç değildir** | F-API V-6 |
| `GET /v1/answers` `status` | `enum: [COMPLETE, QUALIFIED, PARTIAL, ABSTAIN]` (önce serbest `string`) | F-API V-6 |
| `GET /v1/answers` `400` | **Tanınmayan sorgu parametresi** artık 400; bunun **dalganın tek eklemeli-olmayan davranış değişikliği** olduğu ve sessizce düşürülen bir süzgecin yerine geçtiği yazıldı | F-API V-6 |
| `POST /v1/sources/search` `502` | Artık `ALL_SOURCES_FAILED` önce anlatılıyor; `UPSTREAM_UNAVAILABLE` **yalnız geçit gerçekten yokken**. Eski metnin neden yanlış olduğu (`serve.mjs` `deps.gateway`'i hiç göndermiyordu) kayda geçti | F-API V-3 |
| `POST /v1/sources/fetch` `502` | Buradaki başarısızlık artık **belge düzeyindedir**, "geçit yapılandırılmamış" değil | F-API V-3 |
| `GET /v1/files/{fileId}/original` | Kaynak klasör `var/uploads` → **`<COLLEX_DATA_DIR>/uploads`** (varsayılan `<repo>/var/uploads`); `uploadsDir`'in tek yerden çözüldüğü ve neden 404 verdiği yazıldı | F-API V-4 |
| aynı ucun `404` | Kod hâlâ **"var/uploads klasöründe yok"** diyor; metin birebir korundu ve **KNOWN STALENESS** olarak işaretlendi (üç yerde duruyor, birlikte değişmeli) | F-API §7.4 |
| `AnswerResult.warnings` | `RETRIEVAL_LANE_DEGRADED` açıklaması: şeridi kesen artık **15 sn `statement_timeout` değil**, şeridin **kendi 2 500 ms bütçesi** (`TRIGRAM_BUDGET_EXCEEDED`); şerit **FALLBACK** olduğu için doymuş korpusta uyarı hiç çıkmayabilir; `SearchPipelineResult.trigram`'ın **hiçbir HTTP cevabında ve hiçbir ekranda olmadığı** açıkça yazıldı | F-PERF V-1 |
| `SearchRequest.limits` | İki yeni sunucu sabitinin **bilerek** açığa çıkarılmadığı, `additionalProperties: false` sayesinde bir çağıranın kendi bütçesini yükseltemeyeceği yazıldı | F-PERF §10 |

**Doğrulama:** düzenlemelerden sonra pyyaml ayrıştırması ve `$ref` yürüyüşü
temiz (§0), ve `openapi.yaml`'ı **okuyan** iki süit (`retrievalProvenance`,
`api`) 59 testle geçti. **Şema gövdelerinin gerçek cevaplarla alan alan
karşılaştırılması yine yapılmadı** — o, her uca gerçek istek atmayı gerektirir
ve bu hattın işi değildi (L-DOCS §11.4 açık kalmaya devam ediyor).

---

## 3. `TRACEABILITY.md` — V-1..V-22 bloğu

Yeni bir tablo eklendi: her bulgu için **kusur · düzeltme · dosya · kusuru
geri koyunca DÜŞEN gerileme testi · STATUS satırı · hüküm**.

**19 KAPANDI · 1 KISMEN (V-22) · 3 AÇIK (V-14, V-19, V-21).**

Üç ayrıntı bilerek yazıldı:

1. **V-1 "PARTIAL" olarak kaydedildi, "PASS" değil.** 49 368 → 15 756 ms bir
   iyileşmedir; 15–17 sn kalan bir maliyettir ve kalan maliyet artık **başka
   bir şeritte**. Bir P0'ı "kapandı" diye yazmak, ölçülen sayıyı silmek olurdu.
2. **V-3 iki yarım olarak kaydedildi.** Sunucu dikişi kapandı (F-API), ekran
   kapısı kapandı (F-UI), ama **canlı doğrulama yapılmadı** ve satır bunu
   söylüyor.
3. **Vakıasızlık kanıtı her satırda anıldı.** Üç hat da kusuru koda geri koyup
   testin düştüğünü gördü ve dosyaları `diff` ile geri yükledi; F-UI sekiz
   kusuru tek tek geri koydu ve sekizinin sekizi de **tam bir testi**
   kırmızıya çevirdi.

Ayrıca değişen B-satırları: **B-32 DEFERRED → PASS** (kabul ölçümü yapıldı),
**B-41 DEFERRED → PASS** (V-8/V-9/V-17 ile indi), **B-06 / B-16 / B-26 /
B-30 / B-40** hücreleri yeni kanıtla güncellendi, **B-39** hâlâ DEFERRED
(tasarım sistemi göçü yapılmadı; Faz F yalnız ölçümün zorladığı tek bir
token'ı değiştirdi).

Ertelenenler tablosu da düzeltildi: B-32'nin ölçümü **üstü çizildi**, inen
altı ekran ayrı bir satıra alındı ve **inmeyen dokuz ekran** ad ad sayıldı.

---

## 4. `RISKS.md` — on yeni risk, biri düzeltilmiş

`#19` baştan yazıldı: "30 kuralın hepsi doğrulanmadı" **yanlıştı** — bugün
**41 kuralın 25'i** doğrulanmadı, 16'sı madde metniyle doğrulandı, 7'si
`adliTatileTabi:"belirsiz"`. Satır ayrıca **"bu kayıttaki en yüksek etkili
risk"** diye işaretlendi.

Yeni satırlar **#24–#33**: harç kalemlerinde tutar yokluğu · 20 000 parçadaki
15–17 sn ve ekranda ilerleme/iptal olmayışı · **trigram fallback kapısının
ölçülmüş recall değişikliği** · canlı karar aramanın hiç koşmaması · `.ics`'in
hiç açılmaması · atıf denetiminin `NOT_FOUND` diyememesi · yerel kütüphanenin
ingest edilmemesi · **`PgDraftStore.put`'un arka plan yazımlarını anahtar
başına sıralamaması** (F-PERF §10.1'de deterministik olarak üretildi) · açık
kalan üç doğrulama bulgusu · **yedeklemenin zamanlanmış görevi olmaması**.

Her satır kontrolünü ve "en küçük kullanıcı eylemi"ni yazıyor ve hiçbiri sayıyı
kopyalamıyor; STATUS satırına atıf yapıyor.

---

## 5. Diğer belgeler

* **`FINAL_REPORT.md`**: §0–§12 W12 turunun **tarihsel** kaydı olarak
  korundu (W12 satır kimliklerini kullandığı bir uyarıyla) ve **yeni §13**
  eklendi: W13/W14 ve Faz F katmanı, doğrulama hattının niye var olduğu,
  ürünün gerçekten çalıştığı ölçülen beş sert sözü, Faz F'in kapattıkları,
  açık kalan üç kusur ve bir tavan, "üç değil sekiz yüzey" ve bugünkü hüküm.
  §1.4'ün "doğrulanmamış üç yüzey"i tarihsel olarak bırakıldı, üstüne bugünkü
  sayı yazıldı.
* **`PLAN.md`**: Faz 3, 6, 8 ve 9'un durum hücreleri yeniden yazıldı (Faz 9
  "NOT STARTED" → **"BARELY STARTED"**, çünkü yedekleme ve prova edilmiş geri
  yükleme artık var ve ölçüldü); "sıradaki işler" listesine üç madde eklendi;
  kapsam sınırlarına **UYAP/UETS kimlik entegrasyonu yok** ve **sentetik
  ölçüm hukukî kalite iddiası değildir** yazıldı.
* **`DECISIONS.md`**: ADR indeksi **022..028** ile tamamlandı; Faz F'in sekiz
  ADR-dışı kararı en üste eklendi — fallback kapısının **neden** eşiğinin 8
  olduğu ve reddedilen `left(search_text,250)` seçeneği, iki sabitin bilerek
  API'ye açılmaması, migrasyonun **yorum** olarak düzeltilmesinin gerekçesi,
  `gateway ?? researchGateway`, tek `uploadsDir` çözücü, tanınmayan parametre
  400'ü, ekranın **uca** sorması ve **hiçbir toast'ın çıplak HTTP kodu
  yazmaması**.
* **`EXPORT.md`**: yeni **§8** — iki kip (`annex`/`marks`, ADR-024), alıntı
  bütünlüğü reddi (ADR-023, ve `409` yolunun uçtan uca **üretilemediği**
  dürüst kaydı), üç yeni çıktı (`denetim-docx`, `inceleme-docx`,
  `dosya-paketi-zip`), asılların yeri (V-4) ve bu dalgada inmeyenler.
* **`AI.md`**: yeni **§0** (W14'ün maskeleme + kayıt defteri + tavanı, ve
  `maskMode`'un neden yalnız `analyze-document` için olduğu); "Canlı sınama
  kaydı" bölümü **hâlâ boş** ve artık W14'ün hiçbir hattının canlı çağrı
  yapmadığını, L-VERIFY'ın ürünü `ai.configured:false` ile yürüdüğünü
  söylüyor.
* **`architecture/overview.md`**: §6'nın "üç etiketli yüzey" maddesi
  **sekize** çıkarıldı ve iki yeni seam eklendi (ölçülmüş korpus tavanı;
  konsolun çizdiği ile çizmediği). Yeni **§8**: W14 + Faz F'in eklediği her
  parça, W12 bloğunun aynı biçiminde, sonunda **§8.1 "Faz F aslında neyin
  hattıydı"** — kapatılan altı kusurun dördü **dikiş** kusuruydu ve
  hiçbirinin önceden düşen bir birim testi yoktu, çünkü her birim tek başına
  doğruydu.
* **`docs/README.md`**: dalga özeti, S1–S32, ve "çoğu ekran yok" notu
  **tersine döndü** — çizilen dokuz yüzey ile hâlâ düğmesi olmayan altı iş ad
  ad yazıldı.
* **`RUNBOOK.md`** ve **`COMPETITIVE.md`**: yalnız satır aralığı (S1–S32) ve
  "dokuz → sekiz yüzey"; COMPETITIVE ayrıca rakiplerin sattığı eksende
  ColleX'in **geride** olduğunu iki ölçülmüş nedenle söylüyor.
* **`ADRS.md`** (ADR-028'in tek cümlesi): "dokuz" → "sekiz" ve kovanın artık
  ekranda çizildiği notu.

---

## 6. `KULLANIM-ColleX.md` ve `DEMO.md` — vaporware kapısı

Kural: **var olmayan bir ekran anlatılmaz.** Bu turda konsolun gerçekten
taşıdığı görünümler `console.html`'den sayıldı (14 görünüm kimliği:
`dosyalarim · arastir · belgeler · taslak · ayarlar · dosya · belge · izgara ·
karar-ara · denetim · takvim · kapsam · harc · sozlesme`) ve her cümle
`grep` ile doğrulandı.

**Kılavuzda değişen başlıklar** (§8'in on dört alt başlığı):

| Başlık | Önce | Şimdi |
|---|---|---|
| 8.1 Karar arama | ekran hazır değil | **ekran hazır** — ama canlı bir arama hiç yapılmadı |
| 8.2 Atıf denetim raporu · 8.3 Sözleşme · 8.5 Kapsam · 8.8 Harç | ekran hazır değil | **ekran hazır** |
| 8.4 Takvim / `.ics` | ekran hazır değil | **ekran hazır** — `.ics` bir takvim programında hiç açılmadı |
| 8.6 Yedekleme | çalışıyor — `.cmd` ile | **ekran hazır** — Ayarlar'daki kart ve `.cmd` |
| 8.7 Klasör yükleme | şimdilik komut satırından | **ekran hazır** — Belgeler'de klasör seçme ve sürükleme |
| 8.9 Nihai kopya · 8.11 Dosya paketi · 8.13 Genel arama | "düğme Faz B'de" | **"düğme HÂLÂ YOK"** |
| 8.12 Kişi kartları | ekran hazır değil | **ekran hâlâ yok** |

Doğrulandı (grep): `Dosya paketini indir` **0 kez**, `Nihai kopya` **0 kez**
— yani "düğme yok" cümlesi doğru. `Klasör seç`, `Aslını indir`,
`Eksik tutarları girin`, `Karar arama bu sunucuda çalışmıyor`,
`Kaynak geçidi bağlı`, `Yaklaşan ve geciken süreler`,
`Belgeler bu bilgisayarda saklanır`,
`DENEME KORPUSU (sentetik deneme belgeleri)` **birer kez** — yani "ekran var"
cümlelerinin hepsi de doğru.

**Ayrıca kılavuzda:**

* "Bugün / Bu hafta" → **"Yaklaşan ve geciken süreler"** (gerçek başlık).
* Deneme damgası metni ve **veritabanı adının artık hiçbir avukat ekranında
  olmadığı** (yalnız Ayarlar › Sistem durumu).
* 8.1'e ekranın **uca sorduğu** ve geçit kapalıyken **kapalı ve soluk**
  çizildiği anlatıldı.
* §10'a iki yeni sınır: hangi düğmelerin **hâlâ olmadığı** (bozuk düğme
  yerine hiç düğme) ve **büyük arşivde korpus aramasının 15–17 saniye**
  sürdüğü — belgeye sorulan sorunun etkilenmediği vurgusuyla ve **ilerleme
  çubuğu / vazgeç düğmesi olmadığı** kaydıyla.

**`DEMO.md`:** W14 notu tersine döndü (ekranlar var, hangileri yok);
§5.1'de süre panelinin adı, "Belge deposu: <db>" cümlesinin kalkışı ve
13/13 migrasyon; §9'un başlığından "(ekranları henüz yok)" kaldırıldı ve
yerine **ekranı olan / ekranı hâlâ olmayan** iki liste kondu; §10'da "dokuz
yüzey" → **sekiz yüzey** ve yeni bir "ölçek: ölçüldü, tam kapanmadı" maddesi.

---

## 7. `CLAUDE.md`

* Tarih satırı: **"W14 complete through phase F"**, sekiz rapor adıyla, ve
  **19/1/3** hesabı.
* `STATUS` satır aralığı **S1–S32**; `TRACEABILITY` artık **V-1..V-22**
  bloğunu da taşıyor.
* "nine unverified surfaces" → **"eight unverified surfaces"** (üç yerde) ve
  yanına **ölçülmüş tavan**.
* "Do NOT" listesindeki yüzey maddesi yeniden yazıldı: B-16 için "dikiş
  düzeldi ama **hiçbir gerçek upstream cevap vermedi**", ve **üretilmiş probe
  korpusundaki bir ölçek sayısının ürün iddiası olarak sunulamayacağı** ayrı
  bir cümleye çıkarıldı.
* **Altı yeni invaryant** eklendi: trigram fallback eşiği + duvar bütçesi (ve
  bunun bir **recall değişikliği** olduğu, ve iki sabitin API'ye
  açılmayacağı) · `answerStore.list({fileId})`'in indeksin ifadesini
  kullanması · asıllar klasörünün **tek çözücüsü** · bir liste süzgecinin ya
  süzmesi ya 400 demesi · bir ekranın **uca** sorması, sağlık rozetine değil ·
  hiçbir toast'ın çıplak `HTTP <kod>` yazmaması.

---

## 8. Tutarlılık denetimi — ne doğrulandı

1. **Her sayı ölçülmüş bir satıra iz sürüyor.** `S1–S24` kalıntısı
   (`RUNBOOK`, `README`, `COMPETITIVE`) **S1–S32** yapıldı; "dokuz
   doğrulanmamış yüzey" ifadesi belgelerin tamamında (ADRS dâhil) **sekiz**
   oldu; `grep` ile kalıntı taraması **0 eşleşme** verir.
2. **Her özellik cümlesi kaynakta doğrulandı.** Bu turda tek tek arananlar:
   `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS = 8` · `DEFAULT_TRIGRAM_BUDGET_MS =
   2_500` · `TRIGRAM_BUDGET_EXCEEDED` · `sourcesGateway` ·
   `envUploadsDir` · `serve.mjs`'nin `uploadsDir` geçişi ·
   `ANSWER_LIST_QUERY_PARAMS` · `MAX_ANSWER_QUERY_CODE_POINTS` ·
   `ANSWER_STATUSES` · `answerStore`'un `-> 'fileScope'` predikatı ·
   `httpStatusTR` · 14 konsol görünüm kimliği ve yukarıdaki sekiz Türkçe
   ekran dizesi.
3. **Var olmayan bir ekran anlatılmadı** ve **var olan bir ekran "yok" diye
   anlatılmadı**; ikisi de aynı grep turunda sınandı.
4. **Sayı tablosu tek.** Bu turda dokunulan on iki belgenin hiçbiri sayıyı
   kopyalamıyor; satır kimliğine atıf yapıyor. Tek istisna, tanımı gereği
   sayıyı taşıyan `STATUS.md`'dir.

---

## 9. Açık konular — dürüst liste

1. **`run_evals`, `db_local_check`, `demo.mjs` bu turda koşmadı.** Satırları
   kaynağını ve saatini söylüyor; hiçbirini kendi ölçümüm gibi yazmadım.
2. **`openapi.yaml` yine yalnız yapısal olarak doğrulandı** (ayrıştırma,
   `$ref`, sayım, onu okuyan iki süit). Şema gövdelerinin **gerçek
   cevaplarla alan alan** karşılaştırılması yapılmadı.
3. **Faz A/B ve Faz F raporlarının kendileri düzeltilmedi.** Lane raporları
   bağlayıcı **tarihsel** kayıttır; bir sayı yanlışsa düzeltme STATUS'ta
   yapılır (`W14-L-LEGAL` §3.2'nin "15 kalem `amount: null`" hatası → S11'de
   **17**).
4. **Üç kusur açık kaldı** (V-14, V-19, V-21) ve **bir tavan ölçülmüş
   hâlde duruyor** (15–17 sn). Hiçbiri bu hattın işi değildi; hepsi
   `RISKS.md` #25 ve #32'de, `TRACEABILITY.md`'nin V satırlarında ve
   `STATUS.md`'nin "Açık ve dürüst" bölümünde.
5. **`console.html`'i bu tur okumadı, yalnız `grep`ledi.** Ekranların
   davranışına dair her cümle F-UI ve L-CONSOLE-B'nin ölçümlerine dayanır;
   bu hat hiçbir tarayıcı açmadı.
6. **Hiçbir ekran gerçek bir avukat tarafından kullanılmadı** ve buradaki her
   ölçüm **SENTETİK** korpustadır. ColleX'in hukukî isabeti gerçek Türk
   mevzuatı ve içtihadı üzerinde **hiç ölçülmedi**.

---

## 10. Değişen dosyalar

```
CLAUDE.md
control-plane/src/api/openapi.yaml            (yalnız açıklama + bir enum + bir maxLength)
docs/README.md
docs/COMPETITIVE.md
docs/DEMO.md
docs/KULLANIM-ColleX.md
docs/architecture/ADRS.md                     (tek cümle)
docs/architecture/overview.md
docs/implementation/AI.md
docs/implementation/DECISIONS.md
docs/implementation/EXPORT.md
docs/implementation/FINAL_REPORT.md
docs/implementation/PLAN.md
docs/implementation/RISKS.md
docs/implementation/RUNBOOK.md                (tek paragraf)
docs/implementation/STATUS.md
docs/implementation/TRACEABILITY.md
docs/implementation/waves/W14-F-DOCS.md       (bu dosya)
```

**Hiçbir kod ve hiçbir test dosyasına dokunulmadı.**

---

## 11. Hijyen

* Sunucu açılmadı; `netstat` gerekmedi; oluşturulan `var/*.pid` yok.
* Veritabanı yaratılmadı ya da düşürülmedi. `vitest`'in gerçek süitleri kendi
  scratch veritabanlarını (kendi sahiplerinin adlarını) her zamanki gibi
  yönetti; **`collex_local`'a bağlanılmadı, yazılmadı, düşürülmedi**.
* 8787/8898'e dokunulmadı. Git işlemi yok, `.env` okunmadı, Supabase/Resend
  kullanılmadı, devlet upstream'lerine tek istek gitmedi, MCP yüzeyi (54)
  değişmedi.
* Bütün geçici betikler `…/scratchpad/w14f-DOCS/` altında; depoya sızan
  geçici dosya yok.
