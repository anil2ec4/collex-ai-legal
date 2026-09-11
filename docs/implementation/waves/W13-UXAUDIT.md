# W13 — Hat UXAUDIT: ürünü hiç görmemiş bir avukat gibi yürüme (tarayıcı hattı)

Tarih: 02.09.2026 · Hat: UXAUDIT (BROWSER LANE, tek Playwright sahibi) ·
Durum: **denetim tamamlandı; aşağıdaki her sayı ve her alıntı bu makinede
gerçekten ölçüldü.**

Bu bir **denetim** raporudur. Hiçbir depo dosyası değiştirilmedi (bu rapor
hariç), hiçbir git işlemi yapılmadı.

## 0. Kurulum, kanıt ve temizlik

| Öğe | Değer |
|---|---|
| Sunucu | `node control-plane/scripts/serve.mjs --port 8931 --dsn …/collex_demo` |
| `/v1/health` | `db:"ok"`, `dbName:"collex_demo"`, `migrations 11/11`, `mcp:"off"`, `ai.configured:false`, `templates:13`, `deadlineRules:30`, `registeredToolCount:54`, `version:"1.0.0-w12"` |
| Hazırlık | `node control-plane/scripts/demo.mjs` → **6/6 senaryo PASS** (S1 8/8, S2 8/8, S3 7/7, S4 7/7, S5 7/7, S6 10/10) |
| Sentetik test belgeleri | `sentetik_dava_dilekcesi.txt` (3 540 B), `.docx` (38 343 B), `sentetik_taranmis_tebligat.pdf` (947 B, metin katmanı yok, 2 sayfa) — hepsi **uydurma** veri; taraf/karar/dosya gerçek değil |
| Ekran görüntüleri | 25 adet, `…/scratchpad/w13-UXAUDIT/shots/` (repo dışı) |
| Temizlik | Sunucu öldürüldü; `netstat` 8931/8932 **LISTENING 0** (yalnız çekirdek TIME_WAIT kalıntısı, süreç yok); `var/collex.pid` silindi; probe yüklemem `intake.cli --delete ce5225bdd8554567` ile `collex_demo`'dan kaldırıldı (`storedOriginalsRemoved` doğrulandı); **`collex_local`'a dokunulmadı**; 8787/8898'e dokunulmadı |

### Ölçülen sayılar (bu hat)

| # | Ölçüm | Değer |
|---|---|---|
| U1 | Tarayıcı konsolu — **yakalanmamış JS istisnası** | **0** |
| U2 | Tarayıcı konsolu — başarısız istek satırı | **5** (2 × 422 taranmış PDF *beklenen*, 1 × 400 aşırı uzun soru *beklenen*, **2 × 404 `MATTER_NOT_FOUND` — kusur, bkz. P1-3**) |
| U3 | Cevaba kadar süre (sunucu) | korpus sorusu **283 ms**; belge sorusu **65–166 ms**; işlem izi 13 aşama **71,75 ms** |
| U4 | Belge sorusu cevap kartı yüksekliği | **7 432 px = 8,3 ekran** (900 px görünüm), tek soru, 6 kaynak |
| U5 | Korpus sorusu sayfa yüksekliği | **6 804 px = 7,5 ekran**, 4 kaynak |
| U6 | Bir korpus cevabında görünen İngilizce makine kodu | **8 farklı kod, ~40 geçiş** (`NEUTRAL` ×11, `EVIDENCE_CAP_APPLIED` ×7, `SCOPED_OUT_NORM_CONTENT` ×7, `QUESTION_NOT_COVERED` ×5, `AFFIRMATIVE` ×3, `NEGATIVE` ×3, `NORM_CONTENT` ×2, `EVIDENCE_SCOPED` ×1) + `JSON` |
| U7 | Belge sayfasında makine kimliği | **19 UUID**, 19 × `konum N-M (Unicode karakter sayımı)`, 1 × `SHA-256`, 1 × `ANTHROPIC_API_KEY`, 6 × `no 6098`/`no 6100` — tek sayfada |
| U8 | İlk açılışta içeriğin başladığı y | **537 px** (1440×900; ekranın %60'ı başlık) |
| U9 | Taslak formunun başladığı mutlak y | **2 581 px** / 5 500 px'lik sayfada; şablon seçince **kaydırma yok** (`scrollY` 8'de kaldı) |
| U10 | Genişlik kullanımı | 1440 → 1 120/1 425 (%79) · 1920 → 1 380/1 920 (%72) |
| U11 | **960 px (= 1440 @ %150 yakınlaştırma)** | `scrollWidth` **1 087 > 960` → sayfa yatay kayıyor |
| U12 | Kontrast (koyu tema) | `GECİKMİŞ — N gün` çipi **2,76:1** (AA 4.5 → **kalır**) · dosya satırı alt metni **4,37:1 / 12,5 px** (**kalır**) · tablo başlığı 7,06 (geçer) |
| U13 | Kontrast (açık tema) | `GECİKMİŞ` çipi 6,77:1 (geçer) — **yalnız koyu temada bozuk** |
| U14 | Klavye odak halkası | `outline-style: none`, tek gösterge `box-shadow 0 0 0 3px rgba(125,42,51,.18)` → **≈1,4:1** (WCAG 2.2 odak göstergesi için 3:1 ister → **kalır**) |
| U15 | Şablon kartlarında dikey kayma | Kartlar aynı kutuda (`top:360`, `h:548`) ama içerik **dikey ortalanmış**: çip üstleri 425 / 381 / 420 / 399 (1. satır **44 px** kayma), 1003 / 945 / 956 (2. satır **58 px**) |
| U16 | Çift tık koruması | `Araştır` formu **korumalı** (3 tık → 1 POST); **`Yeni dosya` formu korumasız → çift tık 2 dosya yarattı** |

---

## 1. "İlk 10 dakika" — avukatın gerçekten yaşadığı şey

**0:00–0:30.** Ekran bir *ürün* gibi değil, bir *kapak sayfası* gibi açılıyor:
madalyon, serif "ColleX" logosu, "Yargı & Mevzuat Kanıt Sistemi" sloganı, iki
üst üste yatay çizgi. İçerik **537 px**'te başlıyor — 900 px'lik ekranın
%60'ı başlık. İlk okuduğum tam cümle bir gizlilik uyarısı: "Kayıtlarınız bu
bilgisayarda kalır; yalnız Canlı araştırma sorgu metnini resmî kaynaklara,
bulut yapay zekâ (Bulut AI) ise … Anthropic'e gönderir." Ne işe yaradığını
öğrenmeden neyin dışarı çıktığını öğreniyorum. "Üç adımda başlayın" listesi
iyi — ama üç düğme de aynı hayalet (ghost) stilinde; hangisine önce
basacağım belli değil. `01-firstrun-1440-light.png`

**0:30–2:00.** Ayarlar → profil. Form ızgarası düzensiz: `Baro sicil no`
satırın 1/3'ünü kaplayıp kalan 2/3'ü boş bırakıyor, `Vergi no` da öyle.
Alanların kenarlığı yok, bej zemin üstünde bej kutu — neresi alan neresi
kart, ilk bakışta ayırt edilmiyor. "İzmir Barosu" ve "Avukat" **yer tutucu**;
dolu sanıp geçebilirim. Kaydettiğim anda sayfa **birden 360 px yukarı
sıçrıyor** (başlık kompakt moda geçiyor) — imleç bir anda başka bir şeyin
üstünde kalıyor. `02-ayarlar-1440-light.png`

**2:00–3:00.** "+ Yeni dosya" → 5 alan → "Dosyayı aç". Sabırsızlıkla **çift
tıkladım: iki özdeş dava dosyası oluştu** (`0d7dc8fb…` ve `d98d96f5…`, ikisi
de "Yılmaz / Kira tahliye", ikisi de E. 2026/123). Uygulama beni birine
götürdü; ikizin varlığını dakikalar sonra Dosyalarım tablosunda fark ettim.
Dosya sayfası temiz; ama **"aktif dosya" ne demek hâlâ bilmiyorum**: çip var,
tanım yok, ipucu (title) yok, hiçbir yerde bir cümlelik açıklama yok. Altı
işlem düğmesi aynı görünüyor — **"Dosyayı sil" ile "Belge yükle" aynı ağırlıkta**.
`03-matter-page-1440-light.png`

**3:00–5:00.** Belge yükleme. DOCX dilekçe sorunsuz. **Taranmış tebligat PDF'i
ise hiçbir şey yapmadan kayboldu**: dosya sayfasında ne hata, ne uyarı, ne
kırmızı bir satır. İki dosyayı birlikte attığımda tek gördüğüm **yeşil** bir
"1/2 belge yüklendi ve dosyaya bağlandı." bildirimi oldu; PDF'i tek başına
attığımda **hiçbir bildirim çıkmadı**. Gerçekte mükemmel yazılmış bir Türkçe
hata kartı üretilmişti — ama **görünmeyen** `Belgeler` sekmesine yazılmıştı.
Tebligat neredeyse her zaman taramadır; bu, günlük kullanımın ilk adımında
sessiz bir başarısızlık. `05-belgeler-error-1440.png`

**5:00–7:00.** Belge sayfası. Sol sütunda her pasajın altında
`Bölüm 1/19 · konum 0-48 (Unicode karakter sayımı) · 13846e04-ec56-45b2-…`
— **19 UUID**, 19 ofset. "ATIFLAR" listesinde 13 satır, `TBK m. 315` iki
kez, yanlarında `no 6098` gibi ham etiketler. "TARİHLER" listesindeki yedi
cümle parçasının hepsi **kelime ortasından kesilmiş** ("…atırılması
kararlaştırılmıştır… kira bedellerini öd"). "TALEPLER" bölümü dilekçenin
asıl SONUÇ VE İSTEM maddelerini (fesih, tahliye, 148.500 TL) **kaçırmış**,
onun yerine iki yan cümle bulmuş. `06-belge-page-1440.png`

**7:00–8:30.** Üç soru sordum. Cevaplar **doğru ve dürüst** — ama okunacak
gibi değil: "Kira sözleşmesi hangi tarihte yapılmıştır?" sorusunun kartı
**7 432 px = 8,3 ekran**; aynı üç satırlık feragat cümlesi kart içinde **6
kez** tekrar ediyor; aradığım tarih (15.03.2023) 6 742 karakterlik metnin
**2 122. karakterinde**. Konu dışı soruda sistem dürüstçe çekimser kalıyor —
ama bunu **"KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız"** diye
söylüyor; hiçbir şey *başarısız* olmadı, soru belgede yok. `07-belge-answer-1440.png`

**8:30–10:00.** Araştır. Soru kutusu **kendi yer tutucusuyla aynı metni
gerçek değer olarak dolu** getiriyor ("TCK m. 157 dolandırıcılık suçunun
cezası nedir?"). Fark etmeden bastım: bir **kira tahliye** dosyasına bir
**ceza hukuku** araştırması otomatik olarak dosyalandı. Formda `--with-mcp`,
`ColleX-Baslat.cmd`, `ANTHROPIC_API_KEY` gibi satırlar daktilo yazısıyla
duruyor. Cevap kartının başı çok iyi (yeşil onay, "TAM", tek cümlelik özet);
gerisi 7,5 ekran. "Karşıt otorite" tablosunda **aynı Yargıtay kararı üç kez,
aynı kanun dört kez** listelenmiş — "aleyhe karar bulunamadı" diyen bir
tabloda `aksi sonuç (NEGATIVE)` satırını üç kez görmek güven kırıyor.
`08/09/10-*.png`

Sonuç: **on dakikada ürünü çalıştırabildim, ama ürünün ne olduğunu
anlayamadım.** Dürüstlük dili birinci sınıf; bilgi mimarisi ve görsel
hiyerarşi ikinci sınıf.

---

## 2. Görev görev sonuç

| # | Görev | Hüküm | Kritik sürtünme |
|---|---|---|---|
| 1 | İlk açılış (localStorage temiz) | **zorlandım** | Değer önermesi yok, ilk cümle gizlilik uyarısı, içerik 537 px'te, üç eşit ağırlıklı düğme |
| 2 | Profil + ilk dosya + "aktif dosya" | profil **kolay** · dosya **kolay** · **aktif dosya: yapamadım** | Terim hiçbir yerde tanımlı değil; çift tık 2 dosya yarattı; kaydetmede 360 px yerleşim sıçraması |
| 3 | DOCX + taranmış PDF yükleme, belgeye 3 soru | DOCX **kolay** · **taranmış PDF: yapamadım** · sorular **kolay**, cevaplar **zorlandım** | Sessiz yükleme hatası (P0-2); 8,3 ekranlık cevap; 19 UUID |
| 4 | Korpus araştırması, cevap kartını okumak | **zorlandım** | ~40 makine kodu; ön-dolu demo sorusu; karşıt otorite tablosunda tekrar eden satırlar |
| 5 | Cevap dilekçesi + 3 usul itirazı + editör | **zorlandım**, bir adımda **yapamadım** | Şablon seçince kaydırma yok (form 2 581 px aşağıda); "alıntıyı boz" testi **tespit edilmedi** (P0-1); KAYNAKSIZ/K-n hiç açıklanmıyor; sürüm tarihleri aynı |
| 6 | Tebligattan süre hesabı + dosyaya kaydetme | **kolay** | Ürünün en iyi ekranı. Tek kusur: pencere kaydırılınca "Kapat" düğmesi erişilmez oluyor |
| 7 | Ayarlar, tema, sistem durumu, yeniden başlatma | **kolay** | Ayarlar/taslak/dosya/süre **yeniden başlatmadan sonra tam olarak geri geldi** |
| 8 | Kırma denemeleri | karışık | Çift tık koruması **tutarsız**; %150 yakınlaştırmada **yatay kayma**; modal + geri tuşu; iki sekme tehlikesi |

Tıklama/kaydırma maliyeti: profil 10 tık · ilk dosya 8 tık · belge yükleme 2
tık · belgeye soru 2 tık · araştırma 2 tık · **taslak 7 tık + 2 600 px zorunlu
kaydırma** · süre 4 tık.

---

## 3. Sıralı bulgular

### P0 — günlük kullanımı bloke eder / ürünün ana vaadini çürütür

**P0-1 · Editörde "birebir alıntı" bozulabiliyor, sistem fark etmiyor, DIŞA AKTARIM REDDETMİYOR.**
Editörde `HUKUKÎ SEBEPLER` paragrafına "Alıntı ekle" ile K-1 (TCK m.157)
eklendi. Sonra alıntının **içindeki** metin değiştirildi:
`üç yıldan yedi yıla` → `beş yıldan on yıla`, ardından `MADDE 157` → `MADDE 158`.
Ölçülen sonuç: `[K-1]` çipi **kırık değil**, `⚠ KAYNAKSIZ` rozeti **çıkmadı**,
bölüm noktası **yeşil kaldı**, `KAYNAKSIZ` sayacı değişmedi. `Ctrl+S` →
**v3, `issues: []`**. `GET …/export?format=md` → **200**, dosyanın içinde:
> `5237 sayılı Türk Ceza Kanunu (sentetik alıntı), m. 157 — "MADDE 158 - (1) … beş yıldan on yıla kadar hapis …"`
> `> Dayanak [K-1]: 5237 sayılı Türk Ceza Kanunu (sentetik alıntı), m. 157`

Yani **uydurulmuş bir kanun cezası, "Dayanak [K-n]" künyesiyle imzaya hazır
bir dilekçeye yazıldı.** Kök neden iki katmanda:
- Paragraf metnine uygulanan tek denetim **sözcükseldir**
  (`control-plane/src/drafting/composer.ts::evidenceOverlaps`, `QUOTE_OVERLAP_FLOOR = 0.7`
  + sayı-benzeri parçaların paragrafın **herhangi bir yerinde** bulunması;
  aynası `console.html` linter'ı, `W12-UI2.md` §1.2). Türk mevzuatında süre ve
  ceza **yazıyla** geçtiği için (`üç yıldan yedi yıla`, `otuz gün`, `iki hafta`)
  `extractNumbers` bunları hiç görmez; 35 sözcüklük bir alıntıda 2 sözcük
  değiştirmek %70 eşiğini bozmaz. `MADDE 157 → 158` de yakalanmaz, çünkü
  `157` sayısı paragrafın künye kısmında hâlâ duruyor.
- İhracat kapısı `export/draft.py::verify_draft_or_refuse` (satır 337 vd.)
  yalnız **kanıt kaydının kendi** `sha256(entry.quote) == entry.quoteSha256`
  eşitliğini ve kimlik kapanışını denetler; **paragraf metninin alıntıyı hâlâ
  birebir içerdiğini hiç kontrol etmez**.

Önerilen düzeltme (davranış): PUT ve export yolunda, bir paragraf bir
`evidenceId` taşıyorsa, o kanıtın kanonik alıntısının **NFC-normalize edilmiş
tam alt dizgi (substring) olarak** paragrafta bulunması aranmalı; bulunmuyorsa
paragraf otomatik `KAYNAKSIZ`'a düşmeli (sessizce değil, "alıntı
değiştirildi — kanıt bağı koptu" gerekçesiyle) ve export `EXPORT_REFUSED`
vermelidir. Sözcüksel eşik ancak *alıntı dışı* cümleler için anlamlıdır.

**P0-2 · Taranmış PDF yüklemesi dosya sayfasından SESSİZCE başarısız oluyor.**
`console.html:3771 uploadFiles()` başarısızlıkta `fileErrorCard(...)` çağırıyor;
o kart **`#fileerrors` / `#filelist`** öğelerine, yani **`#view-belgeler`
içine** yazılıyor. Yükleme dosya sayfasından (`#dosya/<id>` → Belgeler sekmesi →
"Belge yükle") ya da Dosyalarım'da satıra sürükle-bırak ile başlatıldığında bu
görünüm **gizlidir**. Üstelik `console.html:3786` `if (okCount)` koşulu
yüzünden **hiçbiri başarılı olmazsa bildirim de çıkmaz**; kısmî başarıda ise
`tone:"ok"` (yeşil) bir "1/2 belge yüklendi" bildirimi çıkar — başarısız
dosyanın adı ve nedeni hiç geçmez. Ölçüm: taranmış PDF tek başına yüklendi →
ekranda **hiçbir değişiklik yok**; hata kartı `#fileerrors` içinde bulundu
(`fileerrors.innerText` okundu, metin doğru ve iyi yazılmış).
Etki: tebligat/karar taramaları — yani gerçek hayattaki en yaygın giriş —
kullanıcıya hiçbir şey söylemeden düşüyor.
Ekran: `05-belgeler-error-1440.png` (kartın *nerede* olduğu),
`04-upload-progress-1440.png` (dosya sayfasında ne göründüğü).

### P1 — güveni ya da akışı bozar

**P1-1 · "aktif dosya" ürünün merkezî kavramı ve hiçbir yerde tanımlı değil.**
`#matterpage` çipinde `title` yok (ölçüldü: 4 çipin dördünde de `title: null`).
`console.html` içinde terim yalnız etiket ve hata metinlerinde geçiyor
(satır 6619, 6747, 2201, 2279, 8315). Tek açıklama karşılama kartındaki
"açılan dosya otomatik aktif olur" cümlesi — profil doldurulunca kart kayboluyor.
Avukat, cevapların/taslakların/yüklemelerin sessizce hangi dosyaya bağlandığını
öğrenemiyor.

**P1-2 · Çift tık koruması tutarsız — "Yeni dosya" ikiz kayıt üretiyor.**
`Ara ve doğrula`: 3 tık → **1 POST** (korumalı). `Dosyayı aç`: çift tık →
**2 matter** (`GET /v1/matters` ile doğrulandı, `app_private.matters`'ta iki
satır). Aynı başlık/aynı esas no ile iki dosya, listede ve üst çubuk
seçicisinde **ayırt edilemiyor** (üst çubuk seçicisi yalnız başlığı yazıyor:
üç seçenek de "Dosya: Yılmaz / Kira tahliye"). Kayıt formlarının hepsine
gönderim sırasında `disabled` + tekrar-gönderim koruması gerekiyor; ayrıca
oluşturmada "aynı başlık/esas no ile açık dosya var" uyarısı.

**P1-3 · Var olmayan bir "aktif dosya" seçilebiliyor ve uygulama kendini toparlamıyor.**
Ölçülen zincir: üst çubuk seçicisinde **6 dosya** listelendi
(`4d065df4…`, `41f7fc03…`, `651afb70…`, `2967d781…` + benim 2 dosyam), ama
`GET /v1/matters` o anda **2** dosya döndürüyordu ve
`GET /v1/matters/4d065df4-5ffe-4d64-a7db-9eaac9590cc6` → **404**;
`app_private.matters` tablosunda o kimlikler **hiç var olmadı** (psycopg ile
doğrudan sorgulandı: 2 satır). Bu ölü kimliklerden biri seçilince
localStorage'a aktif dosya olarak yazıldı ve **sonraki her araştırma
"İstek başarısız — Dava dosyası bulunamadı" (`MATTER_NOT_FOUND`) ile
düştü**; cevap üretilmedi. Konsol ölü seçimi **silmiyor**, "dosyasız
çalışmaya geçildi" demiyor; her sayfa açılışında 404 alıp sessizce yutuyor
(U2'deki iki 404). İki ayrı iş: (a) seçici listesini `GET /v1/matters`
sonucuyla **budamak**, (b) `MATTER_NOT_FOUND` alınca aktif dosyayı temizleyip
avukata Türkçe tek cümleyle söylemek.
Not (dürüstlük): listeleme ucunun neden veritabanında olmayan dosyalar
döndürdüğü bu hatta **kök nedene kadar çözülmedi**; yalnız gözlem ve
sonuçları kayda geçirildi.

**P1-4 · Sürüm listesi tarihleri yanlış — denetim izi işe yaramıyor.**
`GET /v1/drafts/{id}/versions` v1 ve v2 için **aynı** `createdAt`
(`2026-09-02T09:07:29.992Z`) döndürüyor; oysa v2 09:09'da kaydedildi ve
editör başlığı doğru saati ("kaydedildi 12:09") gösteriyor. Pencerede iki
satır da aynı tarih, aynı KAYNAKSIZ sayısı, aynı başlık — **hiçbir ayırt
edici bilgi yok**, "ne değişti" sütunu ve kayıt notu da gösterilmiyor.
Ekran: `14-versions-modal-1440.png`.

**P1-5 · Şablon seçmek görünürde hiçbir şey yapmıyor.**
13 kartlı katalog seçimden sonra **açık kalıyor**, form **2 581 px** aşağıda
başlıyor ve **sayfa kaydırılmıyor** (`scrollY` 8'de kaldı). Avukat karta
basıyor, ekranda bir şey değişmiyor. Katalog seçimden sonra tek satırlık bir
"Seçilen şablon: Cevap Dilekçesi — değiştir" şeridine inmeli ve forma
`scrollIntoView` yapılmalı. Ekran: `11-taslak-templates-1440.png`, `12-taslak-form-1440.png`.

**P1-6 · Cevap kartı okunamayacak kadar uzun ve tekrarlı.**
Tek belge sorusu: **7 432 px / 8,3 ekran**; aynı feragat cümlesi 6 kez
("… otorite ve sonuç yönü değerlendirilmez …" ×6, "karakteri karakterine
doğrulandı" ×6, "Kanonik metinden birebir alıntı" ×6, "Teknik doğrulama
ayrıntıları" ×6). Korpus sorusu 6 804 px. Boilerplate karta **bir kez**
(başlıkta) yazılmalı, tespit kartlarında yalnız farklılık kalmalı; tespitler
varsayılan olarak katlanmış (ilk 2 açık) gelmeli.

**P1-7 · Karşıt otorite tablosunda tekrar eden satırlar güveni kırıyor.**
`10-karsit-otorite-table-1440.png`: 11 satır, 3 farklı belge — E. 2023/4521
K. 2024/1187 **3 kez**, E. 2023/7810 K. 2024/2356 **3 kez**, Türk Borçlar
Kanunu **4 kez**, hepsinde aynı `Gerekçe` hücresi. Üstteki özet
"4 ayrı arama yapıldı, aleyhe karar bulunamadı" derken tabloda
`aksi sonuç (NEGATIVE)` üç kez görünüyor. Belge bazında tekilleştirilmeli
(hangi aramada bulunduğu ayrı sütun ya da rozet olmalı).

**P1-8 · Makine sözlüğü avukatın önünde.**
Belge sayfası: **19 UUID** + 19 × `konum 0-48 (Unicode karakter sayımı)`
+ `Parmak izi (SHA-256)` (mobilde **ilk** görünen alan) + `ANTHROPIC_API_KEY`
+ `no 6098` etiketleri. Araştır formu: `--with-mcp`, `ColleX-Baslat.cmd`,
`ANTHROPIC_API_KEY` — daktilo yazısıyla. Cevap kartı: `NORM_CONTENT`,
`AFFIRMATIVE`, `NEGATIVE`, `NEUTRAL`, `SCOPED_OUT_NORM_CONTENT`,
`EVIDENCE_CAP_APPLIED`, `QUESTION_NOT_COVERED`, `UPLOAD_ONLY_EVIDENCE`,
`ABSTENTION_NOT_FINALIZABLE`, `APPLICATION`, `JSON` (~40 geçiş). Editör:
paragraf rol etiketi **`beyan/İRADE`**, kanıt kartında `Alıntı özeti
f771a0e232b6…`. Türkçe-önce ilkesi doğru uygulanmış ama parantez içindeki
ham kod **her satırda** tekrarlanınca metnin yarısı olmuş. Öneri: ham kodlar
yalnız "Teknik ayrıntılar" katlanır bloğunda; UUID/ofset/hash hiçbir zaman
ana akışta değil.

**P1-9 · `KAYNAKSIZ`, `K-n`, `sürüm`, `deneysel` — dördünden üçü açıklanmıyor.**
`KAYNAKSIZ` editörde sayaç, rozet, düğme ve lejant olarak **22+ kez** geçiyor
(her paragrafın araç çubuğunda "KAYNAKSIZ olarak bırak" düğmesi var) ama
**tek bir tanım cümlesi yok**; kırmızı sayaç 2 derken kelime ekranda 22 kez
görünüyor — sinyal/gürültü oranı bozuk. `K-1…K-n` rozetleri hiçbir yerde
"kanıt numarası" diye açıklanmıyor. `sürüm` yalnız pencerede, tarihleri de
yanlış (P1-4). Tek açıklanan `deneysel` (`title` ipucu) — o da mobilde
kayboluyor (P1-10).

**P1-10 · "deneysel" etiketi dar ekranda gizleniyor.**
`control-plane/public/console.html:1647` — `.edacts a.dl.udf .tag { display: none; }`
dar ekran medya sorgusunda. 390 px'te düğme yalnız **"UDF"** yazıyor; kalan
tek uyarı `title` ipucu, o da dokunmatik cihazda **hiç görünmez**. CLAUDE.md'nin
"UDF her yüzeyde `deneysel` der" ilkesi bu kırılma noktasında tutmuyor.
Ekran: `20-editor-390-light.png`.

**P1-11 · Koyu temada en acil öğe en okunmaz öğe.**
`GECİKMİŞ — 212 gün` çipi: beyaz üstü `#e38074` → **2,76:1** (AA 4,5 ister).
Açık temada aynı çip 6,77:1. Dosya satırı alt metni koyu temada 12,5 px'te
**4,37:1**. Ayrıca çip koyu temada **açık renkli** olduğu için görsel aciliyet
tersine dönüyor. Ekran: `18-dosyalarim-dark-1440.png`.

**P1-12 · Klavye odağı pratikte görünmüyor.**
`outline-style: none`; tek gösterge `box-shadow 0 0 0 3px rgba(125,42,51,.18)`
→ bej zemin üzerinde **≈1,4:1**. WCAG 2.2 (2.4.11/2.4.13) odak göstergesi için
3:1 ister. Yalnız klavye kullanan bir avukat nerede olduğunu göremez.
Ekran: `22-focus-ring-1440.png` (odakta olan "ARAŞTIR").

**P1-13 · %150 yakınlaştırmada sayfa yatay kayıyor.**
960 px görünümde (1440 ekranda %150 yakınlaştırmanın karşılığı)
`document.scrollWidth = 1087 > innerWidth = 960`. Taşan öğeler: `.pills`,
`.pill.mute`, `.themebtn` — yani **durum rozetleri ve tema düğmesi ekran
dışında kalıyor**. 390 px kırılma noktası düzeltilmiş ama ~900–1100 px arası
ölü bölge açık. Ekran: `23-editor-zoom150-960.png`.

**P1-14 · Araştır kutusu demo sorusuyla DOLU geliyor ve o cevap dosyaya yazılıyor.**
`#q.value === #q.placeholder === "TCK m. 157 dolandırıcılık suçunun cezası nedir?"`
(ölçüldü). Fark edilmeden basıldığında bir kira tahliye dosyasına ceza hukuku
araştırması **otomatik dosyalanıyor** (`matterId` gövdeye ekleniyor). Kutu boş
başlamalı; demo sorusu ancak "Örnek sorular" şeridinde olmalı.

**P1-15 · Modal penceresi kaydırılınca kapatma düğmesi erişilemez oluyor.**
Süre sonucu penceresinde iç kaydırıcı (`.docpanel.formpanel`, 1 672 px içerik /
790 px kutu) başlığı yukarı taşıyor; ölçüm: `Kapat (Esc)` düğmesinin
`getBoundingClientRect().top = -560` — **görünüm dışında**. Geriye yalnız Esc
kalıyor, o da artık ekranda yazmıyor. Başlık `position: sticky` olmalı.
Ekran: `16-deadline-result-1440.png`.

**P1-16 · Tarayıcı "geri" tuşu modal açıkken altındaki ekranı değiştiriyor.**
Süre penceresi açıkken geri → adres `#dosyalarim` → `#taslak` oldu, **pencere
açık kaldı** (`#docmodal` hâlâ `display:grid`), arkasındaki ekran sessizce
taslak editörüne dönüştü. Avukat pencereyi kapatmak için bastığı tuşla iki
adım geriye ışınlanıyor. Modallar `history.pushState` ile geri tuşuna
bağlanmalı. Ekran: `23-editor-zoom150-960.png` (taslak editörünün üstünde
duran "Süre hesapla" penceresi).

**P1-17 · Mobilde (390 px) dosya tablosu kullanılamıyor.**
Gövde yatay kaymıyor (`scrollWidth 375 < 390`, doğru) ama tablo kendi kabında
**611 px**'e taşıyor: başlık 3 satıra, alt metin 6 satıra sarıyor ve
`Durum` / `Sonraki süre` / `Son işlem` sütunları ekran dışında kalıyor — yani
**en kritik bilgi (sıradaki süre) mobilde görünmüyor**. 390 px'te tablo yerine
kart listesi gerekiyor. Ayrıca belge sayfasında ilk ekranın tamamı künye:
`Parmak izi (SHA-256)` **ilk alan**, belge metni ve "Belgeye sor" kutusu
tamamen kıvrımın altında. Ekranlar: `19-dosyalarim-390-light.png`,
`25-belge-390-dark.png`.

**P1-18 · Belge ön incelemesi yanlış yerde kesiyor ve asıl talepleri kaçırıyor.**
"TARİHLER" listesindeki 7 parçanın hepsi kelime ortasından başlayıp kelime
ortasında bitiyor. "TALEPLER (OTOMATİK TESPİT…)" dilekçenin numaralı SONUÇ VE
İSTEM maddelerini (fesih / tahliye / 148.500 TL tahsil) **bulmadı**; iki yan
cümle buldu. "ATIFLAR" listesinde sözleşmenin "4. maddesi" bir kanun maddesi
gibi `m. 4` etiketiyle çıkıyor ve `TBK m. 315` ile `m. 315` iki ayrı satır
oluyor. Ekran: `06-belge-page-1440.png`.

**P1-19 · Çekimser cevabın dili suçlayıcı ve yanıltıcı.**
Konu dışı soruda: "KESİNLEŞTİRİLEMEZ — **en az bir doğrulama başarısız**;
gerekçeleri okumadan kullanmayın". Hiçbir doğrulama başarısız olmadı; soru
kapsam dışı. Avukat bunu "sistem bozuldu" diye okur. Çekimserlik için ayrı,
nötr bir cümle gerekiyor ("Bu soru elinizdeki kaynaklarda karşılık bulmuyor").

**P1-20 · Kanıt kaynağı seçiminde UUID gösteriliyor.**
Taslak formunda "Son araştırma" seçilince tek bilgi:
`kullanılacak araştırma no: 8b0b0018-f4c…`. Hangi soru, hangi tarih, hangi
sonuç — hiçbiri yok. Soru metni + tarih + hüküm (TAM/KISMİ/ÇEKİMSER)
yazılmalı.

**P1-21 · "Alıntı ekle" penceresi, alaka kapısının elediği kanıdı uyarısız sunuyor.**
Kanıtlar kenar çubuğu K-1'i "hukuk alanı bu belgeyle uyuşmuyor" diye
işaretlerken, aynı K-1 `HUKUKÎ SEBEPLER` paragrafının "Alıntı ekle"
penceresinde **hiçbir uyarı olmadan** ilk sırada listeleniyor ve tek tıkla
ekleniyor. İki yüzey birbiriyle çelişiyor.

### P2 — cila

- **P2-1 · Şablon kartlarında 44–58 px dikey kayma.** Kartlar aynı yükseklikte
  ama içerik dikey ortalı; bir satırdaki dört başlık dört farklı hizada
  (U15). `align-items/justify-content` → üstten hizalama. `11-taslak-templates-1440.png`
- **P2-2 · Şablon kartları birer hukuk metni.** "Cevap Dilekçesi" kartının
  gövdesi 14 satır madde atfı + altında daktilo yazısıyla "Zorunlu: …".
  13 kart arasında arama/filtre de yok.
- **P2-3 · `Belgeler` süzgeç satırı bozuk.** `Dosya` etiketi arama kutusunun
  **sağında** (x=660, y=767), ait olduğu `select` ise bir alt satırda ve
  **1 068 px genişliğinde** (üç seçenekli bir açılır liste). `05-belgeler-error-1440.png`
- **P2-4 · Modal fon örtüsü çok zayıf.** `console.html:1078`
  `background: color-mix(in srgb, var(--ink) 36%, transparent)` — arkadaki
  gövde metni tam okunur kalıyor, pencere "üstte" hissi vermiyor
  (`14/15/16-*.png`).
- **P2-5 · Yıkıcı işlem vurgulanmıyor.** "Dosyayı sil" diğer beş işlemle aynı
  hayalet düğme. Buna karşılık **editörde `DOCX` dolu bordo (birincil),
  `Kaydet` hayalet** — hiyerarşi tersine dönmüş; mobilde daha da belirgin
  (`13-editor-1440.png`, `20-editor-390-light.png`).
- **P2-6 · Her paragrafta 6 düğmelik araç çubuğu.** Mahkeme hitabı ("İZMİR 3.
  SULH HUKUK MAHKEMESİ'NE") ve imza bloğu dahil her paragrafın altında
  "Alıntı ekle / KAYNAKSIZ olarak bırak / Bu paragrafı yaz (Bulut AI) /
  Yukarı / Aşağı / Sil". Araç çubuğu metinden daha büyük yer kaplıyor;
  hover'da açılmalı ya da role göre gizlenmeli.
- **P2-7 · Üç seviyeli iç içe kaydırma.** 1920 px'te tek ekranda üç kaydırma
  çubuğu aynı anda görünüyor: sayfa + `KANITLAR` paneli + kanıt kartının
  içindeki alıntı kutusu (`21-editor-1920.png`). 1920'de 263 px'lik boş kenar
  varken üç sütunun daralması gereksiz.
- **P2-8 · "Bugün / Bu hafta" paneli 7 ay eski süreleri gösteriyor.** Başlık
  bu, içerik `GECİKMİŞ — 212 gün` / `49 gün` / `37 gün`. Başlık
  "Yaklaşan ve geciken süreler" olmalı. `17-dosyalarim-deadline-1440.png`
- **P2-9 · Hukuk metni daktilo yazısıyla.** Süre penceresindeki kural notları
  (HMK m.127/1, m.92/1, m.317/2, m.128) monospace 12 px; belge sayfasında
  `TARAFLAR` listesi de monospace. Kanun metni kod değildir.
  `15/16-*.png`, `24-belge-dark-1440.png`
- **P2-10 · Alıntılar kelime ortasından kesiliyor.** Tespit kartlarında
  `"MADDE 157 - (1) Hileli davranışlarla … kendisi…"`. Cümle sınırında
  kesilmeli.
- **P2-11 · Ayarlar ızgarası düzensiz** (yalnız `Baro sicil no` ve
  `Vergi no` satırları yarım kalıyor), alanların kenarlığı yok, `Tema`
  yerel `select` — sayfadaki tek beyaz kutu (`02-ayarlar-1440-light.png`).
- **P2-12 · Boş durumlar zayıf.** `§` glifi çok açık renkte, altındaki cümle
  küçük; Dosyalarım boş hâlinde arama satırı ile boş durum arasında ~190 px,
  boş durumla altbilgi arasında ~110 px — dikey ritim tutarsız
  (`01-firstrun-1440-light.png`).
- **P2-13 · Arama yer tutucusu kırpılıyor** ("Dosya ara — başlık, müvekkil,
  karşı taraf, mahkeme, es").
- **P2-14 · Aşırı uzun girdi mesajı bilgisiz.** 330 000 karakterlik soru →
  400 `INVALID_REQUEST` → "İstek geçersiz — alanları kontrol edin." Neyin
  uzun olduğu söylenmiyor, istemcide `maxlength`/sayaç yok.
- **P2-15 · Yerleşim sıçraması.** Profil kaydedilince başlık kompakta geçiyor
  ve sayfa ~360 px yukarı atlıyor; kullanıcı düğmeye bastığı anda içerik
  imlecin altından kayıyor.
- **P2-16 · İki tema kontrolü iki farklı yere yazıyor.** Üst çubuktaki
  `Tema` düğmesi yalnız `localStorage`'a; Ayarlar'daki `Tema` seçicisi
  `PUT /v1/settings`'e (`preferences.theme` yeniden başlatmadan sonra
  `"system"` kaldı). Başka tarayıcıda tema kayboluyor.
- **P2-17 · Taslak uyarıları varsayılan kapalı.** En kritik uyarı
  ("2 paragraf KAYNAKSIZ … Avukat tamamlamadan kullanılamaz") katlanmış
  `Taslak uyarıları (5)` içinde; her kaydetmede sayı sessizce büyüyor (5→7).
- **P2-18 · Yerel `confirm()` penceresi.** Kaydedilmemiş taslakla ayrılırken
  tarayıcının kendi diyaloğu çıkıyor ("127.0.0.1:8931 diyor ki") — ürünün
  kendi modal sistemiyle tutarsız. (Davranış doğru: İptal `#taslak`'ta
  tutuyor, Tamam ayırıyor.)
- **P2-19 · `Belge deposu: collex_demo` avukata gösteriliyor** (dosya
  sayfasının künye satırında) — veritabanı adı kullanıcı arayüzünde.
- **P2-20 · `scroll-behavior: smooth` genel.** Her çapa ve her `scrollTo`
  animasyonlu; 7 000 px'lik cevap kartında gezinme yavaşlıyor.

---

## 4. İyi olan ve korunması gereken şeyler

Bunlar denetimde **beklentinin üstünde** çıktı; hiçbir düzeltme bunları
zayıflatmamalı.

1. **Süre hesabı ekranı ürünün en iyi yüzeyi.** 02.02.2026 Pazartesi sonucu,
   beş numaralı hesap adımı düz Türkçe ve madde atfıyla, Tebligat Kanunu
   m.7/a uyarısı, `DOĞRULANMADI — madde metniyle kontrol edin` rozeti ve
   birebir feragat. `16-deadline-result-1440.png`
2. **Çekimserlik gerçekten çalışıyor.** Konu dışı soruda 0 kaynak, 0 tespit,
   "Karşılığı bulunamayan sözcükler: boşanma, nafaka, miktarı, belirlenir".
3. **Alaka kapısı (ADR-022) sahada doğrulandı.** Ceza hukuku araştırmasından
   üretilen kira cevap dilekçesinde 4 kanıtın dördü de
   "KULLANILMAYAN KAYNAKLAR (alakasız görünüyor) — hukuk alanı bu belgeyle
   uyuşmuyor" altına düştü, `HUKUKÎ SEBEPLER` boş bırakıldı.
4. **Kalıcılık sözü tutuyor.** Sunucu öldürülüp yeniden başlatıldıktan sonra
   ayarlar, dosya, 7 dosya öğesi ve taslak (v4) eksiksiz geri geldi.
5. **Yükleme hata metni mükemmel yazılmış** — sadece görünmeyen yerde
   (P0-2): "Bu PDF taranmış görüntüden ibaret; … belgeyi 'aranabilir PDF'
   olarak yeniden kaydedip yükleyin ya da Bulut AI açıksa Bulut OCR ile
   metne çevirin."
6. **`contenteditable="plaintext-only"`** zengin metin yapıştırmasını
   etkisizleştiriyor: biçim, bağlantı ve `<script>` taşıyan bir yapıştırma
   denemesinde ne biçim geçti ne kod çalıştı.
7. **Dışa aktarım künyeleri doğru**: DOCX 40 259 B, MD 4 155 B,
   UDF 3 190 B + `X-ColleX-Experimental: udf`;
   `Content-Disposition` hem ASCII hem `filename*=UTF-8''` taşıyor.
8. **Hash yönlendirmesi ve geri tuşu** (modal dışında) doğru çalışıyor;
   `Ctrl+S` editörde kaydediyor, `Esc` pencereleri kapatıyor,
   kaydedilmemiş değişiklik koruması devrede.
9. **Yakalanmamış JS istisnası sıfır** — beş konsol satırının hepsi HTTP
   yanıt kodu kaydı, hiçbiri çöken bir kod yolu değil.

---

## 5. Önerilen sıra (yapım hatlarına)

1. **P0-1** — alıntı bütünlüğü: PUT + export yolunda "paragraf, kanıtın
   kanonik alıntısını NFC alt dizgi olarak içeriyor mu" denetimi; içermiyorsa
   KAYNAKSIZ'a düş + `EXPORT_REFUSED`. Regresyon testi: alıntı içinde
   `üç → beş` ve `157 → 158` değişikliklerinin ikisi de yakalanmalı.
2. **P0-2** — `uploadFiles` sonucunu **çağıran görünüme** bildirmek
   (`opts.onError` / görünür hata kartı) ve `okCount === 0` hâlinde de
   `tone:"bad"` bildirim; kısmî başarıda başarısız dosya adı + nedeni.
3. **P1-2, P1-3** — form gönderim kilidi + seçici listesinin budanması +
   `MATTER_NOT_FOUND` sonrası aktif dosyanın temizlenmesi.
4. **P1-1, P1-9, P1-19, P1-20** — sözlük işi: "aktif dosya", `KAYNAKSIZ`,
   `K-n` için birer cümlelik tanım; çekimserlik dilinin ayrılması; UUID
   yerine soru+tarih.
5. **P1-6, P1-7, P1-8** — cevap kartının boilerplate'ini tekilleştirmek,
   karşıt otorite tablosunu belge bazında tekilleştirmek, ham kodları
   "Teknik ayrıntılar" altına almak.
6. **P1-10..P1-13, P1-17** — erişilebilirlik ve kırılma noktaları: odak
   halkası ≥3:1, koyu tema `GECİKMİŞ` çipi ≥4,5:1, `deneysel` etiketinin
   gizlenmemesi, 900–1100 px yatay kayma, 390 px'te kart listesi.
7. **P1-4, P1-5, P1-15, P1-16** — sürüm tarihleri, şablon seçiminden sonra
   kaydırma, yapışkan modal başlığı, modalların geçmişe bağlanması.
8. P2 kalemleri tek bir "cila" dalgasında.

---

## 6. Dürüstlük notları

- Bütün ölçümler `collex_demo` üzerinde, **sentetik** korpus ve **uydurma**
  test belgeleriyle yapıldı. Hiçbiri hukukî kalite ölçüsü değildir.
- P0-1'in kanıtı olarak üretilen tahrif edilmiş metin **yalnız probe
  veritabanında** kaldı; paragraf denetimden sonra geri alındı ve
  `collex_demo` bir sonraki `demo.mjs` koşusunda yeniden kurulacaktır.
- P1-3'te listeleme ucunun veritabanında olmayan dosyaları neden döndürdüğü
  **kök nedene kadar götürülmedi**; rapor yalnız gözlemi, `404`'ü, doğrudan
  SQL sayımını ve kullanıcıya yansıyan sonucu iddia eder.
- Bulut AI yüzeyleri bu makinede anahtar olmadığı için **yalnız devre dışı
  hâlleriyle** görüldü; canlı davranış hakkında hiçbir iddia yok.
- Türk devlet siteleri bu makineden erişilemiyor; canlı araştırma hattı
  denenmedi ve bu bir ürün kusuru sayılmadı.
