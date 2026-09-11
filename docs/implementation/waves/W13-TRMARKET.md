# W13 — TRMARKET: Türk hukuk-teknolojisi pazarı ve avukatın gerçek günü

Tarih: **02.09.2026** · Hat: TRMARKET (araştırma/denetim; kod değiştirilmedi,
git işlemi yapılmadı) · Erişim tarihi aksi yazmadıkça **02.09.2026**.

Etiketler: **[doğrulandı]** = sağlayıcının/kurumun kendi yüzeyinde görüldü
(URL + erişim tarihi ile) · **[pazarlama]** = mekanizması gösterilmeyen beyan ·
**[çıkarım]** = iki kaynağın karşılaştırmasından ya da depodaki koddan çıkan
sonuç.

> **Dürüstlük notu.** Bu belgedeki rakip sayıları ve fiyatları o günkü kamuya
> açık sayfalardan alınmıştır ve değişebilir; kullanılmadan önce yeniden teyit
> edilmelidir. ColleX hakkındaki her iddia depodaki dosya/satır ile
> gerekçelendirilmiştir. Türk devlet siteleri (mevzuat.gov.tr, Yargıtay karar
> arama) bu makineden erişilemedi — bu bir ürün kusuru değildir, ölçüm
> kısıtıdır. `karartek.com.tr`, `eksisozluk.com`, `sinerjias.com.tr`,
> `barobirlik.org.tr/Haberler/...` bu makineden 403/402/ECONNREFUSED döndü;
> o kalemler ikincil kaynakla işaretlendi.
>
> Bu belge `docs/COMPETITIVE.md`'nin **tamamlayıcısıdır**: orada Apilex ve
> De Jure var; burada **pazarın geri kalanı** (bilgi bankaları, büro
> otomasyonu, UYAP/UETS eklentileri, yeni AI girişimleri) ve **avukatın
> günlük işi** var. Apilex/De Jure burada yeniden ölçülmedi.

---

## 1. Pazar haritası — bir Türk solo avukatının önündeki beş katman

Türk hukuk-teknolojisi tek bir pazar değil; **beş ayrı satın alma kalemi**
var ve avukat bunların 2–4 tanesine aynı anda para öder. ColleX bugün
yalnız 3. katmanın bir bölümünde ve 4. katmanın küçük bir parçasında
duruyor.

| # | Katman | Ne satar | Solo avukat için tipik yıllık maliyet | ColleX bugün burada mı? |
|---|---|---|---|---|
| 1 | **Bilgi bankası aboneliği** | Mevzuat + içtihat + literatür arama | 0 ₺ (kararTek/UYAP Emsal) → 48.000 ₺ (Lexpera Pro+) | Hayır — canlı MCP geçidi var, abonelik ürünü yok |
| 2 | **Büro otomasyonu** | Müvekkil, dosya, ajanda, duruşma, tahsilat, muhasebe, icra | 2.600 ₺ (yenileme) → 89.000 ₺ (AI'lı paket) | Hayır — `matters` var, tahsilat/ajanda/muhasebe yok |
| 3 | **Hukuki AI asistanı** | Semantik arama, dilekçe/sözleşme üretimi, belge analizi | 15.000 ₺ (Emsal AI Plus) → 142.800 ₺ (Jupytr giriş, kullanıcı/ay 4.490 ₺) | **Kısmen** — arama + kanıt disiplinli taslak var |
| 4 | **UYAP/UETS köprüleri** | Toplu tebligat indirme, toplu sorgu, e-imza otomasyonu | 0 ₺ (T-akıbet, Tebligo free tier) → abonelik | **Hayır** — hiç yok |
| 5 | **İcra takip motoru** | Toplu takip açma, MERNİS/SGK/TAKBİS sorgu, haciz | ayrı ürün (İcraPro / e-İcraProPlus) | Hayır |

### 1.1 Bilgi bankası katmanı — "abonelik kültürü" gerçekte kırılıyor

- **Lexpera** (lexpera.com.tr/uyelik-destek/paketler-ucretler, 02.09.2026)
  [doğrulandı]: yıllık, KDV dahil — **Ücretsiz 0 ₺** (ayda 5 belge
  görüntüleme), **Öğrenci 0 ₺**, **Standart 34.200 ₺**, **Profesyonel
  43.800 ₺** (mektup/örnekler dahil), **Profesyonel + 48.000 ₺** (literatür +
  VIP). Sayfada baro/avukat indirimi ilan edilmiyor.
- **Kazancı** (kazanci.com.tr) [pazarlama/ikincil]: kamuya açık fiyat listesi
  yok, telefonla satış. İkincil kayıtlar 2023 için ~6.500–7.800 ₺ aralığından
  söz ediyor; **teyit edilemedi**, kullanılmamalı. Kazancı'nın Şikayetvar'da
  ayrı bir şikayet sayfası olması (sikayetvar.com/kazanci-hukuk-otomasyon-programlari)
  ürünün hem bilgi bankası hem otomasyon sattığını gösteriyor [doğrulandı — sayfa
  varlığı].
- **kararTek / TBB İçtihat Bilgi Bankası** (karartek.com.tr — bu makineden
  Cloudflare ile engellendi; TBB duyurusu üzerinden [doğrulandı-ikincil]):
  TBB'nin avukatlara **ücretsiz** sunduğu, **1 milyondan fazla Yargıtay
  kararı** içeren, TÜBİTAK onaylı arama robotlu banka; kurulum/güncelleme
  ücreti yok; avukat karar ekleyip meslektaşıyla paylaşabiliyor ve yorum
  yazabiliyor.
- **Sinerji Mevzuat** (mevzuat.sinerjias.com.tr; iOS/Android uygulaması var)
  [doğrulandı — mağaza kaydı]: mevzuat + yüksek mahkeme kararı + dilekçe/
  sözleşme örnekleri + harç/süre tabloları. Kurumsal site bu makineden
  erişilemedi (ECONNREFUSED).
- **Legalbank** (mevzuatvekararlar.legalbank.net) [doğrulandı — sayfa
  varlığı]: elektronik hukuk bankası, mevzuat + karar arama.
- **Barolar toplu abonelik alıyor**: örneğin Giresun Barosu'nun bir mevzuat/
  içtihat programı için **aylık 11 ₺** üyelik duyurusu (giresunbarosu.org.tr,
  Haber 420) [doğrulandı-başlık; sayfa gövdesi 403]. Ayrıca üniversite
  kütüphaneleri Lexpera/Kazancı'ya kurumsal abone (ASBÜ, İÜ, RTEÜ duyuruları)
  [doğrulandı].

> **Sonuç (ticari):** "içtihat arama" tek başına artık **satılabilir bir ürün
> değil**. Solo avukat Yargıtay kararına kararTek + UYAP Emsal + Yargıtay
> Karar Arama üzerinden **bedava** ulaşıyor. 34.200 ₺'yi ödeyen kişi
> *literatür, örnekler ve tek ekranda konsolidasyon* için ödüyor. ColleX'in
> "54 resmî kaynağa canlı geçit" değerini **arama** olarak değil,
> **doğrulama + sentez + karşıt tarama** olarak konumlaması gerekir. (Bu,
> `docs/COMPETITIVE.md` §2'deki duruşun pazar tarafından doğrulanmasıdır.)

### 1.2 Büro otomasyonu katmanı

| Ürün | Ne yapar | Fiyat | Kaynak |
|---|---|---|---|
| **KolayOfis / KolayOfisNG (MicroDestek)** | Dava, icra, muhasebe, belge arşivi, UYAP entegrasyonu | Kullanıcı başına lisans; Teknopark KDV istisnalı; örnek: satış 10.000 ₺ ise yıllık güncelleme/destek 2.000 ₺ | microdestek.com.tr [doğrulandı] |
| **Klasik otomasyon (isim maskeli, "H\*\*\*")** | Dava/icra/muhasebe, pakete göre UYAP kotası | **Kurulum 7.490 – 186.000 ₺; yenileme 2.600 – 65.000 ₺** (+KDV) | smarthukuk.com/blog/en-iyi-avukat-programlari… [doğrulandı — rakam yayımlı, ürün adı maskeli] |
| **AI'lı dava yönetimi ("Y\*\*\* AI")** | Dava yaşam döngüsü + AI asistan + raporlama | **31.000 / 52.000 / 89.000 ₺** dönem toplamı (3/6/12 ay taahhüt) | aynı kaynak [doğrulandı — rakam] |
| **Hukuk Asistan (hukas.com.tr)** | UYAP **ve UETS** entegrasyonu, dava/icra takibi, ajanda, görev, finans, içtihat araması — tek platform | ilan edilmemiş | hukas.com.tr [pazarlama] |
| **Lawyer Team (eski AvukatPro)** | İcra takip + dava takip + UYAP bağlantı + hukuk muhasebesi | ilan edilmemiş | ikincil [çıkarım] |
| **İcraPro / e-İcraProPlus (Zirve Bilgisayar)** | İcra takibi; **UYAP Avukat Portal'da doğrudan takip açma**, Mernis/SGK/Emniyet sorguları | ilan edilmemiş | zirve-bilgisayar.com [doğrulandı] |

**Fiyat aralığının anlamı:** solo avukatın otomasyona ödediği para
2.600 ₺/yıl (eski bir masaüstü ürünün yenilemesi) ile 89.000 ₺/yıl (AI'lı
bulut paket) arasında **35 kat** değişiyor. Bu, ColleX'in "yerelde çalışır,
abonelik yok" duruşunun **gerçek bir fiyat argümanı** olduğunu gösteriyor —
ama yalnız otomasyonun *yerini alırsa*; bugün almıyor (bkz. §5).

### 1.3 Hukuki AI asistanı katmanı — 2026'nın kalabalık cephesi

| Ürün | Ayırt edici tek şey | Fiyat (görülen) | Kaynak / etiket |
|---|---|---|---|
| **Jure** (jure.com.tr) | **29+ modül tek çatı**: Akıllı Arama, Dilekçe/Sözleşme üretimi, Dava Yönetimi, **Akıllı Takvim**, **UYAP Senkronizasyonu (Chrome eklentisi)**, **İcra Takip + otomatik ücret hesabı**, Adliye Modu, Çelişki Analizi, Kişisel Veri Gizleme, Öngörücü Analitik | ilan edilmemiş; 14 gün ücretsiz | jure.com.tr [doğrulandı — özellik listesi]; "6 saat → 40 dakika", "%97" ve "Baro Onaylı" iddiaları [pazarlama] |
| **Emsal AI** (emsal.ai) | Yayımlı, ucuz, net paketleme; "Kaynaklı ve Denetlenebilir Yanıtlar" | **Ücretsiz 0 ₺** (günlük 3 kredi) · **Plus 1.250 ₺+KDV/ay** · **Pro 2.500 ₺+KDV/ay** · Kurumsal | emsal.ai [doğrulandı] ; "11 milyonu aşkın" korpus [pazarlama] |
| **Jupytr** (jupy.tr) | **Kurumsal hafıza** — büro arşivini aranabilir bilgi tabanına çevirme; Word *track changes* çıktısı; hâkim/daire bazlı karar eğilimi | **4.490 ₺ ve 11.900 ₺ / kullanıcı / ay**; 1 hafta 500 ₺ deneme | jupy.tr + webrazzi.com/2026/06/26 [doğrulandı]; "halüsinasyonsuz hukuki araştırma" [pazarlama] |
| **OveK Hukuk** (ovekhukuk.com) | **12 modül**; "9'dan fazla dava türünde 30 saniyede **UYAP uyumlu, UDF formatında** dilekçe"; **Hukuki Strateji Geliştirici** (1.000 sayfa / 40 belge, çelişki + zaman çizelgesi + tanık güvenilirliği) | TL fiyat yayımlanmamış; **baro üyesine Pro yıllıkta %40 indirim**; 2 gün deneme | ovekhukuk.com [doğrulandı]; "hiçbir koşulda model eğitiminde kullanılmaz", "OveK de hata yapabilir" [doğrulandı — kendi metni] |
| **SmartHukuk** (smarthukuk.com) | **Herkese açık MCP sunucusu** — ChatGPT/Codex ve uyumlu ajanlardan kullanılabiliyor; çıktı **UDF + Word + PDF** | **500 / 1.000 / 2.000 ₺ ay** (KDV dahil) — kendi blogunda yayımlı | smarthukuk.com [doğrulandı] |
| **LegalEngine** (legalengine.com.tr) | Pazarlamayı doğrudan **"kapalı devre sistemler"** ve **"Sır Saklama Yükümlülüğü"** üzerine kuruyor | /paketler.html; 5 gün deneme | legalengine.com.tr [doğrulandı] |
| **Turbo Law** | Türk legaltech'in **en büyük turu**: 18.06.2026, **3,8 M$**, Revo Capital liderliğinde (Treeo VC, BridgeX, Alchemist, Gokul Rajaram). Hedef **ABD** pazarı (medical malpractice/sigorta); 1.800+ aktif dosya, 5M+ sayfa | — | webrazzi.com/2026/06/18 [doğrulandı] |
| **Leagle**, **Lexnavi** | Erken aşama; Leagle Hive Founders Accelerator'da, henüz TR turu yok | — | webrazzi [doğrulandı-ikincil] |

**Üç çıkarım:**

1. **Fiyat tabanı çöktü.** Emsal AI 1.250 ₺/ay ve SmartHukuk 500 ₺/ay ile
   "hukuki AI" artık bir Lexpera aboneliğinin **onda birine** satılıyor.
   [çıkarım — iki yayımlı fiyat listesinin karşılaştırması]
2. **Herkes UDF çıkarıyor, kimse "doğrulanmadı" demiyor.** OveK ve SmartHukuk
   çıktıyı doğrudan "UYAP uyumlu UDF" diye satıyor [doğrulandı]. ColleX'in
   UDF'i `deneysel` ve UYAP editöründe hiç açılmadı (STATUS "Doğrulanmamış üç
   yüzey"). Bu, **tek başına ürünü rekabet dışı bırakan** bir farktır (bkz.
   §5 P0-1).
3. **MCP artık bir rakip yüzeyi.** SmartHukuk kamuya açık MCP sunucusu
   veriyor [doğrulandı]. ColleX'in 54 araçlık MCP geçidi bir **mimari
   avantaj değil, artık bir pazar standardı**; fark, ColleX'in tarafında
   *hash'li alıntı doğrulaması + çekimserlik*tir.

### 1.4 UYAP / UETS köprüleri — ColleX'in en büyük kör noktası

Bu katman, avukatın **günlük** yazılım teması ve tamamı ColleX'te yok.

| Ürün | Ne yapar | Fiyat | Kaynak |
|---|---|---|---|
| **T-akıbet UETS Aracı** (t-akibet.com/uets) | Chrome eklentisi; **yüzlerce tebligatı tek tıkla** indirir, PDF birleştirme, klasör/belge bazlı otomatik yer imi | **Tamamen ücretsiz** | [doğrulandı]. Kendi metni: *"Hiçbir veri sunucularımıza gönderilmez, tüm işlemler bilgisayarınızda gerçekleşir"* — **ColleX'in yerel-öncelik argümanının birebir rakibi** |
| **Tebligo** (tebligo.com) | UETS'ye 7/24 senkron; tebligatı 5 saniyede analiz edip taraf/dava türü/mahkeme çıkarır, **müvekkil ve dosya kaydını kendisi açar**, kronolojik dizer, e-posta/SMS hatırlatma | Ücretsiz katman + premium; 30 gün deneme | [doğrulandı]; "%99,2 otomatik işleme", "%50 zaman tasarrufu" [pazarlama] |
| **UYAP Katibim** (uyapkatibim.com) | E-imzayla UYAP Avukat Portal'a bağlanıp **toplu** iş: XML'den toplu takip açma, toplu harç/masraf ödeme, MTS, PTT barkodlu toplu tebligat, toplu MERNİS/SGK/vergi adres sorgusu, **portaldan toplu evrak indirme**, "Aktif 5 Oturum Çözümü" | 2 gün ücretsiz deneme | [doğrulandı] |
| **Tebli (tebli.co)** | UETS entegre; kritik tebliğ tarihlerini hesaplayıp hatırlatır | — | [pazarlama-ikincil; site 403] |

> **Bu katmanın anlamı ColleX için:** Avukatın gününü *asıl* yiyen iş burada
> ve rakipleri **bedava**. ColleX'in "yerel, veriniz makinede kalır" mesajı
> T-akıbet tarafından **zaten** ve **ücretsiz** söyleniyor. ColleX'in bu
> katmana girmesi (bkz. §5 P0-2) hem farklılaşma değil, **bilet fiyatıdır**.

---

## 2. Avukatın gerçek günü — birincil kanıt

### 2.1 En iyi kanıt: TBB'nin kendi şikâyet platformu

`bilisimtalepleri.barobirlik.org.tr` — TBB Bilişim Komisyonu'nun işlettiği
"UYAP ve Diğer Bilişim Sistemleri … sorunlar ve çözüm önerileri paylaşım
platformu". Kategori başına talep sayısı (erişim 02.09.2026, HTTP 200)
[doğrulandı]:

| Kategori | Talep |
|---|---:|
| CELSE UYGULAMASI | **18** |
| UYAP CBS (Cumhuriyet Başsavcılığı) DOSYALARI | **15** |
| UYAP HUKUK DAVASI DOSYALARI | **13** |
| UYAP İCRA VE SATIŞ DOSYALARI | **10** |
| UYAP CEZA DAVASI DOSYALARI | 9 |
| UYAP EDİTÖR PROGRAMI | 6 |
| E-DURUŞMA SİSTEMİ | 4 |
| UETS / e-Devlet / KEP | 1 + 1 + 1 |

Aynı platformdan **avukatların kendi cümleleri** (kısaltılmış, 29–30.09.2023,
hepsi hâlâ "İlgili Birime İletildi"):

1. **Toplu indirme yok** — *"BİR DAVA DOSYASI İÇİNDE BULUNAN BELGELERİ TOPLU
   BİR ŞEKİLDE İNDİRME BUTONU OLMALIDIR."* Gerekçe: belgeleri tek tek
   görüntüleyip kaydetmek "kapsamlı dosyalarda uzun sürebiliyor"; talep hukuk,
   ceza, idari, CBS ve icra dosyaları için birlikte yapılmış. [doğrulandı]
2. **Oturum kendiliğinden kapanıyor** — dava açarken/evrak yüklerken araya
   başka bir iş girince UYAP oturumu düşüyor ve *"BÜTÜN İŞLEMLERİ SİL BAŞTAN
   YAPMAYA NEDEN OLUYOR."* [doğrulandı]
3. **Dosya içi belgeler tarihe göre sıralanamıyor** — belgeler yalnız
   kategoriye ve son 20 evraka göre listeleniyor; bir avukatın ifadesiyle
   *"2015 yılından bu yana süregelen bir dosyayı tam anlamıyla incelemeye
   çalışmak neredeyse imkansız"*. [doğrulandı]
4. **UYAP Editör macOS'ta kullanılamıyor** — Sonoma sonrası UDF yazdırılamıyor,
   Mac klavye kısaltmaları yok, App Store'daki uygulama *"sadece önizlemeye
   izin veriyor"*, iOS/iPad'de **düzenleme ve imzalama yok**. [doğrulandı]
5. **Celse (mobil) uygulaması** — e-imza/mobil imza oturumu çok sık kapanıyor
   (talep: 6 ay); e-Devlet ile girişte oturum 1 hafta; ve *"CELSE
   UYGULAMASINDAN SADECE MAZERET DİLEKÇESİ GÖNDERİLEBİLMEKTEDİR."*
   [doğrulandı]

### 2.2 Şikayetvar — UYAP Avukat Portal

`sikayetvar.com/uyap/avukat-portal` [doğrulandı], şikâyet başlıkları:
*"UYAP Avukat Portalı Sürekli Çöküyor Ve Yavaş Çalışıyor"* (15 Nisan),
*"UYAP Avukat Portalında Sürekli Sunucu Bağlantı Hatası Ve Evrak Görüntüleme
Sorunu"* (29 Aralık), *"UYAP Avukat Portalı'nda Haciz Kesintilerim Dosyama
Yansımıyor, Borç Durumum Belirsiz"* (24 Ekim), *"UYAP'ta Kapanmayan Dosya
Sorunu"* (10 Nisan). Tekrarlayan temalar: yavaşlık/çökme, evrak
görüntüleyememe, ödeme/harç sorunları, kapanmayan dosya.

### 2.3 Günün şekli (sentez)

Kaynaklar: TBB platformu (§2.1), Şikayetvar (§2.2),
`avukatsitesi.org/blog/uyap-avukat-portal-kullanim-rehberi` (05.08.2026,
[doğrulandı]), UYAP e-Duruşma yaygınlık verileri, Adana Barosu "Serbest
Çalışan Avukatların Büro Düzeni" duyurusu (başlık [doğrulandı], gövde 404).

| Zaman dilimi | İş | Bugünkü araç | ColleX'in yeri |
|---|---|---|---|
| Sabah ilk iş | UETS/tebligat kutusu + UYAP "safahat" değişiklikleri + o günün duruşmaları | UYAP Portal, UETS, Celse, UYAP SMS; T-akıbet/Tebligo | **Yok** |
| Tebligat gelince | Tebliğ tarihini tespit et → süreyi hesapla → ajandaya yaz | Elle; Excel; otomasyon programı | **Yarım** (süre hesabı var ama tebliğ tarihi elle girilir, kurallar `dogrulanmadi`) |
| Dosya inceleme | Kapsamlı bir dosyanın belgelerini tek tek indir, tarih sırasına diz, oku | UYAP (toplu indirme YOK, tarih sıralaması YOK) → §2.1 #1,#3 | **Yarım** (yükleyip kronoloji çıkarır; **indirme yok**) |
| Duruşma hazırlığı | Dosya özeti + karşı dilekçenin dayanaklarını kontrol + emsal | Elle + bilgi bankası | **Güçlü** (as-of doğrulama, karşıt tarama) |
| Duruşma | Çoğu artık e-Duruşma: 81 ilde yaygın, 5,6 M+ duruşma; talep duruşmadan 24 saat öncesine kadar | UYAP e-Duruşma | Yok (gerekmiyor) |
| Dilekçe yazımı | Metni yaz → **UYAP Editör'de UDF'e çevir** → e-imzala → portaldan gönder | UYAP Editör (Word kabul edilmiyor) | **Kırık** (bkz. §5 P0-1) |
| Müvekkil bilgilendirme | Telefon/WhatsApp; "dosyam ne oldu?" | Elle; müvekkil portalı olan otomasyonlar | Yok |
| Tahsilat / ücret | Vekâlet ücreti, masraf avansı, serbest meslek makbuzu | Otomasyon + muhasebeci | Yok |
| CMK / adli yardım | Görevlendirme, ödeme takibi | Baro CMK sistemi | Yok |
| İcra | Toplu takip açma, sorgular, haciz, satış | İcraPro / UYAP Katibim | Yok (yalnız icra itiraz dilekçesi şablonu) |

**Korkulan süreler (kaçırılırsa mesleki sorumluluk):** istinaf/temyiz
süreleri açık ara birinci — *"kanuni süreler içinde istinaf veya temyiz
yoluna başvurmaması, özen borcunun en ağır ihlallerinden biri"*
[doğrulandı-ikincil, mesleki sorumluluk sigortası literatürü]. Hemen
arkasından: **bilirkişi raporuna itiraz (HMK m.281, iki hafta)** — *"süresi
içinde gerekçeli itiraz edilmeyen rapor, aleyhe hususlar bakımından kesinleşir
ve istinafta ileri sürülemez"* [doğrulandı-ikincil], ödeme emrine itiraz
(İİK m.62, 7 gün), kambiyo itirazı (İİK m.168, 5 gün), İYUK dava açma
(30/60 gün).

### 2.4 AI'ya güven — Türkiye'nin kendi vakası

**Kızılcahamam / Ankara, 20.06.2026** [doğrulandı — haber; teyit.org sayfası
bu makineden 403]: 25 yıllık bir avukat müvekkilinin savunma dilekçesini
yapay zekâya hazırlatmış; dilekçedeki Yargıtay karar künyeleri UYAP'ta
karşılığı olmayan **uydurma** çıkmış. Karşı vekil fark etmiş, hâkim UYAP'tan
doğrulamış; avukat hakkında **hem savcılık hem Ankara Barosu** "yanıltıcı
bilgi vermek" gerekçesiyle soruşturma başlatmış. Avukatın savunması:
*"Yapay zekâ, mevcut Yargıtay kararlarını ekledi ancak bu kararlara ait
künyeleri yanlış yazdı."*

> Bu tek vaka, ColleX'in bütün mimarisinin **satış argümanıdır**: hash'li
> birebir alıntı + künyenin belgeye bağlı olması + doğrulanamayan alıntıda
> **dışa aktarımın reddi** (exit 2). Rakiplerin hiçbiri "künye
> doğrulanamıyorsa dosya yazılmaz" demiyor. Bunu §7'deki tek cümleye
> çevirmek gerekir.

---

## 3. Sert kısıtlar — ürünün uymak zorunda olduğu Türk pratiği

### 3.1 UYAP Doküman Editörü ve UDF — pazarlık edilemez

- UYAP'a yüklenecek elektronik dosyalar **`.pdf, .jpeg, .jpg, .png, .tiff,
  .udf`** formatlarında olmalıdır; dilekçe **UDF olarak hazırlanır ve
  e-imza bu editör üzerinden atılır**. Tek dosya **40 MB**'ı aşamaz; dilekçe
  ekine evrak ekleme limiti **5 evrak**tır. [doğrulandı — UYAP SSS/kılavuz
  derlemesi; `vatandas.uyap.gov.tr/main/avukat/sss.jsp`]
- **DOCX kabul edilmiyor** — *"UYAP Document Editor required; Word documents
  rejected"* (avukatsitesi.org rehberi, 05.08.2026) [doğrulandı]. Word'den
  gelen metin ancak UYAP Editör'de "İmzalı UDF" yapılarak gönderilebiliyor.
- E-imza sürücüsü/lisans dosyası eskiyince **imza atılmış görünmesine rağmen
  portala gönderilemiyor**; çözüm en güncel UYAP Editör kurulumu
  [doğrulandı-ikincil, 14.01.2025 uyarısı].
- Editör macOS ve iOS'ta pratikte çalışmıyor (§2.1 #4).

**ColleX için sonuç:** DOCX bir **çalışma çıktısıdır**, teslim biçimi
değildir. Ürünün teslim biçimi **UDF olmak zorundadır** ve UDF'in
"deneysel" kalması ürünü mahkeme yolunda kullanılamaz kılar.

### 3.2 KEP / UETS tebligat ve süre

- Tebligat avukata **UETS** üzerinden gelir; ColleX'in süre hesabı bu tarihi
  bilmez. Elektronik tebligatta **muhatabın adresine ulaştığı tarihi izleyen
  beşinci günün sonunda** tebliğ edilmiş sayılır (7201 s.K. m.7/a) — ColleX
  bunu bir **uyarı** olarak gösteriyor (`KULLANIM-ColleX.md` §6), hesaba
  katmıyor. Bu doğru bir tercih ama eksik: tarih tipi seçilebilmeli.

### 3.3 Adli tatil

- 20 Temmuz – 31 Ağustos. HMK m.104: **son günü** adli tatile rastlayan
  süreler, adli tatilin bittiği günden itibaren **bir hafta** uzamış sayılır
  (→ 7 Eylül). İki şart: (a) yalnız son gün tatile rastlarsa, (b) yalnız
  **adli tatile tâbi** dava ve işlerde. [doğrulandı-ikincil, birden çok
  büro yayını, 2026]
- ColleX `holidays.ts`/`rules.ts` tam bu mekanizmayı uyguluyor ve
  `hmk-istinaf 15.07.2026 → 07.09.2026` probe'u ile kanıtlanmış
  (`W12-INTEGRATION` §6). **Eksik olan (b) şartı**: iş adli tatile tâbi mi
  sorusu kullanıcıya sorulmuyor, kural bazlı ön işaretleniyor. İhtiyati
  tedbir, delil tespiti, iş mahkemesi ve icra işlerinde bu **yanlış** uzatma
  üretebilir. → §8 D-4.

### 3.4 Baro / TBB reklam yasağı

TBB Reklam Yasağı Yönetmeliği (21.11.2003; **09.08.2024 kapsamlı
değişiklik**, dijital kurallar sıkılaştırıldı) [doğrulandı-ikincil,
d.barobirlik.org.tr PDF + baro yayınları]:

- Avukat, arama motoru anahtar kelimesi olarak yalnız ad-soyad, ortaklık/büro
  adı, bulunduğu il ve barosu ile "avukat, hukuk, adalet, savunma, hak" gibi
  **genel** sözcükleri kullanabilir.
- **Müvekkil yorumu, referans, teşekkür, kazanılmış dava, şirket adı, başarı
  hikâyesi paylaşımı yüksek risklidir.**
- Reklam, "**üstünlük iddiası, başarı vaadi, slogan**" ile ortaya çıkar.

**ColleX için sonuç (iki yönlü):**
1. ColleX'in **kendi** arayüzü ve dokümanı avukata "başarı oranı", "%97
   doğruluk", "davanızı kazandırır" gibi bir sayı **vermemelidir** — avukat o
   sayıyı müvekkiline aktarırsa yönetmeliği ihlal eder. ColleX'in mevcut
   dili (`ÇEKİMSER`, `KESİNLEŞTİRİLEMEZ`, "hukukî isabet kontrolü değildir")
   bu açıdan **doğru** ve korunmalıdır.
2. ColleX **avukat için pazarlama metni / web sitesi / SEO içeriği üreten**
   bir şablon eklememelidir. (13 şablonda yok — iyi.)

### 3.5 KVKK — avukatın yükümlülüğü ve bulut AI

- **VERBİS:** 1136 sayılı Kanun kapsamındaki serbest avukatlar VERBİS'e
  kayıttan **muaftır** (KVK Kurulu 02.04.2018 tarih **2018/32** sayılı karar;
  RG 15.05.2018). Muafiyet **yalnız sicile kayıt** içindir: avukat **veri
  sorumlusudur** ve aydınlatma, hukuka uygun işleme, veri güvenliği, ilgili
  kişi başvurusu yükümlülükleri **devam eder**. [doğrulandı — kvkk.gov.tr
  2018/32 sayfası + KVKK "Kayıt İstisnaları"]
- **Yurt dışına aktarım (7499 s.K. ile değişik KVKK m.9):** üç kademeli
  süzgeç — (1) **yeterlilik kararı**, (2) **uygun güvenceler** (standart
  sözleşme / bağlayıcı şirket kuralları / taahhütname), (3) **arızi
  istisnalar** (m.9/6, tek seferlik, süreklilik arz etmeyen). **Açık rıza
  artık genel kural değil, istisnadır.** Standart sözleşme imzalandıktan
  sonra **5 iş günü içinde** Kurula bildirilir; bildirim yükümlülüğüne
  aykırılık 2026'da **90.000 – 1.800.000 ₺** idari para cezası.
  [doğrulandı-ikincil: kvkk.gov.tr Yurt Dışına Aktarım Rehberi (Yayın No: 48),
  Kurul 04.06.2024 – 2024/959; Mondaq 2026 derlemeleri]

> **Bu, ColleX'in bulut AI hattı için doğrudan bir tasarım kısıtıdır.**
> Anthropic yurt dışındadır. ColleX'in bugünkü "istek başına onay kutusu"
> (ADR-018) **KVKK m.9 anlamında bir aktarım hukuku sağlamaz**: rutin
> kullanımda "arızi istisna" tükenir, doğru araç standart sözleşmedir ve o
> sözleşmeyi imzalayacak olan **avukatın kendisidir** (veri sorumlusu odur,
> ColleX değil). ColleX'in yapması gereken şey aktarımı hukuka uygun hâle
> getirmek değil, **avukata neyin gittiğini göstermek, en aza indirmek ve
> kaydını tutmaktır.** → §7 G-4/G-5.

### 3.6 Avukatlık Kanunu m.36 (sır saklama) ve m.34 (özen)

Ankara Barosu HUBİTEM, **"Avukatlıkta Yapay Zeka Araçlarının Kullanımı
Rehberi v.1.0"** [doğrulandı — PDF, 13 sayfa, ankarabarosu.org.tr]:

- m.36 sır saklama bakımından avukatın önceliği, *"kullanılan yapay zeka
  aracının **kendini eğiten türden bir sistem olup olmadığını** bilmesi"*dir.
- *"müvekkillere ilişkin **her türlü kişisel bilgi anonim hale getirilmeli** ve
  müvekkillerin kimliğinin saptanmasında kullanılabilecek veriler yapay zekâ
  girdisinde yer almamalıdır."*
- m.34 (özen) bakımından: model *"oldukça ikna edici görünen, yanıltıcı ve
  hatalı cevaplar üretebilir"*; avukattan sistemin **sonuçları nasıl
  ürettiğini anlaması** beklenir.
- Şahsen ifa bakımından: yapay zekâ üretimi içerik kullanılabilir ama
  *"sorumluluk halen vakayı yürüten avukat üzerinde kalacaktır"* ve
  *"avukatın bu sorumluluğu başka bir tarafa devretmesi mümkün değildir."*
- Sonuç bölümü dört başlık dayatıyor: **Gizlilik/sır**, **Fikri mülkiyet**,
  **Bilgilendirme yükümlülüğü** (*"Avukat, kullandığı yapay zeka araçları
  hakkında müvekkilini açık ve doğru şekilde bilgilendirmelidir"*),
  **Müvekkil menfaatine uygunluk** (*"içeriğin güvenilirliğini diğer
  kaynaklardan teyit edilerek doğrulamalıdır"*).

**TBB'nin kendi rehberi — 28.08.2026** (barobirlik.org.tr duyurusu bu
makineden 402 döndü; içerik `hukukihaber.net` analizinden
[doğrulandı-ikincil, 28.08.2026]): TBB, "Avukatlar İçin Yapay Zekâ Kullanımı
Tavsiye Rehberi"ni yayımladı ve meslektaşlara SMS ile duyurdu. Rehber AI
kullanımını **dört risk kademesine** ayırıyor (serbest / kontrollü /
kısıtlı / yasak); ilkeler: mesleki sırrın devredilemezliği, hassas veride
**açık rıza**, mahkemeye sunmadan önce **doğrulama**, halüsinasyon riski,
**nihai sorumluluğun avukatta kalması** ve uygun güvence olmadan
**yurt dışı sunuculara aktarım yasağı**. Rehber "tavsiye niteliğinde"dir.

> **Bu, ColleX'in en büyük dağıtım fırsatıdır.** TBB rehberi yayımlandıktan
> **5 gün sonra** (bugün) piyasada, kendini "kapalı devre / yerel /
> anonimleştirilmiş" diye kanıtlayabilen tek ürün ColleX'e yakındır. Ama
> kanıtlaması gereken şey yalnız mimari değil, **ekranda görünen bir
> uyum yüzeyi**dir (§7).

---

## 4. (a) Türk solo avukatının **para ödeyeceği** yetenekler — sıralı

Sıralama ölçütü: (i) günlük tekrar sayısı, (ii) hata maliyeti, (iii) bugün
hiç kimsenin iyi çözmemiş olması. Her satırda kanıt.

| # | Yetenek | Neden ödenir (kanıt) | Bugün kim yapıyor | ColleX |
|---|---|---|---|---|
| **1** | **Kaçırılmayan süre**: tebligat → tebliğ tarihi → doğru süre → takvim → hatırlatma | Süre kaçırma mesleki sorumluluğun en ağır ihlali [doğrulandı-ikincil]; UYAP SMS ikinci katman olarak öneriliyor; Tebligo doğrudan bunu satıyor | Tebligo, Tebli, otomasyon programları | **Yarım** — hesap var, tetikleyici (UETS) yok, kurallar `dogrulanmadi` |
| **2** | **Dosya inceleme**: kapsamlı bir UYAP dosyasının bütün evrakını **toplu** indirip **tarih sırasına** dizip aranabilir hâle getirmek | TBB platformundaki iki ayrı talep; *"2015'ten süregelen bir dosyayı … incelemeye çalışmak neredeyse imkansız"* [doğrulandı] | UYAP Katibim (toplu indirme), Turbo Law (ABD'de) | **Yarım** — yükleme + kronoloji var, **indirme yok** |
| **3** | **UYAP'a gönderilebilir dilekçe** (UDF, e-imzalanabilir, temiz) | UYAP DOCX kabul etmiyor; UDF zorunlu [doğrulandı]. OveK/SmartHukuk bunu satış başlığı yapmış | OveK, SmartHukuk, De Jure | **Kırık** — UDF `deneysel`, DOCX her sayfada makine bandı taşıyor |
| **4** | **Uydurma künye üretmeyen araştırma** | Kızılcahamam vakası: çifte soruşturma [doğrulandı]; TBB rehberi halüsinasyonu ayrı başlık yapmış | Herkes iddia ediyor, kimse mekanizma göstermiyor | **Güçlü ve tek** — hash + reddetme |
| **5** | **Karşı tarafın dayanaklarını doğrulama** (mülga mı, değişmiş mi, aksi karar var mı) | Kızılcahamam vakasında **karşı vekil** yakaladı; duruşma hazırlığının özü | Kimse ilan etmiyor [çıkarım] | **Güçlü** — as-of + citator + karşıt tarama |
| **6** | **Tebligat kutusunun otomatik boşaltılması** | T-akıbet **ücretsiz** yapıyor; Tebligo "%99,2" ile satıyor | T-akıbet, Tebligo | Yok |
| **7** | **Müvekkile "dosyan ne oldu" cevabı** (portal / özet) | Otomasyonların standart modülü; müvekkil portalı ayrı satılıyor | KolayOfis, Jure, RadKod | Yok |
| **8** | **İcra**: toplu takip açma + sorgu + ücret hesabı | Ayrı bir ürün kategorisi (İcraPro, UYAP Katibim); Jure "İcra Takip + otomatik ücret hesabı" modülü koymuş | İcraPro, UYAP Katibim, Jure | Yok |
| **9** | **Tahsilat/ücret takibi** (vekâlet ücreti, masraf avansı) | Otomasyonların en eski modülü (KolayOfisNG Hesap) | KolayOfis vb. | Yok |
| **10** | **Büro arşivinin aranabilir hâle gelmesi** ("kurumsal hafıza") | Jupytr'ın ana satış başlığı, 4.490 ₺/kullanıcı/ay ile | Jupytr | **Yakın** — intake + FTS + trigram var, "büro arşivi" olarak paketlenmemiş |

---

## 5. (b) ColleX'in "tek günlük araç" olması için eklemesi gerekenler

Sıra bilinçli: her madde bir öncekine bağlı. **Yeni bir dış servise
bağlanmadan** yapılabilecekler önde.

### P0 — bunlar olmadan ürün mahkeme yolunda kullanılamaz

**P0-1 · Temiz UDF teslim çıktısı + UYAP doğrulaması.**
Bugün `export/petition.py` DOCX'e **her sayfaya altbilgi** olarak
`DRAFT_REVIEW_BANNER` ("Bu taslak makine üretimidir; avukat incelemesi
zorunludur.") + ilk sayfa gövde bandı + `DAYANAK KAYNAKLARI` hash ekini
yazıyor (`_build_footer`, satır 238–260; 382–390). Bir Türk avukatı bu
belgeyi **hiçbir mahkemeye sunamaz**. Gereken üç şey:
1. `?format=udf-nihai` / "Nihai sürüm" çıkışı: banner ve hash eki **yok**,
   `[K-n]` gövde atıfları isteğe bağlı, "Bu taslak makine üretimidir" yalnız
   **ekranda ve dosya adında** (`… - TASLAK.docx` vs `… - NİHAİ.udf`) kalır.
   Kanıt/hash paketi **ayrı bir dosya** (`collex.answer.evidence-bundle/v1`)
   olarak iner — mahkemeye giden metinden ayrılır.
2. Nihai çıkışta **doğrulama yine zorunlu** kalsın: doğrulanamayan alıntı
   varsa yine `EXPORT_REFUSED` (bu, ürünün ruhudur — kaldırılamaz).
3. **Bir UDF'yi UYAP Doküman Editörü'nde açmak** (STATUS "Next actions" #4).
   Bu, mühendislik değil **20 dakikalık bir kullanıcı işidir** ve şu anda
   ürünün en pahalı açık bahsidir. Açılmıyorsa `export/udf.py` öznitelikleri
   düzeltilir; açılıyorsa "deneysel" etiketi düşer.
4. UDF üretilirken **UYAP sınırlarına** uy: tek dosya ≤ 40 MB, ek ≤ 5 evrak;
   çıktı ekranında "UYAP'a 5 ekten fazla yükleyemezsiniz" hatırlatması.

**P0-2 · UYAP/UETS köprüsü (yerel, e-imzasız, salt-okuma).**
ColleX UYAP'a bağlanmıyor ve bağlanmamalı (e-imza + oturum + hukuki risk).
Ama **avukatın kendi indirdiği** paketi kabul edebilir:
- **"UYAP klasörü içe aktar"**: avukat UYAP'tan/UYAP Katibim'den/T-akıbet'ten
  indirdiği klasörü ColleX'e bırakır; ColleX PDF'leri, tarihleri, evrak
  türlerini çıkarır, **tarih sırasına dizer** ve dosyanın zaman çizelgesine
  yazar. Bu, §2.1 #1 ve #3'teki iki resmî TBB talebini **UYAP'ı
  değiştirmeden** çözer. Mevcut `intake/` + `matters` + kronoloji bunun
  %70'ini zaten yapıyor.
- **UETS ZIP içe aktar**: T-akıbet'in ürettiği tebligat paketini alıp her
  tebligat için "tebliğ tarihi" adayı çıkarır ve **doğrudan süre hesabına**
  bağlar. Bu, §4 #1 ve #6'yı tek hamlede kapatır.
- Bugünkü **25 MB** yükleme sınırı burada yetmez: UYAP tek dosya için 40 MB'a
  izin veriyor ve toplu dosya klasörü çok daha büyük. Sınır tek dosya için
  ≥ 40 MB'a çıkmalı ve **klasör içe aktarım** dosya dosya işlemeli
  (`UPLOAD_CAP_MIB` tek kaynak kuralı korunarak).

**P0-3 · 30 süre kuralının doğrulanması.**
30 kuralın tamamı `verified.status: 'dogrulanmadi'` ve her sonuçta
"DOĞRULANMADI — madde metniyle kontrol edin" yazıyor. Bu **dürüst** ama
§4 #1'i satılamaz kılıyor: bir avukat, üzerinde "doğrulanmadı" yazan bir
takvime davasını emanet etmez. Bu tek seferlik, sınırlı bir hukukçu işidir
ve ürünün en yüksek getirili işidir.

### P1 — günlük araç olmak için

**P1-1 · Eksik süre kuralları.** Mevcut 30 kural iyi seçilmiş (HMK 9, CMK 4,
İYUK 6, İİK 6, AYM 1, diğer 4) ama solo litigatörün gününde en sık geçen
birkaçı yok:
- **HMK m.281 — bilirkişi raporuna itiraz, 2 hafta** (+ m.281/2 bir defaya
  mahsus 2 hafta ek süre). Süresi kaçarsa rapor aleyhe kesinleşir ve
  istinafta ileri sürülemez [doğrulandı-ikincil]. **En kritik eksik.**
- HMK m.94 kesin süre / m.140 delil listesi (2 hafta), m.318 basit yargılama
  cevap (2 hafta).
- İİK m.78 haciz isteme (1 yıl), m.106 satış isteme, m.128/a kıymet takdirine
  itiraz (7 gün), m.134 ihalenin feshi (7 gün) — icra ağırlıklı bir solo
  büro için günlük.
- TBK m.350/352 kira tahliye dava süreleri (1 ay), TMK m.606 mirasın reddi
  (3 ay).

**P1-2 · "İş adli tatile tâbi mi?" sorusu.** HMK m.104 uzatması yalnız
**adli tatile tâbi** işlerde ve yalnız **son gün** tatile rastlarsa geçerli
(§3.3). ColleX'te adli tatil kutusu kural bazında **önceden işaretli**
geliyor; iş adli tatile tâbi değilse (ihtiyati tedbir, delil tespiti, iş
mahkemesi işleri, icra) bu **yanlış tarafta hata** üretir. Kutu üç durumlu
olmalı: "tâbi / tâbi değil / bilmiyorum → uzatmasız + uzatmalı iki tarih de
gösterilir".

**P1-3 · Tebliğ tarihi tipi.** Süre penceresinde başlangıç tarihinin yanına
tip seçici: *fiziki tebliğ · elektronik tebligat (UETS) · tefhim · öğrenme*.
UETS seçilince 7201 s.K. m.7/a-4'ün beşinci gün kuralı **hesaba katılır**
(bugün yalnız uyarı olarak yazılıyor).

**P1-4 · Büro arşivi ("kurumsal hafıza") paketlemesi.** Jupytr bunu
4.490 ₺/kullanıcı/ay'a satıyor. ColleX'in `chunkStore` (Türkçe FTS +
`pg_trgm` + citator) + `intake` bunu zaten yapabilir; eksik olan **"eski
dilekçelerimde bu konuyu nasıl yazmıştım?"** diye soran bir ekran ve
"kendi dilekçelerimden" kapsamı.

**P1-5 · Müvekkil özeti çıktısı.** Dosya sayfasından tek düğme: son işlemler,
sonraki duruşma, bekleyen süre, atılan adımlar → **hukukçu jargonsuz** bir
PDF/e-posta metni. Bu, avukatın telefonda geçirdiği zamanı doğrudan azaltır
ve hiçbir doğrulama riski taşımaz.

### P2 — sonra

- Tahsilat/ücret defteri (vekâlet ücreti, masraf avansı, serbest meslek
  makbuzu takibi) — otomasyonun yerini almanın önkoşulu.
- İcra takip modülü — burası ayrı bir ürün; girmemek de savunulabilir bir
  karar, ama o zaman ColleX "tek araç" değil "araştırma+dilekçe aracı"dır ve
  mesaj öyle kurulmalıdır.
- Mobil: **yapmayın.** Celse ve UYAP mobil şikâyetleri gösteriyor ki
  mobilde beklenen tek şey "duruşma listesi + mazeret dilekçesi"; ColleX'in
  yerel mimarisi buna uygun değil ve söz vermemek daha dürüst.

---

## 6. Fiyat/konumlandırma önerisi (bu depo kapsamı dışı — yalnız ilke)

Pazar üç fiyat çıpası veriyor: **0 ₺** (kararTek, T-akıbet, Emsal AI free),
**500–2.500 ₺/ay** (SmartHukuk, Emsal AI), **34.200–48.000 ₺/yıl** (Lexpera).
ColleX **tek makinede, aboneliksiz, veriyi dışarı çıkarmayan** bir ürün
olduğu için doğru karşılaştırma Lexpera değil, **büro otomasyonunun yenileme
bedeli** (2.600 ₺/yıl) + **bir AI aboneliği** (15.000 ₺/yıl) toplamıdır.
Tek satır mesaj: *"Bir yılda bir kez ödersiniz; verileriniz hiçbir yere
gitmez; ürettiği her cümlenin kaynağını siz doğrulayabilirsiniz."*

---

## 7. (c) Uyum ve güven korkulukları — ekrana yazılacak **birebir** Türkçe

Aşağıdaki cümleler, TBB rehberi (28.08.2026), Ankara Barosu HUBİTEM rehberi
v1.0, Avukatlık Kanunu m.34/36, KVKK m.9 ve Reklam Yasağı Yönetmeliği'nden
türetilmiştir. Öneri: `control-plane/src/store/persistNotice.ts` yanına bir
`compliance/notices.ts` konulup birebir metin orada tutulsun ve
`console.test.ts` tıpkı `DEADLINE_DISCLAIMER` gibi **birebir** sabitlesin.

**G-1 · Bulut AI onay kutusunun yanına (bugünkü tek satırın yerine):**

> Bu istek seçtiğiniz metni **yurt dışındaki** Anthropic sunucularına
> gönderir. Göndermeden önce müvekkilinizi tanımlayan bilgileri
> (ad-soyad, TCKN, adres, dosya no) çıkarın. Avukatlık Kanunu m.36 uyarınca
> sır saklama yükümlülüğü size aittir ve bu araç o yükümlülüğü üstlenmez.

**G-2 · Bulut AI ilk açılışta bir kez gösterilecek onay ekranı:**

> **Bulut yapay zekâ (Bulut AI) hakkında bilmeniz gerekenler**
> 1. Gönderdiğiniz metin Türkiye dışına aktarılır. KVKK m.9 uyarınca yurt
>    dışına aktarım için açık rıza artık genel kural değil, istisnadır;
>    süreklilik arz eden kullanım için uygun güvence (standart sözleşme)
>    gerekir. Bu güvenceyi sağlamak **veri sorumlusu olarak size** düşer.
> 2. Türkiye Barolar Birliği'nin 28.08.2026 tarihli tavsiye rehberi, uygun
>    güvence olmadan yurt dışı sunuculara aktarımı önermez.
> 3. ColleX bu hattı **kapalı** kullanır; kapalıyken ürünün tamamı çalışır.
> ☐ Okudum. Bu bilgisayarda Bulut AI'yi kendi sorumluluğumla açıyorum.

**G-3 · Her Bulut AI çıktısının üstünde (mevcut "KAYNAKSIZ" ile birlikte):**

> Bu metin bir yapay zekâ modeli tarafından yazılmıştır. Nihai hukukî
> değerlendirme ve sorumluluk avukata aittir; bu sorumluluk devredilemez.

**G-4 · Yeni ekran — Ayarlar › "Bulut AI kayıt defteri" (BUGÜN YOK, eklenmeli):**
Her bulut isteğinin tarihi, hangi dosya, kaç karakter, hangi model, hangi
bölüm. Avukat bunu müvekkiline gösterebilmeli ve bir denetimde
"neyi ne zaman gönderdim" sorusuna cevap verebilmeli. Satır başlığı:

> Bu defter, hangi metnin ne zaman yurt dışına gönderildiğini gösterir.
> Metnin kendisi saklanmaz; yalnız kaydı tutulur.

**G-5 · Yeni özellik — "Göndermeden önce maskele" (BUGÜN YOK):**
Ankara Barosu rehberi *"müvekkillere ilişkin her türlü kişisel bilgi anonim
hale getirilmeli"* diyor. Bulut isteğinden önce TCKN (11 hane), VKN (10
hane), telefon, IBAN ve `matters` kaydındaki taraf adları otomatik olarak
`[MÜVEKKİL]`, `[KARŞI TARAF]`, `[TCKN]` ile değiştirilip **avukata önizleme**
gösterilmeli. Düğme metni: **"Maskele ve gönder"** / **"Maskelemeden gönder"**.
Bu, ürünün TBB rehberine karşı gösterebileceği en somut kanıttır.

**G-6 · Süre sonucunun altındaki mevcut iki uyarıya bir üçüncü:**

> Bu hesap tebliğ tarihini sizin girdiğiniz gibi kabul eder. Elektronik
> tebligatta tebliğ, muhatabın adresine ulaştığı tarihi izleyen beşinci
> günün sonunda yapılmış sayılır (7201 s.K. m.7/a). Tebliğ şerhini
> UYAP'tan doğrulayın.

**G-7 · Taslak editöründe, dışa aktarma düğmelerinin yanında:**

> UYAP yalnız `.udf`, `.pdf`, `.jpg`, `.png`, `.tiff` kabul eder; **Word
> (DOCX) dosyası UYAP'a yüklenemez.** DOCX'i kendi arşiviniz ve düzeltmeniz
> için kullanın, mahkemeye UDF gönderin.

**G-8 · Ayarlar › Verilerim nerede? bölümüne bir satır:**

> Serbest avukatlar VERBİS'e kayıttan muaftır (KVK Kurulu 02.04.2018,
> 2018/32). Muafiyet yalnız sicile kayıt içindir: aydınlatma, veri güvenliği
> ve ilgili kişi başvurusu yükümlülükleriniz sürer. ColleX verilerinizi bu
> bilgisayarda tutar; bunun güvenliği (Windows hesabı, disk şifreleme,
> yedek) sizin sorumluluğunuzdadır.

**G-9 · Yasaklı dil (reklam yasağı + TBB rehberi).** Ürün hiçbir yerde
şunları **yazmamalı**: başarı oranı, "davanızı kazandırır", "%N doğruluk",
"en iyi", "hukuki tavsiye", "avukata gerek kalmadan". `console.test.ts`
LANG-7 kuralına ("Bulut AI" adlandırması) benzer bir **yasaklı sözcük
testi** eklenmeli.

---

## 8. (d) Bugünkü üründe bir Türk avukatının **yanlış / tuhaf / utandırıcı**
bulacağı şeyler

Şiddet sırasına göre. Her madde dosya/satır ile.

**D-1 (P0, utandırıcı) · Mahkemeye sunulamayan çıktı.**
`export/petition.py` DOCX'in **her sayfasının altbilgisine**
"Bu taslak makine üretimidir; avukat incelemesi zorunludur." yazıyor
(`_build_footer`, 238–260), ilk sayfaya ayrıca gövde bandı koyuyor (385) ve
belgenin sonuna hash'li `DAYANAK KAYNAKLARI` eki ekliyor. Bir avukat bu
dosyayı ne müvekkiline ne mahkemeye verebilir; metni başka bir belgeye
kopyalayıp temizlemek zorunda kalır — yani ürünün vaat ettiği zaman
tasarrufu **sıfırlanır** ve elle kopyalarken hata riski girer.
`export/cli.py` ve `drafting/routes.ts`'te **temiz/nihai çıkış anahtarı yok**
(grep: yalnız dosya adı temizleyen `clean()` var).
→ Çözüm P0-1.

**D-2 (P0) · "Yerel korpus" kapsamı boş; ilk izlenim "çalışmıyor".**
`KULLANIM-ColleX.md` §4 açıkça diyor: *"Günlük kurulumda bu depo boştur …
cevap 'ÇEKİMSER' olur — bu doğrudur."* Avukat ürünü ilk açtığında en doğal
şeyi yapar (bir soru sorar, varsayılan kapsam neyse onu bırakır) ve
**ÇEKİMSER** görür. Dürüstlük burada ürünü öldürüyor. Varsayılan kapsam
**"Canlı kaynaklar"** olmalı ve "Yerel korpus" boşken ya gizlenmeli ya da
"(boş — kendi belgelerinizi yükleyin)" diye etiketlenmeli.

**D-3 (P1) · 25 MB yükleme sınırı Türk dosyası için küçük.**
UYAP tek evrakta 40 MB'a izin veriyor [doğrulandı]; taranmış bir icra ya da
ceza dosyası bunu rahatlıkla aşar. `intake/quarantine.py`
`UPLOAD_CAP_MIB = 25` bilinçli bir karar (senkron intake, 180 s bütçe) ama
**avukatın gerçek dosyasıyla çelişiyor**. Gerekçe teknik, sonuç ürünsel.

**D-4 (P1, hukuken yanlış olabilir) · Adli tatil uzatması ayrım yapmıyor.**
HMK m.104 uzatması yalnız **adli tatile tâbi** işlerde uygulanır (§3.3).
`rules.ts`'te adli tatil kural bazında ön işaretli; iş adli tatile tâbi
değilse süre **7 Eylül'e uzatılmış gibi** gösterilebilir — ve bu, avukatın
**süreyi kaçırması** demektir. Bu, "dogrulanmadi" etiketiyle savunulamayacak
tek hata sınıfıdır, çünkü hata **güvenli olmayan** tarafta.

**D-5 (P1) · Vekâlet ücreti sözleşmesi şablonu kanunî sınırları
tanımıyor (kontrol edilmeli).**
Şablon listesinde "vekâlet ücreti" sözleşmesi var (`KULLANIM-ColleX.md` §5).
Avukatlık Kanunu m.164/1: ücret, dava değerinin **%25'ini aşamaz**
(aşan kısım kısmî butlan); m.164/4: **Avukatlık Asgari Ücret Tarifesi'nin
altında** ücret kararlaştırılamaz; m.163: sözleşme belirli bir hukukî yardımı
ve ücreti içermelidir; ücretsiz iş baroya bildirilir. [doğrulandı-ikincil]
Şablon yüzde alanı alıyorsa **>25 için uyarmalı**, tarife altı tutar için
uyarmalı. Aksi hâlde ürün avukata **disiplin suçu ürettirir**.

**D-6 (P1) · Tahliye taahhütnamesi şablonu form riski taşıyor.**
Tahliye taahhüdü, kiralananın tesliminden **sonra** ve yazılı olarak
verilmelidir (TBK m.352/1); düzenleme tarihi ile tahliye tarihinin ilişkisi
Yargıtay'ın en çok bozduğu konulardan biridir. Şablon bunu bir **zorunlu
uyarı** olarak taşımıyorsa (kontrol edilmeli), üretilen belge geçersiz olur.

**D-7 (P2, tuhaf) · Kaynak kartlarında "(SENTETİK)".**
Deneme veritabanında kaynak çipi "(SENTETİK)" gösteriyor. Bir avukat için bu
kelime hiçbir şey ifade etmez ve ürünün "sahte karar üretiyor" izlenimi
verir — Kızılcahamam vakasından sonra bu **çok kötü** bir çağrışımdır.
Türkçesi: **"örnek metin — gerçek karar değil"**.

**D-8 (P2, tuhaf) · Hata kodlarının parantez içinde gösterilmesi.**
`QUESTION_NOT_COVERED`, `CORPUS_UNAVAILABLE`, `PAYLOAD_TOO_LARGE` ekranda
görünüyor. Gerekçe (destek) doğru, ama varsayılan olarak **gizlenmeli**,
"Ayrıntı" ile açılmalı.

**D-9 (P2) · "Bilgisayar tek kullanıcılıdır, şifre sormaz."**
Bir avukat bürosunda bilgisayar başında sekreter, stajyer, temizlik görevlisi
olur. Avukatlık Kanunu m.36 ve KVKK veri güvenliği yükümlülüğü karşısında
"şifre sormaz" cümlesi savunulamaz. En azından **konsola bir yerel PIN**
(oturum kilidi) ve Ayarlar'da "Windows hesabınızı kilitleyin" yerine somut
bir yönerge gerekir.

**D-10 (P2) · Ürün UYAP'a bağlanmadığını doğru söylüyor ama alternatif
sunmuyor.** `KULLANIM-ColleX.md` §9: *"ColleX UYAP'a, UETS'ye bağlanmaz,
duruşma takibi yapmaz, tebligat almaz."* Bu dürüst; ama avukat için
okunuşu "bu program günlük işime dokunmuyor"dur. P0-2'deki **içe aktarım**
yolu eklenirse aynı cümle şöyle olur: *"ColleX UYAP'a bağlanmaz; UYAP'tan
indirdiğiniz dosyayı ve UETS paketini içe aktarır."*

---

## 9. Kaynak listesi (hepsi 02.09.2026 erişimi)

| Kaynak | Ne için | Etiket |
|---|---|---|
| lexpera.com.tr/uyelik-destek/paketler-ucretler | Paket fiyatları (0/34.200/43.800/48.000 ₺) | doğrulandı |
| kazanci.com.tr · sikayetvar.com/kazanci-hukuk-otomasyon-programlari | Ürün varlığı, fiyat kapalılığı | doğrulandı (varlık) |
| karartek.com.tr (403) + barobirlik.org.tr/Haberler/…-69007 | TBB kararTek: 1M+ Yargıtay kararı, avukata ücretsiz | doğrulandı-ikincil |
| mevzuat.sinerjias.com.tr · apps.apple.com/tr/app/sinerji-mevzuat | Sinerji ürün kapsamı | doğrulandı |
| mevzuatvekararlar.legalbank.net | Legalbank varlığı | doğrulandı |
| giresunbarosu.org.tr/Haber/…/420 | Baro toplu abonelik (aylık 11 ₺) | doğrulandı-başlık |
| smarthukuk.com/blog/en-iyi-avukat-programlari-hukuk-burosu-yazilimlari-2026 | Otomasyon fiyat aralıkları (7.490–186.000 / 2.600–65.000 / 31.000–89.000 ₺), SmartHukuk 500/1.000/2.000 ₺ ay | doğrulandı |
| microdestek.com.tr (KolayOfis / KolayOfisNG) | Otomasyon kapsamı, lisans modeli | doğrulandı |
| zirve-bilgisayar.com (İcraPro, e-İcraProPlus) | İcra + UYAP portal entegrasyonu | doğrulandı |
| hukas.com.tr | UYAP **+ UETS** entegre otomasyon | pazarlama |
| jure.com.tr | 29+ modül, UYAP senkron, İcra Takip, Akıllı Takvim; "%97", "6 saat→40 dk", "Baro Onaylı" | doğrulandı (özellik) / pazarlama (sayılar) |
| emsal.ai | 0 / 1.250 / 2.500 ₺+KDV ay; "11M+"; "Kaynaklı ve Denetlenebilir Yanıtlar" | doğrulandı (fiyat) / pazarlama (korpus) |
| jupy.tr · webrazzi.com/2026/06/26 | 4.490 ve 11.900 ₺/kullanıcı/ay; kurumsal hafıza; "halüsinasyonsuz" | doğrulandı (fiyat) / pazarlama |
| ovekhukuk.com | 12 modül, "UYAP uyumlu UDF", baroya %40, "OveK de hata yapabilir", "model eğitiminde kullanılmaz" | doğrulandı |
| legalengine.com.tr/blog/avukatlar-icin-yapay-zeka | "kapalı devre sistemler", "Sır Saklama Yükümlülüğü" | doğrulandı |
| webrazzi.com/2026/06/18 (Turbo Law) | 3,8 M$ / Revo Capital / 18.06.2026; 1.800 dosya, 5M sayfa | doğrulandı |
| t-akibet.com/uets | Ücretsiz UETS toplu indirme; *"Hiçbir veri sunucularımıza gönderilmez"* | doğrulandı |
| tebligo.com | UETS 7/24 senkron, otomatik dosya/müvekkil oluşturma; "%99,2" | doğrulandı (özellik) / pazarlama (sayı) |
| uyapkatibim.com | Toplu takip açma, toplu sorgu, toplu evrak indirme, 5 oturum çözümü | doğrulandı |
| bilisimtalepleri.barobirlik.org.tr (+ /Talepler/…) | TBB'nin kendi platformu: kategori sayıları ve **avukatların birebir cümleleri** | doğrulandı |
| sikayetvar.com/uyap/avukat-portal | UYAP şikâyet başlıkları | doğrulandı |
| avukatsitesi.org/blog/uyap-avukat-portal-kullanim-rehberi (05.08.2026) | UYAP günlük işlevler, "Word documents rejected", e-imza/oturum sorunları | doğrulandı |
| vatandas.uyap.gov.tr/main/avukat/sss.jsp (derleme) | Kabul edilen formatlar (.pdf/.jpeg/.jpg/.png/.tiff/.udf), 40 MB, 5 ek | doğrulandı-ikincil |
| uyap.gov.tr/e-durusma-tum-turkiyede + basın (31.05.2026) | e-Duruşma 81 ilde, 5,6 M+ duruşma | doğrulandı-ikincil |
| ankarabarosu.org.tr/…/yapay_zeka_araclarnn_kullanm_rehberi_X1.pdf | Ankara Barosu HUBİTEM "Avukatlıkta Yapay Zeka Araçlarının Kullanımı Rehberi v.1.0" — m.34/36, anonimleştirme, bilgilendirme yükümlülüğü | doğrulandı (PDF metni okundu) |
| barobirlik.org.tr/Haberler/…-86648 (402) + hukukihaber.net/tbb-avukatlar-icin-yapay-zeka-rehberininin-analizi | TBB tavsiye rehberi, **28.08.2026**, dört risk kademesi, yurt dışı sunucu, açık rıza, nihai sorumluluk | doğrulandı-ikincil |
| kvkk.gov.tr/Icerik/4233/2018-32 · /Icerik/2044 · /Icerik/8142 (Yayın No: 48) | Avukat VERBİS istisnası (02.04.2018–2018/32, RG 15.05.2018); m.9 üç kademeli aktarım; standart sözleşme 5 iş günü bildirimi | doğrulandı / doğrulandı-ikincil |
| d.barobirlik.org.tr/…/Reklam_Yasagi_Yonetmeligi.pdf + baro yayınları | Reklam yasağı: üstünlük iddiası/başarı vaadi/slogan yasak; 09.08.2024 değişikliği | doğrulandı-ikincil |
| yeniakit.com.tr/…-2008428 (20.06.2026) | Kızılcahamam: uydurma Yargıtay künyeleri, savcılık + Ankara Barosu soruşturması | doğrulandı-ikincil |
| barandogan.av.tr / okyanushukuk.com (HMK m.281) | Bilirkişi raporuna itiraz 2 hafta; süresinde itiraz edilmezse aleyhe kesinleşir | doğrulandı-ikincil |
| kadimhukuk.com.tr, gsghukuk.com (adli tatil 2026) | 20 Temmuz–31 Ağustos; m.104 bir hafta uzama, iki şart | doğrulandı-ikincil |
| barobirlik.org.tr/Haberler/…-86198 | 2026 CMK Ücret Tarifesi, RG 08.01.2026 sayı 33131 | doğrulandı-ikincil |
| app.e-uyar.com / kamaci.av.tr (Avukatlık K. m.163-164) | %25 tavanı, tarife altı yasağı | doğrulandı-ikincil |

**Erişilemeyenler (bu makineden):** karartek.com.tr (Cloudflare 403),
eksisozluk.com (403), sinerjias.com.tr (ECONNREFUSED),
barobirlik.org.tr/Haberler/* ve bilisimtalepleri ana duyuruları (402 — alt
sayfalar curl ile 200 döndü), tebli.co (403), teyit.org (403),
mevzuat.gov.tr ve Yargıtay karar arama (ülke kısıtı).
