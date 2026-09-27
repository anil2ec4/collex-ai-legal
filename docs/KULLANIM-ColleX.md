# ColleX — Kullanım Kılavuzu (avukat için)

Sürüm tarihi: 10.09.2026. Bu kılavuz ColleX'i her gün kullanacak avukat için
yazıldı. Ekranda gördüğünüz her yazı burada da aynen geçer; ekran adları
**kalın** yazılmıştır. Bilgisayar terimi kullanmadık — kullanmak zorunda
kaldığımız yerde kelimeyi hemen orada tek cümleyle açıkladık.

Önce üç cümle:

1. **ColleX bu bilgisayarda çalışır.** Dava dosyalarınız, belgeleriniz,
   sorularınız ve taslaklarınız bu bilgisayarda kalır. İki istisna vardır ve
   ikisini de siz açarsınız: **canlı araştırma** (sorunuzdan çıkan arama
   sözcükleri resmî kaynakların sitelerine gider) ve **bulut yapay zekâ**
   (yalnız o istek için ilgili belge metni dışarıdaki bir servise gider).
2. **ColleX dayanağını gösteremediği bir soruya cevap yazmaz.** Bulamazsa
   "**Dayanak bulunamadı**" der. Dilekçe taslağında ise dayanağı olmayan
   paragrafı siler değil — **KAYNAKSIZ** diye işaretler ve önünüze koyar.
3. **Son kontrol her zaman sizindir.** ColleX yüzde vermez, garanti vermez,
   davanın sonucunu tahmin etmez. Ekrandaki her sonuç bunu ayrıca yazar.

---

## İçindekiler

| # | Bölüm | Ne anlatır |
|---|---|---|
| 1 | [Başlangıç](#1-başlangıç) | ColleX'i açmak, kapatmak, ilk açılış kartı |
| 2 | [İlk on dakika — örnek bir dosya](#2-ilk-on-dakika--örnek-bir-dosya) | Baştan sona tek bir iş: dosya aç, belge yükle, sor, taslak üret |
| 3 | [Uygulamanın içindeki iki yardım ekranı](#3-uygulamanın-içindeki-iki-yardım-ekranı-nasıl-çalışır-ve-sözlük) | "Nasıl çalışır?" ve "Sözlük" ekranları, "?" düğmesi |
| 4 | [Dosyalarım](#4-dosyalarım) | Dava dosyaları, aktif dosya, süre paneli |
| 5 | [Belgeler](#5-belgeler) | Belge yükleme, belgeye soru sorma |
| 6 | [Araştır](#6-araştır) | Soru sormak ve cevabı okumak |
| 7 | [Taslak](#7-taslak) | Dilekçe ve sözleşme taslağı üretmek |
| 8 | [Süreler](#8-süreler) | Süre hesabı ve doğrulama damgaları |
| 9 | [Hazır işler](#9-hazır-işler-cevabın-altındaki-katlı-bölüm) | Karar arama, atıf denetimi, harç, takvim ve diğerleri |
| 10 | [Yedekleme](#10-yedekleme-ve-geri-yükleme) | Yedek almak ve geri yüklemek |
| 11 | [Ayarlar](#11-ayarlar) | Kendiniz, tercihler, verilerinizin yeri, sistem durumu |
| 12 | [Sorun giderme](#12-sorun-giderme) | Bir şey çalışmadığında ne yapmalı |
| 13 | [Sınırlar ve dürüstlük](#13-sınırlar-ve-dürüstlük) | Nelerin sınandığı, nelerin sınanmadığı |
| 14 | [Henüz ekranda olmayan işler](#14-henüz-ekranda-olmayan-işler) | Üzerinde çalışılanların kısa listesi |
| 15 | [Sözlük](#15-sözlük) | Ekrandaki her terimin tek cümlelik karşılığı |

**En çok sorulan altı soru, doğrudan bağlantısıyla:**
[Cevabım neden "Dayanak bulunamadı" çıktı?](#dayanak-bulunamadı-çıktığında-ne-yapılır) ·
[KAYNAKSIZ ne demek?](#kaynaksız-ne-demek) ·
[Bu süre doğru mu?](#8-süreler) ·
[Alıntının belgede gerçekten durduğunu nasıl görürüm?](#bir-cevabı-nasıl-denetlersiniz) ·
[Verilerim nerede duruyor?](#11-ayarlar) ·
[Bir şey çalışmıyor](#12-sorun-giderme)

---

## 1. Başlangıç

*Bu bölüm ColleX'i açmayı, kapatmayı ve ilk açılışta karşınıza çıkan kartı
anlatır.*

### Beş dakikalık hızlı başlangıç

İlk denemede şu sırayı izleyin:

1. Masaüstündeki **ColleX** simgesine çift tıklayın. Simge yoksa proje
   klasöründeki `ColleX-Baslat.cmd` dosyasını çift tıklayın.
2. Siyah **ColleX Sunucu** penceresini açık bırakın. Tarayıcı kendiliğinden
   açılmazsa adres çubuğuna `http://127.0.0.1:8787/` yazın.
3. **Ayarlar** › **Kendim** bölümünde ad, unvan ve baro bilgilerinizi kaydedin.
4. **Dosyalarım** › **+ Yeni dosya** ile çalışacağınız dosyayı açın ve aktif
   dosya olarak seçin.
5. **Belgeler** sekmesinden PDF, DOCX, TXT veya UDF belgesini yükleyin.
   Belge kartı hazır olduğunda aynı dosya içinde **Araştır** ekranından soru
   sorabilir, **Taslak** ekranından dilekçe üretebilirsiniz.

İnceleme ekranındaki **DOCX indir** düğmesi sözleşme inceleme raporunu Word
belgesi olarak indirir. Taslak ekranındaki indirme seçenekleri taslağı `DOCX`,
`MD` veya uygun olduğunda `UDF` olarak verir. İşi bitirince masaüstü
**ColleX'i Durdur** simgesine çift tıklayın.

### Açmak

Masaüstündeki **ColleX** simgesine **çift tıklayın** (bu simge, ColleX
klasöründeki `ColleX-Baslat.cmd` dosyasının kısayoludur). Sırayla şunlar
olur: kendi kayıtlarınız açılır, bir siyah pencere ("ColleX Sunucu") açılır,
en fazla bir dakika sonra tarayıcınız ColleX'i gösterir.

- Siyah pencereyi **kapatmayın**; ColleX o pencere açık olduğu sürece
  çalışır. Küçültebilirsiniz.
- ColleX zaten açıksa çift tıklamak yalnız tarayıcıyı açar.
- Kendi kayıtlarınıza ulaşılamazsa ColleX **bilerek durur** ve ekranı hiç
  açmaz: pencerede Türkçe bir satır ve bakılacak günlük dosyasının yolu
  yazar. Bir tuşa basınca pencere kapanır; sorunu giderip yeniden çift
  tıklayın (bkz. [Sorun giderme](#12-sorun-giderme)).

### Kapatmak

Masaüstündeki **ColleX'i Durdur** simgesine çift tıklayın (`ColleX-Durdur.cmd`).
Siyah pencereyi elle kapatmak yerine bunu kullanın: durdurucu önce
**nazikçe** durmasını ister ve son kaydettiğiniz taslağın diske yazılmasını
bekler. Yalnız ColleX'in kendi pencerelerini kapatır; aynı bilgisayarda açık
başka bir programa dokunmaz.

### İlk açılış

İlk açılışta bir **karşılama kartı** görürsünüz. Kartta sırayla şunlar
vardır:

- Başlık: **"ColleX — her cümlenin altında dayanağı yazar"**.
- Tek paragraflık giriş: sorunuzu sorarsınız, ColleX bu bilgisayardaki
  **hukuk kütüphanesinde** ve sizin yüklediğiniz belgelerde arar, her
  tespitin yanına o tespitin hangi belgenin hangi satırından geldiğini koyar.
- **"Başlamak için üç adım"** — yaptıkça yanına ✓ gelen canlı bir liste:
  1. Adınızı ve baro bilgilerinizi yazın (dilekçelerin altına bunlar geçer) → **Ayarlar**
  2. İlk dava dosyanızı açın (bundan sonra her şey o dosyaya bağlanır) → **+ Yeni dosya**
  3. Bir belge yükleyin ya da ilk sorunuzu sorun → **Belgeler**
- Bir dürüstlük paragrafı: ColleX yüzde vermez, garanti vermez, davanın
  sonucunu tahmin etmez; dayanağını gösteremediği yeri boş bırakmaz,
  KAYNAKSIZ diye işaretler.
- Bir **sistem satırı**: o an neyin açık neyin kapalı olduğunu tek cümlede
  yazar — örneğin *"Şu an: kendi kayıtlarınız açık · hukuk kütüphanesi 12.480
  belge · canlı araştırma kapalı · bulut yapay zekâ kapalı."*
- İki düğme: **Başlayalım** · **Önce nasıl çalıştığını okuyayım**.

Kart, ilk iki adımı tamamladığınızda kendiliğinden kalkar. Geri getirmek
isterseniz üst çubuktaki **?** düğmesi › **Karşılama kartını yeniden göster**.

### Üst çubuk

Soldan sağa: ColleX işareti · **aktif dosya seçici** · **Kendi kayıtlarım** ·
**Canlı araştırma** · **Bulut yapay zekâ** · **?** · **◐ Tema**.

Ortadaki üç küçük rozet ColleX'in üç ayağını gösterir. Yeşil = çalışıyor,
gri = kapalı, kırmızı = sorun. Normal kullanımda "Kendi kayıtlarım" ve
"Canlı araştırma" yeşil, "Bulut yapay zekâ" gri olur (bulut yapay zekâ siz
açmadıkça kapalıdır). Bir rozet kırmızıysa ne yapmanız gerektiği rozete
dokununca tek cümleyle yazar.

Ekranda **DENEME BELGELERİ (gerçek mevzuat değil)** yazan bir uyarı
görürseniz: bu kurulumda hukuk kütüphanesinin yerinde deneme amacıyla
üretilmiş metinler var. Çıkan hiçbir sonuç gerçek hukukî değerlendirme
değildir; dilekçede kullanmayın. Günlük kurulumda bu uyarı görünmez.

---

## 2. İlk on dakika — örnek bir dosya

*Bu bölüm, ürünü hiç görmemiş biri için baştan sona tek bir işi anlatır:
dosya açmak, belge yüklemek, soru sormak, süre hesaplamak ve taslak üretmek.*

Örnek: **kira sözleşmesine dayalı bir tahliye işi**.

1. **Kendinizi tanıtın.** **Ayarlar** › **Kendim** kartına ad, unvan, baro,
   baro sicil no ve adres yazıp kaydedin. Bunlar dilekçe taslaklarının vekil
   bloğuna kendiliğinden geçer.
2. **Dosyayı açın.** **Dosyalarım** › **+ Yeni dosya** → başlık
   ("Yılmaz / Kira tahliye"), müvekkil, karşı taraf, mahkeme, esas no.
   Kaydedince dosya açılır ve **aktif dosya** olur — bundan sonra
   yaptığınız her iş kendiliğinden bu dosyaya bağlanır.
3. **Belgeyi yükleyin.** **Belgeler** sekmesine kira sözleşmesini sürükleyin.
   Yükleme bitince belgenin kartı listede görünür; kartın altında ColleX'in
   metinde bulduğu atıflar, tarihler ve talep cümleleri ayrı bir kartta
   listelenir.
4. **Belgeye sorun.** Belge kartında **Belgeye sor** deyin, sağdaki kutuya
   sorunuzu yazın ("Tahliye taahhüdü hangi tarihte imzalanmış ve hangi tarih
   için verilmiş?") ve **Ctrl+Enter** basın. Cevabın dayandığı bölümler solda
   sarıyla vurgulanır.
5. **Cevabı okuyun.** En üstteki büyük cümle bu cevabı kullanıp
   kullanamayacağınızı söyler. Altındaki her tespitin altında dayandığı
   **alıntı** durur. Alıntının başlığına tıklayın: belgenin tam o yeri açılır.
   Gözünüzle görmediğiniz bir cümleyi kullanmayın.
6. **Süreyi hesaplayın.** Belge sayfasında bir tarihin yanındaki **Süre
   başlat** düğmesi süre hesabını o tarihle açar. Kuralı seçin, sonuç günü
   ve hesap adımları çıkar. **Dosyaya kaydet** deyince süre dosyanızın
   **Süreler** sekmesine ve **Dosyalarım**'daki panele girer.
7. **Taslağı üretin.** **Taslak** sekmesi › şablon seçin (örneğin *Cevap
   dilekçesi*) → form alanlarını doldurun → **Kanıt kaynağı** olarak
   **Son araştırma**'yı işaretleyin → **Taslağı oluştur**.
8. **Taslağı bitirin.** Editörde **KAYNAKSIZ: n** sayacına bakın: bu
   paragrafların dayanağı yok, onları ya tamamlayın ya çıkarın. **Kaydet**
   (Ctrl+S) her seferinde yeni bir sürüm üretir. **DOCX** ile Word dosyasını
   indirin.

Bu sekiz adım ColleX'in tamamıdır; kalan bölümler bu adımların ayrıntısıdır.

---

## 3. Uygulamanın içindeki iki yardım ekranı: "Nasıl çalışır?" ve "Sözlük"

*Bu bölüm, ekranda anlamadığınız bir kelimeye rastladığınızda nereye
bakacağınızı anlatır. Bu kılavuzu açmak zorunda değilsiniz: aynı anlatım
uygulamanın içindedir.*

### "?" düğmesi — tek kapı

Üst çubukta, **◐ Tema**'nın hemen solunda kalıcı bir **?** düğmesi vardır ve
her ekranda durur. Basınca sekmelerin hemen altında kısa bir liste açılır:

- **Nasıl çalışır?**
- **Sözlük**
- **Neyi tarıyoruz?**
- **Verilerim nerede?**
- (ince ayraçtan sonra) **Karşılama kartını yeniden göster**

Kural şudur: **hiçbir açıklama kendiliğinden açılmaz.** Kapattığınız bir
açıklama kapalı kalır, ekran onu size ikinci kez dayatmaz. Geri getirmenin
tek yolu bu **?** düğmesidir. Bu yüzden düğmeyi kapatmaktan çekinmeyin —
kaybolmaz.

### Satır içindeki küçük "?" düğmeleri

Ekranda uyarı taşıyan her etiketin yanında küçük yuvarlak bir **?** vardır:
durum rozeti (TAM / ŞERHLİ / KISMİ / DAYANAK BULUNAMADI), **KAYNAKSIZ**
rozeti, **K-1** gibi kaynak numaraları, yürürlük rozetleri, **DOĞRULANMADI**
damgası, "deneysel" etiketi, aktif dosya seçici ve parmak izi satırı.

Bastığınızda **aynı kartın içinde, o satırın hemen altında** dört satırı
geçmeyen küçük bir tanım kartı açılır: terimin adı, tek cümlelik karşılığı,
gerekiyorsa "neden önemli" satırı ve iki bağlantı — **Sözlükte aç** ve
**Kapat**. Kart yüzen bir balon değildir; sayfayı kaydırmaz, bastığınız
düğme yerinde kalır. Aynı anda tek kart açık olur, **Esc** kapatır.

### "Nasıl çalışır?" ekranı

**?** › **Nasıl çalışır?** ile açılır. Ayrıca **Ayarlar**'ın en üstündeki
**Nasıl çalışır?** kartında **Anlatımı aç** düğmesi vardır. Beş dakikada
okunur ve sekiz bölümdür:

1. **Tek cümlede** — ColleX'in ne yaptığı, çerçeveli tek paragraf.
2. **Bir sorunun yolculuğu** — dört adım: sorunuz → arama → alıntı → cevap.
3. **Cevabın üstündeki etiket ne demek?** — TAM, ŞERHLİ, KISMİ, DAYANAK
   BULUNAMADI (ÇEKİMSER) ve bunlardan ayrı bir eksen olan
   KESİNLEŞTİRİLEMEZ.
4. **Bu bir doğruluk garantisi değildir** — ürünün tek açık inkâr cümlesi,
   ekranda kalıcı olarak durur.
5. **ColleX ne yapmaz** — yüzde vermez, "hatasız" demez, davanın sonucunu
   tahmin etmez, UYAP ile eşitlenmez, sizin yerinize karar vermez.
6. **Bir cevabı nasıl denetlersiniz?** — dört adım (aşağıda ayrıca yazılı).
7. **Verileriniz nerede duruyor?** — makinede kalan ve makineden çıkan
   şeyler.
8. **Sık sorulan beş soru** — katlanmış cevaplarla.

Ekranın altında iki bağlantı vardır: **Sözlüğü aç** ve **Karşılama ekranını
yeniden göster**.

### "Sözlük" ekranı

**?** › **Sözlük** ile ya da herhangi bir satır içi tanım kartındaki
**Sözlükte aç** ile açılır. Ayarlar'daki **Nasıl çalışır?** kartında da
**Sözlük** düğmesi vardır.

Ekranın en üstünde bir arama kutusu vardır: **"Sözlükte ara — terim ya da
kelime"**. Yazdıkça liste süzülür. Altında alfabetik tek sütun hâlinde
maddeler durur; her maddede kalın başlık (ekranda **gördüğünüz** kelime,
bilgisayar terimi değil), tek cümlelik tanım, gerekiyorsa "neden önemli" ve
"nerede görürsünüz" satırları, gerekiyorsa sonda parantez içinde teknik adı
bulunur.

Aradığınız kelime yoksa ekran şunu der: *"Bu kelime sözlükte yok.
Aradığınız şey bir ekranda geçiyorsa yanındaki ? düğmesine basın."*

Sözlükteki tanımların tamamı bu kılavuzun [15. bölümünde](#15-sözlük) de
yazılıdır; ikisi aynı metindir.

---

## 4. Dosyalarım

*Bu bölüm, işlerinizi dava dosyası hâlinde toplamayı anlatır.*

Burası masanızdır. Her dava, danışmanlık, sözleşme veya icra işi bir
**dosya**dır.

### Dosya açmak

**+ Yeni dosya** → başlık (örn. "Yılmaz / Kira tahliye"), müvekkil, karşı
taraf, mahkeme, esas no, tür (dava / danışmanlık / sözleşme / icra / diğer).
Kaydedince dosya açılır ve **kendiliğinden aktif dosya olur**.

### Aktif dosya

Üst çubukta hangi dosyada çalıştığınız yazar. Aktif dosya seçiliyken
yüklediğiniz belge, sorduğunuz soru, ürettiğiniz taslak ve hesapladığınız
süre **kendiliğinden o dosyaya bağlanır**. Dosyayı üst çubuktan
değiştirebilirsiniz. Başka bir tarayıcı sekmesinde dosyayı değiştirirseniz
bu sekme "Aktif dosya başka sekmede değişti" der.

Hiçbir dosya seçili değilse soru kutusunun altında tek satır uyarı çıkar:
*"Bir dava dosyası seçili değil — bu cevap hiçbir dosyaya kaydedilmeyecek.
Bağlamak için üst çubuktan bir dosya seçin."*

### Dosya sayfası

Listede bir dosyaya tıklayınca dosya sayfası açılır: başlık, taraf çipleri,
mahkeme ve esas no, durum (**Açık / Beklemede / Kapalı**), hızlı işlemler
(**Belge yükle**, **Bu dosyada araştır**, **Taslak oluştur**, **Not ekle**,
**Süre ekle**, **Dosyayı sil**) ve altı sekme:

| Sekme | İçinde ne var |
|---|---|
| **Belgeler** | Bu dosyaya bağlı belgeler |
| **Araştırmalar** | Bu dosyada sorulan sorular ve cevapları |
| **Taslaklar** | Bu dosyanın dilekçe/sözleşme taslakları ve sürümleri |
| **Zaman çizelgesi** | Olaylar; belgeden çıkarılanlar "belgeden sezgisel çıkarım — UYAP'tan doğrulayın" notu taşır, siz **Doğrulandı işaretle** deyince yeşile döner |
| **Süreler** | Hesaplanan süreler, kalan gün, "tamamlandı" anahtarı |
| **Notlar** | Serbest notlar |

Ekrandaki "Bu çalışma alanı bu bilgisayardadır; UYAP ile eşitlenmez" satırı
doğrudur: ColleX UYAP'a bağlanmaz.

**Dosyayı sil** dosyayı ve kayıtlarını siler; taslaklar silinmez, "dosyasız"
kalır ve **Taslak › Kayıtlı taslaklar**'dan açılabilir. Bir belgeyi silmeden
önce neyin öksüz kalacağını görürsünüz.

İki küçük kural: dosyaya bağlanmış bir belge, cevap ya da taslak kaydının
**hangi belgeye/cevaba/taslağa ait olduğu sonradan değiştirilemez** — yanlış
kaydı **Dosyadan çıkar** deyip doğrusunu yeniden ekleyin (not kayıtları
serbestçe düzenlenir). Bir not veya olay kaydının metni **64 KB**'ı aşamaz;
uzun metinleri belge olarak yükleyin (ekran "Dosya kaydı çok büyük…" der).

### Süreler paneli

**Dosyalarım**'ın üstündeki **"Yaklaşan ve geciken süreler"** paneli bütün
dosyalardaki süreleri gösterir; gecikenler ve önümüzdeki 14 gün ayrı ayrı
sayılır: 7 güne kadar **kırmızı**, 14 güne kadar **turuncu**, geçmişse
**GECİKMİŞ**. Panelde ayrıca **Takvimi aç** düğmesi vardır. Geçmiş bir tarih
"sıradaki süre" diye gösterilmez.

---

## 5. Belgeler

*Bu bölüm, kendi belgelerinizi ColleX'e vermeyi ve onlara soru sormayı
anlatır.*

### Yükleme

**Belgeler** sekmesine dosyayı sürükleyin ya da seçin. Kabul edilen türler:
Word (DOCX), PDF, düz metin (TXT), UYAP belgesi (UDF). Üst sınır **25 MB**
(daha büyüğünü bölün). Birden çok belge seçerseniz "3/7 yükleniyor" gibi bir
sayaç görürsünüz. Aktif dosya varsa belge ona bağlanır ve yükleme alanında
hangi dosyaya bağlanacağı yazılı durur; aktif dosya yoksa sonradan **Dosyaya
ekle** ile bağlarsınız (**Dosyadan çıkar** geri alır).

Bir klasörü olduğu gibi de verebilirsiniz: ColleX klasörü **alt klasörleriyle
birlikte** tarar, `.pdf/.docx/.txt/.udf` dışındaki dosyaları hata saymaz,
**atlar** (UYAP indirmeleri yan dosyalarla doludur; onlara "hata" demek üç
gerçek sorunu gürültüye gömer). Bir dosya başarısız olursa **adıyla ve
nedeniyle** raporlanır ve partiyi düşürmez. Tek seferde en fazla **200
dosya**.

Her dosya, tek tek yüklediğinizde geçtiği aynı kontrollerden geçer: boyut
sınırı, dosya türü kontrolü, zararlı olabilecek dosyaların ayıklanması ve
**600 sayfa** üst sınırı. 3.000 sayfalık bir tarama bekletmeden, bir
saniyeden kısa sürede "bu belge N sayfa; en fazla 600 sayfa işlenebilir —
belgeyi bölün" der.

Yükleme sırasında görebileceğiniz satırlar:

- **"zaten yüklüydü"** rozeti: aynı belgeyi daha önce yüklemişsiniz. ColleX
  içeriği tanır, ikinci kopya oluşturmaz.
- **Taranmış sayfa uyarısı**: "10 sayfanın 9 tanesinde metin yok — …" derse
  PDF'in o sayfaları resimdir. ColleX metin okuyamadığı sayfayı hiç
  kullanmaz; sorularınızın cevabında o sayfalar yer almaz. Tamamen taranmış
  bir PDF reddedilir ("Belgeden metin çıkarılamadı.") ve **taramadan metne
  çevir** düğmesi önerilir — bu düğme yalnız bulut yapay zekâ açıkken
  çalışır. İçi boş bir dosya için "Belge boş — içeriği olan bir belge
  seçin." görürsünüz.
- Yükleme 3 dakikayı aşarsa "Belge işleme süresi aşıldı" der; dosya çok
  büyük ya da sayfa sayısı çok fazladır.
- "Belge işleme aracı beklenmedik biçimde sonlandı" derse altında bir
  **kayıt no** satırı vardır; sorun bildirirken bu numarayı verin.
- Büyük düz metinler (örneğin 3 MB'lık bir TXT) yüklenir ve soru saniyeler
  içinde cevaplanır. Kaynak metinleri 5 MB'ı aşan bir cevabın kaydına tam
  metinler yazılmaz; alıntılar ve doğrulama değerleri kayıtta kalır ve cevap
  bunu bir uyarı satırıyla söyler.

### Belge kartı

Her belgede: **Belgeye sor**, **Tam metni aç**, **Bu dosyayla araştır**,
**Taslakta kullan**, **Dosyaya ekle / Dosyadan çıkar**, **Aslını indir**,
**Sil**.

### Belgeye sor

Solda belgenin bölümleri, sağda soru kutusu. Nerede aranacağı üç seçenektir:

- **Bu belge** — yalnız bu belgenin metni.
- **Bu dosyadaki tüm belgeler** — aktif dosyaya bağlı belgelerin tamamı.
- **Bu belge + hukuk kütüphanem** — belgeye ek olarak bu bilgisayardaki
  mevzuat ve karar metinleri.

Sorunuzu yazıp **Ctrl+Enter** basın. Cevabın dayandığı bölümler solda
sarıyla vurgulanır.

Belge sayfasındaki cevap **hukukî değerlendirme değildir** ve bunu kendisi
yazar: *"Yüklediğiniz belgeden alıntılar birebir doğrulandı; bu bir hukukî
değerlendirme değildir — belge sorunuzu cevaplıyor mu, kararı siz verin."*
Başlıkta durum damgası yerine **"N pasaj bulundu"** yazar; bu bilerek
böyledir, çünkü belgede pasaj bulmak sorunun cevaplandığı anlamına gelmez.
Kendi belgeniz için yürürlük hesabı yapılmaz; ekranda "yüklediğiniz belge —
yürürlük değerlendirilemez" yazar.

Alakasız bir soru sorarsanız belgeden hiçbir pasaj alınmaz; sorunuzla ortak
sözcük taşımayan bölümler yalnız künyeleriyle listelenir.

"Bu belgeye sorulan sorular" listesi altta durur; eski cevaba tıklayınca
yeniden açılır. Silinmiş bir belgeye soru sorarsanız cevap "bu belge
sorunuzu desteklemiyor" değil, **"Belge kaydı bulunamadı; silinmiş
olabilir."** olur — ikisi çok farklı şeydir.

### Otomatik ön inceleme

Belge yüklenince ColleX metinde bulduğu kanun/karar atıflarını, tarihleri ve
talep cümlelerini ayrı bir kartta listeler. Bu bir **sezgisel** taramadır:
"karşı tarafın talebi de burada görünebilir" uyarısı bu yüzdendir.

- Atıf → **Hukuk kütüphanemde doğrula**: atfın karşılığı var mı, hangi
  tarihte yürürlükte, tek tıkla bakarsınız; **Cevabı aç** ile ayrıntı.
- Tarih → **Süre başlat** (süre hesabını o tarihle açar) ya da **Zaman
  çizelgesine ekle** (dosyanın zaman çizelgesine "doğrulanmadı" işaretiyle
  girer).
- Talep → **Taslağa talep olarak aktar**: bir sonraki taslakta talepler
  alanına hazır gelir.

---

## 6. Araştır

*Bu bölüm, ColleX'e soru sormayı ve gelen cevabı okumayı anlatır. Ürünün
kalbi burasıdır.*

### Soru kutusu

Ekranın **en üstünde** durur. Başlık: **"Neyi öğrenmek istiyorsunuz?"**,
altında tek satır açıklama: *"Cevabın her tespitinin altında dayandığı belge
ve pasaj yazar."* Sayfa açılınca imleç doğrudan bu kutudadır. Hukuk terimi
kullanmak zorunda değilsiniz; gündelik Türkçe yeter.

### Nerede arayalım?

Kutunun altında üç seçenek vardır ve her birinin altında ne yaptığı yazar:

| Seçenek | Ne yapar |
|---|---|
| **Hukuk kütüphanemde** | İnternete çıkılmaz; yalnız bu bilgisayara kurulu mevzuat ve karar metinleri taranır |
| **Yüklediğim belgelerde** | Yalnız işaretlediğiniz belgelerin metni okunur |
| **Resmî kaynaklarda** | Yargıtay, Danıştay ve Mevzuat Bilgi Sistemi gibi resmî kaynaklara bağlanılır |

**Resmî kaynaklarda** seçeneği internet ister. Bir araştırma en çok
**2 dakika** sürer ve en çok **10 belgenin** tam metnini getirir. Arama
sonuç listeleri dayanak sayılmaz; dayanak, getirilen belgenin tam metnidir.

"Yüklediğim belgelerde" seçiliyken **"hukuk kütüphanem de taransın"**
kutusunu işaretlerseniz ikisi birleşir. Kapalı bir seçenek soluk görünür ve
neden kapalı olduğunu kendi satırında düz Türkçeyle yazar.

Yanındaki **"Hangi tarihteki hukuka göre?"** alanı bugünle başlar; geçmiş
bir tarih girerseniz cevap o tarihte yürürlükte olan metne dayanır.

Sormak için **Ara ve dayanağıyla getir** mührüne basın. Altında katlanmış
bir **Ayrıntılı arama** bölümü vardır: mahkeme türü, tarih aralığı, bulut
yapay zekâ anahtarı ve ekli belgeler.

### Beklerken ne görürsünüz

Uzun süren her işte bir **ilerleme kartı** çıkar: hangi aşamada olunduğu
(yalnız gerçekten bilinen aşama yazılır), geçen süre ve bir **Vazgeç**
düğmesi. **Yüzde gösterilmez**, çünkü program "%60 bitti" gibi bir bilgi
üretmiyor ve uydurulmuş bir yüzde yazmayız.

Üç saniyeden sonra tek cümle belirir: *"Bekleme uzuyor. En uzun bekleme,
aradığınız ifadenin arşivde hiç geçmediği durumdur; böyle bir aramanın
sonucu da boş döner."* Karar aramada aynı yerde *"Resmî kaynak sunucuları
yoğun olduğunda yanıt gecikebilir; bu bekleme ColleX'te değil, kaynağın
kendi tarafındadır."* yazar.

**Vazgeç**'e bastığınızda temiz bir kart gelir: ne kadar beklendiği, sonucun
neden bilinemeyeceği ve tek tıkla geri dönüş ("Aynı soruyu yeniden sor").
Soru kutunuz ve tarihiniz olduğu gibi durur; vazgeçtiğiniz bir istek size
hata olarak gösterilmez.

Üç ayrıntı, dürüstlük gereği:

- **Yedeklemede Vazgeç yoktur**: eksik kopyalanmış bir klasör yedek
  sayılmaz. Sebebi kartın içinde yazar.
- **Canlı araştırmada Vazgeç, koşuyu değil beklemeyi durdurur.** Araştırma
  devam edebilir; bittiğinde sonucu **Kayıtlı cevaplar** listesinde
  bulursunuz. Kart bunu açıkça söyler.
- **Dışa aktarmada (DOCX/Markdown/UDF) ilerleme çubuğu yoktur**: dosyayı
  program üretir, indirmeyi tarayıcınız yürütür ve bu sayfa onun bittiğini
  göremez. Bitişini bilmediğimiz bir çubuk dönmeye devam eden bir yalan
  olurdu. Onun yerine tek satır yazılır: *"DOCX hazırlanıyor — dosya
  tarayıcınızın indirilenler listesinde belirir."*

Canlı araştırma sürerken bir ilerleme paneli adım adım ne yapıldığını yazar:
"Mevzuat aranıyor", "Yargıtay/Danıştay kararları aranıyor", "Belge çekiliyor
2/6"… Her satırın sonunda durum vardır: sürüyor / tamamlandı / kısmen
tamamlandı / başarısız / zaman aşımı / atlandı. Resmî kaynak cevap vermezse
araştırma "başarısız" biter ve nedeni Türkçe yazar; **ColleX uydurma sonuç
göstermez.**

### Cevap nasıl okunur

Cevap üç katman hâlinde gelir: **karar → dayanak → denetim**.

**1) En üstteki büyük cümle** bu cevabı kullanıp kullanamayacağınızı söyler:

| Ekrandaki cümle | Altındaki talimat |
|---|---|
| **"Her tespit bir alıntıya bağlandı."** | Alıntıları kendi gözünüzle okuyun; nihai hukukî değerlendirme sizindir. |
| **"Tespitler alıntıya bağlandı; ancak bir çekince ya da aksi yönde bir kaynak var."** | Aksi yöndeki kaynak da bu ekranda; iki tarafı karşılaştırmadan dilekçeye taşımayın. |
| **"Bazı tespitler alıntıya bağlanamadı."** | Bağlanamayan tespitler aşağıda ayrıca işaretli; o kısmı kaynağa bağlamadan kullanmayın. |
| **"Bu soruya cevap yazılmadı."** | Bkz. [Dayanak bulunamadı çıktığında](#dayanak-bulunamadı-çıktığında-ne-yapılır). |

Bu cümleler bilerek bir **getirme** ifadesidir, hüküm değildir: "dayanağı
bulundu" demek "sorunuz cevaplandı" demek değildir.

**2) Cümlenin altında küçük bir durum rozeti** vardır ve yanında **?**
taşır: **Durum: TAM** · **Durum: ŞERHLİ** · **Durum: KISMİ** · **Durum:
DAYANAK BULUNAMADI (ÇEKİMSER)**. Bu makine sözcükleri silinmedi,
küçültüldü — bir cevabı başkasına anlatırken işinize yarar.

**3) Ayrı bir satırda kesinleştirme bilgisi** durur. Bu, durumdan **ayrı bir
eksendir**; cevap TAM iken de çıkabilir:

- **"KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî
  değerlendirme avukatındır"**
- **"KESİNLEŞTİRİLEMEZ — iç kontrollerden biri sonuç veremedi; aşağıdaki
  gerekçeleri okumadan kullanmayın"**

"Teknik kontroller" şu demektir: her alıntı belgenin tam metninde tam o
yerde duruyor mu, kaynak o tarihte yürürlükte miydi, aleyhe kaynak tarandı
mı. **Hukukî isabet kontrolü değildir.**

**4) Tek satır künye**: *"3 Eylül 2026 tarihinde yürürlükte olan metne göre
değerlendirildi · 4 kaynak · 3 tespit."*

**5) Denetim dosyasını indir** — bu cevabın bütün alıntılarını, belge
sürümlerini ve parmak izlerini içeren tek dosya. Meslektaşınıza ya da
bilirkişiye verebilirsiniz; onlar bu dosyayla cevabı ColleX'e ihtiyaç
duymadan denetleyebilir.

**6) Kapsam satırları** tespitlerden **önce** görünür ve hiçbiri katlanmaz:

- *"Sorunuzun 9 anahtar sözcüğünden 2'si kaynaklarda karşılık buldu.
  Karşılık bulmayanlar: kıdem, ihbar, fesih."* — düşükse cevap sorunuzun
  yalnız bir kısmını karşılıyordur.
- *"Yalnız yüklediğiniz 3 belgede arandı; hukuk kütüphaneniz taranmadı."*
- *"Bu cevabı yapay zekâ yazmadı: cümleler kaynaklardan olduğu gibi alındı,
  sıralaması kurallarla yapıldı."* — bulut yapay zekâ açıksa bunun yerine
  *"Taslağı bulut yapay zekâ yazdı; yazdığı her cümlenin dayanağı bu
  bilgisayarda tek tek doğrulandı."* yazar.
- Bir arama şeridi düşerse bu da burada yazar; sessizce düşmez.

**7) Tespit kartları.** Her tespitin kendi kartı vardır ve **dayandığı alıntı
aynı kartın içindedir** — ayrı bir kaynaklar bölümüne gitmek zorunda
kalmazsınız. Kartta yukarıdan aşağı şunlar bulunur:

- **Hüküm çipi** ve yanında **?**: "kaynakla destekleniyor", "kaynaklar
  çelişiyor", "dayanak yetersiz", "kaynak o tarihte yürürlükte değil",
  "kaynak soruyu kısmen karşılıyor".
- **Tespit metni**.
- **Güven cümlesi.** Yüzde çubukları ana akışta gösterilmez; onun yerine o
  dayanağın **en zayıf yanı adıyla** söylenir: *"Bu dayanağın en zayıf yanı:
  Güncellik. Dilekçeye geçirmeden önce kaynağı kendiniz okuyun."* Zayıf yan
  çıkmadıysa: *"Bu dayanağın zayıf yanı çıkmadı; alıntı, belgenin kayıtlı
  nüshasıyla harfi harfine karşılaştırıldı."*
- **Sayaç satırı**: "2 kaynağa dayanıyor · aleyhe 1 kaynak".
- **Dayanak bloğu**: kaynak başlığı, mahkeme/tarih, **yürürlük rozeti**
  (mülga / güncel değil / henüz yürürlükte değil — bu rozet asla katlanmaz),
  *"Alıntı, belgenin bu bilgisayarda kayıtlı hâlinden harfi harfine
  alınmıştır; tek sözcüğü değiştirilmemiştir."* cümlesi, serif blok alıntı,
  kısa künye (E./K., mevzuat no, madde) ve **Belgeyi tam metniyle aç**.

İlk tespit açık gelir, kalanlar katlıdır. Katlı bir kartta bile şu dördü
görünür kalır: hüküm çipi, tespit metninin ilk iki satırı, güven cümlesi ve
kaynak başlığı + yürürlük rozeti. Yazdırırken her şey açılır.

**8) Aleyhe kaynak.** Aleyhinize olan kaynak gizlenmez ve ayrı bir bölüme
sürülmez: çeliştiği tespitin **hemen altında**, bordo çizgili açık bir blok
olarak durur. Başlık: **"Bu tespitin aksine karar var"**. Aleyhe tarama
sonucu cümlesi her zaman görünür kalır — cevap yazılmasa bile: *"Aleyhe
karar arandı: 6 ayrı arama yapıldı, aksi yönde karar bulunamadı. Bu, aksi
yönde karar olmadığı anlamına gelmez; yalnızca bu arşivde bulunmadığı
anlamına gelir."*

**9) Alıntının nasıl doğrulandığı.** Kaynak kartında katlanmış bir kapak
vardır: **"Bu alıntı nasıl doğrulandı?"** İçinde önce şu açıklama durur:
*"Aşağıdaki numaralar, metnin tek bir harfi değişse bile bambaşka çıkar.
Alıntının belgeden koparılmadığını böyle gösteriyoruz; bu bir noter onayı
değildir ve numara, resmî yayımlanmış metinle değil, bu bilgisayarda kayıtlı
nüsha ile eşleşmeyi gösterir."* Altında dört satır: alıntının parmak izi,
belgenin parmak izi, alıntının belgedeki yeri (kaçıncı harften kaçıncı
harfe) ve belgenin kayıtlı sürüm numarası.

Alıntı ile belgedeki metin birebir örtüşmezse ColleX bunu **söyler**:
"⚠ Alıntı aralığı bu metinle birebir örtüşmedi" ya da "⚠ Belge parmak izi
EŞLEŞMEDİ — bu metni kullanmayın". Olumlu cümle sabit basılmaz; her
seferinde gerçekten karşılaştırılır.

**10) "Bu cevabın denetim kaydı"** — sayfanın sonunda tek katlı çekmece.
İçinde dört katlı satır vardır:

- Aleyhe karar taraması (kaç arama yapıldığı ve hangi sorgularla)
- Kanıt kümesine alınmayan belgeler (sorunuzla yalnız sözcük düzeyinde
  benzeyen, dayanak sayılmayan metinler)
- Uyarılar ve doğrulama gerekçeleri (her satır Türkçe cümle; makine kodu
  cümlenin ardından soluk parantez içinde)
- Cevap nasıl üretildi (adım adım, süreleriyle)

Çekmecenin giriş cümlesi şudur: *"Aşağıdakiler cevabı okumak için gerekmez;
bu cevabı bir başkasına — hâkime, bilirkişiye, karşı vekile — karşı
savunmanız gerektiğinde gerekir."* Ama bir doğrulama sonuç veremediyse bu
cümle yazılmaz: onun yerine çekmecenin **üstünde**, katlanmayan kalın tek
satır durur: *"Bu cevabı olduğu gibi kullanmayın: aşağıdaki gerekçelerden en
az biri, cevabın bir bölümünün dayanağını zayıflatıyor."*

Uyarı satırlarında bazen soluk parantez içinde kısa İngilizce kodlar
görürsünüz. Türkçesi her zaman önce yazılır; kod yalnız destek istediğinizde
işe yarar, sizin için bir anlam taşımaz. Kararınızı Türkçe cümleye göre
verin.

### Dayanak bulunamadı çıktığında ne yapılır

En üstte şu yazar: **"Dayanak bulunamadı — bu yüzden cevap yazılmadı."** ve
altında kuralın kendisi: *"Bu bir arıza değil, ürünün kuralıdır: ColleX
dayanağını gösteremeyeceği bir cümleyi kurmaz. Ekranda tespit ve kaynak
kartı olmamasının sebebi budur."* Ekran ayrıca sınanabilir tek cümleyi de
yazar: *"Aşağıda hiçbir kaynak kartı ve hiçbir tespit yoktur."*

**Neden** satırı iki biçimde çıkar:

- *"Neden: sorunuzdaki şu sözcüklerin taranan kaynaklarda karşılığı yok —
  kira, tahliye, ihtar."* (sözcüklere tıklayınca soru kutusunda o sözcük
  seçili gelir)
- ya da *"Neden: sorunuzun sözcükleri kaynaklarda geçiyor, ancak hiçbir
  pasaj sorunun kendisine karşılık gelmiyor — yalnız benzer sözcükler
  taşıyorlar."*

Altında **"Buradan sonra dört yol var:"** başlığıyla dört düğme durur ve her
birinin altında ne yaptığı yazar:

1. **Resmî kaynaklarda ara** — resmî kaynaklara bağlanır; dışarı yalnızca
   sorunuzdan türetilen arama metni gider.
2. **Belge yükle** — sözleşmeyi, kararı ya da bilirkişi raporunu yükleyin;
   cevap doğrudan o belgenin metnine dayansın.
3. **Soruyu daralt** — kanunun adını, madde numarasını ya da kararın esas
   numarasını yazmak sonucu en çok değiştiren şeydir.
4. **Değerlendirme tarihini değiştir** — cevap, seçtiğiniz tarihte
   yürürlükte olan metne göre verilir.

Günlük kurulumda hukuk kütüphanesi **boş** gelir (deneme metinleri bilerek
yüklenmez). Bu yüzden "Hukuk kütüphanemde" seçeneğiyle sorulan sorular
"Dayanak bulunamadı" ile döner — bu doğru davranıştır, arıza değildir.
Resmî kaynaklarda arayın ya da kendi belgelerinizi yükleyin.

### Bir cevabı nasıl denetlersiniz

1. Cevabın başındaki cümleyi okuyun: bu cevabı kullanıp kullanamayacağınızı
   söyler.
2. Her tespitin altındaki alıntıyı okuyun.
3. Alıntının başlığına tıklayın: belgenin tam o yeri açılır.
4. Alıntının belgede birebir geçtiğini kendi gözünüzle görün. **Görmediğiniz
   bir cümleyi kullanmayın.**

### Geçmiş

Sekmenin altında **Son araştırmalarım** listesi durur; tıklayınca cevap
yeniden çizilir. Aktif dosyanın soruları dosya sayfasının **Araştırmalar**
sekmesindedir. Bir araştırma kaydını silebilirsiniz.

---

## 7. Taslak

*Bu bölüm, dilekçe ve sözleşme taslağı üretmeyi anlatır.*

### Şablon seçmek

**Dilekçeler** (dava dilekçesi, cevap dilekçesi, istinaf başvurusu, temyiz
dilekçesi, ihtarname, icra itiraz dilekçesi, arabuluculuk başvurusu) ve
**Sözleşmeler** (hizmet, kira, tahliye taahhütnamesi, iş, satış, vekâlet
ücreti) — toplam **on üç şablon**. Her kartta kısa açıklama ve "Zorunlu: …"
satırı vardır.

### Form

Alanlar gruplar hâlinde gelir: **Mahkeme ve dosya · Taraflar · Vekil ·
Olaylar · Talepler · Deliller · Ek bilgiler**. Ayarlar'daki bilgilerinizden
ve aktif dosyadan dolan alanlarda **"otomatik — kontrol edin"** çipi vardır.
Dosya başlığı hiçbir alana yazılmaz (başlık satırı mahkeme hitabıdır).

- Taraf satırı: ad, rol (listeden ya da "Diğer (yazın)"), TCKN/VKN tek kutu
  (11 hane TCKN, 10 hane VKN), adres, katlanır vekil bloğu.
- Olaylar: tarih + metin satırları.
- Talepler, deliller, usul itirazları: her satır ayrı madde olur.

**Kanıt kaynağı** seçin: **Son araştırma** (bu oturumda sorduğunuz son soru;
bir araştırma yaptıysanız şablonu seçtiğinizde kendiliğinden işaretli
gelir), **Dosyadaki kayıtlı araştırma**, **Seçili belgeler** (yüklediğiniz
belgeler — yalnız delil listesine "Ek-n" olarak girer ve olay önerisi
üretir, **hukukî dayanak yazmaz**) ya da kanıtsız.

ColleX kaynağı taslağa yazmadan önce bir **alaka kontrolü** yapar: şablonun
hukuk alanına uymayan (örneğin kira cevap dilekçesinde ceza kanunu maddesi)
ya da olay/talep metninizle hiç ortak sözcüğü olmayan kaynaklar HUKUKÎ
SEBEPLER'e girmez. Olay veya talep metninde açıkça andığınız bir madde ya da
karar (örneğin "TCK m. 157") her zaman kullanılır.

### Editör

**Taslağı oluştur** deyince editör açılır.

- **Üstte**: başlık, tür, **KAYNAKSIZ: n** sayacı, sürüm ve kayıt notu
  ("v2 · kaydedildi 14:02" / "kaydedilmemiş değişiklik"), düğmeler:
  **Kaydet (Ctrl+S)**, **DOCX**, **Markdown**, **UDF** (yanında "deneysel"),
  **Sürümler**, **Yeniden oluştur**.
- **Solda**: bölümler; yanındaki nokta yeşilse bölümde kaynaksız paragraf
  yok, kırmızıysa var, sarıysa aleyhe kaynak bölümüdür.
- **Ortada**: paragraflar. Her paragrafın rolü Türkçe yazar (olay, talep,
  hukukî değerlendirme, dayanak…). Metni doğrudan düzenlersiniz. Kaynağa
  bağlı paragrafın altında **[K-1]**, **[K-2]** gibi kaynak numaraları
  vardır; belgenin sonundaki "DAYANAK KAYNAKLARI" ekinde aynı numarayla
  künye ve alıntı bulunur.
  Paragraf araçları: **Alıntı ekle**, **KAYNAKSIZ olarak bırak**, **Bu
  paragrafı yaz (bulut yapay zekâ)**, Yukarı / Aşağı / Sil, bölüm sonunda
  **+ Paragraf ekle**. "EK — DOĞRULAMA BİLGİLERİ" bölümü makine tarafından
  yazılır ve düzenlenmez; bu bölüme ve "DEĞERLENDİRİLMESİ GEREKEN ALEYHE
  KAYNAKLAR" bölümüne yapay zekâ paragrafı yazılamaz.
- **Sağda**: kanıt kartları. **Dayanak olarak kullan** anahtarı kapalıysa o
  kaynak sebeplerde anılmaz. Yüklenen belgeler "Ek — yüklenen belge" çipiyle
  kilitlidir (dayanak yapılamaz). Alaka kontrolünün kenara aldığı kaynaklar
  **"Kullanılmayan kaynaklar (alakasız görünüyor)"** başlığı altında, neden
  çipiyle ("alan uyuşmuyor" / "metinle örtüşmüyor") listelenir; kararı siz
  verirsiniz: **Yine de dayanak olarak kullan** anahtarını açıp kaydedince o
  kaynak sebeplere girer. **Olay önerileri** belgeden çıkarılan tarih ve
  tutar cümleleridir; **Olaylara ekle** demezseniz kendiliğinden asla
  eklenmez.

#### KAYNAKSIZ ne demek

O paragrafın metni, taslağa bağlı belgelerin hiçbirindeki alıntıyla
örtüşmüyor demektir. Hukukî değerlendirme ve dayanak rollü paragraflarda bu
bir **uyarıdır**; olay ve talep paragraflarında normaldir, çünkü onlar sizin
beyanınızdır. Dayanağını siz eklemelisiniz. KAYNAKSIZ paragraf sayısı
belgenin içinde de yazar ve DOCX çıktısının ilk satırı her zaman "Bu taslak
makine üretimidir; avukat incelemesi zorunludur." bandıdır.

#### "Alıntıyı değiştirdiniz" uyarısı

Bu, ColleX'in en katı kuralıdır ve bir gün karşınıza çıkacaktır.

Bir paragrafı bir kaynağa bağladığınızda ColleX o paragrafın **alıntıyı
birebir içerdiğini** kaydeder. Sonradan paragrafın içindeki alıntı metnini
değiştirirseniz — bir kelime, bir rakam, tek bir harf — **bağ kopar.**
O anda iki şey olur:

1. **Kaydet** dediğinizde ilgili satır kırmızı görünür ve *"alıntı
   değiştirildi — kanıt bağı koptu"* der, hangi kaynağa ([K-1] gibi) ait
   olduğunu söyler. Paragraf **KAYNAKSIZ**'a düşer.
2. O taslağı Word, UDF ya da Markdown olarak indirmeye çalışırsanız ColleX
   **reddeder** ve hiçbir dosya yazılmaz.

**Ne yapmalısınız?** İkisinden biri:

- **Alıntıyı geri koyun.** Kaynağın metnini birebir yazın (kopyala-yapıştır
  en güvenlisi); bağ anında geri kurulur ve indirme yeniden çalışır.
- **Ya da atfı kaldırın.** Cümleyi kendi ifadenizle yazmak istiyorsanız o
  paragraftan kaynağı çıkarın. Paragraf KAYNAKSIZ olarak kalır — bu
  meşrudur, çünkü ekranda ve çıktıda öyle görünür.

Yapmamanız gereken tek şey bunu bir arıza sanıp yeniden denemektir. Ret bir
hata değil, ürünün asıl işidir.

### Kaydet ve sürümler

**Kaydet** her seferinde yeni bir sürüm oluşturur (v1, v2, …). Kayıt
başarılıysa "Taslak kaydedildi — v2"; yazılamadıysa açıkça "Taslak
kayıtlarınıza YAZILAMADI" der — o durumda DOCX indirip saklayın. Aynı taslak
başka bir sekmede kaydedilmişse "Yeni sürümü yükle" uyarısı çıkar; önce
yükleyin, sonra düzenleyin. **Sürümler** eski sürümlerin künyesini listeler
ve eski bir sürümü açabilirsiniz. Kaydedilmemiş değişiklikle sekmeden
ayrılmak isterseniz onay sorulur.

**Yeniden oluştur** formu geri getirir (değerler korunur) ve taslağı baştan
üretir; kanıt kümesi taslak başına sabittir, yeni kanıt için bu yolu
kullanın.

### Dışa aktarma

İndirilen dosyanın adı **"Belge - Dosya - vN.uzantı"** biçimindedir
(örneğin "Cevap Dilekçesi - Yılmaz Kira tahliye - v2.docx"); dosyasız bir
taslakta ortadaki parça olmaz. Belgenin içindeki tarih ve saatler
bilgisayarınızın yerel saatidir.

- **DOCX**: Word belgesi. Dışa aktarma sırasında her alıntı yeniden
  doğrulanır; tek bir alıntı tutmazsa dosya **yazılmaz** ve nedenini
  görürsünüz. Dışa aktarıcı beklenmedik biçimde durursa ekranda bir kayıt
  numarası vardır; sorun bildirirken onu verin.
- **Markdown**: düz metin sürümü.
- **UDF — deneysel**: UYAP Doküman Editörü biçimi. Bu dosya henüz UYAP'ta
  açılarak denenmedi ve imzasızdır; dosyanın içinde bu uyarı da yazar.
  UYAP'ta açın, düzgün görünüyorsa kullanın; sorun varsa DOCX kullanın.
  (UYAP yalnız `.udf`, `.pdf`, `.jpg`, `.png`, `.tiff` kabul eder; Word
  dosyası doğrudan yüklenemez.)

### Bulut yapay zekâ ile paragraf yazdırmak

**Bu paragrafı yaz (bulut yapay zekâ)**: talimat yazarsınız, hangi
kaynaklara dayanacağını işaretlersiniz, uzunluk seçersiniz ve "bu istek için
onay" kutusunu işaretlersiniz. Yazılan paragrafın her kaynağı ayrıca kontrol
edilir: paragrafın gerçekten o kaynağı anlatıp anlatmadığına bakılır;
yeterince örtüşmeyen kaynak paragrafa bağlanmaz, hiçbiri bağlanamazsa
paragraf **KAYNAKSIZ** gelir. Sonuç tablosu her kaynağın "korundu / atıldı"
kararını gösterir. Bulut yapay zekâ kapalıysa düğme nedenini yazar. Sonradan
elle düzenlerseniz bağ yeniden kontrol edilir ve çip bunu söyler.

### Kayıtlı taslaklar

Taslak sekmesinin altındaki kart son yirmi taslağı listeler ("dosyasız"
olanlar dâhil); **Aç** editörü getirir. Bir taslağı silebilirsiniz.

---

## 8. Süreler

*Bu bölüm, bir sürenin son gününü hesaplamayı ve sonucun ne kadarına
güvenebileceğinizi anlatır.*

Süre hesabını üç yerden açarsınız: **Dosyalarım › Süre ekle**, dosya
sayfasında **Süre ekle**, ya da belge sayfasında bir tarihin yanındaki
**Süre başlat**.

Pencerede: usule göre gruplu kural listesi (HMK, CMK, İYUK, İİK, AYM,
Diğer — **kırk bir kural**); hesaplanamayan dört kural (ıslah, karar
düzeltme, iş davasında arabuluculuk dava şartı, kesin süre bilgi notu)
seçilemez ama notu okunur; **özel süre** (gün/hafta/ay/yıl); başlangıç
tarihi; **adli tatil** kutusu (kurala göre önceden işaretli).

Her kuralın altında bir satır vardır: **"Bu kuralı nasıl doğrularım?"** —
hangi maddeyi açacağınızı ve neyi karşılaştıracağınızı tek cümlede söyler.

Sonuç: son gün ve gün adı büyük yazıyla; altında hesap adımları (başlangıç
günü sayılmaz, hafta sonu ve resmî tatil ileri alınır, ayın karşılığı yoksa
son gün, adli tatile denk gelirse 7 Eylül'e uzatma) ve varsa uyarılar
(elektronik tebligatta beşinci gün, tefhim/öğrenme, arife öğleden sonra,
CMK'da adli tatilin uzatmaması).

### Doğrulanmış ve doğrulanmamış kurallar

**16 kuralın madde metni resmî kaynaktan çekildi** ve kural o metinle
karşılaştırıldı; onlar **DOĞRULANDI** damgası taşır ve damganın yanında
hangi maddeye, hangi tarihte bakıldığı yazar. **Kalan 25 kural
DOĞRULANMADI.**

İki uyarı her hesapta vardır ve kaldırılamaz:

- **DOĞRULANMADI — madde metniyle kontrol edin.** Kural bu damgayı
  taşıyorsa süre değerini ilgili maddeyle **kendiniz** karşılaştırın; kartın
  altındaki "Bu kuralı nasıl doğrularım?" satırı hangi maddeye
  bakacağınızı söyler.
- **"Süre hesabı bilgi amaçlıdır; tebliğ usulü, adli tatil ve özel süreler
  avukatça kontrol edilmelidir — kaçırılan süreden ColleX sorumlu
  değildir."** Bu cümle her sonuçta, her kartta, her çıktıda ve takvime
  aktardığınız her olayın açıklamasında aynen durur.

### "Adli tatil: tartışmalı" rozeti

Yedi kuralda adli tatilin uygulanıp uygulanmayacağı tartışmalıdır. ColleX bu
kurallarda **uzatmayı uygulamaz**: size **kısa ve güvenli** tarihi verir,
rozetle "tartışmalı" olduğunu söyler ve iki tarihi birden gösterir. Kısa
tarihe göre hareket edin.

### Düzeltilmiş iki kural

Bunları saklamıyoruz, çünkü ikisi de bir süre kaçırtabilirdi:

- **İcra mahkemesi kararlarına karşı istinaf** ColleX'te "10 gün, tefhimden"
  yazıyordu. 7499 sayılı Kanun (yürürlük 01.06.2024) İİK m.363/1'den
  "tefhim veya" ibaresini çıkardı ve "on gündür"ü **"iki haftadır"** yaptı.
  Kural artık **2 hafta / tebliğden**; eski hâli de kayıtlı ve 01.06.2024
  öncesi bir başlangıç tarihi verdiğinizde uyarı çıkar.
- **Islah** için "davanın her aşamasında sadece bir kez" yazıyordu. HMK
  m.176/2 **"Aynı davada, taraflar ancak bir kez ıslah yoluna
  başvurabilir"** der. Bu iki cümle aynı şey değildir; metin düzeltildi.

**Dosyaya kaydet** deyince süre dosyanın **Süreler** sekmesine ve
Dosyalarım'daki panele girer; tamamlanınca anahtarı kapatın. Takvim
dosyasını (Outlook ya da Google Takvim'de açılan dosya) **Takvimi aç**
panelinden alırsınız.

---

## 9. Hazır işler (cevabın altındaki katlı bölüm)

*Bu bölüm, sık yapılan hazırlıkları tek tıkla çalıştıran kartları anlatır.*

**Araştır** ekranında, cevabın altında katlanmış bir **Hazır işler** bölümü
vardır: *"Sık yapılan hazırlıklar. Her biri tek tıkla çalışır; ne yaptığı
kendi satırında yazar."* Kartlar üç aile hâlindedir. Çalışamayan bir kart
silik görünür ve nedenini kendi satırında düz Türkçeyle yazar (örneğin
"Önce Belgeler'e bir belge yükleyin." ya da "Hukuk kütüphaneniz bu kurulumda
boş.").

### Belgelerimle çalış

| Kart | Ne yapar |
|---|---|
| **Belgeyi özetle** | Seçtiğiniz belgeden konu, taraflar, talepler ve tarihleri çıkarır; her cümlenin altında alıntısı durur |
| **Tarih sırası çıkar** | Belgedeki tarihleri ve her tarihe bağlı olayı, geçtiği pasajla birlikte listeler |
| **Aynı soruyu birçok belgeye sor** | Satır belge, sütun soru; her hücre kaynağına bağlı |
| **Sözleşmeyi kontrol listemle karşılaştır** | Kendi kontrol listenizle karşılaştırır; kural tabanlıdır, yorum üretmez |

**Sözleşme kontrol listesi** hakkında iki cümle raporun içinde yazılıdır:
*"Bu inceleme KURAL TABANLIDIR: metni sizin kontrol listenizle
karşılaştırır. Hukukî değerlendirme yapmaz, yorum üretmez ve yapay zekâ
kullanmaz."* ve *"'yok' satırı, aranan başlığın metinde bulunamadığını
söyler; maddenin gerekli olup olmadığına avukat karar verir."*
Ayrıca **"risk" kelimesi yalnız doğrulanmış bir alıntıya bağlı satırda
kalabilir**: kaynağı olmayan bir gözlem "⚠ KAYNAKSIZ —" ile başlar ve
içindeki "risk", "riskli", "risklerin" gibi bütün biçimlerde "risk" kökü
"gözlem"e çevrilir ("riskli" → "gözlemli"). Böylece o satır bağlamından
koparılıp okunsa bile bir risk değerlendirmesi gibi görünmez. Bir alıntı
ancak ColleX'in kendi kaydettiği bir araştırma sonucunda aynen duruyorsa
"doğrulanmış" sayılır.

Raporda "var" ya da "belirsiz" çıkan her satırın altında, sözleşmenin o
satırı karşılayan **kendi cümlesi** ve madde adı ("Özel Şartlar 1",
"Madde 5", "Giriş") yazılıdır; eşleşmenin doğru olup olmadığını o cümleyi
okuyarak görürsünüz. Aranan ifade olumsuz bir cümlede geçiyorsa
("depozito alınmamıştır") satır "var" değil "belirsiz" olur ve nedeni
yazılır.

### Karar ve mevzuat bul

| Kart | Ne yapar |
|---|---|
| **Karar ve mevzuat ara** | Merci, daire, yıl aralığı, tam ifade ve hariç tutulacak kelimelerle arar; bulunan belgenin tam metnini getirir |
| **Aleyhe kararları da tara** | Sorunuzu çalıştırır ve doğrudan aleyhe kaynak taramasına götürür; aleyhinize olan kaynak gizlenmez |
| **Resmî kaynaklarda araştır** | Resmî kaynaklara bağlanır; en fazla 2 dakika ve en fazla 10 tam belge |
| **Hangi kaynaklara bakabiliyoruz?** | Bağlı kaynaklar, bugün kapalı olanlar ve kapsam dışı kalan alanlar |

**Karar ve mevzuat ara** ekranında ColleX'in ulaşabildiği **54 ayrı resmî
arama işlemi** tek yerden çağrılır — Yargıtay, Danıştay, istinaf, Emsal
(UYAP), Uyuşmazlık Mahkemesi, Anayasa Mahkemesi, on mevzuat türü ve sekiz
kurul. Üç kural bozulmaz:

- **Arama sonucu listesindeki satır kanıt değildir.** O satır bir künyedir.
  Alıntı yapılabilir bir pasaj ancak **Tam metni getir** dediğinizde
  üretilir; alınan bölüm kaydedilir ve o andan sonra metnin değişmediği
  ColleX tarafından denetlenebilir hâle gelir.
- **Ulaşılamayan kaynak adıyla söylenir**: "Şu kaynağa ulaşılamadı; bu
  kaynağın sonuçları listede YOK." Sessizce eksik liste gösterilmez.
- **Künye uydurulmaz.** Kimliği okunamayan bir sonuç listeye hiç girmez.

**Kütüphaneye al — getirdiğiniz metinler nasıl kütüphanenize girer.** "Tam
metni getir" dediğiniz her belge önce bu bilgisayardaki bir **kuyruğa**
yazılır (`var\library` klasörü; her belge tek bir dosya, içinde kaynak, adres,
alınma zamanı ve metnin parmak izi). Kuyruktaki belgeler henüz aranabilir
değildir. **"Kütüphaneye al"** düğmesi (Kaynaklar ekranındaki kütüphane
kartı) kuyruğu bu bilgisayardaki veritabanına yayımlar; `ColleX-Baslat.cmd`
de her açılışta aynı yayımı kendiliğinden yapar. Yayımlanan belge kuyruktan
`yayimlandi` alt klasörüne taşınır — silinmez, sizin kopyanızdır — ve o
andan sonra Araştır ekranında **"Hukuk kütüphanemde"** seçeneğiyle taranır;
kütüphane kartındaki ve Ayarlar'daki belge sayısı da bir artar. Aynı belgeyi
ikinci kez getirmek ikinci bir kayıt açmaz: metin değişmemişse "zaten var"
diye sayılır, metin değişmişse eski sürüm kapanıp yeni sürüm eklenir.
Ölçülen durum (10.09.2026, deneme veritabanı): bir belge kuyruğa yazıldı,
yayım iki kez çalıştırıldı — ilkinde 1 belge / 5 parça yayımlandı, ikincisi
hiçbir şey görmedi; aynı belge yeniden kuyruğa konunca "zaten var" dendi ve
yeni satır yazılmadı; belge Araştır'da alıntısıyla bulundu. Bir sınır var ve
ekranda da yazar: kuyruktan gelen belge **yürürlük dönemi** taşımaz (alınma
zamanı bir yürürlük tarihi değildir), bu yüzden güncelliği "bilinmiyor" diye
işaretlenir ve cevap kesinleştirilemez — kararın tarihini kaynağından siz
doğrularsınız.

Ekran ne zaman açılır: karar arama bu bilgisayarda çalışmıyorsa ekranın
üstünde kırmızı bir şerit çıkar, form alanları kapanır ve sizi kaynak listesi
ekranına yönlendirir. Şerit nötr renkteyse arama denenebilir; hangi kaynağa
ulaşılıp ulaşılamadığı ancak gerçek bir aramada belli olur.

**Tam ifade kutusunu açık bırakın.** Varsayılan olarak açıktır. Kapatırsanız
kaynak sorgunuzu sözcüklere böler: bir denemede `tahliye taahhüdü` tırnaksız
**116.090 karara** açıldı ve liste karar tarihine göre sıralandı (ilk
sayfanın tamamı aynı daire, aynı gün); aynı sorgu tırnak içinde **758
karara** düştü ve daireler konuya oturdu. Sonuç boş gelirse **"Tam ifade
olmadan yeniden ara"** ile tek tıkla genişletebilirsiniz.

**Sayfanın şekli ekranda yazar**: *"Bu sayfa: 7 ayrı merci · en çok:
Yargıtay 5. Hukuk Dairesi (8) · karar tarihleri 16.04.2025 – 03.06.2026."*
Böylece "bu liste tek daireye ve tek güne yığılmış" tespitini tek bakışta
yaparsınız. Listenin başında ayrıca kaynağın kendi kayıt sayısı yazar:
*"Kaynakta 761 kayıt var — burada ilk 13 tanesi listeleniyor."* **Kaynak bu
sayıyı bildirmiyorsa ekran "bildirmedi" der ve asla "0" yazmaz** — "arşivde
yok" ile "öğrenemedik" farklı cümlelerdir.

**Her satırda ikinci bir satır vardır.** Kaynak eşleşen bir cümle verdiyse o
yazılır; vermediyse satır boş bırakılmaz: *"Eşleşen cümle sağlanmadı — bu
kaynak liste satırında metin döndürmüyor."* Bugün Yargıtay ve Danıştay arama
sonuçlarında karardan cümle vermiyor; bu yüzden bu satırı sık göreceksiniz.
Bir satırın işinize yarayıp yaramadığını anlamanın tek kesin yolu **Tam
metni getir**tir.

**Dürüst sınır:** bu arama gerçek devlet kaynaklarına ulaşıyor ve gerçek
karar künyeleri getiriyor. **Ama listenin sırasına ColleX karar vermiyor:**
sıralamayı kaynağın kendisi yapar, ColleX yalnız elindeki sayfayı yeniden
dizebilir ve bunu ekranda yazar — *"Bu bir ilgililik sıralaması değildir;
kaynağın sonraki sayfalarında daha uygun kararlar olabilir."* Kısacası:
**erişim ölçüldü, isabet ölçülmedi.** Bu ekranı "aradığımı buldu" yerine
"bakmam gereken künyeleri önüme getirdi" diye kullanın.

**Hangi kaynaklara bakabiliyoruz?** ekranı tek sayfada, kaynak kaynak: adı,
durumu (Açık / Kapalı / Bilinmiyor), hangi süzgeçleri kabul ettiği ve ne
içermediği. Altında **bilinen boşluklar** listesi durur; en çok
tekrarlanması gereken satır orada birebir yazılıdır: **"AİHM (HUDOC)
kapsamda değildir."** Bu sayfanın tek kuralı: **hiçbir hücre sayı
uydurmaz.** Ölçülmemiş bir değer "0" yazmaz, tahmin yazmaz —
**"ölçülmedi"** yazar.

### Hesap ve denetim

| Kart | Ne yapar |
|---|---|
| **Süre hesapla** | 30 usul kuralı, adli tatil ve HMK m. 92/2 ile hesaplar; her sonuç DOĞRULANMADI etiketiyle gelebilir |
| **Harç ve gider hesapla** | 492 s.K. tarifesine göre başvurma, karar-ilam ve peşin harç; bilinmeyen tutar uydurulmaz, sizden istenir |
| **Dilekçemdeki atıfları denetle** | Dilekçedeki her atfı arar; yürürlüğü DİLEKÇENİN TARİHİNE göre okur, çözemediği künyeyi boş bırakır |
| **Dilekçe taslağı hazırla** | 13 şablon; dayanağı olmayan her paragraf KAYNAKSIZ işaretlenir |
| **Kayıtlı araştırmalarım** | Bu bilgisayarda saklanan önceki cevapları açar; hiçbiri dışarı gönderilmez |

#### Harç ve gider hesabı

ColleX **hiçbir zaman bir tutar uydurmaz.** Bir yargı harcının iki yarısı
vardır:

- **Kanundaki yapı ve oran** — yıllarca sabittir ve madde metninden
  okunabilir. Bunlar elimizde: nispi karar ve ilam harcı binde 68,31, nispi
  vekâlet ücreti tavanı %25 ve kanun yolu kesinlik sınırlarının kanundaki
  taban tutarları.
- **Yıllık tutar** — maktu harçlar, AAÜT kademeleri, uygulanacak kesinlik
  sınırları. Bunlar her Ocak Resmî Gazete'de yenilenir ve **ColleX bunları
  bilmez.**

Bu yüzden 20 tarife kaleminin **10'u tutarsız** gelir. Ekranda "Tutar
girilmedi" yazar ve yanında bir kutu vardır: bu yılın rakamını yılda bir kez
girersiniz, hesap o tutarla yapılır ve girdiğiniz değer o yıl için saklanır.
Bir kalem eksikse **toplam hesaplanmaz** — tahmini bir toplam yazmak yerine
"Toplam hesaplanamadı — N kalem eksik" der. **Yanlış harç, reddedilen
dosyadır.**

Hesap adım adım gösterilir (dava değeri → başvurma harcı → karar ve ilam
harcı → asgari → peşin harç → gider avansı → açılışta ödenecek) ve her
çıktıda tarife uyarısı aynen durur. Kesinlik sınırı hesabında bu yılın
rakamını girmediyseniz sonuç "Belirlenemedi — bu yılın sınırını girin" olur.


#### Faiz hesabı

**Faiz hesapla** kartı bir alacağın faizini dönem dönem hesaplar: kanunî
(yasal) faiz, ticarî işlerde avans faizi ya da sözleşmede kararlaştırılan
faiz. Hesap **basit faizdir** ve gün gün yapılır; oran bir tarihte
değiştiyse hesap o tarihte bölünür ve her dönem ayrı satırda görünür.

Harçtaki kural burada da geçerlidir: **ColleX bilmediği bir oranı tahmin
etmez.** Kanunî faizin 2006'dan bu yana iki oranı ColleX'te vardır; ikisi
de henüz Resmî Gazete metniyle karşılaştırılmadığı için satırında
"karşılaştırılmadı" yazar ve nasıl doğrulanacağı yanında durur. Avans
faizinin oranlarını ColleX bilmez: her dönem için oranı ve **kaynağını**
(Resmî Gazete, Merkez Bankası duyurusu, sözleşmenin maddesi) siz girersiniz.
Oranı eksik bir dönem varsa toplam hesaplanmaz; ekranda o dönem için
"oran gir" düğmesi çıkar.
#### Dilekçemdeki atıfları denetle

Karşı tarafın dilekçesini verirsiniz; ColleX içindeki bütün atıfları çıkarır
ve her birini üç kovadan birine koyar:

| Kova | Ne demek |
|---|---|
| **bulundu** | Kaynak bulundu ve künyesi doğrulandı |
| **bulunamadı** | Bu atıf, **taradığımız kaynaklarda** yok. Uydurulmuş bir künye olabilir; kaynağı elle teyit edin |
| **belirsiz** | Karar verilemedi: kapsamımız dışında, kaynağa erişilemedi ya da referans eksik. **Kaynağın yokluğu anlamına gelmez** |

Rapor bu üç cümleyi kendi üstüne aynen yazar, çünkü "bulunamadı" ile
"belirsiz" aynı şey değildir ve ekranda asla aynı renkte gösterilmez. Üç şey
daha:

- **Yürürlük, bugüne göre değil DİLEKÇENİN TARİHİNE göre** değerlendirilir;
  raporun başlığında hangi tarihe göre bakıldığı yazar.
- **Çözülemeyen bir atıfın künye hücresi boş bırakılır.** Soru işareti, tire
  ya da tahmin yazılmaz — ve bu kural üretilen Word dosyasının içinde
  ayrıca kontrol edilir.
- **Alıntı denetimi parmak izi karşılaştırmasıdır**, benzerlik puanı değil.
  Kaynak var ama iddia edilen alıntı tutmuyorsa satır "belirsiz" olur ve
  nedeni yazılır.

**Dürüst sınır:** bugünkü hâliyle bu rapor pratikte "bulunamadı" diyemiyor;
elimizdeki kayıtlar bir kanunun tam metnini mi yoksa bir parçasını mı
sakladığını söylemiyor. Gerçek bir hükmü "uydurma görünüyor" diye
raporlamaktansa "belirsiz" demeyi seçtik. Yani bu rapor bugün **"neyi
tarayabildik, ne bulduk"** raporudur; tam bir atıf doğrulaması değildir.
Kendi dilekçeniz için ayrıca bir rapor indirebilirsiniz: orada her atıf
zaten doğrulanmış bir kayda bağlı olduğu için denetim tamdır.

#### Takvim ve duruşma

Dosyaya **duruşma** kaydedebilirsiniz: dosya sayfasında **Süreler**
sekmesini açın, en üstteki **Duruşmalar ve keşifler** bölümünde **Duruşma
ekle**'ye basın. Tarih, saat, tür (Duruşma / Keşif / e-Duruşma), mahkeme
(dosyanın mahkemesi hazır gelir), salon ve not yazıp **Duruşmayı kaydet**'e
basın. Duruşma olduktan ya da ertelendikten sonra satırdaki seçiciden durumu
**Yapıldı** ya da **Ertelendi** yapın. Takvim ekranında duruşmanın üstüne
bastığınızda bir **hazırlık kartı** çıkar: açık süreler, son üç belge ve
dosyanın kronolojisi.

Takvim dosyası Outlook ya da Google Takvim'de açılacak biçimde üretilir:
süreler **tüm gün** olayı ve 7 gün önce hatırlatma, duruşmalar **saatli**
olay (İstanbul saati) ve 1 gün önce hatırlatma. Süre uyarı cümlesi her
olayın açıklamasına aynen konur — takviminize aktarılan bir tarih, uyarısı
olmadan gitmez.

**Dürüst sınır:** üretilen takvim dosyası gerçek bir takvim programında hiç
açılmadı. Biçimin zorunlu alanları sınandı; Outlook'ta açılışı sınanmadı.
İlk açtığınızda çalışıyorsa lütfen bildirin, bu not kalkacak.

---

## 10. Yedekleme ve geri yükleme

*Bu bölüm, verilerinizin ikinci bir kopyasını almayı anlatır. Kılavuzun en
önemli maddelerinden biridir.*

**Yedek almak:** masaüstündeki **ColleX'i Yedekle** simgesine çift tıklayın
(`ColleX-Yedekle.cmd`). Bir yedek **üç parçadır** ve ikisi bir yedek
değildir:

1. kendi kayıtlarınızın tam kopyası,
2. `belgeler` — yüklediğiniz asıl dosyaların kendisi,
3. `yedek.json` — her dosyanın boyutunu ve **parmak izini** tutan liste.

Üçüncüsü yedeği **denetlenebilir** yapan şeydir. Listesi olmayan bir klasör
ColleX için yedek sayılmaz.

> **Bu klasör müvekkil verisi içerir — şifreli bir diske koyun (Windows'ta
> BitLocker, Mac'te FileVault ile şifrelenmiş bir disk).** Bu cümle her yedek sonrası ekrana çıkar; yer kaplasın
> diye yazılmadı.

**Geri yüklemek:** masaüstündeki **ColleX'i Geri Yükle** simgesi
(`ColleX-Geri-Yukle.cmd`). Geri yükleme **hiçbir zaman mevcut kayıtlarınızı
silmez**: onları tarihli bir adla bir kenara koyar, sonra yedeği açar. Asıl
belgeler **birleştirilir**, silinmez.

Bir yedeği elle denetlemek isterseniz yedekleme simgesinin doğrulama
seçeneği her dosyanın parmak izini yeniden hesaplar ve eksik ya da bozulmuş
dosyayı **adıyla** söyler.

**Ne yapılmadı:** kendiliğinden çalışan ya da zamanlanmış yedek yok,
şifreleme yok. Yedeği **siz** almalısınız. Ayarlar'daki yedek satırı hiç
yedek alınmadıysa kırmızı, yedek yedi günden eskiyse turuncu görünür.


### Bu bilgisayarda doğrulama (ColleX-Dogrula)

ColleX'in resmî kaynaklara gerçekten ulaşıp ulaşmadığını **kendi
bilgisayarınızda** ölçmek için, ColleX açıkken masaüstündeki
`ColleX-Dogrula.cmd` dosyasına çift tıklayın (Mac'te
`deploy/macos/collex-verify.sh`). Birkaç dakika sürer ve şunları yapar:

1. 26 resmî kaynağın her birinde sırayla, aralıklı bir arama yapar;
2. sonuç gelen her kaynaktan bir kararın tam metnini getirir ve metnin
   **parmak izini** yeniden hesaplayıp bozulmadan geldiğini denetler;
3. ayarlı bir yerel yapay zekâ modeli varsa onu yalnız örnek cümlelerle
   dener;
4. Mac'te bilgisayarın kendisini (sürüm, işlemci, bellek) yazar.

Dosyalarınıza, taslaklarınıza ve cevaplarınıza **hiçbir şey yazmaz**. Sonuç
`dogrulama` klasöründe tarihli bir rapordur; her kaynak için "ulaşıldı,
sonuç geldi", "ulaşıldı ama bu sorguya sonuç yok" ya da **"ULAŞILAMADI"**
yazar. Rapor müvekkil verisi içermez; isterseniz geliştiriciye
gönderebilirsiniz. Rapor **erişimi** ölçer, sonuçların isabetini ölçmez.
---

## 11. Ayarlar

*Bu bölüm, kendinizi tanıtmayı, tercihlerinizi ve verilerinizin nerede
durduğunu anlatır.*

Ayarlar dört karttan oluşur:

- **Kendim** — ad, unvan, baro, sicil no, adres, telefon, e-posta, UETS
  adresi, vergi dairesi/no ve varsayılan şehir (dilekçe imza yeri).
  Taslaklardaki vekil bloğu buradan dolar.
- **Tercihler** — tema (Sistem / Açık / Koyu) ve Araştır ekranında hazır
  deneme sorularının gösterilip gösterilmeyeceği.
- **Verilerim nerede?** — kısa cevap: bu bilgisayarda. Kart size **klasörün
  tam yolunu** yazar; kopyalayıp Dosya Gezgini'ne yapıştırarak
  açabilirsiniz. Yüklediğiniz belgelerin aslı bu klasörün altındaki
  `uploads` klasöründedir. Bu satır yalnız program kendisi bildirdiğinde
  çizilir; ColleX hiçbir yolu tahmin etmez. Kayıtlarınızın teknik adı ve
  klasör yapısı bu kartın içinde, **"Teknik ayrıntı"** başlığı altında
  durur.
- **Sistem durumu ve yedekleme** — neyin açık neyin kapalı olduğu, canlı
  araştırma durumu, bulut yapay zekâ (açık mı, hangi model, "canlı
  sınanmadı"), belge sayıları, şablon sayısı, süre kuralı doğrulama sayısı,
  sürüm, saat ve son yedeğin tarihi. Bir şey çalışmıyorsa önce buraya
  bakın.

Kartların en üstünde ayrıca bir **Nasıl çalışır?** kartı vardır: *"ColleX'in
ne yaptığını, ne yapmadığını ve bir cevabı nasıl denetleyeceğinizi beş
dakikada anlatır."* İki düğmesi vardır: **Anlatımı aç** ve **Sözlük**.

### Makineden çıkan iki şey

1. **Resmî kaynaklarda ara** seçtiğinizde sorunuzdan çıkan arama sözcükleri
   o kaynakların sitelerine gider. Ekli belgeniz varsa canlı araştırmada
   bağlam olarak kayda geçer.
2. **Bulut yapay zekâyı siz açarsanız**, yalnız o istek için ilgili belge
   metni dışarıdaki bir servise gider. Bu seçenek varsayılan olarak
   kapalıdır ve ColleX onsuz tam çalışır.

Bunun dışında hiçbir şey bu bilgisayardan çıkmaz. Bu çalışma alanı UYAP ile
eşleşmez.

### Bulut yapay zekâyı açmak

Bulut yapay zekâ varsayılan olarak **kapalıdır** ve kapalı kalabilir. Açmak
isterseniz Anthropic'ten alınmış bir erişim anahtarının bilgisayara
tanıtılması gerekir; bu işlemi ColleX'i kuran teknik kişi yapar. **Anahtar
hiçbir ayara ve hiçbir dosyaya yazılmaz**; ekranda ve kayıtlarda "[gizli]"
görünür.

Açıkken **Ayarlar › Sistem durumu** "yapılandırılmış" der ve yanında
**"canlı sınanmadı"** yazar: bu özellikler gerçek servise karşı henüz
denenmedi; ilk gerçek deneme sizin olacaktır. Bulut yapay zekâ üç yerde
kullanılır ve her seferinde ayrı onay ister:

1. **Araştır** ve **Belgeye sor**'daki çip — açıkken her soru "bu istek
   dışarı gider" satırıyla gider. Sayfa yenilenince çip kapanır.
2. Belge sayfasındaki **Analiz et** — belgenin taraf/talep/dayanak/tarih/
   gözlem/eksik listesini çıkarır; her madde için belgede birebir alıntı
   arar: bulursa "alıntı belgede var", bulamazsa **KAYNAKSIZ**.
3. **Taramadan metne çevir** — taranmış PDF'i (en fazla 32 MB, en fazla 100
   sayfa) metne çevirir; PDF'in tamamı gönderilir. Sonucu "Belge olarak
   yükle" ile belgeleriniz arasına alırsınız.

Bulut yapay zekânın söylediği hiçbir şey kendi başına "kaynaklı" sayılmaz;
doğrulama her zaman bu bilgisayarda yapılır.

---

## 12. Sorun giderme

*Bu bölüm, bir şey çalışmadığında ne yapacağınızı anlatır. Hiçbir satırda
bilgisayar terimi yoktur.*

| Belirti | Ne yapmalı |
|---|---|
| Çift tıkladım; siyah pencere "kayıtlara ulaşılamadı" ya da "kayıt yapısı hazırlanamadı" deyip durdu | Başlatıcı, kayıtlarınıza ulaşamadığı için **bilerek** durdu. Önce **ColleX'i Durdur**, sonra yeniden **ColleX**. Sürerse pencerede yazan iki dosya yolunu saklayın ve destek isteyeceğiniz kişiye gösterin. |
| Çift tıkladım, tarayıcı açılmadı | Kayıtlarınız başlamamış olabilir. **ColleX'i Durdur**, sonra yeniden **ColleX**. Hâlâ olmuyorsa siyah penceredeki dosya yolunu saklayın. |
| Siyah pencerede Node.js, Python veya `.venv` bulunamadı | Kurulum önkoşullarından biri eksik. Proje klasöründeki kurulum notlarını izleyin; `.venv` için Python ortamını yeniden oluşturun. Başlatıcı eksik ortamla yarım çalışan ekran açmaz. |
| PostgreSQL ya da Scoop ile ilgili hata çıktı | Yerel kayıt veritabanı başlatılamadı. PostgreSQL hizmetinin kurulu ve çalışır olduğunu kontrol edin; ayrıntı için `%TEMP%\collex-ensure-db.log` ve `%TEMP%\collex-postgres.log` dosyalarına bakın. |
| Belge yükleme veya kütüphane işlemi hata verdi | `%TEMP%\collex-library.log` dosyasındaki son satırları saklayın ve işlemi bir kez daha deneyin. |
| Siyah pencerede "8787 portu kullanımda" | ColleX zaten açık ya da düzgün kapanmamış. **ColleX'i Durdur** çalıştırıp yeniden başlatın. |
| Ekranda "Sunucuya ulaşılamadı — ColleX kapalı görünüyor" ve rozetler kırmızı | ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın; bağlantı gelince bu sayfa kendini yeniler. |
| Üst çubukta canlı araştırma rozeti gri; Araştır'da "Canlı araştırma şu an kapalı" | ColleX canlı araştırmasız açılmış. ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın; rozet yeşile dönene kadar 5–10 saniye bekleyin. Bilgisayar internete bağlı değilse canlı araştırma "başarısız" biter — bu beklenen davranıştır. |
| Canlı araştırma "Resmî kaynaklara ulaşılamadı" dedi | Resmî kaynaklar o an cevap vermiyor ya da internet yok. Sonra tekrar deneyin; ColleX uydurma sonuç göstermez. |
| "Bu belge zaten yüklüydü" | Aynı içerik daha önce yüklenmiş; mevcut belgeyi kullanın. Dosyaya bağlamak için **Dosyaya ekle**. |
| "Belgeden metin çıkarılamadı." | PDF'in sayfaları resimdir. Belgeyi metin içeren biçimde yeniden dışa aktarın ya da bulut yapay zekâ açıksa **taramadan metne çevir** deyin. "Belge boş — içeriği olan bir belge seçin." ise dosya gerçekten boştur. |
| Cevap KISMİ ve "Cevap süre bütçesini (60 sn) aştı" yazıyor | ColleX tespit yazımını bırakıp bulduğu pasajları gösterdi. Soruyu daraltıp yeniden sorun. |
| "Gönderdiğiniz şey sınırı aşıyor" | Tek seferde çok büyük bir şey gönderildi. Sınırlar: belge 25 MB, taramadan metne çevirme 32 MB ve 100 sayfa, not/olay metni 64 KB, ekrandan gönderilen diğer veriler 1 MB. Uzun metni belge olarak yükleyin ya da ikiye bölün. |
| "Belge işleme aracı beklenmedik biçimde sonlandı" / dışa aktarmada "kayıt no: …" | Ayrıntı siyah pencereye yazıldı. Kayıt numarasını not edin; yeniden deneyin; sürerse numarayla birlikte bildirin. |
| "Hukuk kütüphanemde" seçeneğiyle her soru "Dayanak bulunamadı" | Günlük kurulumda hukuk kütüphanesi boştur. **Resmî kaynaklarda** ya da **Yüklediğim belgelerde** seçeneğini kullanın. |
| "Taslak kayıtlarınıza YAZILAMADI" | Kayıt o an yazılamadı. DOCX indirip saklayın; ColleX'i kapatıp yeniden açtıktan sonra tekrar kaydedin. |
| "Yeni sürümü yükle" | Aynı taslak başka yerde kaydedilmiş. Yükleyin, düzenlemenizi tekrarlayın. |
| Bulut yapay zekâ düğmeleri gri | Erişim anahtarı tanıtılmamış. Bkz. [Bulut yapay zekâyı açmak](#bulut-yapay-zekâyı-açmak). İstemiyorsanız yok sayın; ColleX onsuz tam çalışır. |

Bir sorunu bildirirken **Ayarlar › Sistem durumu** ekranını ve varsa uyarı
satırındaki parantez içi kodu not edin.

---

## 13. Sınırlar ve dürüstlük

*Bu bölüm, nelerin sınandığını ve nelerin sınanmadığını tek tek sayar. Bir
ürünün size söylemesi gereken en önemli bölüm budur.*

- **Deneme belgeleri gerçek hukuk değildir.** Bir kurulumda hukuk
  kütüphanesinin yerinde deneme amacıyla üretilmiş metinler bulunabilir;
  ekran bunu **DENEME BELGELERİ (gerçek mevzuat değil)** diye yazar. O
  metinler gerçek Türk mevzuatı veya içtihadı değildir ve dilekçede
  kullanılmaz.
- **41 süre kuralının 25'i doğrulanmadı.** 16'sının madde metni resmî
  kaynaktan çekildi ve karşılaştırıldı; kalan 25'i doğrulanmadan
  kullanılmamalıdır ve her hesap bunu yazar. Bu, bu kılavuzdaki **en yüksek
  etkili** sınırdır: kaçırılan bir süre geri alınamaz.
- **Harç hesabında yıl ve tarife satırını kontrol edin.** 2026 tarifesinin
  resmî GİB tablosundan doğrulanan başvurma, karar harcı alt sınırı ve suret
  tutarları hazır gelir. Her satırın doğrulama tarihi ve kaynağı vardır;
  bu tutarlar başka yıla taşınmaz. Bilinmeyen gider avansı ve diğer kalemler
  sizden istenir; eksikse toplam boş kalır. AAÜT nispi kademeleri hesaplanmaz.
  Kanun yolu başvurma satırı, ayrı istinaf/temyiz harçlarının toplamı değildir.
  Güncel ölçüm ve açık kalemler: [denetim tablosu](implementation/STATUS.md).
- **UDF çıktısı deneyseldir** ve UYAP editöründe hiç açılmadı. DOCX güvenli
  yoldur.
- **Takvim dosyası gerçek bir takvim programında hiç açılmadı.** Biçimin
  zorunlu alanları sınandı, Outlook / Google Takvim denemesi yapılmadı.
- **Karar aramanın geniş kapsamlı isabeti henüz doğrulanmadı.** İşçilik
  konusunda küçük bir tam metin örneklemi incelendi; birleşik kavramı
  tırnaklamak ilgisiz sonuçları azalttı, fakat her sorguda işe yarar karar
  getirmedi. Sıralamayı kaynak da etkiler. Konuyla ilgisiz pasaj dayanak
  sayılmaz; sonuçta kaynak bulunması sorunuzun cevaplandığını göstermez.
  Örneklem yöntemi ve sınırları: [çalışma denetimi](implementation/AUDIT-2026-09-07.md).
- **Atıf denetim raporu bugün pratikte "bulunamadı" diyemez.** Elimizdeki
  kayıtlar bir kanunun tam mı parça mı saklandığını söylemediği için,
  çözülemeyen her atıf "belirsiz" olur. Rapor bir **kapsam beyanıdır**; tam
  bir atıf doğrulaması değildir.
- **Canlı araştırmada getirilen belgeler kuyruğa yazılır; kütüphaneye
  ancak "Kütüphaneye al" ile (ya da her açılışta `ColleX-Baslat.cmd`
  aracılığıyla) girer.** *(10.09.2026 notu: bu yol bir deneme veritabanında
  uçtan uca ölçüldü — bkz. §9 "Kütüphaneye al" paragrafı. Bu bilgisayardaki
  gerçek kütüphane o gün hâlâ 0 belgeydi, çünkü henüz hiçbir belge
  getirilip alınmamıştı; sayı ancak siz aldıkça artar.)* Kuyruktan gelen
  belgeler yürürlük dönemi taşımadığı için güncellikleri "bilinmiyor" kalır.
- **Bulut yapay zekâ canlı sınanmadı.** Bütün davranışı çevrimdışı
  sınamalarla doğrulandı; gerçek servise hiç istek gönderilmedi.
- **Büyük bir hukuk kütüphanesinde arama yavaştır ve en can sıkıcı hâli,
  aradığınız şeyin arşivde olmadığı hâldir.** Yaklaşık yirmi bin sayfalık
  bir denemede yaygın bir kelimeyle sorulan soru **yaklaşık 4 saniye**
  sürdü ve cevap döndü; buna karşılık **arşivde hiç geçmeyen bir ifade
  yaklaşık 7,5 saniye sürdü ve sonunda "Dayanak bulunamadı" dedi** — yani
  en uzun bekleyiş, en boş sonuçtur. Yüklediğiniz belgeye sorduğunuz soru
  bundan etkilenmez; o yol saliseler içinde cevap verir. **Bekleme
  kısalmadı; görünür ve durdurulabilir oldu.**
- **Karşılama kontrolü sözcük düzeyindedir.** Sorunuzla iki anlamlı sözcüğü
  paylaşan bir pasaj cevaba girebilir; "karşılık bulmayan sözcükler"
  satırını okuyun. "Teknik kontroller tamamlandı" hukukî isabet demek
  değildir. Taslaktaki **alaka kontrolü** de aynı türdendir: hukuk alanı ve
  sözcük örtüşmesiyle karar verir, tanımadığı bir kanunu elemez;
  "Kullanılmayan kaynaklar" listesini gözden geçirin.
- **Süre bütçesi aşamalar arasında işler.** Tek bir uzun arama adımı 60
  saniyeyi geçerse cevap o adım bitince KISMİ olur; ColleX adımı yarıda
  kesmez.
- **Yüklenen belgeler delildir, dayanak değil.** ColleX sizin kendi
  dilekçenizden hukukî değerlendirme paragrafı yazmaz.
- **ColleX UYAP'a ve UETS'ye bağlanmaz**, duruşma takibi yapmaz, tebligat
  almaz, sizin adınıza hiçbir yere evrak göndermez.
- **Bilgisayar tek kullanıcılıdır.** ColleX yalnız o bilgisayardan açılır ve
  şifre sormaz. Bilgisayarınızı başkalarıyla paylaşıyorsanız Windows
  hesabınızı kilitleyin.
- **Siyah pencere zorla kapatılırsa** son birkaç saniyede kaydedilen kayıt
  yazılmamış olabilir. Durdurucu önce nazikçe durmasını ister ve kayıtların
  yazılmasını bekler; bu yüzden pencereyi çarpı ile kapatmak yerine her
  zaman **ColleX'i Durdur** simgesini kullanın.
- **Yedeğinizi siz almalısınız.** Kendiliğinden çalışan yedek yoktur.

---

## 14. Henüz ekranda olmayan işler

*Bu bölüm, üzerinde çalışılan ve bugün ekranda düğmesi bulunmayan işleri tek
listede sayar. Ayrıntısı anlatılmaz, çünkü bugün kullanamazsınız.*

ColleX'in kuralı şudur: **arkasında çalışan bir şey olmayan bir düğme
gösterilmez.** Bir ekran ya çalışır, ya silik görünür ve nedenini yazar; bir
iş henüz yoksa ekranda hiç görünmez. Bugün ekranda olmayanlar:

- dilekçenin mahkemeye verilecek **sade kopyası** (kaynak tablosu ve
  işaretler olmadan),
- bir dosyanın tamamının **tek sıkıştırılmış klasör** hâlinde dışa
  aktarılması,
- **kişi kartları** ve ad benzerliğine dayalı menfaat çatışması taraması,
- **tek kutudan genel arama** ve "nerede kalmıştım" listesi.

Bugün çalışan ekranların tam listesi: beş sekme — **Dosyalarım · Araştır ·
Belgeler · Taslak · Ayarlar** — ve sekmelerin içinden açılan ekranlar:
**dosya sayfası**, **belge sayfası**, **Nasıl çalışır?**, **Sözlük**,
**Aynı soruyu birçok belgeye sor**, **Karar ve mevzuat ara**, **Dilekçemdeki
atıfları denetle**, **Harç ve gider**, **Sözleşme kontrol listesi**,
**Takvim** ve **Hangi kaynaklara bakabiliyoruz?**.

---

## 15. Sözlük

*Bu bölüm, uygulamadaki **Sözlük** ekranının aynısıdır. Ekranda anlamadığınız
bir kelime görürseniz yanındaki **?** düğmesine basın; sizi doğrudan oraya
getirir.*

**Aktif dosya** — Üst çubuktan seçtiğiniz dava dosyası. Seçiliyken
ürettiğiniz cevap, yüklediğiniz belge ve yazdığınız taslak kendiliğinden o
dosyaya bağlanır; seçili değilken hiçbiri bir dosyaya bağlanmaz.

**Alıntı** — Belgeden birebir kopyalanmış metin parçası. Özetlenmemiş,
kısaltılmamış, kelimesi değiştirilmemiştir. Nerede görürsünüz: her tespitin
altında.

**Pasaj** — Bir belgenin, alıntının alındığı bölümü; çoğu zaman birkaç
paragraf. ColleX uzun belgeleri pasajlara ayırır ve her alıntıyı tek bir
pasaja bağlar.

**K-1, K-2 …** — Cevaptaki alıntıların numarasıdır. Her numara belirli bir
belgenin belirli bir bölümünü gösterir.

**Tespit** — ColleX'in cevapta kurduğu tek bir hüküm cümlesi. Her tespitin
altında dayandığı alıntı durur.

**Hukuk kütüphanesi** — ColleX kurulurken bu bilgisayara konulan mevzuat ve
karar metinleri. Burada aramak internete hiç çıkmadan arama yapmak demektir.
Nerede görürsünüz: Araştır ekranındaki arama yeri seçimi.

**Resmî kaynaklar** — Yargıtay, Danıştay, Anayasa Mahkemesi ve Mevzuat Bilgi
Sistemi gibi kaynak siteleri. Bu seçenek internet ister; bir araştırma en
fazla 2 dakika sürer ve en fazla 10 belgenin tam metnini getirir. Arama
sonuç listeleri dayanak sayılmaz; dayanak, getirilen belgenin tam metnidir.

**Bulut yapay zekâ** — Cevabı yazarken bu bilgisayar dışındaki bir yapay
zekâ servisinden yardım alma seçeneği. Varsayılan olarak kapalıdır.
Açarsanız yalnız sizin başlattığınız istek için ilgili belge metni dışarı
gider ve ColleX bunu her seferinde ekranda yazar.

**Belge parmak izi** — Bir belgenin metninden hesaplanan, o metne özel kısa
imza. Belgede tek harf değişse imza da değişir. Neden önemli: alıntının hâlâ
aynı belgeden, aynı hâliyle geldiğini böyle gösterebilirsiniz. Bu bir noter
onayı değildir; imza, resmî yayımlanmış metinle değil, bu bilgisayarda
kayıtlı nüsha ile eşleşmeyi gösterir. (Teknik adı: SHA-256.)

**Metindeki yeri** — Alıntının, belgenin kaçıncı harfinden kaçıncı harfine
kadar uzandığı. Aynı alıntıyı başkasının da aynı yerde bulabilmesi içindir.
(Teknik adı: Unicode karakter sayımı.)

**Belge sürümü (nüsha no)** — Aynı belgenin her yüklenişi ayrı sürüm sayılır
ve eskiler silinmez. Bir alıntı hangi sürümden alındıysa onun numarası
yazılır.

**Taslak sürümü** — Taslağın her kaydedilişi ayrı numara alır. Eski sürümler
durur; istediğiniz zaman geri dönebilirsiniz.

**DAYANAK BULUNAMADI (ÇEKİMSER)** — ColleX yeterli dayanak bulamadığı için
cevap yazmadı. Tahmin etmek yerine susmayı seçer. Neden önemli: bu etiketi
gördüğünüzde belge yükleyip ya da arama yerini genişletip yeniden
sorabilirsiniz.

**TAM · ŞERHLİ · KISMİ** — Cevabın üstündeki durum etiketleri. TAM: bütün
tespitler bir alıntıya bağlandı. ŞERHLİ: tespitler kaynaklı, ama bir çekince
ya da aksi yönde bir karar da bulundu. KISMİ: bazı tespitler doğrulanamadı;
cevap eksiktir.

**KESİNLEŞTİRİLEMEZ** — İç kontrollerden biri sonuç veremedi. Durumdan ayrı
bir bilgidir; cevap TAM iken de çıkabilir. Neden önemli: gerekçelerini
okumadan bu cevabı kullanmayın.

**KAYNAKSIZ** — Bu paragrafın metni, taslağa bağlı belgelerin hiçbirindeki
alıntıyla örtüşmüyor. Dayanağını siz eklemelisiniz. Neden önemli: KAYNAKSIZ
paragraf duruyorken taslak dışa aktarılmaz — yanlışlıkla dayanaksız dilekçe
vermeyesiniz diye.

**Aleyhe kaynak** — Bulunan sonucun aksini söyleyen karar ya da hüküm.
ColleX bunları gizlemez; çeliştiği tespitin hemen altına koyar.

**Yürürlük** — Bir hükmün sorulan tarihte geçerli olup olmadığı. Rozetler:
yürürlükte · güncel değil · mülga · henüz yürürlükte değil · biliniyor değil ·
yüklediğiniz belge — yürürlük değerlendirilemez.

**Deneme belgeleri** — Bu kurulumda gerçek mevzuat yerine deneme amacıyla
üretilmiş metinler var. Çıkan hiçbir sonuç gerçek hukukî değerlendirme
değildir; dilekçede kullanmayın.

**Deneysel** — Bu çıktı biçimi üretiliyor, ama hedef programda (UYAP Doküman
Editörü) henüz hiç açılmadı. Açıldığı doğrulanana kadar bu etiket kalkmaz.

**DOĞRULANMADI (süre hesabı)** — Süre, kuralına göre hesaplandı; ancak
hiçbir merci onaylamadı. Neden önemli: süreyi mutlaka kendiniz de kontrol
edin; ColleX bunu size her hesapta hatırlatır.

**Denetim dosyası** — Bir cevabın bütün alıntılarını, belge sürümlerini ve
parmak izlerini içeren tek dosya. Başka bir kişi ya da program bu cevabı bu
dosyayla bağımsız olarak denetleyebilir. (Teknik adı: JSON.)

**Kendi kayıtlarınız** — Dava dosyalarınız, belgeleriniz, cevaplarınız ve
taslaklarınızın durduğu yer. Bu bilgisayardan çıkmaz. Teknik ayrıntısı:
Ayarlar › Verilerim nerede?

---

Bu kılavuzdaki her ekran 03.09.2026 tarihli sürümde açılır; sınanmamış
olanlar 13. bölümde ad ad sayıldı. Ekran adları, uygulamanın kendi metniyle
karşılaştırılarak doğrulandı; burada anlatılıp da açılmayan bir ekran
yoktur.

Bir sorunuz olursa **Ayarlar › Sistem durumu** ekranını açın; orada neyin ne
durumda olduğu Türkçe yazar. Ekranda anlamadığınız bir kelime görürseniz
yanındaki **?** düğmesine, ya da üst çubuktaki **?** düğmesi › **Sözlük**'e
basın.
