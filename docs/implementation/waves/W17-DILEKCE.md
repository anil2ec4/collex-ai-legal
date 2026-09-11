# W17/b — Dilekçe analizi, gerçek bir dilekçeyle

**Tarih:** 06.09.2026
**İstek (kullanıcı):** *"Şimdi dilekçe analizini de gerçek bir dilekçeyle dene.
Ayrıca bulduğun bütün kusurları düzeltiyorsun…"*
**Yöntem:** çalışan bir sunucu (`serve.mjs --port 8991 --with-mcp --dsn
…/collex_demo`, gerçek MCP geçidi, 54 araç), gerçek bir Türk cevap dilekçesi,
`POST /v1/contracts/petition-analysis`, ve her turdan sonra yeniden ölçüm.

Bu rapor **tarihsel bir kayıttır**: sayıları düzeltilmez, en fazla dipnot
düşülür. Güncel sayı `STATUS.md` → "Ölçülen sayılar" tablosundadır.

---

## 0. Neden bu tur gerekti

W16 dilekçe analizini yazdı ve `tests/contracts/petitionAnalysis.test.ts`
sentetik bir cevap dilekçesiyle 34 testte yeşildi. Gerçek bir dilekçe o
testlerin hiçbirini kırmadan **on kusur** verdi.

Fark tek bir şeyden çıktı: **sentetik fixture her başlığı kendi satırına
yazıyor, gerçek dilekçe yazmıyor.**

```
fixture                       gerçek dilekçe
-------                       --------------
AÇIKLAMALAR                   KONU : Davacının 12.02.2026 tarihli dava
                                     dilekçesine karşı cevaplarımızın
1. Müvekkil ile davacı…              sunulmasından ibarettir.
                              …
HUKUKİ SEBEPLER               HUKUKÎ SEBEPLER : TBK m. 474, TBK m. 475,
                                                TTK m. 23, HMK m. 119…
3. 6100 sayılı HMK m. 119…
```

Ders, W17'nin ilk yarısının dersiyle aynı ve bu kez metin katmanında:
**gerçek girdiyle çalıştırılmamış bir özellik bitmiş sayılmaz.** Fixture, kodun
yazarının kafasındaki belgedir; dilekçe, avukatın masasındaki belge.

---

## 1. Denenen belge

`scratchpad/opus2/dilekce.txt` — bir eser sözleşmesi / ayıp uyuşmazlığında
davalı vekilinin cevap dilekçesi. SENTETİK: taraflar, dosya numarası ve karar
uydurmadır; ama **şekli** gerçektir.

İçerdikleri, çünkü her biri bir kusuru ortaya çıkardı:

| Öge | Neyi ölçtü |
|---|---|
| `DOSYA NO :`, `DAVALI :`, `VEKİLİ :`, `DAVACI :` | önsöz ayıklaması |
| `KONU : <97 karakterlik cümle>` | önsöz uzunluk sınırı |
| `AÇIKLAMALAR` + 7 numaralı paragraf | jenerik başlık altında tür kararı |
| `TBK m. 474`, `TBK m. 475`, `TTK m. 23/1-c`, `HMK m. 119`, `HMK m. 129` | kısaltma + madde eşleştirmesi |
| `Yargıtay 15. Hukuk Dairesi'nin E. 2019/2145, K. 2020/1877` | karar künyesi ayrıştırma |
| `Anılan kararda…` | kısa gönderme (short form) |
| `HUKUKÎ SEBEPLER :`, `DELİLLER :`, `SONUÇ VE İSTEM :` satır içi | başlık tanıma |
| `Davalı Vekili` / `Av. Selin Aydın` | imza bloğu |

---

## 2. Başlangıç ölçümü (düzeltmeden önce)

```
süre            2 dk 04 sn
iddia           12
yanlış BULUNDU   1        ("6098 sayılı Türk Borçlar Kanunu … m. 1")
atıf satırı     10        (çıplak "TBK", "TTK", "HMK" + çıplak "m. 475"…)
aleyhe kayıt    50        beşi hariç hepsi konuyla ilgisiz
```

---

## 3. Bulunan kusurlar ve düzeltmeleri

### D-1 · `KONU : …` bir iddia oluyordu

`isPreambleLine` önce satırın TAMAMINI katlıyor ve 90 karakteri aşarsa
**hemen `false`** dönüyordu. Gerçek KONU satırı 97 karakter. Oysa uzunluk sınırı
BAŞLIK ve MAHKEME-ADRESİ testleri içindir — onlar satırı bir şekil olarak okur;
etiket testi yalnız iki nokta öncesindeki ≤30 karakteri okur ve iki noktadan
sonrasının uzunluğu onu ilgilendirmez.

**Düzeltme:** etiket testi öne alındı. `src/contracts/petitionAnalysis.ts`
`isPreambleLine`.

### D-2 · İmza bloğu bir iddia oluyordu

"Davalı Vekili" ve "Av. Selin Aydın" birleşip `iddia-12` oldu; avukatın kendi
adı karşı tarafın iddiası olarak listelendi ve aleyhe kaynak arandı.

**Düzeltme:** `SIGNATURE_LINE` — `PREAMBLE_TITLES` gibi **KAPALI bir biçim
listesi**, şekil sezgisi değil: tam olarak bir rol adı, bir nezaket kapanışı,
ya da yalnızca "Av." unvanı + ad olan bir satır. "Davalı vekili duruşmada bu
beyanı geri almıştır" cümlesi yakalanmaz (test var).

### D-3 · Satır içi başlıklar görülmüyordu

`headingKindOf` satırı katlar ve 60 karakteri aşarsa vazgeçer. Bu yüzden
`HUKUKÎ SEBEPLER : TBK m. 474, …` bir başlık değil, sıradan bir paragraf
sayıldı ve üç bölüm önce bırakılmış **"AÇIKLAMALAR"** başlığı altında kaldı.
`DELİLLER` ve `SONUÇ VE İSTEM` de öyle.

**Düzeltme:** `inlineHeadingOf` — iki noktadan önceki ≤40 karakteri başlık
olarak dener; tanırsa başlığı DEĞİŞTİRİR ve **iki noktadan sonrasını iddia
olarak tutar**. İçerik atılmaz: HUKUKÎ SEBEPLER satırı Türk dilekçesinin
kanunlarını saydığı yerdir; atılsaydı o atıflar hiçbir iddiaya bağlanamazdı.

Sıra önemlidir ve yorumda yazılıdır: `isPreambleLine` **önce** çalışır, çünkü
"KONU" hem bir önsöz etiketi hem bir anlatı başlığıdır ve `KONU : …` biçiminde
önsöz olanıdır.

### D-4 · Her iddia "vakıa" etiketliydi

Jenerik başlık altındaki her paragraf başlığın türünü alıyordu. Gerçek
dilekçenin yedi numaralı paragrafının hepsi "vakıa" oldu — TBK m. 474'e,
TTK m. 23/1-c'ye ve HMK m. 119'a dayanan üçü dahil.

Bu bir süs değil: `CLAIM_KIND_HELP_TR.VAKIA` avukata *"Vakıa cümlesinin atfı
olmaması olağandır"* der. Yanlış etiket, olması gereken atfın yokluğunu **mazur
gösterir**.

**Düzeltme:** `HEADING_RULES`'a `weak` alanı. "HUKUKÎ SEBEPLER" altındaki her
satırın ne olduğunu söyler; "AÇIKLAMALAR" hiçbir şey söylemez — tüm tartışmanın
yaşadığı yerdir. Zayıf başlık altında **paragrafın kendi ATFI** karar verir
(`citesAuthority`, `parseReferences` ile), çünkü `HUKUKI_SEBEP_CUES` içindeki
"uyarınca" *"sözleşme uyarınca"*da da ateşler — o bir sözleşmedir, hukukî sebep
değil. Ayrıştırılmış bir atıf ise cümle hakkında bir OLGUDUR.

Sonuç: 7 numaralı paragrafın 4'ü doğru biçimde `HUKUKI_SEBEP`, 3'ü `VAKIA`.

### D-5 · Çıplak "TBK" ikinci bir atıf olarak yaşıyordu

`pairArticlesWithTheirLaw` maddeyi kanunuyla eşleştiriyor ama kanun satırı
ayrıca kalıyordu. Çözümleyici onu 6098'in **İLK maddesiyle** yanıtladı ve rapor

> **bulundu** — 6098 sayılı Türk Borçlar Kanunu … **m. 1**

yazdı. Belgede yazan atıf **m. 475**'ti. Yeşil bir satırın belgeden BAŞKA bir
maddeyi göstermesi, hiç denetim yapmamaktan kötüdür.

**Düzeltme:** eşleşen kanun `claimed` kümesine girer ve kendi satırı düşer;
birleşen satırın `raw`'ı **belgenin yazdığı gibi** okunur (`TBK m. 475`), çünkü
kanunsuz bir "m. 475" avukatı hiçbir şeyin 475. maddesini aramaya gönderir.
Ayrıca `isCheckableCourtReference` numarasız bir karar göndermesini denetime
hiç sokmaz.

### D-6 · Aleyhe sorgular kanun numarasından kuruluyordu

`contraryBaseTerm`'ün son çaresi kanun NUMARASIYDI: `6098 sayılı m. 475 bozma`.
Hiçbir karar öyle yazılmaz; arşiv gevşek eşleşti ve beş alâkasız kararı
**"aleyhe kaynak BULUNDU"** olarak döndürdü. On iki iddianın beşinde oldu:
elli kayıt, hiçbiri konuyla ilgili değil. Bir cevap raporunda yanlış bir
*"aleyhe içtihat VAR"* en pahalı hatadır — avukat ya bir öğleden sonrasını
harcar ya da bir noktadan boşuna vazgeçer.

**Düzeltme:** temel terim artık **KURUM**dur, kavram motorundan okunur. Kurum
tanınmazsa terim BOŞ kalır ve şerit nedeniyle birlikte ÇALIŞTIRILMADI der.
Dürüst bir "sorgu kurulamadı", beş yanlış cevaptan iyidir.

Kavram motoru `OPPOSITE_TERMS` taramasının ÖNÜNE alındı: tablo en-spesifik-önce
sıralıdır, `OPPOSITE_TERMS` hiç sıralı değildir. Ölçüldü — "manevi tazminat"
paragrafında tarama çıplak `tazminat` anahtarını (Türk medenî pratiğinin en
geniş sözcüğü) veriyordu; motor `manevi tazminat` verir. Ters çevirme ifadesi
ayrı aranır (`contraryFlavorFor`), o yüzden daha dar bir terim aynı ifadeyi
korur: sorgu `manevi tazminat "tazminat talebinin reddi"` oldu.

### D-7 · Aleyhe aşamasının saati yoktu

Yalnız şerit SAYISI vardı (`MAX_CONTRARY_LANE_RUNS = 40`) — bu, bir kaynağın o
gün ne kadar yavaş olduğu hakkında hiçbir şey söylemez. Gerçek dilekçe iki
dakika dört saniye sürdü ve avukatın beklemeyeceği bir rapor,
çalıştırmayacakları bir rapordur.

**Düzeltme:** `CONTRARY_TIME_BUDGET_MS = 30_000`, şeritler ARASINDA ve ancak
**bir şerit gerçekten koştuktan sonra** okunur (ilk kontrol geç diye hiçbir şey
aramayan bir rapor daha kötü olurdu). Kesilen her şerit
`CONTRARY_TIME_BUDGET_TR` ile ÇALIŞTIRILMADI'dır: rapor yapmadığı şeyi söyler.

### D-8 · Künye üç kez basılıyordu, tarih olduğu gibi

```
Yargıtay 11. Hukuk Dairesi · Yargıtay 11. Hukuk Dairesi E. 2026/5892
K. 2026/4208 · 2026/5892 · 2026/4208
```

Şerit `[court, title, docketNo, decisionNo]` dizisini körlemesine birleştiriyor,
sağlayıcının `title`'ı ise zaten üçünü de taşıyordu. Sayfa boyunca on kez.
Aynı kayıtlardan birinin `decisionDate`'i **`"6006-09-20"`** idi ve olduğu gibi
basılıyordu — avukata kararın 6006 yılından olduğunu söyleyerek.

**Düzeltme:** `formatSourceKunye` — her parça yalnız satır onu TAŞIMIYORSA
eklenir, karşılaştırma katlanmış metin üzerinde yapılır, ve satırdakini KAPSAYAN
yeni bir parça onun yerine geçer (kapsama iki yönlü çalışır: `court` önce
gelir, `title` çoğu kez onu tekrarlar). `formatDecisionDateNote` — etiketli ve
Türkçe sırada (`Karar tarihi: 13.07.2026`); yılı `KUNYE_YEAR_MIN..MAX`
dışındaysa "Kaynak okunabilir bir karar tarihi bildirmedi" der. Sınır bir
SABİTTİR, saat değil, o yüzden aynı girdi hep aynı satırı basar.

### D-9 · Hiçbir kaydın bağlantısı yoktu

Raporun kendi uyarısı *"tam metni açıp alıntıyı kendiniz doğrulayın"* diyor.
Her kaydın `href`'i boştu; açılacak bir şey yoktu — raporun tutamadığı bir söz.
`petitionLaneRow`'daki "Tam metne git" bağlantısı konsolda zaten yazılıydı ve
hiç görünmüyordu.

**Düzeltme:** satırın kendi `sourceUrl`'ü bağlantı olur. **Ama** bu SAĞLAYICI
metnidir ve konsol onu doğrudan bir `a.href`'e yazar, o yüzden getirme
katmanının izin listesinden geçer (`checkFetchUrl`: yalnız https, userinfo yok,
IP literal yok, tam host eşleşmesi). Reddedilen bağlantı yerine **bağlantı
YOK** — tıklanmaması gereken bir bağlantı değil.

### D-10 · On iddianın sekizi hiç sorgu üretmiyordu

D-6'nın dürüst ama neredeyse işe yaramaz sonucu: yalnız 2 iddia kendi
sözcüklerinde bir kurum adlandırıyordu. *"davacı ilk bildirimini ancak
30.01.2026 tarihinde yapmıştır"* diyen bir paragraf, hâlâ bir ESER SÖZLEŞMESİ
uyuşmazlığının paragrafıdır ve avukatın arayacağı terim tam olarak odur.

**Düzeltme (üç deneme sürdü, ikisi ölçülerek çürütüldü):**

1. *Belgenin tamamına `contraryBaseTerm`.* Ölçüldü: **"ihbar tazminatı"** — bir
   iş hukuku kurumu, dosyada geçmiyor. Bütün bir dilekçe neredeyse her kavramı
   hecelemeye yetecek kadar sözcük taşır ("bildirim" bir paragrafta, "tazminat"
   başkasında). Altı iddia bir inşaat ayıbı dosyasında
   `ihbar tazminatı "tazminat talebinin reddi"` aradı.
2. *Sözcüğü belgede BİREBİR geçme şartı + en sık geçen kazanır.* Ölçüldü:
   **"tazminat"** — geçiyordu, ama aday kümesi `analyzeIntake(belge)` +
   `OPPOSITE_TERMS` idi ve "eser sözleşmesi" o kümede yoktu.
3. **Kabul edilen:** aday kümesi önce **iddiaların KENDİ terimleridir.** Bütün
   bir dilekçe üzerinde kavram motorunu koşturmak, bir paragraf üzerinde
   koşturmaktan başka bir sorudur — belge geniş ve jenerik anahtarları
   ateşlerken paragrafları spesifik olanları ateşler. Ölçülen sonuç:
   **"eser sözleşmesi"**.

Ödünç alındığında rapor bunu SÖYLER (`borrowedTermTR`): çıkan kararlar
uyuşmazlığın konusuyla ilgilidir, o iddiaya birebir cevap verdikleri anlamına
gelmez. TALEP ve DELİLLER blokları hiç ödünç almaz.

### D-11 · Aynı sorgu bir raporda on altı kez

D-10'un yan etkisi: altı iddia aynı şeridi kurdu ve rapor
`ihbar tazminatı "tazminat talebinin reddi"` sorgusunu **altı ayrı kez**
gönderdi. On altı şerit × ~10 sn, otuz saniyelik bütçe → 3 koştu, 13
ÇALIŞTIRILMADI. Kâğıt üzerinde kapsama, ekranda hiçbir şey.

**Düzeltme:** rapor başına **AYRI sorgu başına bir yukarı çağrı**
(`contraryCache`). Bir sorgunun cevabı, onu soran her iddianın cevabıdır;
ret de ret olarak önbelleğe alınır, böylece ölü bir kaynak on altı kez
denenmez. Tekrarlanan bir sorgu ne şerit ne süre bütçesine yazılır.

### D-12 · Aynı karar bir iddia altında iki kez

Bir iddianın şeritleri yalnız ters-çevirme ifadesinde ayrılır, o yüzden aynı
kararlara düşerler. `eser sözleşmesi "aksi yönde"` ve
`eser sözleşmesi "karşı oy"` birebir aynı beş künyeyi döndürdü; rapor beş karar
için on satır bastı.

**Düzeltme:** karar, onu bulan İLK şeridin altında listelenir; sonraki şerit
kaçının yukarıda olduğunu söyler (`alreadyListedTR`) ve **BULUNDU durumunu
korur** — gerçekten buldu. "bulunamadı" demez.

### D-13 · TALEP ve DELİLLER blokları KAYNAKSIZ uyarısı üretiyordu

*"davanın reddine … karar verilmesini … talep ederiz"* ve bütün DELİLLER satırı
"dayanaksız ifade" olarak işaretlendi — avukatın okuyup geçmesi gereken 12
uyarının 2'si. Kaynaklanması hiç mümkün olmayan bir şeyde ateşleyen uyarı,
okuyucuya önemli olanları atlamayı öğretir. Ayrıca DELİLLER listesi
`eser sözleşmesi` kavramını ateşleyip tam bir aleyhe şerit takımı alıyordu:
bir belge listesi bir önerme değildir.

**Düzeltme:** `TALEP` ve `DIGER` bloklarında dayanaksız-ifade taraması ve
aleyhe araması yapılmaz; ikisi de nedenini yazar
(`CONTRARY_NOT_AN_ASSERTION_TR`).

---

## 4. Ölçülen sonuç (aynı dilekçe, aynı sunucu)

| | önce | sonra |
|---|---|---|
| süre | 2 dk 04 sn | **33,2 sn** |
| iddia | 12 | **10** (KONU ve imza bloğu iddia değil) |
| iddia türleri | 11 vakıa · 1 talep | **5 hukuki sebep · 3 vakıa · 1 talep · 1 diğer** |
| başlıklar | hepsi "AÇIKLAMALAR" | **AÇIKLAMALAR · HUKUKÎ SEBEPLER · DELİLLER · SONUÇ VE İSTEM** |
| yanlış BULUNDU | 1 | **0** |
| atıf satırı | 10 (çıplak "TBK", çıplak "m. 475"…) | **6, hepsi kanunuyla** (`TBK m. 475`, `HMK m. 129` …) |
| aleyhe şerit kurulan / koşan | 4 / 4 | **16 / 15** (13'ü önbellekten) |
| sorgusuz iddia | 8 / 12 | **2 / 10** (yalnız TALEP ve DELİLLER — doğru olan) |
| aleyhe sorgu | `6098 sayılı m. 475 bozma` | `eser sözleşmesi "aksi yönde"` · `manevi tazminat "tazminat talebinin reddi"` |
| künye | üç kez basılı | **tek satır** |
| karar tarihi | `2026-07-13` / `6006-09-20` | `Karar tarihi: 13.07.2026` / "Kaynak okunabilir bir karar tarihi bildirmedi" |
| bağlantı | yok | **her kayıtta**, izin listesinden geçmiş |
| KAYNAKSIZ cümle | 12 | **10** (talep ve delil listesi hariç) |

**Bu sayıların NE OLMADIĞI.** Süre, satır sayısı ve şerit durumları ölçüldü.
**İSABET ÖLÇÜLMEDİ**: dönen kararların bu uyuşmazlıkla gerçekten ilgili olup
olmadığı bir hukukçu değerlendirmesidir ve yapılmadı. Sıralamayı kaynak
sunucusu belirler; ColleX eline verilen satırları yeniden sıralayabilir ve
ekranda bunu söyler (B-16 etiketi: *"erişim ölçüldü, isabet ölçülmedi"*).
Ayrıca ölçüm `collex_demo` üzerindedir.

---

## 4b. İkinci tur — bağımsız, çekişmeli denetim

Yukarıdaki ölçüm alındıktan sonra aynı yüzeye **altı bağımsız mercek** salındı
(avukat gözü, sade dil, dürüstlük değişmezleri, ayrıştırıcı doğruluğu,
API↔ekran sözleşmesi, test kalitesi) ve her bulgu **iki ayrı şüpheciye**
çürütülmek üzere verildi. **35 bulgu yargılandı: 14'ü ayakta kaldı, 21'i
çürütüldü.** Ayakta kalan on dördün hepsi düzeltildi.

En pahalı üçü, ve neden önemli oldukları:

**(a) Ölü bir kaynak "arandı, bulunamadı" diye çiziliyordu.** `searchSources`
her geçit hatasını ve her sağlayıcı hatasını yakalıyor, `failedSources`'a
yazıyor ve **normal şekilde `rows: []` ile dönüyor**. Port bu alanları hiç
okumuyordu. Sonuç: MCP geçidi kapalıyken şerit yeşil "arandı, bulunamadı — Bu
sorgu çalıştı ve sonuç getirmedi" yazıyordu ve **ARAMA_BASARISIZ üründe hiç
erişilemiyordu** — dört durumu ayırmak için yazılmış bir rapor üçe düşüyordu,
ve çöküş en pahalı tarafa oluyordu. Port artık hiçbir kaynağın cevap vermediği
durumda fırlatıyor; `tests/integration/contraryOutage.test.ts` bunu **mount
edilmiş uygulama üzerinden** ölçüyor.

**(b) "Aleyhe kaynak bulundu" ölçülmemiş bir yön iddia ediyordu.** Durum yalnız
satır SAYISINA bakıyor; hiçbir şey dönen kararın iddianın AKSİ yönde olup
olmadığına bakmıyor. Ölçüldü: bir eser sözleşmesi dosyasında rozet beş
**Yargıtay 11. HD** (ticaret dairesi) kararının üzerinde "aleyhe kaynak
bulundu" diyordu, ve aynı karar hem "eser sözleşmesi" hem "manevi tazminat"
iddiasının aleyhine delil gibi listeleniyordu. Yönü doğrulamak **denendi ve
yapılamayacağı görüldü**: `ContraryHit` yalnız künye/tarih/bağlantı taşır ve
Bedesten hattı hiç snippet yayınlamaz, yani bir yön testi bu durumu
**erişilemez** yapardı — ki bu başka bir dürüstlük sorunudur. Etiket ve açıklama
artık yalnız ölçüleni söylüyor: **"sorgu sonuç getirdi"**, ve cümle "bu
kararların iddianın AKSİ yönünde olup olmadığı ÖLÇÜLMEDİ" diye devam ediyor —
kapsama tablosunun ve harç tarifesinin doldurulamayan hücre için kullandığı
dilin aynısı.

**(c) W17'nin kendi düzeltmesi bir gerileme üretmişti.** Liste testi
`claim.kind === "DIGER"` idi; oysa `DIGER` aynı zamanda `inferKind`'ın
"sınıflandıramadım" değeridir. Sıradan bir **ceza savunma dilekçesinde beş
iddianın dördü** — "Sanığın eylemi suç oluşturmamaktadır" ve "Şikayet süresi
geçmiştir" dahil — "Bu blok bir iddia değil, bir liste (deliller/ekler)" diye
işaretlendi, hiç aranmadı ve dayanaksız-ifade taramasının dışında bırakıldı.
Soru artık **BAŞLIĞA** soruluyor (`isDocumentListHeading`), asla yedeğe.

Kalan on bir bulgu ve düzeltmeleri:

| # | Bulgu | Düzeltme |
|---|---|---|
| 4 | "…mevzuat atfı bulunamadı" cümlesi, aynı kartın iki satır yukarısında o iddianın mevzuat atıflarını listelerken duruyordu | cümle artık yalnız KAVRAM tanınamadığını söylüyor ve bir madde numarasının neden aleyhe sorgu olarak aranmadığını yazıyor |
| 7 | `CLAIM_MARKER` yalnız Arap rakamı anlıyordu: **"1-)"** — Türk avukatlarının en çok yazdığı biçim — ve "(1)" görünmezdi; "I. AÇIKLAMALAR" başlık sayılmıyordu. Bir icra itirazının üç sebebi TEK iddiaya çöküyordu | iki AYRI alternatif ("1-)" ve "(1)") + `HEADING_LEAD` Roma rakamı/harf öneki. Ayırıcıyı isteğe bağlı yapmak denendi ve **aynı saat geri alındı**: "14.03.2024 tarihli" iddia numarası oluyordu |
| 13 | `İZMİR 5. İCRA MÜDÜRLÜĞÜ'NE`, `MÜDAFİ : Av. Ahmet Yılmaz`, `İSTİNAF EDEN (DAVALI) : …` iddia oluyordu | her merciin kesme işaretli yazılışı + bileşik rol etiketleri (kapalı liste) + parantezli rol açıklaması |
| 14 | "sözleşmenin 5. maddesi" bir mevzuat atfı sayılıyor, "belirsiz" satırı üretiyor ve paragrafı "hukuki sebep"e terfi ettiriyordu | kanunu olmayan çıplak madde artık ne atıf satırı ne tür sinyali; cümle iddia metninde durur ve **dayanaksız-ifade taramasına girer** |
| 9 | "TTK m. 23/1-c — metinde 2 kez geçiyor"; dilekçe bendi bir kez, maddeyi bir kez anmıştı | `rawForms` (eklemeli): satır bütün yazılışları gösterir, sayı **TOPLAM** olarak adlandırılır |
| 12 | HUKUKÎ SEBEPLER bloğu beş atıf yazıyor, kartı "Atıf denetimi — 4 atıf" diyordu | iddia↔satır eşleştirmesi artık bütün yazılışları dener (canlı: 4 → **5**) |
| — | "2004 sayılı İcra ve⏎İflas Kanunu m. 269" hiç kanun üretmiyordu (isim satır sonuyla bölünmüştü) ve karar künyeleri `raw` içinde **satır sonu** taşıyordu | belge artık DÜZYAZI olarak ayrıştırılıyor (boşluklar toplanır); ikisi de düzeldi |
| 2 | Karşı tarafın cümlesinin yanındaki "?", TASLAK ekranının tanımını açıyor ve avukata "dayanağını siz eklemelisiniz" diyordu | ekranın kendi terim anahtarı: **"KAYNAKSIZ (dilekçe incelemesi)"** |
| 10 | Bir bildirim avukatı **"alinti" alanına** yolluyordu — ekranda böyle bir alan yok | "hemen altında tırnak içinde durur" |
| 11 | Ekranın giriş cümlesinde **"kova"** — geliştirici sözcüğü | "üç ayrı bölüm açar: atıf denetimi, aleyhe kaynak ve atfa bağlanmayan cümleler" |
| — (tarayıcıda bulundu) | "Tam metne git" bağlantısının `target`'ı yoktu: bir tık, 33 saniyede üretilen ve hiçbir yerde saklanmayan raporu götürüyordu | yeni sekmede açılır + `rel` verilir, ve bağlantının kendi metni "(yeni sekmede)" der |
| — (tarayıcıda bulundu) | Ödünç kavram iki kez yazılıyordu ("Sorgular şu kavram üzerine kuruldu: …" + notun aynısı) | not varken tek satır yazılmıyor (B-27: tekrar eden uyarı okunmayan uyarıdır) |

Çürütülen 21 bulgunun çoğu aynı nedenle düştü: **önerilen "düzeltme" bağlayıcı
bir kuralı çiğneyecekti** (künye uydurmak, durumları birleştirmek, yüzde
eklemek, bir kapıyı gevşetmek) ya da bildirilen davranış **bu projenin bilerek
seçtiği dürüst davranış**tı (tahmin etmeyi reddetmek, ÇALIŞTIRILMADI demek,
künyeyi boş bırakmak).

İkinci turdan sonra aynı dilekçeyle aynı sunucuda ölçülen sonuç **değişmedi**
(33,2 sn · 10 iddia · 16 şerit / 15 koştu), **bir sayı dışında**: HUKUKÎ
SEBEPLER bloğunun atıf sayısı **4 → 5** oldu ve TTK satırı artık iki yazılışını
birden gösteriyor.

## 5. Kapanmayan, bilerek bırakılan

- **Ödünç alınan terim tekrarlıdır.** Sekiz iddia aynı beş kararı gösterir.
  Alternatifi (bir kez göstermek) yedi iddiada boş bir aleyhe bölümü bırakırdı,
  ki o daha yanıltıcıdır. Sözleşme değişikliği (belge düzeyinde tek bir aleyhe
  bölümü) düşünüldü ve bu turda YAPILMADI.
- **Atıfların altısı da "belirsiz".** `collex_demo` gerçek TBK/TTK/HMK metnini
  taşımaz. Bu doğru davranıştır (bulunamadı DEĞİL, belirsiz), ama gerçek
  kütüphanede ne olacağı **ölçülmedi**.
- **`(sentetik alıntı)` künyesi.** Demo korpusundaki başlıklar kendilerini öyle
  etiketler ve künyeye o şekilde girer. Bu dürüsttür ve `collex_local`'da
  görünmez; W15'in yasak sözcük süpürmesi `console.html`'in KENDİ metinlerini
  tarar, veriyi değil.

---

## 6. Dosyalar

| Dosya | Ne değişti |
|---|---|
| `src/contracts/petitionAnalysis.ts` | D-1..D-7, D-10..D-13 |
| `src/contracts/citationAudit.ts` | D-5 |
| `src/sources/searchService.ts` | `formatSourceKunye`, `formatDecisionDateNote` (D-8) |
| `src/api/server.ts` | künye/tarih/bağlantı bağlantısı + `checkFetchUrl` (D-8, D-9) |
| `tests/contracts/petitionRealPetition.test.ts` | **YENİ** — 28 test, hepsi ölçülmüş bir kusurdan |
| `tests/contracts/petitionShapes.test.ts` | **YENİ** — 15 test: cevap dilekçesi OLMAYAN şekiller (ceza savunma, icra itirazı, istinaf) |
| `tests/integration/contraryOutage.test.ts` | **YENİ** — 4 test: ölü geçit ARAMA_BASARISIZ üretir, mount edilmiş uygulama üzerinden |
| `tests/sources/kunyeFormat.test.ts` | **YENİ** — 10 test |
| `tests/security/contraryHref.test.ts` | **YENİ** — 7 test |
| `tests/contracts/corpusResolver.test.ts` | bir bekleyiş güncellendi, biri eklendi (çıplak madde artık satır değil) |
| `tests/pipeline/console.test.ts` | iki pin güncellendi (yeni durum etiketi, ekrana özel terim anahtarı) |
| `tests/contracts/petitionAnalysis.test.ts` | iki bekleyiş güncellendi, ikisi de gerekçeli |
| `tests/integration/w16Wiring.test.ts` | fixture bir kurum adlandırır oldu (gerekçesi dosyada) |
