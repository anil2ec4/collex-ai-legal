# Yerel OCR (W20)

Taranmış bir PDF sayfasının metin katmanı yoktur. W19'a kadar böyle bir sayfa
dürüstçe **OKUNAMADI** (`UNREADABLE_NO_TEXT`) olarak işaretlenir ve "dosyanın
tamamı okundu" iddiasını engellerdi. W20 bu davranışı korur ve yanına **yerel**
bir OCR sınırı ekler (`intake/ocr.py`).

## Ne değişti, ne değişmedi

| Durum | Sonuç |
|---|---|
| Makinede yerel OCR yok (varsayılan) | Aynen W19: sayfa `UNREADABLE`, kapsam eksik, tamamen taranmış PDF kapalı başarısız olur ("taranmış PDF — OCR bu modda devre dışı", kod `SCANNED_PDF_NO_OCR`). |
| Yerel OCR var ve sayfayı okudu | Metin sayfanın **kendi yuvasına** yazılır (aynı sayfa numarası, `extraction_method = 'ocr'`, motorun güven puanı). Alıntılar yine "s. N" olarak o fiziksel sayfayı gösterir; ayrı bir "OCR kopyası" belge oluşmaz. W21: sayfa `pages.ocrPages` listesine girer, `pages.emptyPages`'e girmez; dosyanın `extraction.ocr` değeri `true` olur. |
| Güven puanı düşük (< 0,60) | Sayfa `SPARSE` kaydedilir: okunmuş sayılır ama doğrulanmış sayılmaz; dosya incelemesi `OCR_LOW_CONFIDENCE` boşluğu yazar ve "tamamı okundu" demez. |
| OCR sayfayı okuyamadı | Sayfa `UNREADABLE` kalır; uyarıda sayfa numarasıyla yazar (`OCR_FAILED_PAGES:<n>`). |
| OCR'ın dosya başına süresi doldu (W21) | Ulaşılamayan sayfalar `UNREADABLE` kalır; `OCR_BUDGET_EXCEEDED:<n>` ve sayfaları sayan bir cümle; yükleme yine tamamlanır. |
| Taranmış sayfada yalnız kısa bir metin katmanı var (W21) | Sayfa metin katmanıyla "okunmuş" sayılmaz: OCR varsa okunur (metin katmanı OCR metninin önünde korunur; OCR'ın onu yeniden okuyan satırları eklenmez), yoksa ya da OCR metin katmanının ötesinde bir şey bulmadıysa `SPARSE` kaydedilir ve `IMAGE_TEXT_PAGES:<n>` uyarısı çıkar. |

Bulut OCR (POST `/v1/ai/ocr`) ayrı, açık rıza isteyen bir özelliktir ve
`COLLEX_DATA_BOUNDARY=LOCAL_ONLY` altında reddedilir. Yerel OCR hiçbir ağ
çağrısı yapmaz.

## Kurulum (Windows, isteğe bağlı)

Bu depo hiçbir şeyi kendiliğinden kurmaz veya indirmez. Yerel OCR için iki
program gerekir:

1. **Tesseract** (Türkçe dil verisiyle): `scoop install tesseract` ve
   `tesseract-languages` ya da UB Mannheim yükleyicisi; kurulumdan sonra
   `tesseract --list-langs` çıktısında `tur` görünmelidir.
2. **Poppler** (`pdftoppm`): `scoop install poppler`.

İkisi `PATH` üzerindeyse ColleX onları kendiliğinden bulur
(`COLLEX_OCR=auto`, varsayılan). Kapatmak için `COLLEX_OCR=off`.

Denetim:

```bash
.venv/Scripts/python.exe -c "from intake.ocr import detect_ocr_capability; print(detect_ocr_capability())"
```

## Bu makinedeki durum (11.09.2026)

`tesseract` ve `pdftoppm` kurulu değil → yerel OCR **kapalı**. Sahte bir
sağlayıcıyla yapılan testler (`tests/intake/test_ocr.py`) sınırın ve sayfa
eşlemesinin doğru çalıştığını kanıtlar; gerçek bir tek sayfa OCR sınaması bu
makinede **çalıştırılamadı** (ortam engeli) ve test raporunda "skipped" olarak
görünür, geçti olarak değil.

## Durum kodları (W21)

| Kod | Anlamı |
|---|---|
| `OCR_READY` | `tesseract`, Türkçe dil verisi (`tur`) ve PDF sayfasını görüntüye çeviren `pdftoppm` bulundu: taranmış sayfalar bu bilgisayarda okunabilir. |
| `OCR_DISABLED` | `COLLEX_OCR=off`: yerel OCR bilerek kapalı. |
| `OCR_EXECUTABLE_MISSING` | `tesseract` bulunamadı. |
| `OCR_TURKISH_DATA_MISSING` | `tesseract` var ama `tur` dil verisi yok. |
| `OCR_RASTERIZER_MISSING` | PDF sayfasını görüntüye çeviren program (`pdftoppm`) yok. |
| `OCR_FAILED` | Durum denetlenemedi ya da cevabı anlaşılmadı; taranmış sayfalar okunmamış sayılır. |

Sorgu (Windows `.venv/Scripts/python.exe`, macOS `.venv/bin/python`):

```bash
.venv/Scripts/python.exe -m intake.ocr --status
```

**Sunucu yoklaması:**

- Sunucu bu komutu süreç başına **bir kez** çalıştırır. Bir kurulumun
  görünmesi için sunucu yeniden başlatılır.
- `/v1/health` içindeki `ocr` alanı ilk cevap gelene kadar `null`dır. Bu
  "henüz bilinmiyor" demektir, "hazır" değil.
- Ayarlar › Sistem durumu'ndaki satırın adı "Taranmış sayfaları bu
  bilgisayarda okuma"dır.
- Yalnız `OCR_READY` taranmış bir sayfanın okunmasına izin verir. Diğer her
  kodda W19 davranışı sürer: sayfa `UNREADABLE` kalır ve kapsam eksik olur.

Bu makinede W21 yoklamasının sonucu (11.09.2026) `OCR_EXECUTABLE_MISSING`.
macOS kurulumu: [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §8
(DOĞRULANMADI). Mac'te hizmetin kendi ortamındaki durum `/v1/health` →
`ocr.state` ile okunur (MAC-MINI-PRODUCTION §5.5); terminaldeki `--status`
terminalin ortamını sınar.

## Taranmış sayfalar nasıl sayılır (W21)

### Görüntü sayfaları: kısa metin katmanı "okundu" demek değildir

Bir tarama çoğu zaman sayfaya dijital bir satır ekler: e-imza doğrulama
satırı, damga, Bates numarası. W21'den önce bu satır 50 karakteri geçince
sayfa `EXTRACTED` sayılır, OCR'a hiç gönderilmez ve dosya incelemesi dosyanın
tamamını okunmuş kabul edebilirdi; oysa sayfanın gövdesi görüntüdeydi.

Kural (`intake/extract.py`):

- Metin katmanı **boş olmayan ama 400 karakterden kısa** bir sayfanın içerik
  akışı okunur (görüntü çözülmez). Çizilen görüntüler (doğrudan, Form XObject
  içinde ya da satır içi görüntü olarak) **birlikte** sayfanın en az
  **yarısını** kaplıyorsa sayfa **görüntü sayfası** sayılır. Alanlar toplanır:
  sayfayı şeritler, karolar ya da MRC bölgeleri halinde yazan bir tarayıcı tek
  büyük görüntü çizmez ama sayfa yine taramadır.
- Görüntü sayfası yerel OCR'a gönderilir. OCR okursa metin katmanındaki
  karakterler aynen OCR metninin önünde, aynı sayfa yuvasında korunur
  (doğrulama kodunu OCR bozabilir).
- **OCR yalnız metin katmanında olmayanı ekler (R2-32).** `tesseract` sayfayı
  görüntüye çevirip okur; görünen metin katmanı da çizildiği için onu da yeniden
  okur — hatalarıyla. Önceden bu ikinci kopya aynı sayfaya eklenirdi: kısa
  metinli bir kapak ya da imza sayfası (antetli kâğıt görüntüsü üstünde) iki
  kez yer alır, "1.500.000 TL"nin yanında yanlış okunmuş "1.500.600 TL" tek ve
  doğrulanmış bir alıntı olabilirdi. Şimdi OCR'ın her satırı metin katmanıyla
  karşılaştırılır (büyük/küçük harf, Türkçe i/ı ve aksanlar yok sayılır; 4+
  karakterlik sözcüklerde tek harf ya da rakam farkı "yakın" sayılır) ve üç
  sonuçtan birini alır (`intake/extract.py::_split_ocr_lines`):
  - **Kopya — eklenmez.** Satırın sözcükleri metin katmanında sözcüğü sözcüğüne
    geçiyor; ya da sözcüklerinin en az %80'i aynı sırayla geçiyor, bunların en
    az **üçü birebir** eşleşiyor ve yakın eşleşenler birebir eşleşenlerin
    yarısını aşmıyor (uzun bir satırın tek sözcüğü yanlış okunmuş).
  - **Eklenmez ama gizlenmez de.** Satır metin katmanındaki bir
    değere ancak yakın bir sözcükle ve daha zayıf bir dayanakla benziyor: tek
    başına bir tarih ya da tutar, "ESAS NO : 2024/128" (metin katmanında
    `2024/123`), kısa "Doğrulama kodu" satırında bir harfi farklı kod. Yanlış
    okunmuş bir kopya ile sayfada ayrıca geçen farklı bir değer burada ayırt
    edilemez. Satır metne **eklenmez** (alıntılanamaz), sayfa `SPARSE` kaydedilir,
    `sparsePages`'e girer ve `OCR_WITHHELD_LINES_PAGES:<n>` kodu ile eklenmeyen
    satırları (en çok üçü, 40 karakterle) sayfa numarasıyla gösteren bir cümle
    çıkar: "… bu satırlar aramada çıkmaz ve alıntılanamaz; bu sayfaların
    tamamının okunduğu doğrulanmadı". Önceki turda (R2-32 ilk düzeltme) bu
    satırlar **sessizce** siliniyor, sayfa `EXTRACTED` kalıyordu: taranmış bir
    dilekçenin "11.03.2024" tarih satırı, altbilgideki "12.03.2024" yüzünden
    metinden düşüyordu.
  - **Eklenir.** Geri kalan her satır, okuma sırasıyla metin katmanının arkasına.
  - **Bir metin katmanı sözcüğü bir kez yeniden okunabilir.** Altbilgiyi
    birebir yeniden okuyan satır o sözcükleri "kullanır"; başka bir satır aynı
    sözcüklerin yeniden okuması sayılamaz. Bu yüzden OCR altbilgiyi (içindeki
    "12.03.2024" ile) okuduysa, tek başına duran "11.03.2024" ayrı bir değerdir
    ve metne eklenir; sayfa `EXTRACTED` kalabilir.
- OCR metin katmanının ötesinde **hiçbir şey** bulmadıysa sayfa metin katmanı
  sayfası kalır (`pdf_text_layer`, `ocrPages`'e girmez) ve **her zaman**
  `SPARSE` + `IMAGE_TEXT_PAGES` kaydedilir; güven puanı ya da metin katmanının
  uzunluğu bunu değiştirmez. Önceki turda OCR güveni ≥ 0,60 ve metin katmanı
  ≥ 150 karakterse sayfa `EXTRACTED` sayılıyordu; ama UYAP e-imza altbilgileri
  ~200 karakterdir: gövdesi silik ya da el yazısı bir taramada OCR yalnız keskin
  altbilgiyi okursa sayfa uyarısız "okundu" oluyordu. Antetli görüntü üstündeki
  kısa bir dijital sayfa bundan ayırt edilemez; o da `SPARSE` kalır (dosya
  incelemesi `SPARSE_PAGE` boşluğu yazar). Cümle: "yerel OCR görüntüde bu kısa
  metinden başka yazı bulmadı; bu, görüntüde başka yazı olmadığını göstermez".
- OCR metin katmanının ötesinde yalnız birkaç karakter bulduysa (ör. antetteki
  büro adı) sayfa `ocr` + `SPARSE` kaydedilir ve `OCR_LOW_CONFIDENCE_PAGES`
  cümlesi nedeni doğru söyler: "sayfaların kısa metin katmanı okundu; yerel OCR
  görüntüde bunun ötesinde yalnız birkaç karakter buldu …" — güven 0,9 iken
  "düşük güvenle okundu" demez.
- **Bilinen sınırlar (R2-32):** karşılaştırma satır satırdır. OCR bir metin
  katmanı satırını aynı satırdaki görüntü yazısıyla birleştirirse (sözcüklerin
  %80'inden azı eşleşir) satır bütünüyle eklenir ve içindeki yeniden okuma
  hatalarıyla birlikte alıntılanabilir. En az üç birebir sözcükle yakın eşleşen
  uzun bir satır kopya sayılır: sayfada metin katmanındaki satırın **tek bir
  değeri farklı** ikinci bir satırı varsa ve OCR metin katmanındaki satırı
  ayrıca okumadıysa bu ikinci satır eklenmez. Kısa satırların eklenmemesi
  temkinlidir: altbilgideki kodu yanlış okuyan bir OCR sayfayı gereksiz yere
  `SPARSE` yapabilir. Eşikler yalnız sahte OCR sağlayıcılarıyla sınandı; gerçek
  `tesseract` çıktısıyla **ölçülmedi**.
- OCR yoksa, okuyamazsa ya da süre yetmezse sayfa `SPARSE` kaydedilir,
  `pages.sparsePages`'e girer ve `IMAGE_TEXT_PAGES:<n>` kodu ile sayfaları
  sayan Türkçe bir cümle eklenir. Dosya incelemesi bu sayfa için boşluk yazar;
  dosya "tamamı okundu" sayılmaz. Cümle bilineni söyler — sayfada büyük bir
  görüntü ve kısa bir metin katmanı var, görüntüde başka yazı olup olmadığı
  doğrulanamadı; sayfayı "taranmış, görüntüdeki yazı okunmadı" diye anmaz
  (antetli bir görüntü üstündeki dijital sayfa da aynı görünür; R2-32).
- Küçük bir logo ya da imza görseli taşıyan normal bir sayfa etkilenmez; 400
  karakteri geçen bir metin katmanı (ör. önceden OCR'lanmış aranabilir bir
  tarama) gövde metni sayılır.
- İçerik akışı çözümlenemeyen sayfa, bir görüntü **çizebiliyorsa** "olası
  tarama" sayılır — bilinmeyen durum okunmuş sayılmaz (R2-35). Çizebilir
  demek: sayfa bir görüntü XObject'i, bir Form XObject'i (imzalama ve
  birleştirme araçları özgün taramayı bunun içine sarar) ya da türü okunamayan
  bir XObject adlandırıyor, içerik akışında satır içi görüntü işleci (`BI`)
  var ya da içerik akışının kendisi okunamıyor. Önceden yalnız doğrudan görüntü
  XObject'i sayılıyordu; Form içine sarılmış ya da satır içi çizilmiş bir tarama
  e-imza satırıyla `EXTRACTED` kalıyordu.
- Form XObject'inin `/Matrix`, `/Subtype` ve `/Resources` değerleri dolaylı
  başvuru (`4 0 R`) olabilir (PDF'te geçerli); bunlar ölçmeden önce çözülür.
  Önceden dolaylı bir `/Matrix` ölçümü düşürüyor ve sayfa tarama sayılmıyordu.
- Görüntü kaynağı bozuk olan sayfa (var olmayan bir nesneye başvuru, sözlük
  olmayan bir kayıt) yüklemeyi **düşürmez**: hiçbir görüntüleyicinin
  çizemeyeceği bir kayıt görüntü sayılmaz, sayfa metin katmanıyla okunur.
  Bu düzeltmeden önce böyle bir PDF 500 `INTAKE_FAILED` veriyor ve
  `intake.cli --dir` bütün toplu yüklemeyi durduruyordu.
- **Bilinen sınır:** üst üste binen görüntüler toplamı şişirebilir (1'e
  kırpılır); aynı küçük görseli sayfaya çok kez döşeyen, 400 karakterden kısa
  metinli bir sayfa "olası tarama" sayılabilir — bu yanlışlık okunmamış sayfayı
  okunmuş saymak yönünde değildir.

### Düşük güvenle ya da çok az okunan OCR sayfaları (R2-33)

OCR'ın güveni 0,60'ın altındaysa (`LOW_CONFIDENCE`), OCR'ın sayfaya kattığı
metin 50 karakterden kısaysa ya da (R2-32) OCR satırları metin katmanına çok
benzediği için eklenmediyse sayfa `SPARSE` kaydedilir: okunmuş sayılır, tamamı
okunmuş sayılmaz. Önceden bu karar yalnız sayfa kaydında kalıyordu;
`pages` alanında `emptyPages: []` ve `ocrPages` görünüyor, dosya sayfası
"Belgenin bütün sayfalarının yazısı görüntüden metne çevrildi", dosya kartı
"bu sayfalar aramada çıkar" diyordu. Silik ya da el yazısı bir taramada yalnız
"T.C. ANKARA" okunduysa avukat aramada sonuç çıkmamasını "belgede geçmiyor"
sanabilirdi.

Şimdi böyle bir sayfa:

- hem `ocrPages`'te hem `sparsePages`'te listelenir;
- belge uyarılarına `OCR_LOW_CONFIDENCE_PAGES:<n>` kodu ve "… sayfada yerel
  OCR'ın okuması eksik ya da belirsiz kaldı (sayfa …): <neden>. Bu sayfaların
  tamamının okunduğu doğrulanmadı ve bu sayfalarda aramanın sonuç vermemesi,
  aranan ifadenin orada geçmediğini göstermez" cümlesi eklenir. Neden sayfa
  grubuna göre yazılır: düşük güven, yalnız birkaç karakter ya da kısa metin
  katmanının ötesinde yalnız birkaç karakter; eklenmeyen satırlar için ayrıca
  `OCR_WITHHELD_LINES_PAGES:<n>` ve kendi cümlesi gelir;
- konsolda "aramada çıkar" denmez; dosya kartında "seyrek metin uyarısı" ve
  "N sayfa görüntüden okundu (yerel OCR) · M tanesi yalnız kısmen" görünür;
  kartın cümlesi "görüntüden yalnız kısmen okunabildi" der ve olası nedenlerin
  hepsini sayar (sayfa listesi nedeni taşımaz; cümle tek bir neden uydurmaz,
  nedeni belge sayfasındaki uyarı söyler); "Okunabilirlik" satırı "bu
  sayfaların tamamı okunmuş sayılmaz" der; bulut OCR önerisi bu sayfalar için
  de çıkar.

Bu düzeltmeden önce yüklenen belgelerin `pages` alanı eski biçimdedir;
"Analizi yenile" ya da aşağıdaki yeniden değerlendirme onu günceller.

### Eski belgelerin sayfa durumları (R2-34)

Sayfa durumunu değiştiren bir düzeltme (W21 #25, R2-32, R2-33) çoğu zaman
kanonik metnin tek bir karakterini değiştirmez. Önceden aynı belge yeniden
yüklendiğinde ya da "Analizi yenile"ye basıldığında ardışık düzen sürümü
içerik özetinden bulup "değişmedi" diyor, yalnız belge üst verisindeki
`page_stats` ve uyarıları güncelliyordu: dosya sayfası "seyrek" derken dosya
incelemesinin okuduğu `legal.document_version_segments` satırları `EXTRACTED`
kalıyor, inceleme dosyayı yine "tamamı okundu" sayabiliyordu.

Şimdi:

- Aynı metnin yeniden okunmasında (`intake/ingest.py::refresh_derived_fields`)
  sayfa satırlarının `extraction_method` / `extraction_status` / `confidence`
  değerleri, üst veriyle **aynı işlemde** yeni okumaya eşitlenir
  (`ingestion/segments.py::resync_segments`). Önce her satırın sayfa numarası,
  etiketi ve karakter aralığı yeni haritayla karşılaştırılır; biri tutmazsa
  hiçbir satır değiştirilmez ve belgeye "Sayfaların okunma durumu yeniden
  değerlendirilemedi …" uyarısı yazılır. Sayfa haritası hiç olmayan sürüme
  harita eklenir. Yeniden yükleme cevabı değişikliği söyler: "N sayfanın okunma
  durumu bu okumaya göre güncellendi; M sayfa artık tamamı okunmuş sayılmıyor".
- Kimsenin dokunmadığı belgeler için:
  `python -m scripts.backfill_locators --dsn <dsn> --reclassify [--no-ocr] [--apply]`.
  Her güncel yükleme sürümünün aslı yeniden okunur (önce bu makinenin yerel
  OCR'ıyla, metin tutmazsa OCR'sız; `--no-ocr` doğrudan OCR'sız). Yalnız
  saklanan kanonik metni **bayt bayt** veren okuma sayfa durumlarını ve üst
  veriyi yerinde günceller; yeni sürüm oluşmaz. Metni üretemeyen belge
  `needsReanalysis` altında listelenir (sayfaları ancak yeni bir sürümle
  yeniden değerlendirilebilir: "Analizi yenile" ya da `--reanalyze`).
  `--apply` olmadan her şey bir işlem içinde yapılır ve geri alınır.

### Sayfa istatistikleri OCR'dan SONRA hesaplanır

`pages` alanı (yükleme cevabı, `GET /v1/files`, `GET /v1/files/{id}`):

| Alan | Anlamı |
|---|---|
| `emptyPages` | Ne metin katmanının ne yerel OCR'ın okuyabildiği sayfalar. W21'den önce OCR'ın okuduğu sayfalar da burada kalıyor ve dosya sayfasında "aramada çıkmaz, alıntı yapılamaz" deniyordu. |
| `sparsePages` | Kısmen okunan sayfalar: çok kısa metin katmanı, yalnız kısa metin katmanı okunmuş görüntü sayfası, (R2-33) yerel OCR'ın düşük güvenle veya çok az okuduğu sayfa ya da (R2-32) OCR satırları metin katmanına çok benzediği için eklenmeyen sayfa. |
| `ocrPages` (W21, ek alan) | Yerel OCR'ın okuduğu sayfalar. Bu sayfalar aranır ve alıntılanır; alıntılar belgenin aslıyla karşılaştırılmalıdır. `sparsePages`'te de olan bir OCR sayfası yalnız kısmen okunmuştur: orada aramanın sonuç vermemesi bir şey kanıtlamaz. |
| `pagesWithText` | `pageCount` eksi `emptyPages`. |

`extraction.ocr` yalnız `ocrPages` doluysa ya da uyarılarda `OCR_PAGES:<n>`
(n ≥ 1) varsa `true` olur; hiçbir zaman varsayılmaz.

### Süre bütçesi

Yükleme süreci `INTAKE_EXEC_TIMEOUT_MS` = 180 sn'de kesilir. W21'den önce OCR'ın
toplam süresi yoktu ve sayfa başına 120 sn hem `pdftoppm`'e hem `tesseract`'a
ayrı ayrı verildiği için tek sayfa 240 sn sürebiliyordu.

| Sabit (`intake/ocr.py`) | Değer | Anlamı |
|---|---|---|
| `OCR_TOTAL_BUDGET_S` | 90 | Bir dosyanın bütün OCR'ı; kalan süre metin çıkarma, parçalama ve dizinleme içindir. |
| `PAGE_TIMEOUT_S` | 120 | Bir sayfada görüntüye çevirme **ve** okuma birlikte; dosya bütçesinden kalandan fazla olamaz. |
| `OCR_MIN_PAGE_S` | 5 | Bundan az süre kaldıysa sayfa hiç başlatılmaz. |

Süreye yetişmeyen sayfalar okunmamış sayılır: `OCR_BUDGET_EXCEEDED:<n>` ve
"… sayfaya yerel OCR, belge başına süre sınırı (90 sn) dolduğu için
uygulanmadı" cümlesi. POSIX'te (Mac) süreç `SIGTERM` alırsa çalışan
`pdftoppm`/`tesseract` alt süreci de sonlandırılır; Windows'ta bu koruma yoktur,
yalnız süre bütçesi vardır. Gerçek sayfa başına süre hiçbir makinede
**ölçülmedi**; kaç sayfanın 90 sn'ye sığdığı bilinmiyor.

### Makine kodları

Konsol Türkçe cümleyi değil **kodu** okur; cümle her zaman kodun yanında gelir.

| Kod | Nerede | Anlamı |
|---|---|---|
| `SCANNED_PDF_NO_OCR` | 422 `EXTRACTION_FAILED` `error.warnings` | Hiçbir sayfa okunamadı; bu bilgisayarda yerel OCR yok ya da kapalı. |
| `SCANNED_PDF_OCR_FAILED` | 422 `error.warnings` | Yerel OCR denendi ama hiçbir sayfayı okuyamadı ya da süresi yetmedi (o zaman `OCR_BUDGET_EXCEEDED:<n>` de gelir). |
| `SCANNED_PDF_OCR_NOT_APPLIED` | 422 `error.warnings` | Sayfalarda yalnız birkaç karakterlik metin katmanı var (ör. sayfa numarası); OCR uygulanmadı, içerik okunmadı. |
| `SCANNED_PAGES:<n>` | belge uyarıları | n sayfa hiç okunamadı. |
| `OCR_PAGES:<n>` | belge uyarıları | n sayfa yerel OCR ile okundu. |
| `OCR_FAILED_PAGES:<n>` | belge uyarıları / 422 | OCR n sayfada denendi, okuyamadı. |
| `OCR_BUDGET_EXCEEDED:<n>` | belge uyarıları / 422 | n sayfaya süre yetmediği için OCR uygulanmadı. |
| `IMAGE_TEXT_PAGES:<n>` | belge uyarıları | n görüntü sayfasından yalnız kısa metin katmanı okundu; görüntüde başka yazı olup olmadığı doğrulanamadı (OCR metin katmanının ötesinde bir şey bulmadıysa da). |
| `OCR_LOW_CONFIDENCE_PAGES:<n>` | belge uyarıları | n sayfada yerel OCR'ın okuması eksik ya da belirsiz kaldı: düşük güven, yalnız birkaç karakter ya da kısa metin katmanının ötesinde yalnız birkaç karakter (R2-33); bu sayfalar `sparsePages`'tedir. |
| `OCR_WITHHELD_LINES_PAGES:<n>` | belge uyarıları | n sayfada OCR'ın bazı satırları metin katmanındaki bir değere çok benzediği için metne eklenmedi (R2-32); cümle eklenmeyen satırları gösterir; bu sayfalar `sparsePages`'tedir. |

`POST /v1/files` 422 `EXTRACTION_FAILED` cevabı `error.warnings`'i **her zaman**
bir dizi olarak taşır (başka neden yoksa boş dizi).
