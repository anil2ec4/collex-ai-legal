# W13 — LANE APILEX: Apilex (apilex.ai) tam yüzey istihbaratı

Belge tarihi / erişim tarihi: **02.09.2026** (aksi yazmadıkça bu belgedeki her
Apilex verisi bu gün alınmıştır).
Kapsam: apilex.ai'nin tüm kamuya açık yüzeyi (sitemap'ten sayılan **101 URL**,
4 dil), mağaza kayıtları (Google Play, Apple App Store), üçüncü taraf kaynaklar
(şikayetvar, ekşi sözlük, baro duyuruları, basın), ve bunların ColleX'in bugün
çalışan mekanizmalarıyla karşılaştırması.

## 0. Dürüstlük etiketleri ve yöntem

- **[doğrulandı]** = Apilex'in kendi yüzeyinde (site, mağaza kaydı, sözleşme
  metni, resmî PDF) bu belgede yazılı erişim tarihinde bizzat görüldü; URL
  verilmiştir.
- **[pazarlama]** = Apilex'in beyanı; mekanizması gösterilmiyor, doğrulanamaz.
- **[çıkarım]** = iki kaynağın karşılaştırmasından ya da bir eksikliğin
  yokluğundan çıkan sonuç; kanıt değil, değerlendirme.
- **[kullanıcı beyanı]** = üçüncü kişi kullanıcının kamuya açık ifadesi.
  İfadenin **var olduğu** doğrulandı; **içeriğinin doğruluğu doğrulanmadı**.
  Bunlar ürün hatası kanıtı değildir; sinyaldir.

Yapılmayanlar (bilerek): hesap açılmadı, kimlik/ödeme bilgisi hiçbir forma
girilmedi, giriş denenmedi, ürünün içine bakılmadı. Apilex Kullanım Koşulları
m.3.2 (vi) rakip ürün geliştirmek için erişimi, (viii) sistematik çıktı
toplamayı yasaklıyor — buna uyuldu, yalnız kimlik doğrulaması gerektirmeyen
kamuya açık sayfalar okundu.

Ölçülemeyenler (dürüst boşluk):
- **Wayback Machine CDX API bu makineden ısrarla `429 Too Many Requests`
  döndürdü** (3 deneme). 12 aylık değişim izi bu nedenle arşivden
  çıkarılamadı; değişim tespiti yalnız `docs/COMPETITIVE.md` (28.08/02.09.2026
  anlık görüntüsü) ile bugünün karşılaştırmasından yapıldı (§6).
- Chrome Web Store listesi bu makineden `consent.google.com` yönlendirmesi
  arkasında kaldı; eklentinin bugünkü sürüm/kullanıcı sayısı okunamadı.
  Eklentinin **varlığı** apilex.ai'nin kendi sayfasından doğrulandı.
- Ürün içi ekran akışı (onboarding) hesap açılmadığı için görülmedi.

---

## 1. Şirket, ölçek, para

| Bilgi | Değer | Etiket / kaynak |
|---|---|---|
| Ticaret unvanı (sözleşme) | **Apilex Teknoloji Anonim Şirketi**, Osmangazi Mah. 3117. Sk. Altınbaş Teknopark No:3/15 Esenyurt/İstanbul, VN 3852066694 | [doğrulandı] apilex.ai/tr/kullanim-kosullari |
| İkinci unvan | Google Play geliştirici adresi **Cumhuriyet Mah. Silahşör Cad. No:65 Şişli**; App Store telif satırı **"© Fitty Teknoloji A.Ş."**; Kütahya Barosu duyurusu **"APİLEX FİTTY TEK. A.Ş"** | [doğrulandı] play.google.com / apps.apple.com / kutahyabarosu.org.tr — **iki farklı tüzel kişi ve iki farklı adres kamusal yüzeylerde yan yana duruyor** [çıkarım] |
| Kurucular | Av. Cebrail Ergül (Kurucu Ortak & CEO), Kemal Tamer, Batuhan İpek | [doğrulandı] apilex.ai/tr/kurucudan-mesaj + basın |
| ARR | **9. ayında 8 milyon doları aştı**; 3. haftada başabaş; **dış yatırım almadı (bootstrap)**; yıl sonuna doğru tur planı | egirisim.com, 23.06.2026 [doğrulandı-haber, şirket beyanı → içerik pazarlama] |
| Ekip | **120 kişi** (egirisim, 23.06.2026). Kendi kariyer sayfasındaki "138+" şablon metnidir, kullanılamaz (§5) | [doğrulandı-haber] / [çıkarım] |
| Pazarlar | Türkiye, **Fransa** (21 Ocak), **Almanya** (28 Mart); "Yakında: İtalya, İspanya, Brezilya" | [doğrulandı] apilex.ai/tr |
| Yan yayın | **apilex.legal** — adı geçen avukatların imzasıyla haftalık hukuk makalesi platformu (TR/EN/FR bölümleri, 7 sayfa arşiv, en yenisi 26.08.2026) | [doğrulandı] apilex.legal |
| Destek | destek@apilex.ai, info@apilex.ai, 850 259 22 42, "7/24" | [doğrulandı] apilex.ai/tr/sss, /tr/iletisim |

**Okuma:** ColleX'in rakibi bir MVP değil; **kâr eden, 120 kişilik, üç ülkede
satan bir şirket**. Fiyat/özellik yarışına girilemez. Tek savunulabilir
konum, onların ürün *sözleşmesinin* bile veremediği şey: **doğrulanabilirlik**.

---

## 2. Ürün yüzeyi — modüller, Apilex'in kendi sözcükleriyle

Ana gezinme yalnız **üç ürün** gösteriyor: **Asistan · Semantik Karar Arama ·
Projeler** ([doğrulandı] apilex.ai/tr, /tr/platform).

### 2.1 Asistan (`/tr/asistan`)
- "İstediğiniz soruyu yönelterek hukuki araştırma ve hukuki belge üretimi
  yapın." · "Araştırma, Analiz ve Üretim Tek Ekranda" [doğrulandı]
- Kaynak seçici çipleri ekran maketinde: **Karar · Mevzuat · Doktrin ·
  Sözleşme/Dilekçe** + "Asistan cevaplasın" [doğrulandı] — **"Doktrin" bir
  kaynak türü olarak ilan ediliyor**; hangi doktrin, kimin, hangi lisansla —
  hiçbir yerde yazmıyor [pazarlama].
- Maket içindeki hazır istemler: "Çatılı iş yeri kira sözleşmesi oluşturur
  musun?", "İş sözleşmelerindeki rekabet maddesinin geçerliliğini araştır.",
  "Sözleşmedeki cezai şart maddelerini analiz et."; yan düğmeler
  **"Bilirkişi Raporu İtirazı" · "Delil Listesi" · "Kaynaklar" ·
  "Özelleştir"** [doğrulandı].
- Araştırma alt-yetenekleri: **Semantik Arama · Konu İlişkisi Tespiti ·
  Güncellik Faktörü** ("En güncel kararları ve mevzuat değişikliklerini
  önceliklendirir") [pazarlama — mekanizma yok].
- "Profesyonel Kullanıma Hazır Metin Üretimi … Dilekçeler, sözleşmeler,
  **ihtarnameler** ve hukuki görüş yazıları" [doğrulandı].
- **Agent Beta**: "Derin hukuki araştırma ve daha detaylı belge üretimi"
  [pazarlama] — adım günlüğü, bütçe, kaynak izi vaadi yok.

### 2.2 Semantik Karar Arama (`/tr/ictihat-arama-motoru`)
- Kapsam listesi (sayı verilmeden): **Üst derece mahkemeleri · İlk derece
  mahkemeleri · Kurul kararları · AİHM kararları · Diğer ilgili yargı
  organları** [doğrulandı] — *bu, önceki anlık görüntüde olmayan bir
  genişlemedir; özellikle **AİHM** ve **ilk derece mahkemesi** kararları.*
- Özellik başlıkları: "Doğal Dil ile Anlamsal Arama", **"Tam Metin
  Kararlar"**, **"Dosyana Ekle ya da Arşivle"** [doğrulandı].
- Korpus sayısı: **"12 milyondan fazla güncel karar"** (/tr/platform ve
  /en/platform) ↔ **"11 milyondan fazla içtihat"** (Google Play açıklaması,
  bugün) — **çelişki bir yıldır sürüyor** [çıkarım, iki resmî yüzey].
- Play açıklaması kapsamı **"Yargıtay, Danıştay ve Bölge Adliye Mahkemesi"**
  ile sınırlıyor; site AİHM + kurul + ilk derece diyor [çıkarım — kapsam
  beyanı yüzeyden yüzeye tutarsız].

### 2.3 Projeler (`/tr/akilli-belge-yazim-platformu`)
- "Tüm dava dosyalarınızı ve hukuki belgelerinizi tek bir alanda toplayın,
  klasörleyin"; desteklenen içerik: **Sözleşmeler · Dava dosyaları · Resmî
  yazışmalar · Raporlar ve ekler · Tarama Belgeleri** (yani **taranmış
  belge/OCR** kabul ediliyor) [doğrulandı].
- **"Binlerce Sayfayı Dakikalar İçinde Analiz Edin"** — toplu analiz
  [pazarlama].
- **"Otomatik Özet ve Karşılaştırmalar"** — "toplu özetler ve **karşılaştırmalı
  analizler**", "kritik farklar ve ortak noktalar **tablolama** özelliğiyle"
  [pazarlama] — *ColleX'te karşılığı olmayan en somut modül.*
- **"Özel Asistan"**: "Asistan, **yalnızca proje içeriğini dikkate alarak**
  sorularınıza yanıt verir" [doğrulandı] — ColleX'in `filters.fileIds`
  "Belgeye sor" akışının doğrudan muadili.
- **"Kurumsal Bilginizi Kalıcı Hale Getirin … Dosyalar saklanır, tekrar
  erişilebilir ve yeniden sorgulanabilir"** [doğrulandı] — §4'teki "sıfır veri
  saklama" beyanıyla açıkça çelişir.

### 2.4 UDF Dönüştürücü (`/tr/udf-donusum`)
- **Girişsiz, kamuya açık bir araç**: "UDF, PDF ve DOCX formatları arasında
  hızlı ve güvenli dönüşüm", sürükle-bırak [doğrulandı]. robots.txt bu yolu
  ayrıca `Allow` ile işaretliyor → bilinçli SEO/edinim kancası [çıkarım].

### 2.5 Sitemap'te olan, menüde olmayan sayfalar (yetim / eski)
`/tr/otomatize-is-akislari` ve `/tr/hukuki-analiz-ve-arastirma` sitemap'te
var ama ana sayfa/platform/asistan gövdesinden **hiç link almıyor**
[doğrulandı — üç sayfanın href taraması]. İçerikleri:
- **Otomatize İş Akışları**: "Duruşma hatırlatmaları · Vade takibi · **Süre
  kontrolü** · Müvekkil bildirimleri", "Otomatik belge oluşturma · Şablon
  yönetimi · Toplu belge işleme · Arşivleme", "**E-imza entegrasyonu · UYAP
  bağlantısı · Takvim senkronizasyonu · E-posta otomasyonu**"; sayfada sabit
  yüzdeli sahte ilerleme çubukları ("Dava Takip Süreci 75%") [pazarlama —
  çalışan ürün kanıtı yok, maket].
- **Hukuki Analiz ve Araştırma**: "**%95 doğruluk oranıyla** benzer davaları
  bulun", "manuel aramaya göre **10 kat** daha hızlı", "**4.8/5** müşteri
  memnuniyeti", "**%75** araştırma süresinden tasarruf" [pazarlama —
  yöntemsiz, kaynaksız sayılar; menüden erişilemeyen bir sayfada duruyor].

### 2.6 Entegrasyonlar (üç ana sayfada da tekrarlanan blok)
- **UYAP**: "Apilex UYAP Chrome Eklentisini indirin. Tamamen güvenli biçimde
  tüm dosyalarınızı tek tıkla indirin." [doğrulandı] — yani UYAP'tan **dosya
  indirme** yönü; UYAP'a **gönderme/kaydetme** iddiası yok.
- **Word**: "Sözleşme, dilekçe gibi hukuki belgelerinizi doğrudan Word
  üzerinden analiz edin, inceleyin ve oluşturun." [doğrulandı] — Word add-in
  [çıkarım].
- **Drive**: "Drive'daki dosyalarınızla doğrudan Apilex üzerinde belge aramaya
  gerek duymadan çalışın." [doğrulandı].
- **UETS / e-tebligat / KEP: hiçbir resmî sayfada geçmiyor** [çıkarım]. Bir
  şikayetvar kaydı satışta "UYAP veri entegrasyonu ve **Nisan ayında UETS**"
  sözü verildiğini söylüyor [kullanıcı beyanı] — yani UETS satış vaadi, ürün
  vaadi değil.

### 2.7 Mobil
| | Google Play | Apple App Store |
|---|---|---|
| Kayıt | `ai.apilex.app`, "Apilex: Hukuk Asistanı" | `id6752776204` |
| Puan | **4,3 / 124 yorum** | **4,74 / 247 değerlendirme** |
| Sürüm / tarih | **son güncelleme 30 Tem 2026** | **v1.2.3, 31.07.2026**; ilk yayın **14.01.2026** |
| Sürüm notu | "Performans iyileştirildi ve hatalar giderildi." | aynı |
| Diller | TR | **EN, FR, DE, IT, PT, ES, TR** |
| Uygulama içi satın alma | — | **"1 Aylık Plan ₺24.999,99" ve "6 Aylık Paket ₺39.999,99"** |
[doğrulandı] play.google.com/store/apps/details?id=ai.apilex.app ·
apps.apple.com/tr/app/id6752776204 · itunes.apple.com/lookup?id=6752776204

- Play indirme: **"5 B+"** (5.000+). `docs/COMPETITIVE.md` 28.08.2026'da
  "1.000+" yazıyordu → **bir üst basamağa geçmiş** [doğrulandı-değişim].
- **Her iki mağaza da ~5 haftadır güncellenmedi** (30–31 Temmuz 2026)
  [çıkarım]. Mobil, aktif geliştirme hattı değil.
- iOS açıklaması web pazarlamasında olmayan yetenekleri sayıyor: "Dosya özeti
  çıkartın · **Derin araştırma** yapın · Sözleşme ve dilekçe **analizi** ·
  **Belge risk analizi** · **Dilediğiniz dosya formatında** belgelerinizi
  indirin · **Dava entegrasyonu** · **Takvim senkronizasyonu**" [doğrulandı].
- Play açıklaması: "Avukatlar, **hukuk öğrencileri ve hukuki desteğe ihtiyaç
  duyan herkes** için tasarlandı." — Kullanım Koşulları m.2.1 ise "bireysel
  veya **tüketim amaçlı kullanıma açık değildir**" diyor. **Doğrudan çelişki**
  [çıkarım, iki resmî yüzey].
- Play'deki gizlilik politikası bağlantısı `apilex.ai/gizlilik-sozlesmesi`
  yönlendirmeye düşüyor; sitedeki gerçek yol `/tr/gizlilik-politikasi`
  [doğrulandı].

---

## 3. Fiyat, deneme, baro kanalı

**Yayımlanmış bir fiyat sayfası yok.** `/tr/fiyatlandirma`, `/en/pricing`,
`/tr/guvenlik`, `/tr/destek`, `/tr/entegrasyon` → **404** [doğrulandı, bugün
denendi]. SSS: "Detaylı bilgi için satış ekibimizle iletişime geçebilir veya
demo talep edebilirsiniz." → **kapalı fiyat, demo-satış hunisi** [doğrulandı].

Kamuya sızmış rakamlar:
| Kaynak | Rakam | Etiket |
|---|---|---|
| App Store TR uygulama içi satın alma listesi | **1 Aylık ₺24.999,99** · **6 Aylık ₺39.999,99** | [doğrulandı] apps.apple.com, 02.09.2026 |
| ekşi sözlük (jeth, 01.12.2025) | "6 aylik 25.000 tl yillik 40.000 tl" | [kullanıcı beyanı] |
| ekşi sözlük (zadiks, 06.01.2026) | "50 bini çok abartı buldum" (yıllık) | [kullanıcı beyanı] |
| hukukiyapayzeka.com (06.01.2026) | 6 aylık ve 1 yıllık paketler, taksit, "tüm özellikleri sınırsız" | [ikincil kaynak] |

**Aynı iki rakam (25.000 / 40.000) üç bağımsız kaynakta dönüyor; hangi rakamın
hangi süreye ait olduğu kaynaklar arasında tutarsız.** Bu belgede rakamlar
tekil olarak kullanılamaz; "≈25.000 ₺ ve ≈40.000 ₺ iki basamaklı bir abonelik"
demek doğrulanabilir sınırdır.

**Kota:** hiçbir yüzeyde sayısal kota yok. Kullanım Koşulları m.3.5 bunun
yerine **"adil kullanım"** koyuyor: aşırı kullanımda Apilex "kullanım limitleri
uygulayabilir, işlemleri durdurabilir, erişimi sınırlandırabilir" ve
**"olağan hizmet maliyetlerini aşan … ek yapay zekâ kullanım maliyetlerinin
tahsilini talep etme hakkını saklı tutar"** [doğrulandı]. Yani ücret tavanı
sözleşmede açık uçlu.

**Deneme:** ücretsiz self-servis deneme **yok**; "Demo talebinde bulunarak
Apilex'i ücretsiz olarak deneyebilirsiniz. Ekibimiz size özel bir demo oturumu
düzenleyecektir." [doğrulandı, /tr/sss].

**Baro kanalı — en güçlü edinim mekanizması:**
- Sitemap'te baroya özel demo iniş sayfaları: `/tr/ankarabarosudemo`,
  `/tr/bingolbarosudemo`, `/tr/ordubarosudemo`, `/tr/trabzonbarosu`,
  `/tr/demoiste` [doğrulandı]; İstanbul Barosu PDF'i ayrıca
  `apilex.ai/istanbulbarosudemo` veriyor.
- **İstanbul Barosu**: "Apilex'ten İstanbul Barosu Avukatlarına **%25
  İndirim** … kayıt olurken İstanbul Barosu'nu seçmeniz yeterlidir."
  [doğrulandı] storage.istanbulbarosu.org.tr PDF (Canva, 24.11.2025).
- **Kütahya Barosu**: protokol, tüm üyelik paketlerinde **"%25 oranında 6 ay
  boyunca"** [doğrulandı] kutahyabarosu.org.tr (14.10.2025).
- Şanlıurfa Barosu (LexPanel ile birlikte) ve Antalya Barosu duyuruları da
  mevcut [doğrulandı-arama sonucu başlıkları].
- Aynı kanalın gölge yüzü: şikayetvar'da 30.09.2025 tarihli "İzinsiz tanıtım
  araması" şikâyeti, arayan kişinin numaraları **"barolardan"** aldığını
  söylediğini aktarıyor [kullanıcı beyanı].

---

## 4. Doğruluk, güvenlik ve veri iddiaları ↔ sözleşme metni

### 4.1 Halüsinasyon / doğruluk
Pazarlama tablosu (üç ürün sayfasında da tekrarlanıyor) kendini
**"%100 Kaynaklı"** ve **"Denetlenmiş İçerik"** olarak, genel modelleri
**"Halüsinasyon Riskli"** olarak etiketliyor; "Kaynaklarıyla Cevaplar: Her
Zaman ↔ Nadiren" [doğrulandı, /tr/asistan]. **Doğrulama mekanizması hiçbir
sayfada tarif edilmiyor** — hash yok, konum yok, yeniden doğrulama tarifi yok,
çekimserlik/cevap reddi yok [çıkarım].

Aynı şirketin sözleşmesi (Kullanım Koşulları, **son güncelleme 21.07.2026**):
- m.2.2: **"ÜRETİLEN ÇIKTILAR YAPAY ZEKA KAYNAKLI OLDUĞUNDAN HATALAR VEYA
  EKSİKLER İÇEREBİLİR."** [doğrulandı]
- m.2.3: Çıktı **"yalnızca bir ön taslak ve referans materyali"**; kullanıcı
  onu **"bir baroya kayıtlı avukatın denetiminden ve onayından geçirmeden"**
  mahkemeye/icraya/resmî kuruma vermemeyi taahhüt eder [doğrulandı].
- m.9.1: "Apilex, bunların **doğruluğu, eksiksizliği, güncelliği** … konusunda
  açık veya zımni **hiçbir garanti vermez**." [doğrulandı]
- m.9.2: Çıktının bir avukat tarafından incelenmeden kullanılması
  **"Kullanıcı'nın ağır ihmali"** sayılır [doğrulandı].

→ **"%100 Kaynaklı" ile "hiçbir garanti vermez" aynı sitede duruyor.** Bu, bu
lanenin ürettiği en satılabilir tek cümledir ve ColleX'in konumunu tanımlar
(§7).

### 4.2 Sertifikalar ve güvenlik
- Ana sayfa rozetleri: **KVKK · ISO 42001 · EU AI ACT · ISO 27001 · GDPR**
  [doğrulandı, /tr]. `/tr/gizlilik-sertifikasi` iki PDF bağlantısı sunuyor:
  "Bilgi Güvenliği Yönetim Sistemi" ve "Yapay Zeka Yönetim Sistemi"
  [doğrulandı] — belge numarası/denetleyici kuruluş sayfa metninde yok.
- Kullanım Koşulları m.7.3: şifreleme, SSL/TLS, düzenli sızma testleri,
  erişim yetki matrisi, **"ISO 27001 … standardına uygunluk"** [doğrulandı].
- SSS: "Veri merkezi güvenliği ve yedekleme sistemlerimiz **SOC 2
  standartlarına uygundur**" — *uygunluk* beyanı, **SOC 2 raporu iddiası
  değil** [doğrulandı].
- Platform sayfası kurumsal vaatler: **SAML SSO, denetim günlükleri, veri
  yaşam döngüsü yönetimi**, "Model Eğitimi Yok", "Bağımsız Denetim"
  [pazarlama].
- m.9.2: **%99 erişilebilirlik "hedefi"**; açıkça "garanti veya kesin taahhüt
  niteliğinde olmayıp", **hizmet kredisi/telafi yok** [doğrulandı].

### 4.3 Veri — en zayıf halka
- Gizlilik Politikası: **"Platform sıfır veri saklama politikası ile
  operasyonlarını yürütür … işlem çağrısı bittiği anda veriler tamamen
  silinir."** — ve **aynı paragrafın son cümlesi**: "İçerikleriniz şifrelenerek
  saklanır ve yalnızca yetkilendirilmiş personelimiz tarafından … erişilebilir."
  [doğrulandı — tek paragraf içinde çelişki].
- Aynı politikanın saklama tablosu: "İçerik ve Hukuki Verileriniz (yüklediğiniz
  belgeler, istemleriniz, **arama geçmişiniz, projeleriniz**): hesabınızı
  sildiğinizde derhal ve kalıcı olarak silinir" [doğrulandı] → yani hesap
  yaşadığı sürece **saklanıyor**; "sıfır veri saklama" bu tabloyla ve Projeler
  sayfasının "Dosyalar saklanır" cümlesiyle bağdaşmıyor [çıkarım].
- **Yurt dışına aktarım açık**: "Barındırma (hosting) hizmeti sağlayıcımız" ve
  **"Yapay zekâ destekli analiz ve içerik üretimi hizmeti sağlayıcılarımız"**
  yurt dışı alıcı grubu olarak sayılıyor — **hiçbirinin adı verilmiyor**
  [doğrulandı].
- Kullanım Koşulları m.8.3: "Güncel Alt Veri İşleyen listesine Kullanıcı her
  zaman internet sitesinde paylaşılan **'Sub-Processor' tablosu** üzerinden
  erişebilir." **Böyle bir sayfa sitemap'te yok; denenen 5 makul yol 404
  verdi** [doğrulandı — sözleşmenin işaret ettiği belge yayında değil].
- m.6.4: kullanıcı içeriği model eğitimi/fine-tuning için kullanılmayacak
  [doğrulandı] — bu gerçek ve olumlu bir taahhüt.
- KVKK rolü: içerik/hukuki veriler için **veri sorumlusu avukat, Apilex veri
  işleyen** [doğrulandı]. Yani müvekkil verisinin yurt dışına aktarımının
  KVKK m.9 sorumluluğu avukatın üzerinde kalıyor [çıkarım] — **İzmir Barosu'na
  kayıtlı tek kişilik büro için bu, ColleX'in en keskin karşı argümanı.**

---

## 5. Sitenin kendi tutarsızlıkları (satış konuşması malzemesi)

1. **CEO iki kişi.** `/tr/hakkimizda` sayfası **"Felix Rowe — Kurucu & CEO"**
   diyor ve "Liderlik Ekibi" olarak Camille Ortiz, Jonas Reed, Anika Wells'i
   sıralıyor; müşteri sözü "David Pearce, Head of Product, **Baincroft**";
   metrikler "**$7,000** aylık tasarruf", "**31** faturalandırma saatinde
   artış"; blog kartları İngilizce ve **JUNE 2025** tarihli. `/tr/kurucudan-mesaj`
   ise **"Av. Cebrail Ergül — Kurucu Ortak & CEO"** diyor.
   **`/tr/hakkimizda` ve `/tr/kariyer` satın alınmış bir şablonun
   temizlenmemiş demo metnidir** ("138+", "%96 Glassdoor") [doğrulandı, iki
   resmî sayfa; çelişki 02.09.2026'da canlıdır].
2. **Korpus 12M ↔ 11M** (site ↔ Play), bir yıldır düzeltilmemiş.
3. **Hedef kitle**: ToU "tüketim amaçlı kullanıma açık değildir" ↔ Play
   "hukuki desteğe ihtiyaç duyan herkes için tasarlandı".
4. **"%100 Kaynaklı"** ↔ **"hiçbir garanti vermez"** (§4.1).
5. **"Sıfır veri saklama"** ↔ "İçerikleriniz … saklanır" ↔ "Dosyalar
   saklanır, tekrar erişilebilir" (§4.3).
6. **Sözleşmenin işaret ettiği Sub-Processor tablosu yayında değil** (§4.3).
7. **Ölü bağlantı metni**: footer'da "Hakkımızda" ve "Destek" başlıkları var
   ama üç ana sayfanın hiçbirinden bu yollara link çıkmıyor [doğrulandı].
8. **Mobilde çelişki**: SSS "mobil = responsive web" diyor; iki mağazada
   yayında native uygulama var.

Bu liste, ColleX'in "her cümle kanıta bağlı" iddiasının aynası olarak
kullanılabilir — ama **§0'daki etiketlerle birlikte**, ve asla "rakip
yalan söylüyor" diye değil: "iki resmî sayfası birbirini tutmuyor, sen
hangisine güveneceksin?" diye.

---

## 6. 28.08.2026 → 02.09.2026 arasında ne değişti

`docs/COMPETITIVE.md` anlık görüntüsüyle karşılaştırma (Wayback erişilemediği
için değişim izi yalnız bu iki nokta arasında):

| Değişim | Kanıt |
|---|---|
| **Yeni ürün sayfaları**: `/tr/udf-donusum` (girişsiz UDF↔PDF↔DOCX dönüştürücü), `/tr/ictihat-arama-motoru`, `/tr/akilli-belge-yazim-platformu`, `/tr/hukuki-analiz-ve-arastirma`, `/tr/otomatize-is-akislari`, `/tr/sss` | sitemap.xml + sayfa gövdeleri, 02.09.2026 |
| **Kapsam genişledi**: "AİHM kararları" + "İlk derece mahkemeleri" + "Kurul kararları" ilk kez ayrı ayrı sayılıyor | /tr/ictihat-arama-motoru |
| **"Doktrin"** bir kaynak türü olarak asistan maketinde belirdi | /tr/asistan |
| **Global**: Fransa (21.01) ve Almanya (28.03) canlı; 4 dilli site (TR/EN/FR/DE); iOS 7 dil | /tr, sitemap, itunes lookup |
| **apilex.legal** ayrı içerik platformu yayında | apilex.legal |
| **Play indirme 1.000+ → 5.000+** | play.google.com |
| **Sertifika rozetleri**: ISO 42001 ve EU AI Act eklendi | /tr |
| **Kullanım Koşulları 21.07.2026'da güncellendi** (adil kullanım m.3.5, beta m.3.3, karşılıklı tazminat m.9.3 dahil) | /tr/kullanim-kosullari |
| **Değişmeyen**: fiyat sayfası hâlâ yok, 12M↔11M çelişkisi duruyor, mobil 30-31 Temmuz'dan beri güncellenmedi | — |

---

## 7. Sahadan gelen sinyal — kullanıcılar ne diyor

Hepsi **[kullanıcı beyanı]**; ifadenin varlığı doğrulandı, içeriği değil.
Kaynaklar: eksisozluk.com/apilex--8010008 (3 sayfa, 29.07.2025–30.08.2026),
sikayetvar.com/apilex-yapay-zeka-hukuk-asistani (4 şikâyet).

**Olumlu ve somut**
- 01.12.2025: "317 sayfa sözleşme yükledim. yaklaşık **50 saniyede** çözümledi
  … risk analizi yaptı, özetledi."
- 24.12.2025 (teknik okuma): PDF ve **UDF** okuyabiliyor; **istem
  iyileştirme** (prompt optimizasyonu) ayrı bir adım olarak kullanıcıya
  gösteriliyor; "mevzuat uydurma problemini çözmüş".
- 16.07.2026: iki demo, "bir kez bile … uydurma emsal karar yazmasına denk
  gelmedim, her seferinde yargıtayın sitesinden teyit ettim doğruydu"; bir kez
  sohbet çöktü, baştan başlamak gerekti.
- 02.03.2026: "yargı kararları ile sınırlandırma çok iyi … fiyatları dünyadaki
  emsallerine göre bedava."

**Olumsuz — ürün riski**
- 18.02.2026: "cevabını bildiğim **üç soru sordum üçünde de tamamen yanlış
  bilgi** verdi ki bilmeyen birini yanıltır."
- 16.03.2026: "**halüsinasyon görmeye devam** eden … **iş güvencesi olmayan bir
  iş yerinde işe iade davası açılması gerektiğini** söyleyebilecek kadar hatalı
  şekillendirilmiştir … avukatlar için pahalı bi ağır ceza bileti."
- 24.04–15.05.2026: "24 nisandan beri teknik sorunların çözülmediği" →
  sonradan "sorun birkaç gün önce düzeldi" edit'i.
- 23.07.2026: "aylar önce işe yarıyordu şu an çöp … **evrak yüklenmiyor**,
  cevaplar çoğu zaman gelmiyor, uygulama **stabil değil** … gpt aylık 500 tl ye
  çok daha fazlasını stabil çalışarak yapabiliyor."
- 28.07.2026: "gerçekten şu an çöp … sürekli aramaları da rahatsız edici."
- Şikayetvar (4 kayıt): 05.02.2026 alımı — "kurulumdan bu yana düzgün
  çalışmadı", aramalar sonuçsuz, sözleşme analizi bozuk; 09.04.2026 alımı —
  satışta **UYAP veri entegrasyonu ve Nisan'da UETS** sözü verildiği,
  programın sürekli hata verdiği; 30.09.2025 — izinsiz tanıtım araması,
  numaraların "barolardan" alındığı beyanı.
- Fiyat, tekrarlayan **1 numaralı itiraz**: "ekstrem pahalı", "50 bini çok
  abartı", "biz chat gpt'den devam".
- 28.07 ve 30.08.2026: LinkedIn'de sürekli ilan açıp işe almama ve onsite
  ısrarı eleştirisi [kullanıcı beyanı].

**Bu blok neden önemli:** rakibin gerçek zayıf noktası özellik listesi değil,
**kararlılık (stability), doğruluk ve fiyat**. ColleX'in üç yapısal avantajı
tam olarak bunlara denk düşüyor: yerel çalışır (bulut kesintisi yok),
doğrulanamayanı yazmaz (çekimserlik), abonelik yok.

---

## 8. ÖZELLİK MATRİSİ — Apilex iddiası | kanıt | ColleX bugün | boşluk | ne yapılmalı

ColleX sütunu yalnız **bu depoda bugün çalışan ve testli** olanı sayar
(02.09.2026, W12-FIX2 sonrası). Boşluk şiddeti tek kişilik bir dava avukatının
**günlük** işine göre: **P0** = bu olmadan iş akışı kopuyor, **P1** = haftalık
acı, **P2** = değerli ama ertelenebilir, **P3** = stratejik/opsiyonel.

| # | Apilex iddiası (kendi sözcükleri) | Kanıt | ColleX bugün | Boşluk | Ne yapılmalı |
|---|---|---|---|---|---|
| 1 | "Semantik Karar Arama … somut olayı anlatın" | [doğrulandı] /tr/ictihat-arama-motoru | **Var, farklı mekanizma**: hibrit getirme (exact-pin + Türkçe FTS + trigram + citator, RRF) + canlı 54 araçlık resmî kaynak geçidi; her pasaj deterministik alıntı kontrolünden geçer | — | Konumu koru; "semantik" sözcüğüne değil **doğrulanabilirliğe** yaslan |
| 2 | "12 milyondan fazla güncel karar" / Play'de "11 milyondan fazla" | [çıkarım] iki resmî yüzey çelişik | Statik kopya korpus yok; sorgu anında canlı çekim + alınma zaman damgası. Yerel korpus **SENTETİK** | **P1** (algı) | **Kapsam manifestosu**: kaynak başına canlı durum + son erişim + bilinen boşluk. Sayı yarışına girme, "kaç değil, hangisi ve ne zaman" de |
| 3 | Kapsam: "**AİHM kararları**" | [doğrulandı] /tr/ictihat-arama-motoru | **Yok** — 54 araçta AİHM/İHAS yolu yok (`grep aihm\|echr` → 0) | **P2** (AYM bireysel başvuru dosyalarında P1) | AYM bireysel başvuru kararlarında AİHM atıflarının citator kenarıyla yakalanması; ya da HUDOC için ayrı bir kaynak kararı — kapsam yalanı yerine **dürüst boşluk** ilanı |
| 4 | Kapsam: "**İlk derece mahkemeleri**" kararları | [doğrulandı] aynı sayfa | Kısmî: Emsal (UYAP emsal) ilk derece/BAM içerir; iddia edilen genişlikte değil | **P2** | Emsal şeridinin kapsamını ölç ve manifestoya yaz |
| 5 | Kaynak türü olarak "**Doktrin**" | [doğrulandı] /tr/asistan (maket) | **Yok** | **P3** | Girme. Telif riski yüksek, doğrulanabilirlik düşük. Apilex'in apilex.legal ile kendi doktrin havuzunu kurduğu [çıkarım] not edilsin |
| 6 | "**Projeler** — dosyalarınızı tek alanda toplayın, klasörleyin" | [doğrulandı] /tr/akilli-belge-yazim-platformu | **Var**: Davalarım (`/v1/matters*`), belge/cevap/taslak otomatik dosyaya bağlanır, kalıcı yerel PostgreSQL | — | Eşit; farkı "verileriniz makinenizden çıkmıyor" ile anlat |
| 7 | "**Özel Asistan** — yalnızca proje içeriğini dikkate alarak yanıt verir" | [doğrulandı] | **Var**: `POST /v1/answer` + `filters.fileIds` ("Belgeye sor"), her kart "yüklediğiniz belge" der | — | Eşit + üstün (hash'li, konumlu) |
| 8 | "**Binlerce sayfayı** toplu analiz", "**Otomatik özet ve karşılaştırmalar** … **tablolama**" | [pazarlama] | **Yok**: çok-belgeli toplu analiz, belgeler arası karşılaştırma tablosu yok (`grep karşılaştır/compare/toplu` → yalnız tarih karşılaştırma) | **P1** | **Çok-dosya karşılaştırma tablosu**: aynı matter'daki N belgeden madde/tarih/tutar/taraf çıkarıp satır satır fark tablosu; her hücre bir `fileId + offset` gösterir. Sezgisel v1 zaten atıf/tarih/talep çıkarıyor — üstüne kur |
| 9 | "**Dava dosyası özetleri**" / "dosya özeti çıkartın" | [doğrulandı] İstanbul Barosu PDF, iOS açıklaması | **Kısmî**: sezgisel v1 analizi (atıf/tarih/talep) + Davalarım özeti; "dosyanın hikâyesi" özeti yok | **P1** | **Kanıta bağlı dosya kronolojisi**: yüklenen tüm belgelerden tarih+olay çıkar, her satır `Ek-n` + offset ile bağlı; çıkarılamayan yeri boş bırak (uydurma) |
| 10 | "**Belge risk analizi**", "sözleşmedeki cezai şart maddelerini analiz et" | [doğrulandı] iOS + /tr/asistan | **Kısmî**: yerel sezgisel analiz + bulut AI `analyze-document` (her tespit birebir alıntıyla doğrulanır, doğrulanamayan KAYNAKSIZ) — **canlı sınanmadı** | **P1** | Bulut AI hattını **bir kez canlı sınayıp** `AI.md`'ye kaydet; sözleşme için madde-madde risk şeridi (yalnız alıntıya bağlı, hüküm önerisi değil) |
| 11 | "**Agent Beta** — derin hukuki araştırma" | [pazarlama], adım izi yok | **Var ve üstün**: `/v1/research` bütçe tavanlı (≤24 çağrı / ≤10 tam belge / ≤120 s), her adım kaynak+zaman damgalı, 54 aracın hepsi için Türkçe ilerleme etiketi | — | **Farkı göster**: "ne yaptığını satır satır gösteren tek derin araştırma" |
| 12 | "**%100 Kaynaklı**", "Denetlenmiş İçerik" | [pazarlama]; ToU m.9.1 "hiçbir garanti vermez" | **Mekanizma var**: alıntı SHA-256 + belge içerik SHA-256 + Unicode kod-noktası aralığı + sürüm kimliği; doğrulanamayan alıntı dışa aktarımı **exit 2** ile durdurur | — | **Bu tek satır ColleX'in tüm konumu.** §4.1'deki çelişkiyi yan yana koy |
| 13 | Çekimserlik / cevap reddi | Hiçbir yüzeyde **yok** [çıkarım] | **Var**: kapsam kapısı (ADR-017, taban 0.4) → "ÇEKİMSER", KAYNAKLAR bilerek boş | — | Koru; gevşetme yasağı CLAUDE.md'de |
| 14 | Karşıt içtihat / aleyhe karar taraması | Hiçbir yüzeyde **yok** [çıkarım] | **Var**: zorunlu karşıt-otorite şeritleri, "Çelişen Otoriteler", dilekçede ayrı "KARŞI İÇTİHAT" bölümü | — | Koru, öne çıkar |
| 15 | "**Güncellik Faktörü** — en güncel kararları önceliklendirir" | [pazarlama] | **Üstün**: `asOf` zaman makinesi + yürürlük rozeti + temporal kapanış (ADR-012) | — | "Güncel" değil, **"olay tarihinde yürürlükte olan"** diye sat |
| 16 | "Hukuki Belge Üretimi … dilekçe, sözleşme, **ihtarname**, hukuki görüş yazıları" | [doğrulandı] /tr/asistan | **Var, 13 şablon**: Dava · Cevap · İstinaf · Temyiz · **İhtarname** · İcra takibine itiraz (İİK m.62) · Arabuluculuk başvuru formu + Hizmet · Kira · Tahliye taahhütnamesi · Belirsiz süreli iş · Satış · Avukatlık ücret sözleşmesi (`control-plane/src/drafting/templates.ts`). Her paragraf beyan / kanıta bağlı / **⚠ KAYNAKSIZ**; sürümlü (`PUT` → sürüm+1) | Kısmî — **hukuki görüş / mütalaa** şablonu yok | 14. şablon olarak **hukuki mütalaa** ekle: zaten çalışan çekimserlik + karşıt otorite disipliniyle en doğal eşleşen belge türü; müvekkile verilen yazılı görüşte "kaynaksız cümle yok" en çok orada satar |
| 17 | "**Özel Belge Şablonu Kullanımı**" / "kişiye özel belge şablonları" | [doğrulandı] karşılaştırma tablosu + İstanbul Barosu PDF | **Yok**: 13 şablon sabit, avukatın kendi şablonunu yükleyip doldurtması yok | **P1** | **Kullanıcı şablonu**: avukatın kendi DOCX'ini yükleyip alan eşlemesi yapması. Kanıt disiplini (KAYNAKSIZ işareti) şablondan bağımsız korunmalı |
| 18 | "Dilekçelerdeki **üslûbumu** anlıyor, tarzıma göre dilekçe oluşturuyor" | [kullanıcı beyanı] 29.11.2025 | **Yok** | **P2** | Şablon + kullanıcı sözlüğü (m.17) bunun %80'ini karşılar; model kişiselleştirmesine girme |
| 19 | **UYAP Chrome eklentisi** — "tüm dosyalarınızı tek tıkla indirin" | [doğrulandı] /tr/platform | **Yok** | **P0** | Tek kişilik büronun günlük ilk hareketi UYAP'tan dosya indirmektir. ColleX'in cevabı eklenti olmak zorunda değil: **"UYAP'tan indirdiğin klasörü sürükle-bırak"** + izlenen klasör (watched folder) → otomatik intake. Eklenti yazmadan acının %70'i kapanır |
| 20 | **Word entegrasyonu** — "doğrudan Word üzerinden analiz edin, oluşturun" | [doğrulandı] | **Yok** (çıktı DOCX var, add-in yok) | **P1** | Add-in yerine: DOCX **yeniden içe alma** (avukat Word'de düzenler, ColleX'e geri yükler, atıf kapanımı yeniden doğrulanır). Add-in'den ucuz, kanıt zincirini korur |
| 21 | **Google Drive** entegrasyonu | [doğrulandı] | **Yok** ve olmamalı (yerel, KVKK duruşu) | **P3** | Girme; "dosyanız buluta çıkmaz" argümanının bedeli budur, açıkça söyle |
| 22 | **UDF dönüştürücü** (UDF↔PDF↔DOCX, girişsiz, ücretsiz) | [doğrulandı] /tr/udf-donusum | **Kısmî**: UDF **okuma** çalışıyor (`intake/extract.py:extract_udf`), UDF **yazma deneysel** (imzasız, UYAP editöründe hiç açılmadı, ADR-019) | **P0** | **UDF çıktısını gerçek UYAP Doküman Editörü'nde bir kez aç ve sonucu yaz.** Bu tek test, "deneysel" etiketini kaldırıp ColleX'i UYAP iş akışına sokar. Ek: yerel UDF→DOCX/PDF dönüştürücü (Apilex'inkinin aksine **hiçbir dosya makineden çıkmadan**) |
| 23 | **UETS / e-tebligat / KEP** | Resmî sayfada **yok**; satışta vaat edildiği [kullanıcı beyanı] | **Yok** | **P2** | İkisinde de yok. Rekabet konusu değil; **süre hesabı** ile birleştirilirse (tebliğ tarihi girişi) asıl değer orada |
| 24 | "**Süre kontrolü**, duruşma hatırlatmaları, vade takibi" | [pazarlama] yetim sayfa `/tr/otomatize-is-akislari`, sahte ilerleme çubukları | **Var ve daha dürüst**: `/v1/deadlines` 30 kural (HMK/CMK/İYUK/İİK/AYM), adli tatil + resmî tatil + ay sonu kuralı; **30 kuralın tamamı `dogrulanmadi`**, her sonuçta zorunlu uyarı | **P1 (kalite)** | **30 kuralı madde metniyle doğrula ve `verified`'ı çevir.** Rakibin bu alanda çalışan ürünü yok; bizim çalışan ama etiketli ürünümüz var. Etiketi kaldıran, alanı alır |
| 25 | **Takvim senkronizasyonu** | [doğrulandı] iOS açıklaması, [pazarlama] web | **Yok** | **P1** | Hesaplanan süreden **.ics** üret (tek dosya, sunucu yok, Outlook/Google'a çift tıkla eklenir). Ucuz, günlük, disclaimer ics açıklamasına da gömülür |
| 26 | **E-imza entegrasyonu** | [pazarlama] yetim sayfa | **Yok** | **P3** | Girme |
| 27 | **SAML SSO, denetim günlükleri, veri yaşam döngüsü** | [pazarlama] /tr/platform | **Yok** — tek kullanıcı, konsol auth'suz ve 127.0.0.1'e bağlı | **P3** | Kapsam dışı; tek kişilik büro için anlamsız |
| 28 | **Mobil uygulama** (iOS 4,74/247 · Android 4,3/124) | [doğrulandı] mağaza kayıtları | **Yok**, bilinçli vaat edilmiyor | **P2** | Girme. Gerekirse **duruşma öncesi tek sayfalık dosya özeti PDF'i** (telefonda okunur) — uygulama değil, çıktı |
| 29 | **Çok dilli** (TR/EN/FR/DE + IT/PT/ES mobilde), Fransa/Almanya canlı | [doğrulandı] | Yok, kapsam dışı | **P3** | Kapsam dışı |
| 30 | "%85'e varan zaman tasarrufu", "%95 doğruluk", "10 kat hızlı", "4.8/5" | [pazarlama] yöntemsiz | **İddia yok, ölçüm var**: STATUS "Ölçülen sayılar" S1–S22, hepsi komut + çıkış koduyla | — | Asla rakibin sayı diline geçme. "Bizim sayımız yok, komutumuz var" |
| 31 | "Sıfır veri saklama" + adı verilmeyen **yurt dışı** hosting ve AI sağlayıcıları; Sub-Processor tablosu yayında değil | [doğrulandı] gizlilik politikası + ToU m.8.3 + 404'ler | **Yapısal üstünlük**: her şey yerel; bulut AI **varsayılan KAPALI**, istek başına onay, anahtar yoksa hat tamamen yok (ADR-018) | — | **KVKK argümanını yaz**: "müvekkil dosyası hangi ülkeye, hangi şirkete gidiyor? Onların sözleşmesi bunu söylemiyor. Bizde hiçbir yere gitmiyor." |
| 32 | Kota: sayısal kota yok, **"adil kullanım"** + ek maliyet tahsili hakkı (m.3.5) | [doğrulandı] | Abonelik yok, kota yok, ek fatura yok | — | "Doğrulama hiçbir planda kısılmaz" ilkesini koru |
| 33 | Ücretsiz self-servis deneme **yok** (yalnız demo talebi) | [doğrulandı] /tr/sss | ColleX çift tıkla açılır ve çalışır | — | "Deneme için satışçıyla konuşmak gerekmez" |
| 34 | Kararlılık: "evrak yüklenmiyor", "uygulama stabil değil", haftalarca çözülmeyen kesinti | [kullanıcı beyanı] 04.2026, 07.2026 | Yerel, tek işlem, ağ bağımsız (canlı araştırma hariç) | — | **En güçlü ve en az kullanılan argüman**: "internet çökse de dosyan açılır" |
| 35 | SEO/içerik motoru: 100+ Türkçe hukuk yazısı (`/tr/blog`) + **apilex.legal** (imzalı avukat makaleleri, TR/EN/FR) | [doğrulandı] | Yok, kapsam dışı | **P3** | Kapsam dışı — ama blogdaki **2026 harç/tarife ve parasal sınır** yazıları bir ürün boşluğuna işaret ediyor → m.36 |
| 36 | *(Apilex'te de ürün olarak yok, blogda var)* 2026 parasal sınırlar, harçlar, tebligat ücretleri | [doğrulandı] apilex.ai/tr/blog/kesin-karar-istinaf-siniri-2026 vb. | **Yok** | **P1 fırsat** | **Parasal sınır / harç hesaplayıcısı** (istinaf-temyiz kesinlik sınırı, yıl seçimli, mevzuat atıflı, süre hesabıyla aynı "doğrulandı/doğrulanmadı" disiplininde). Rakip bunu blog yazısı olarak veriyor; **araç olarak veren kazanır** |

### Boşlukların sıralı özeti (tek kişilik dava avukatı için)

**P0 — bunlar olmadan günlük akış kopuyor**
1. **UYAP'tan gelen dosyayı ColleX'e sokmanın sürtünmesiz yolu** (m.19) —
   izlenen klasör + sürükle-bırak toplu intake. Eklenti şart değil.
2. **UDF çıktısının gerçek UYAP Doküman Editörü'nde doğrulanması** (m.22) —
   tek bir manuel test, "deneysel" etiketini düşürür.

**P1 — haftalık acı**
3. Çok-dosya **karşılaştırma tablosu** (m.8).
4. Kanıta bağlı **dosya kronolojisi/özeti** (m.9).
5. **Kullanıcı kendi şablonunu yükleyebilsin** (m.17).
6. **30 süre kuralının madde metniyle doğrulanması** (m.24) — rakipte
   çalışan muadili yok, bizim tek eksiğimiz etiket.
7. Süreden **.ics** üretimi (m.25).
8. **Parasal sınır / harç hesaplayıcısı** (m.36).
9. Word'de düzenlenmiş DOCX'in **geri yüklenmesi** (m.20).
10. Bulut AI hattının **bir kez canlı sınanması** (m.10).
10b. **Hukuki mütalaa şablonu** (14. şablon, m.16).
11. **Kapsam manifestosu** sayfası (m.2) — 12M/11M çelişkisine karşı en
    dürüst cevap.

**P2** — AİHM/ilk derece kapsam ölçümü (m.3–4), üslup/şablon zenginleştirme
(m.18), mobil yerine tek sayfa duruşma özeti (m.28).
**P3** — Drive, e-imza, SSO, doktrin, çok dillilik, mobil uygulama, içerik
pazarlaması. Bunlara **girilmemesi** bilinçli bir karardır ve öyle yazılmalıdır.

---

## 9. Konumlandırma sonucu (build ajanlarına tek cümle)

Apilex, kâr eden ve hızlı büyüyen bir **hız ve kapsam** ürünüdür; sözleşmesi
çıktının doğruluğu için **hiçbir garanti vermez** ve kullanıcıyı çıktının
tamamını avukat gözüyle doğrulamakla yükümlü kılar. ColleX bu boşluğa
oturur: **hızda değil, doğrulanabilirlikte, kararlılıkta ve verinin
makineden çıkmamasında yarışır.** Yol haritası bu nedenle §8'in P0/P1
sırasını izlemeli — yani **UYAP'a giren/çıkan dosya akışı** ve **süre/harç
kurallarının doğrulanması** önce, "onlarda var bizde yok" listesinin geri
kalanı sonra.

---

## 10. Kaynak listesi (hepsi erişim 02.09.2026, aksi belirtilmedikçe)

| Kaynak | Ne için |
|---|---|
| <https://apilex.ai/robots.txt> · <https://apilex.ai/sitemap.xml> | 101 URL'lik tam yüzey sayımı, 4 dil, `/tr/udf-donusum` özel `Allow` |
| <https://www.apilex.ai/tr> · `/tr/platform` · `/tr/asistan` | üç ürün, Agent Beta, entegrasyonlar, ISO/EU AI Act rozetleri, "%100 Kaynaklı" tablosu, global genişleme |
| <https://www.apilex.ai/tr/ictihat-arama-motoru> | AİHM + ilk derece + kurul kapsamı, "Tam Metin Kararlar" |
| <https://www.apilex.ai/tr/akilli-belge-yazim-platformu> | Projeler: toplu analiz, karşılaştırma tabloları, proje-özel asistan, "dosyalar saklanır" |
| <https://www.apilex.ai/tr/udf-donusum> | girişsiz UDF↔PDF↔DOCX dönüştürücü |
| <https://www.apilex.ai/tr/otomatize-is-akislari> | süre kontrolü/e-imza/takvim/UETS-benzeri vaatler (yetim sayfa, maket) |
| <https://www.apilex.ai/tr/hukuki-analiz-ve-arastirma> | "%95 doğruluk", "10 kat", "4.8/5" (yetim sayfa) |
| <https://www.apilex.ai/tr/sss> · `/en/faq` | %85 tasarruf, SOC 2 "uygunluk", deneme = demo, fiyat kapalı, mobil = responsive |
| <https://www.apilex.ai/tr/kullanim-kosullari> | son güncelleme 21.07.2026; m.2.2/2.3/3.2/3.5/4.3/6.4/7.3/8.3/9.1/9.2/11.8 |
| <https://www.apilex.ai/tr/gizlilik-politikasi> | "sıfır veri saklama" ↔ saklama tablosu, yurt dışı hosting + AI sağlayıcıları (adsız) |
| <https://www.apilex.ai/tr/gizlilik-merkezi> · `/tr/gizlilik-sertifikasi` · `/tr/scc` | ISO PDF'leri, SCC, aydınlatma metinleri |
| <https://www.apilex.ai/tr/hakkimizda> · `/tr/kariyer` | temizlenmemiş şablon metni ("Felix Rowe", "Baincroft", "138+", JUNE 2025) |
| <https://www.apilex.ai/tr/kurucudan-mesaj> | Av. Cebrail Ergül, Kurucu Ortak & CEO |
| <https://www.apilex.ai/tr/blog> (100 yazı) · örnek `/tr/blog/kesin-karar-istinaf-siniri-2026` | SEO içerik motoru; 2026 parasal sınır/harç içerikleri |
| <https://www.apilex.legal/> | imzalı avukat makale platformu, TR/EN/FR |
| <https://play.google.com/store/apps/details?id=ai.apilex.app> | 11M+ iddiası, "herkes için", 4,3/124, 5 B+ indirme, 30 Tem 2026 |
| <https://apps.apple.com/tr/app/id6752776204> · `itunes.apple.com/lookup?id=6752776204` | v1.2.3 (31.07.2026), ilk yayın 14.01.2026, 4,74/247, 7 dil, IAP ₺24.999,99 / ₺39.999,99, "© Fitty Teknoloji A.Ş." |
| <https://www.sikayetvar.com/apilex-yapay-zeka-hukuk-asistani> | 4 şikâyet (02.2026 alımı, 04.2026 alımı + UETS vaadi, izinsiz arama) |
| <https://eksisozluk.com/apilex--8010008> (3 sayfa) | 29.07.2025–30.08.2026 arası kullanıcı deneyimi; fiyat, halüsinasyon, kesinti, 317 sayfa analizi |
| <https://egirisim.com/2026/06/23/...-8-milyon-dolar-arri-gecti/> | 8 M$ ARR, 120 kişi, bootstrap, 3. haftada başabaş |
| <https://www.fortuneturkey.com/apilex-ai-milyar-dolarlik-global-legaltech-pazarina-girdi> (12.12.2025) | kurucular, ISO 27001:2022, genişleme planı |
| <https://storage.istanbulbarosu.org.tr/public/2026/02/4065e5ee-...pdf> (PDF 24.11.2025) | İstanbul Barosu %25 indirim, `/istanbulbarosudemo`, "kişiye özel belge şablonları" |
| <https://kutahyabarosu.org.tr/kurum/apilex-fitty-tek-a-s-yapay-zeka-hukuk-asistani/> (14.10.2025) | "APİLEX FİTTY TEK. A.Ş", %25 / 6 ay protokol |
| <https://www.hukukiyapayzeka.com/2026/01/06/apilex-de-jure-karsilastirma/> | üçüncü taraf karşılaştırma; paket yapısı, ~1 dk belge üretimi iddiası |

Erişilemeyenler: web.archive.org CDX (`429`, 3 deneme), Chrome Web Store
listesi (consent yönlendirmesi), Google Play kullanıcı yorum gövdesi
(JS). Bu belge bunları **yokmuş gibi** göstermez.

> Bu belge bir araştırma/denetim çıktısıdır; pazarlama metni değildir.
> Dışarıda kullanılırken §0 etiketleri ve erişim tarihleri birlikte
> taşınmalıdır. Rakip sayfaları değişir — her iddia kullanılmadan önce
> yeniden teyit edilmelidir.
