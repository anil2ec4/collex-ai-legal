# W13 — LANE DEJURE: De Jure (dejure.ai) derin rakip istihbaratı

Erişim tarihi: **02.09.2026** (aksi belirtilmedikçe her satır bu gün alındı).
Hazırlayan: W13 araştırma/denetim hattı. **Bu hat hiçbir depo dosyasını
değiştirmedi**, yalnız bu raporu yazdı; git işlemi yapılmadı.

Etiketler: **[doğrulandı]** = rakibin kendi yüzeyinde (site HTML'i, JS
paketi, mağaza kaydı, sözleşme metni, kendi SVG varlığı) bizzat görüldü,
URL + tarih verilidir · **[pazarlama]** = rakibin beyanı, mekanizma
gösterilmiyor · **[çıkarım]** = iki kaynağın karşılaştırmasından ya da
üçüncü taraftan çıkan sonuç.

> **Dürüstlük notu.** ColleX sütunları `docs/implementation/STATUS.md`
> "Ölçülen sayılar" (S1–S22) ve `CLAUDE.md` invaryantlarından alınmıştır;
> bu rapor hiçbir yeni sayı ölçmemiştir ve hiçbir sayıyı kopyalamaz, satır
> kimliğine atıf yapar. ColleX ölçümleri **SENTETİK** korpustadır ve hukukî
> kalite iddiası değildir. Üç yüzey doğrulanmamıştır ve raporda öyle anılır:
> süre kuralları (`dogrulanmadi`), UDF (`deneysel`), bulut AI
> (`liveTested:false`).

---

## 0. Yöntem ve kapsam (ne yapıldı, ne yapılamadı)

Yapılanlar:

- `robots.txt` + `sitemap.xml` ile tam yüzey sayımı; sitemap'te olmayan ama
  gezinmede/JS'te geçen sayfalar da bulundu (`/dilekce-editoru`, `/baro`,
  `/demo-form`).
- 12 genel sayfa HTML olarak çekildi ve metne dönüştürüldü.
- `/yasal` (10 sözleşme/politika, ~138 KB düz metin) baştan sona tarandı.
- **49 Next.js JS paketi indirildi ve dizgi çıkarımı yapıldı** — sayfada
  render edilmeyen paket/özellik veri yapıları, SSS verisi, referans listesi
  ve anlaşmalı-baro haritası buradan çıktı. Sitede **görünmeyen** özellik
  adları bu yolla bulundu (bkz. §3.2).
- App Store (id6449427444) **tam sürüm geçmişi + birebir sürüm notları**,
  iTunes lookup metadata; Google Play sayfası, puanlar ve son yorumlar.
- Dış kaynaklar: kitle fonlama kampanyası, baro duyuruları (İstanbul Barosu
  PDF'i birebir metin), basın, üçüncü taraf karşılaştırma yazısı, ekşi/arama
  özetleri.

Yapılamayanlar (dürüstçe):

- **Wayback 12 aylık diff alınamadı.** `web.archive.org` CDX ve snapshot
  istekleri bugün 429 döndü, WebFetch bu hostu reddediyor. Yerine **App
  Store sürüm geçmişi** kullanıldı; bu, tarihli ve birebir olduğu için
  Wayback'ten daha güçlü bir yol haritası kanıtıdır (§4).
- `app.dejure.ai` kimlik doğrulaması ister; ürün içi ekranlar görülmedi.
  Ürün içi sözlüğün büyük kısmı JS paketlerinden çıkarıldı (§3.2, §3.6).
- ekşi sözlük 403 döndü; oradaki iddialar yalnız arama motoru özetiyle
  bilinmektedir → **[çıkarım]**, doğrudan alıntı yapılmadı.
- YouTube inceleme videosu metne dökülemedi.

---

## 1. Şirket, yüzey haritası ve satış kanalı

| Alan | Bulgu | Etiket |
|---|---|---|
| Tüzel kişi | **Detech Yazılım Anonim Şirketi** ("De Jure") | [doğrulandı] dejure.ai/yasal, 02.09.2026 |
| Adres (KVKK başvuru) | Üniversite Mah. Sarıgül Sk. No:35/2 İç Kapı No:2, Entertech İstanbul Teknokent, Avcılar/İstanbul | [doğrulandı] /yasal §13.2 |
| Adres (Play geliştirici) | O BLOK, N:37/1-28 Üniversite Mah., 34320 İstanbul | [doğrulandı] play.google.com/store/apps/details?id=com.dejure |
| İletişim | info@dejure.ai · destek@dejure.ai · 0212 909 15 15 · +90 535 057 40 20 (Play) · +90 530 672 75 15 (İstanbul Barosu duyurusu) | [doğrulandı] |
| Alan adları | `www.dejure.ai` (pazarlama), `app.dejure.ai` (ürün: /giris, /hesapolustur, /egitim, /forum), `baro.dejure.ai` (baro odası girişi), **`desktop.dejure.ai`** (sözleşmede tanımlı) | [doğrulandı] /yasal §2 "Platform" tanımı |
| Barındırma | Vercel (`dpl_…` başlıkları, `_next/static`), Next.js App Router, PostHog feature-flag'leri, Google Analytics + GTM + LinkedIn Insight çerezleri | [doğrulandı] home.html + /yasal Çerez Politikası §6 |
| Kuruluş / destek | 2021, TÜBİTAK 1512 Girişimcilik Destek Programı | [çıkarım] kitle fonlama sayfası + basın |
| Kurucular | Yunus Berfu Özcan (kurucu), Av. Akif Çimen (kurucu ortak); kampanya sayfasında Akif Çimen (CEO), Muhammet Yusuf Sarıgöz (CTO), Mahinur Arpacıoğlu Çimen (COO) | [çıkarım] hukukihaber.net (09.10.2022, güncelleme 10.01.2025) + narfon.com.tr |

**Kamuya açık sayfa yüzeyi (tam sayım, 02.09.2026):** `/` · `/fiyatlandirma`
· `/semantik-arama` · `/dilekce` · `/dilekce-editoru` · `/derin-arastirma` ·
`/sozlesme` · `/anlasmali-barolar` · `/baro` · `/blog` (+ `?page=1..37`) ·
`/yasal` · `/demo-form`. `sitemap.xml` bunlardan yalnız 9'unu sayar;
`/dilekce-editoru`, `/baro`, `/demo-form` **sitemap'te yok** ama menüde var
→ dilekçe editörü SEO'ya değil satışa (demo hunisine) bağlanmış.
`robots.txt` `/search` ve `/dokuman`'ı "app redirect sayfaları" diyerek
kapatıyor. **[doğrulandı]**

`/nedir` sayfası arama motorlarında indeksli ama bugün **404** →
kaldırılmış. **[doğrulandı]** (curl, 02.09.2026)

**Satış kanalı iki uçlu:** (a) self-servis satın alma (kredi/banka kartı,
İyzico) ve (b) "Demo Planla" formu → telefonla satış. Pro paket için
sözleşme "Kurumsal onboarding ve öncelikli destek içerir" der; kurulum
**De Jure teknik ekibi tarafından uzaktan erişimle** yapılır (§5.2).

---

## 2. Fiyatlandırma, paketler ve — kritik — kota

### 2.1 Yayımlanmış fiyat tablosu (birebir)

| Paket | Fiyat | Baro indirimi | Baro indirimli net |
|---|---|---|---|
| Ücretsiz Paket | Ücretsiz | — | — |
| Aylık Temel Paket | **1.500 ₺ / ay** | "Bu pakete uygulanmaz" | — |
| Aylık Tam Paket | **6.800 ₺ / ay** | "Bu pakete uygulanmaz" | — |
| Yıllık Tam Paket (Önerilen) | **60.000 ₺ / yıl** ("Aylık tam pakete göre yılda 21.600 ₺ tasarruf") | 0-5 yıl %40 · 5+ yıl %25 | **36.000 ₺/yıl** · **45.000 ₺/yıl** |
| Yıllık Pro Paket | **80.000 ₺ / yıl** | 0-5 yıl %40 · 5+ yıl %25 | **48.000 ₺/yıl** · **60.000 ₺/yıl** |

Kaynak: <https://www.dejure.ai/fiyatlandirma> ve ana sayfa fiyat bölümü,
erişim 02.09.2026. **[doğrulandı]** — indirimli tutarlar sayfada birebir
yazılıdır, tarafımızca hesaplanmamıştır.

### 2.2 Paket × özellik matrisi (sayfanın kendi ikonlarından çözüldü)

Sayfa `✓` / `✗` ikonlarını SVG path olarak çiziyor; ikon yolları
(`M20 6 9 17l-5-5` = var, `M18 6 6 18` = yok) mobil akordeon kartlarından
tek tek çözüldü. **[doğrulandı]**

| Özellik | Ücretsiz | Aylık Temel 1.500 ₺ | Aylık Tam 6.800 ₺ | Yıllık Tam 60.000 ₺ | Yıllık Pro 80.000 ₺ |
|---|:--:|:--:|:--:|:--:|:--:|
| Semantik arama | ✓ | ✓ | ✓ | ✓ | ✓ |
| Çoklu vurgulama | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hibrit arama | ✗ | ✓ | ✓ | ✓ | ✓ |
| Otomatik atıf | ✗ | ✓ | ✓ | ✓ | ✓ |
| Derin araştırma (Normal) | ✗ | ✓ | ✓ | ✓ | ✓ |
| Derin araştırma (Odaklı) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Derin araştırma asistanı (Chat) | ✗ | ✗ | ✓ | ✓ | ✓ |
| **Dilekçe oluşturma** | ✗ | **✗** | ✓ | ✓ | ✓ |
| Dilekçe analizi | ✗ | ✗ | ✓ | ✓ | ✓ |
| Dilekçe asistanı (Chat) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Sözleşme oluşturma | ✗ | ✗ | ✓ | ✓ | ✓ |
| Sözleşme analizi | ✗ | ✗ | ✓ | ✓ | ✓ |
| **UETS entegrasyonu** | ✗ | ✗ | **✗** | **✗** | ✓ |
| **Duruşma takibi** | ✗ | ✗ | **✗** | **✗** | ✓ |
| **UYAP entegrasyonlu editör** | ✗ | ✗ | **✗** | **✗** | ✓ |

**Satış açısından en önemli üç satır:** dilekçe yazdırmak **en az 6.800 ₺/ay**;
UYAP entegrasyonu, UETS ve duruşma takibi **yalnız 80.000 ₺/yıl Pro**'da.
Yani De Jure'nin reklamını yaptığı "tam UYAP entegrasyonu, UETS
entegrasyonu" ana sayfa vaadi, ürünün **en pahalı tek paketine** kilitlidir.

### 2.3 Kota — sitede yok, sözleşmede var (en güçlü tek bulgu)

Fiyat sayfasında **hiçbir kota rakamı yok**; SSS'de kota sorusu **yok**
(SSS verisi JS'ten çıkarıldı, 5 soru, hiçbiri limitle ilgili değil — §6.1).
JS'te `#faq-limits` diye bir çapa var ama karşılığı olan SSS maddesi
**mevcut değil**. **[doğrulandı]**

Buna karşılık **Mesafeli Satış Sözleşmesi m.6.6** kotayı açıkça
tanımlıyor ve örnek rakam veriyor:

> "…paketinizde tanımlı olan aylık kullanım limitinizin (sorgu, dilekçe
> yazdırma vb.) %10'undan fazlasını kullandıysanız iade hakkınızı
> kaybedersiniz…" — örnek olarak "aylık 100 kullanım kotası" ve "aylık 160
> kullanım kotası" verilir.
> <https://www.dejure.ai/yasal#mesafeli-satis-sozlesmesi> (02.09.2026)
> **[doğrulandı]**

Ve Deneme Üyeliği Sözleşmesi m.8.2, tamamı büyük harfle:
"KULLANICININ BELİRLENEN KULLANIM LİMİTLERİNE ULAŞMASI DOLAYISI İLE YAŞAMIŞ
OLDUĞU ZARARDAN DE JURE SORUMLU DEĞİLDİR." **[doğrulandı]**

Ayrıca JS'teki paket veri yapısı Temel paketi
**"Derin Araştırma (Normal, sınırlı)"** diye etiketler — sitede render
edilen tabloda bu "sınırlı" kelimesi **görünmüyor**. **[doğrulandı]**

**Sonuç [çıkarım]:** Aylık kota gerçektir, satın alma öncesi
yayımlanmamıştır ve büyüklüğü ancak iade hükmündeki örneklerden tahmin
edilebilir. Üçüncü taraf kullanıcı yorumları da tekrar eden kota
şikâyetlerini bildiriyor **[çıkarım]** (ekşi sözlük özeti; sayfa 403 verdi,
doğrudan görülmedi).

### 2.4 İade, yenileme, fesih

- Yıllık abonelik **otomatik yenilenmez**; aylık abonelik yenilenir
  (Platform Hizmet Sözleşmesi m.6.2–6.3). **[doğrulandı]**
- Yasal cayma hakkı yok (Mesafeli Sözleşmeler Yönetmeliği m.15/1-ğ);
  De Jure "iyi niyet göstergesi olarak" **14 gün** tanır, **kullanıcı başına
  ömür boyu 1 kez**, ve **kotanın %10'u aşılmışsa hak düşer** (m.6.1–6.6).
- 14 gün sonrası yıllık iptalde iade **"tamamen Satıcı'nın münhasır
  takdirinde"**; aylık iptalde **iade yok** (m.6.7). **[doğrulandı]**
- Fiyat değişikliği 15 gün önce e-posta ile bildirilir (m.6.5).
- Sorumluluk tavanı: son 12 ayda ödenen abonelik bedeli; gizlilik/veri
  güvenliği ihlallerinde bunun **iki katı** (Platform m.10.1–10.2).

### 2.5 Baro kanalı — İzmir Barosu dahil

De Jure'nin kendi harita varlığı (`/map/turkey-mapchart.svg`) **72 il
barosunu `data-partner="true"` işaretler**; hiçbiri `false` değil.
**İzmir dahildir.** Anlaşması olmayan 9 il: Aksaray, Bayburt, Bilecik,
Bitlis, Erzincan, Hakkâri, Karaman, Kilis, Tunceli. Ayrıca "İstanbul 2 No'lu
Barosu ile anlaşmamız bulunmaktadır", "Ankara 2 No'lu Barosu ile anlaşmamız
**bulunmamaktadır**". **[doğrulandı]** — kendi SVG'lerinden sayıldı,
02.09.2026. (Kitle fonlama sayfasındaki "19 baro" rakamı 2023'e aittir —
kanal iki yılda ~4× büyümüş. **[çıkarım]**)

İstanbul Barosu duyurusu (04/2026) mekanizmayı anlatıyor: indirim
**yalnız yıllık üyeliklerde**, Baronet'ten alınan **kampanya kodu** ile;
ayrıca adliyelerdeki baro odalarında **yalnız içtihat arama motoru**
`baro.dejure.ai` üzerinden ücretsiz. **[doğrulandı]**
<https://storage.istanbulbarosu.org.tr/public/2026/04/7aff7cc7-03ca-42bc-975c-42951998f9bc.pdf>

> **ColleX için doğrudan sonuç:** Bizim kullanıcımız İzmir Barosu üyesi.
> Onun için De Jure'nin gerçek fiyatı **48.000 ₺/yıl** (Pro, 0-5 yıl kıdem)
> veya **60.000 ₺/yıl** (Pro, 5+ kıdem); UYAP/UETS/duruşma takibi istemiyorsa
> **36.000 / 45.000 ₺/yıl** (Tam). Baro odasındaki bedava sürüm yalnız
> aramadır — dilekçe, derin araştırma, UDF yoktur.

---

## 3. 15 modül — tek tek, iddia ve kabul edilen sınır

### 3.1 Sitede ilan edilen 15 kalem

Ana sayfa hero'su: *"Dilekçe yazdırma, derin araştırma, sözleşme hazırlama,
tam UYAP entegrasyonu, UETS entegrasyonu ve daha fazlası."* **[pazarlama]**

Fiyat tablosundaki 15 kalem §2.2'de. Aşağıda her birinin **kendi sayfasındaki**
iddiaları ve kabul ettiği sınırlar.

#### (1) Semantik arama · (2) Çoklu vurgulama · (3) Hibrit arama
Kaynak: <https://www.dejure.ai/semantik-arama> (02.09.2026) **[doğrulandı]**

- "yalnızca kelime eşleşmesi değil, anlam ilişkisi üzerinden sonuçları
  listeler"; "benzer olay kurgularını ve benzer gerekçeleri ortaya çıkarır".
- Hibrit: **pozitif ve negatif anahtar kelime** ile daraltma.
- **Filtre derinliği (yeni, önceki anlık görüntüde yoktu):** filtreler
  "sadece mahkeme düzeyinde değil daha alt düzeyde de" uygulanır — örnek
  olarak *"Yargıtay 3. Hukuk Dairesi kararları içinde 2020-2023"* ve
  *"Bursa Bölge Adliye Mahkemesi kararları içinde 2018-2022"* verilir.
  Yani **daire + il BAM + yıl aralığı** filtresi vardır.
- Arama **literatürü de kapsar** (makale/kitap/tez/dergi).
- Kabul edilen sınır: **yok** — sayfada hiçbir doğruluk/kapsam çekincesi yok.

#### (4) Otomatik atıf
"Otomatik atıf" yalnız paket satırı olarak geçer; ayrı sayfası yoktur.
Derin Araştırma sayfası "Rapor, her çıkarımın dayandığı kaynağı açıkça
gösterir. Bu sayede argüman zinciri izlenebilir hale gelir ve
denetlenebilirlik artar." der. **Yeniden doğrulama (hash, ofset, sürüm
kimliği) tarifi yoktur.** **[doğrulandı-sayfa metni]** / mekanizma
**[pazarlama]**

#### (5) Derin araştırma (Normal) · (6) Derin araştırma (Odaklı) · (7) Derin araştırma asistanı (Chat)
Kaynak: <https://www.dejure.ai/derin-arastirma> (02.09.2026) **[doğrulandı]**

- "Her sorunuz için **tüm veritabanını tarar**" **[pazarlama]** —
  taranan şeyin ne kadarı olduğu, güncelliği, tazeleme sıklığı **hiçbir
  yerde yazmıyor**.
- "**Ortalama 5 ile 10 dakika** arasında süren araştırma sonucunda sorunuza
  ilişkin dayanaklı, kaynakçalı rapor sunar."
- Taranan **karar** veritabanları (birebir liste): Yargıtay · Danıştay ·
  Anayasa Mahkemesi · Bölge Adliye Mahkemeleri · **Bölge İdare Mahkemeleri**
  · **İlk Derece Mahkemeleri** · Uyuşmazlık Mahkemeleri · **Özelge** · BDDK ·
  Kamu İhale Kurulu · KVKK Kararları · Rekabet Kurulu · **Reklam Kurulu** ·
  **RTÜK** · Sayıştay · Sigorta Tahkim.
- Taranan **literatür**: Makaleler · Kitaplar · Tezler · Dergiler.
- Filtreleme: **merci seçimi** + **yıl filtresi**.
- **Evrak ekleyerek araştırma başlatma:** "dava dilekçesi, sözleşme vb."
  yükleyip araştırmayı o belge üzerinden başlatma.
- Asistan (Chat): rapor sonrası sohbet, "kaynakları tekrar değerlendirmesini
  isteyebilirsiniz", karşılaştırmalı analiz.
- Kabul edilen sınır: **yok**.

> **Kapsam karşılaştırması (ColleX):** De Jure listesinde bizde **olmayan**
> üç merci var: **Reklam Kurulu**, **RTÜK**, ve **ilk derece / bölge idare
> mahkemesi** kararları; ayrıca **literatür** (makale/kitap/tez/dergi)
> tamamen bizde yok. Bizde **olup onlarda listelenmeyen**: **mevzuat.gov.tr
> tam metin + gerekçe + madde ağacı**, **Cumhurbaşkanlığı kararnamesi /
> genelge / yönetmelik**, **BTK**. (`CLAUDE.md` §Directory map, 54 araç.)

#### (8) Dilekçe oluşturma · (9) Dilekçe analizi · (10) Dilekçe asistanı (Chat)
Kaynak: <https://www.dejure.ai/dilekce> (02.09.2026, "tam - pro" rozeti)
**[doğrulandı]**

- "Yapay zeka sadece dilekçe oluşturmaz; aynı zamanda **hukuki olarak
  güvenilir ve güçlü metinler üretir**." **[pazarlama]**
- **İsteğe bağlı evrak yükleme:** yüklenen evraklar dilekçe yazımında
  kullanılır — "yapay zeka sadece talebinize bağlı kalmadan eklenen
  evraklardan yararlanabilir." **Bu, ColleX'in ADR-021'de yasakladığı şeyin
  tam tersidir** (bizde yüklenen belge yalnız `Ek-n` delil ve
  `suggestedFacts`; hukukî değerlendirme paragrafına asla girmez).
- **İçtihat filtresi dilekçe içinde:** "yalnızca BAM, yalnızca Yargıtay ya
  da yalnızca Danıştay kararları eklenmesini tercih edebilirsiniz" + tarih
  aralığı.
- **Uzunluk:** "iki farklı uzunluk seçeneği… normal ve uzun." Uzun mod
  "normal moda göre **3-4 kat daha uzun** bir metin üretir".
- **"Dilekçe çıktısı son haline geldiğinde UDF olarak dışa aktarılabilir."**
- Asistan: bölüm ekleme/genişletme/daraltma, üslup değiştirme, belirli bir
  argümanı güçlendirme — sınırsız iterasyon.
- **Dilekçe Analizi:** dilekçeyi yükle + istenen analizi anlat; örnek
  sorular sayfada: "hukuki dayanaklarının güçlü olup olmadığını, eksik
  argümanların bulunup bulunmadığını veya **karşı tarafın olası itirazlarına
  karşı ne kadar hazırlıklı** olduğunu". Çıktı: "kapsamlı bir rapor",
  "zayıf noktaları tespit eder, güçlendirme önerileri sunar ve gerekirse
  **alternatif argümanlar** önerir"; "**karşı tarafın dilekçesindeki
  açıkları belirleyebilirsiniz**".
- Kabul edilen sınır: sayfada **avukat kontrolü uyarısı yok**; uyarı yalnız
  sözleşmede (§6.2).
- Şablon yok: JS'teki demo verisi taslak adlarının serbest metinden
  türetildiğini gösteriyor ("Munzam zarar davası dilekçe taslağı",
  "Davalı bankanın cevap dilekçesi taslağı", "Munzam zarar istinaf başvuru
  dilekçesi taslağı", "Göreve İtiraz Dilekçesi", "Yetkisiz İşlem İtiraz
  Dilekçesi"). **[çıkarım]** → **alan-doğrulamalı şablon yok**, prompt'a
  bağlı serbest üretim.

#### (11) Sözleşme oluşturma · (12) Sözleşme analizi
Kaynak: <https://www.dejure.ai/sozlesme> (02.09.2026, "tam - pro")
**[doğrulandı]**

- İki akış: **hazırlama** (sıfırdan) ve **inceleme**.
- İnceleme: "sözleşme maddelerini analiz ederek bir **risk raporu** çıkarır
  ve **her madde için iyileştirme önerileri** sunar. Risk tespitleri, ilgili
  **mevzuat ve içtihat referanslarıyla** desteklenir."
- "İnceleme ekranında **kaynaklara aynı ekrandan** erişebilirsiniz."
- Kapsanan türler: kira, gizlilik (NDA), iş, satış, hizmet, lisans,
  distribütörlük, tedarik "ve daha pek çok".
- Kabul edilen sınır: **yok**.

#### (13) UETS entegrasyonu · (14) Duruşma takibi
Web sitesinde **ayrı sayfası yoktur**; yalnız Pro paketinin özellik satırı
olarak geçer. Ne kadarının otomatik olduğu, hangi kimlik bilgisiyle
bağlandığı, bildirim mekanizması **hiçbir kamuya açık sayfada
anlatılmıyor**. **[doğrulandı — yokluk]**

Mobil sürüm notu bu boşluğu dolduruyor (§4): **2.4.0 (19.02.2026)** —
*"Takvim modülü: Duruşma ve tebligat takibi, hatırlatıcılar ve bildirimler"*.
**[doğrulandı]** → duruşma/tebligat takibi **takvim + hatırlatıcı +
bildirim** olarak gerçek bir modüldür.

#### (15) UYAP entegrasyonlu editör = **masaüstü uygulaması**
Kaynak: <https://www.dejure.ai/dilekce-editoru> ("Pro" rozeti) + `/yasal`
Ek Protokol. **[doğrulandı]** — **bu, raporun en önemli teknik bulgusudur.**

Sayfadan:
- "web uygulamamızdaki dilekçe yazan yapay zeka modülünden **farklı bir
  ürün**"; "dava dosyanız üzerinde çalışmayı merkeze alır".
- "Bu üründe dava dosyanızı açabileceğiniz bir **workspace**'e sahip
  olursunuz. **UYAP'ta bulunan dava dosyanız workspace'e alınır** ve
  dosyanızda yazılmasını istediğiniz dilekçe, dosyanın bağlamına uygun
  biçimde oluşturulur."
- "dilekçe içeriğinde kullanılan içtihatları **eş zamanlı olarak
  görüntüleyebilirsiniz**".
- "**Derin araştırma raporlarını kullanmasını sağlayabilirsiniz.** Gerekli
  içtihat ve dayanaklar rapordan alınarak dilekçeye eklenir."
- "Dilekçeniz son haline geldiğinde **UDF olarak dışa aktarabilirsiniz**."

Ek Protokol'den (asıl bilgi burada):
- m.1.2: "Üye'nin **UYAP hesabına bağlanarak** dosya bilgilerini (**taraf,
  evrak, safahat** vb.) çeken, bu verileri yapay zeka (AI) ajanları
  aracılığıyla işleyerek dilekçe taslakları oluşturan bir **masaüstü
  yazılımıdır**."
- m.2.1: "kurulumunun, De Jure teknik ekibi tarafından Üye'nin bilgisayarına
  **uzaktan erişim (AnyDesk, TeamViewer vb. araçlarla)** yoluyla yapılmasını
  kabul eder."
- m.2.4: "Uygulama, UYAP Avukat Portalı'na **kullanıcının kendi kimlik
  bilgileriyle** bağlanır; De Jure, bu credentials'lara erişemez, saklamaz."
- m.3.1: Üye, UYAP dosyalarındaki **özel nitelikli kişisel veriler dahil**
  tüm veriyi **"De Jure altyapısına aktarmaya yasal olarak tam yetkili"**
  olduğunu **gayrikabili rücu** beyan eder.
- m.6.3: "Veriler, **Google Cloud'da (AB sunucuları)** yurtdışı
  altyapılarda tutulmakta ve işlenmektedir."

> **Bu, ColleX'in en net karşıt konumudur.** De Jure'nin UYAP değeri şu
> bedelle gelir: (i) 80.000 ₺/yıl tek paket, (ii) satıcının uzaktan
> masaüstünüze kurulum yapması, (iii) UYAP dosya içeriğinin (müvekkil
> verisi, safahat, evrak) **yurt dışı buluta** aktarılması, (iv) avukatın
> bunun tüm KVKK/meslek sırrı sorumluluğunu **gayrikabili rücu** üstlenmesi.
> ColleX'te dosya makineyi terk etmez.

### 3.2 Sitede **görünmeyen** ama JS paketinde ilan edilen özellikler

Paket kartlarının veri yapısı (`_next/static/chunks/*.js`), render edilen
karşılaştırma tablosundan **daha zengin** bir özellik listesi taşıyor.
**[doğrulandı]** — birebir dizgiler:

| Paket | JS'teki tam özellik listesi (render edilmeyenler **kalın**) |
|---|---|
| Ücretsiz | Semantik arama · Çoklu vurgulama |
| Aylık Temel (id `monthly-basic`, "Bireysel", "Rutin kullanım") | **Derin Araştırma (Normal, sınırlı)** · **Sınırsız semantik arama** · Çoklu vurgulama · Hibrit arama · **Sorgu iyileştirme** · **Mevzuat ekleme** · Otomatik atıf · **İçtihat/Literatür listesi** · **Favori kararlar** · **Zor kararlar için destek** · **Arama geçmişi** |
| Aylık/Yıllık Tam (`monthly-full`/`annual-full`, "Büro", "Yoğun araştırma") | Derin Araştırma (Normal) · Derin Araştırma (Odaklı) · Dilekçe oluşturma · Sözleşme analizi · **Sonuçları incele** · **Dokümanı incele** · **Doküman özeti** · **İlgililer** · **Gelişmiş hafıza** · **Keşif araması** · **Pozitif/negatif kelime filtreleme** · Temel paketteki tüm özellikler |
| Yıllık Pro (`annual-pro`, "Kurumsal", "UYAP + masaüstü") | **⭐UYAP entegrasyonlu masaüstü dilekçe editörü uygulaması** · UETS entegrasyonu · Duruşma takibi · Derin Araştırma (Normal/Odaklı) · Dilekçe oluşturma · Sözleşme analizi · Diğer paketlerdeki tüm özellikler · *not:* "**Kurumsal onboarding ve öncelikli destek** içerir." |

Bunlardan ColleX açısından önemli olan dördü:

1. **"Mevzuat ekleme"** — mevzuat 15 kalemlik pazarlama listesinde yok ama
   Temel pakette var. Mobil uygulama açıklaması da "**Mevzuat**" ve
   "**Başlıkla Arama**" der. **[doğrulandı]** → mevzuat araması gerçektir,
   pazarlanmıyor.
2. **"Gelişmiş hafıza" / "Memory (Hafıza)"** — oturumlar arası bellek.
   ColleX'te dava dosyası var, ama **cevaplar arası hafıza yok**.
3. **"İlgililer"** — ilgili kişi/kurum çıkarımı (entity extraction). Bizde
   sezgisel intake analizi var, "ilgililer" görünümü yok.
4. **"Keşif araması" / "Sorgu iyileştirme"** — sorgu genişletme/öneri.
   Mobil sürüm notu 1.02/1.03 de "arama sorgularını revize ederek arama"
   diyor. Bizde konsolda sorgu önerisi yok.

Ürün içi sözlükten çıkan diğer dizgiler (**[doğrulandı]**, JS):
`Klasörlerim` · `Geçmiş` · `Yeni Dilekçe` · `Editör (Aktif)` ·
`Sözleşme Editörü` · `Derin Araştırma Planla` · `Analizi Gör` ·
`Literatürde Ara` · `Tümünü Seç` · `Daha Fazla Yükle` ·
`Aylık ortalama dosya:` · `Yakında` · durum etiketleri
`Hazırlık` / `Planlandı` / `Tamamlandı` / `Açık` / `Hizmet Dışı` ·
mod etiketleri `Hızlı` / `Odaklı` · doküman sohbeti yer tutucusu
"Doküman hakkında bir soru sorun…" · "Dilekçe konusu veya açıklama yazın…"
· analiz yönergesi örneği "Örn: Davacı vekiliyim, dilekçedeki riskleri
lehime değerlendirin".

> **`Klasörlerim` bulgusu, `docs/COMPETITIVE.md` §1'deki**
> *"De Jure'de resmî sayfalarda dosya/proje/klasör kavramı geçmiyor"*
> **satırını geçersiz kılar.** De Jure'de hem klasör, hem (Pro'da) UYAP
> workspace'i, hem mobilde "Dava dosyalarım" vardır. Bu satır W13
> sentezinde **düzeltilmelidir**.

### 3.3 Referans / müşteri duvarı

Sayfada dönen logo şeridi 6 isim gösteriyor; JS'teki tam liste 27 isim
içeriyor: Akkuyu Nükleer · Astaş Holding · Başkent Doğalgaz · BOTAŞ · DEDAŞ ·
Demirören Medya · Egemenoğlu · Ersan Şen · Fenerbahçe SK · Galatasaray
Üniversitesi · Kadir Has Üniversitesi · Koç Üniversitesi · Kolcuoğlu Demirkan
Koçaklı · Mutlu Avukatlık Ortaklığı · Okan Üniversitesi · Özyeğin
Üniversitesi · ÖZAY Law Firm · Sağlık Bakanlığı · Sermaye Piyasası Kurulu ·
TÜSİAD · Yapı Kredi · Yıldız Holding · Ziraat Bankası · Acar Ergönen ·
Aksan Hukuk Bürosu · Akıncı · Kenaroğlu (+ logo dosyaları: Akbank, Hepiyi,
Lukoil, Paksoy, Pekin Bayar Mizrahi, Petrol Ofisi, Pladis, Takasistanbul,
Ay Yapım). **[pazarlama]** — ilişkinin niteliği (müşteri mi, deneme mi)
hiçbir yerde tanımlı değil.

### 3.4 Blog — ürün sinyali değil, SEO çiftliği

368 yazı / 37 sayfa; **1. sayfadaki ve 37. sayfadaki yazıların tamamı
"9 Ocak 2026" tarihli**, yazar "De Jure Hukuk Ekibi". Konular TBK madde
şerhleri (m.65, 72, 74, 75, 76, 78, 83, 84, 86-87, 89 …). **[doğrulandı]**
→ tek seferde toplu yayımlanmış arama motoru içeriği; **ürün duyurusu,
sürüm notu ya da yol haritası taşımıyor**. Rakip yol haritası için blog
işe yaramaz; App Store sürüm geçmişi yarar (§4).

### 3.5 Korpus şeffaflığı — hâlâ sıfır

De Jure hiçbir yüzeyde **karar sayısı**, **güncellik tarihi** veya
**tazeleme sıklığı** yayımlamıyor. SSS'deki tek "yeterlilik" cevabı
otorite argümanıdır: "De Jure'nin veritabanı Türkiye'nin önde gelen
üniversitelerinin kütüphanelerinde yer almaktadır… **Genişliğine güvenerek
kullanabilirsiniz.**" **[pazarlama]** — bu, 28.08.2026 anlık görüntüsünden
**değişmemiştir**.

### 3.6 Demo içeriğinden çıkan ürün gerçekleri

Ana sayfadaki üç gömülü demo ("Web Uygulaması", "Dilekçe Editörü",
"Dilekçe Editörü Dashboard") JS'te veri olarak duruyor. İçinde gerçek
formatta atıflar var: `Yargıtay, 11. Hukuk Dairesi, E. 2019/4241,
K. 2022/6411, T. 28.09.2022` yanında **`Bursa 1. Asliye Ticaret Mahkemesi,
E. 2023/1239, K. 2025/250, T. 04.03.2025`** gibi **ilk derece** kararları
ve bir literatür başlığı. **[doğrulandı]** → ilk derece mahkeme kararları
ve doktrin gerçekten korpusta. Bizde **ilk derece kararı yok** (Emsal/UYAP
kararları Bedesten üzerinden kısmen gelir; doktrin hiç yok).

---

## 4. Gerçek yol haritası — App Store sürüm geçmişi (birebir)

Kaynak: <https://apps.apple.com/tr/app/de-jure-ai/id6449427444?l=tr>
(shoebox `versionHistory` verisi), erişim 02.09.2026. **[doğrulandı]**

| Sürüm | Tarih | Sürüm notu (birebir) |
|---|---|---|
| 2.6.1 | 10.08.2026 | "- Hata düzeltmeleri ve iyileştirmeler." |
| **2.6.0** | **08.07.2026** | "- **UYAP UDF dosyalarını görüntüleme desteği eklendi.** - Genel kararlılık ve performans iyileştirmeleri yapıldı." |
| 2.5.0 | 21.05.2026 | "Yeni özellikler ve hata düzeltmeleri." |
| **2.4.0** | **19.02.2026** | "- **Takvim modülü: Duruşma ve tebligat takibi, hatırlatıcılar ve bildirimler** - **Dilekçe Analizi modülü: Dilekçe hazırlama ve düzenleme editörü** - Derin Araştırma: Sonuçlar arasında arama, sohbet desteği - Galeriden görsel seçimi - **Dava dosyalarım**" |
| 2.1.0 | 31.07.2025 | "Bu sürüm, yeni özellikler ve performans iyileştirmeleri içerir." |
| 2.0.0 | 30.07.2025 | (aynı) |
| 1.6 | 07.10.2024 | "Yazılımsal iyileştirmeler." |
| 1.05 / 1.04 | 22–21.08.2024 | "Hata düzeltmeleri." |
| 1.03 | 16.01.2024 | Ana sayfada örnek arama sorguları; beyaz ekran hatası düzeltildi |
| 1.02 | 15.01.2024 | Gerçek zamanlı arama sorgusu takibi; sorguyu düzenleyip arama |
| 1.01 | 26.09.2023 | "Media manager iyileştirmeleri yapıldı." |
| 1.0 | 02.07.2023 | İlk sürüm |

**Okunuşu [çıkarım]:** 2023–2025 arası ürün bir **arama motoru**du
(Play alt başlığı hâlâ "Hukukçular için yapay zeka teknolojisine sahip arama
motoru"). Şubat 2026'da tek hamlede **dava dosyası + takvim/duruşma-tebligat
takibi + dilekçe editörü** geldi; Temmuz 2026'da **UDF okuma**. Instagram
biyografisi bugün "Hukukçular için yapay zeka teknolojisine sahip **dilekçe
editörü**" diyor **[çıkarım]** — konumlandırma aramadan dilekçe/dosya
iş akışına kaydı. Bu, ColleX'in "Davalarım + Taslak + Süreler" ekseninin
**doğru eksen** olduğunun bağımsız teyididir.

### Mobil uygulama gerçeği (satın alma öncesi görülen tek nesnel kalite verisi)

| Ölçüt | App Store (TR) | Google Play (TR) |
|---|---|---|
| Sürüm / güncelleme | 2.6.1 · 10.08.2026 | 06.08.2026 |
| Puan | **4,6 / 5** — **25 değerlendirme** | **4,1 / 5** — **17 yorum** (telefon: 4,0 / 16) |
| İndirme | — | **1 B+** (1.000+) |
| Boyut / min sürüm | 70 MB · iOS 16.4+ | — |
| İlk yayın | 02.07.2023 | 06.06.2023 |
| Kategori | Referans | Verimlilik |

**[doğrulandı]** iTunes lookup API + Play sayfası, 02.09.2026.

Play'de görünen **son üç yorumun üçü de olumsuz ve aynı hatayı** anlatıyor:
oturumun sürekli düşmesi / uygulamanın açılmaması (22.05.2026, 03.06.2026,
06.07.2026). **[doğrulandı]** — bu, "web paritesi" iddiasıyla çelişen
somut bir kalite sinyalidir. Toplam kullanıcı tabanı da küçüktür: 1.000+
indirme, 42 toplam değerlendirme.

Mobil uygulama açıklaması (her iki mağaza) **web'de reklamı yapılmayan**
özellik adları veriyor: "Derin Araştırma · Sonuçları İncele · **Doküman
Analizi** · **Arama Sorgumu İyileştir** · **UDF Analizi** · **Memory
(Hafıza)** · **Mevzuat** · **Başlıkla Arama** · **Kelime Filtreleme** ·
**UDF Görüntüleme**". **[doğrulandı]**

---

## 5. Hukukî metinler — bir Türk avukatın kabul etmek zorunda olduğu şeyler

`/yasal` on belge taşır: Deneme Üyeliği Sözleşmesi · Platform Hizmet
Sözleşmesi · Mesafeli Satış Sözleşmesi (Tüketici) · **Ek Protokol (Dilekçe
Editörü)** · Kullanım Koşulları (AUP) · Gizlilik Politikası · Çerez
Politikası · Aydınlatma Metni · Ticari İleti Onay Metni · **Veri Aktarımı
Protokolü**. Hepsi **[doğrulandı]**, erişim 02.09.2026.

### 5.1 Veri mimarisi ve alt işleyenler

| Konu | De Jure'nin yazdığı |
|---|---|
| Barındırma | "Veriler **Google Cloud**'da AES-256 şifreleme ile saklanır ve aktarılır (HTTPS/TLS 1.2+)"; "Google Cloud veri merkezleri (**AB sunucuları**)" |
| Alt işleyenler (§8) | **Yalnız ikisi adlandırılıyor: Google Cloud ve İyzico** (ödeme). |
| **Model sağlayıcı** | **Hiçbir yerde adlandırılmıyor.** OpenAI/Anthropic/Google Gemini vb. hiçbir LLM sağlayıcısı ne alt işleyen listesinde ne başka bir yerde geçiyor. **[doğrulandı — yokluk]** |
| Yurt dışı aktarım | KVKK m.9, **Standart Sözleşme Klozları**, "Standart Sözleşme KVK Kurumuna bildirilmiştir" |
| İhlal bildirimi | **72 saat** içinde Üye'ye |
| Roller | Kullanıcı içeriği + UYAP verisi için **Üye = Veri Sorumlusu**, De Jure = Veri İşleyen |
| Model eğitimi | "Kullanıcı İçeriği… model eğitimi için **KESİNLİKLE KULLANILMAZ**" |
| Veri sahipleri | "Üye'nin kendisi, **Üye'nin müvekkilleri, karşı taraflar**… veya yüklenen dosyalardaki kişiler" |
| Özel nitelikli veri | "doğası gereği Özel Nitelikli Kişisel Veri (örn. ceza mahkumiyeti, sağlık verileri) içerebilir"; hukukî dayanağı temin etmek **münhasıran Üye'nin** |
| Ürün geliştirme | De Jure "Veri Sorumlusu" olduğu veriler için amaçlar arasında "**hedefli reklamlar**", "**Ar-Ge aşamasındaki uygulamaların geliştirilmesi ve pazarlanması**", "**Pazarlama analiz çalışmaları**" sayılıyor |

> **Bir avukat için üç somut soru cevapsız kalıyor:** hangi LLM'e gidiyor,
> hangi ülkede işleniyor (Google Cloud AB deniyor ama model çağrısı için
> hiçbir taahhüt yok), ve **model sağlayıcısıyla bir alt-işleyen sözleşmesi
> var mı**. ColleX'te bu soru yapısal olarak yoktur: varsayılan olarak
> hiçbir şey makineyi terk etmez; bulut hattı **kapalı**dır ve ancak
> `ANTHROPIC_API_KEY` + **istek başına** onayla açılır (ADR-018), ne
> gittiği `docs/implementation/AI.md`'de yazılıdır.

### 5.2 Dilekçe Editörü Ek Protokolü — avukatın üstlendiği yük

- Kurulum **uzaktan erişimle satıcı tarafından** (AnyDesk/TeamViewer),
  m.2.1; "Üye, kurulum öncesinde önemli verilerini **yedeklemekle bizzat
  sorumludur**" m.2.3.
- Üye, UYAP dosya verilerini "De Jure altyapısına **aktarmaya yasal olarak
  tam yetkili**" olduğunu **gayrikabili rücu** beyan eder (m.3.1) ve
  müvekkil açık rızalarını aldığını kabul eder (m.3.2); "Bu yükümlülüğün
  ihlalinden doğacak tüm hukuki, cezai ve **mesleki sorumluluk münhasıran
  Üye'ye aittir**."
- Teyit yükümlülüğü (m.5.3): vakıa özetleri, **tarih/isim/miktar**, eklenen
  **içtihatların doğruluğu, güncelliği ve dosyayla ilgisi**, tüm hukuki
  argüman ve talepler — hepsini müvekkile sunmadan önce doğrulamak
  **münhasıran Üye'nin** yükümlülüğü.

### 5.3 Kendi metinleri arasındaki üç çelişki (satış malzemesi)

**Çelişki A — doğruluk garantisi ↔ sorumsuzluk beyanı.**
Ana sayfa SSS'si (bugünkü **birebir** metin):

> **"Kararların doğruluğunu garanti ediyor musunuz?"** — *"Evet. Derin
> araştırma ve dilekçe modüllerinde kaynakça bölümünde listelenen ve
> tıklayıp açabildiğiniz kararlar gerçektir ve doğruluğu tarafımızca
> garanti edilmektedir."*
> <https://www.dejure.ai> (SSS), 02.09.2026 **[pazarlama]**

Platform Hizmet Sözleşmesi m.8.3 (büyük harfle) ve m.8.5:

> m.8.3 — *"…HİZMETLER ARACILIĞIYLA SUNULAN İÇERİKLERİN, ARAMA
> SONUÇLARININ, YAPAY ZEKA ANALİZLERİNİN VEYA OLUŞTURULAN EVRAK
> TASLAKLARININ DOĞRULUĞU, GÜNCELLİĞİ, EKSİKSİZLİĞİ… KONUSUNDA AÇIK VEYA
> ZIMNİ **HİÇBİR GARANTİ VERMEZ**."*
> m.8.5 — *"Yapay zeka (AI) sistemlerimiz bazen hatalar yapabilir, bilgiler
> eksik kalabilir veya **tamamen yanlış sonuçlar üretebilir**… kendiniz
> dikkatlice kontrol etmek ve doğrulamak **tamamen Üye'nin
> sorumluluğundadır**."*
> <https://www.dejure.ai/yasal#hizmet-sozlesmesi>, 02.09.2026 **[doğrulandı]**

*Not — dürüst okuma:* SSS'deki garanti **dar** kapsamlıdır: iddia, kaynakçadaki
kararların **var olduğu** (uydurulmadığı) yönündedir, analizin doğru olduğu
yönünde değil. Bunu satışta yanlış aktarmayalım; asıl çelişki, aynı sayfada
**hiçbir mekanizma gösterilmeden** "garanti" kelimesinin kullanılması ile
sözleşmedeki "hiçbir garanti vermez" arasındadır.

**Çelişki B — KVKK "ek risk doğmaz" ↔ "münhasıran Üye sorumludur".**
SSS (birebir): *"…Bu nedenle **KVKK kapsamında ek bir risk doğmaz**;
kişisel verileri manuel olarak silmeniz veya anonimleştirmeniz zorunlu
değildir."* **[pazarlama]**
Aynı sitedeki Gizlilik Politikası ise Üye'yi **Veri Sorumlusu** yapar,
özel nitelikli veriler için hukukî dayanağı temin etmeyi **münhasıran
Üye'ye** yükler ve Ek Protokol m.3.2 mesleki sorumluluğu **münhasıran
Üye'ye** verir. **[doğrulandı]** → SSS bir avukata, sözleşmesinin tam
tersini söylüyor. Bir avukat için bu, ticari değil **meslekî** bir risktir.

**Çelişki C — imha/yedek.**
Platform m.5.5: web arayüzünden yüklenen evrak "işlem tamamlandıktan…
sonra… **kalıcı olarak saklanmaz ve imha edilir**" ve "Sistemlerimizde
**hiçbir kullanıcı dosyasının gizli yedeği (back-up) alınmaz**… hiçbir iz,
kalıntı veya kurtarılabilir kopya barındırılmaz."
Gizlilik Politikası §7: "Yedekleme ve Kurtarma: **Günlük yedekler**, felaket
kurtarma planı; veriler ayrı sunucularda tutulur."
Ek Protokol m.4.2: "UYAP'tan anlık çekilen ve işlemeye esas alınan ham
veriler (örn. dosya içeriği) ise işlem tamamlandıktan sonra **saklanmaya
devam olunur**."
Gizlilik Politikası §11.4: fesihte veriler "**30 gün içinde** silinir".
**[doğrulandı]** → dört farklı saklama/imha vaadi, aynı sayfada.

---

## 6. Üçüncü taraf sinyalleri (tarafsızlığı doğrulanmadı)

- **hukukiyapayzeka.com, "Apilex mi De Jure mu?", 06.01.2026** — laboratuvar
  testi değil, pratik kıyas. Öne çıkanlar: dilekçe üretim süresi De Jure
  ~5 dk / Apilex ~1 dk; De Jure "karmaşık konularda tutarsızlık ve yanlış
  bilgi riski"; De Jure paketleri özellik/soru limitli, Apilex sınırsız;
  De Jure'nin avantajı UYAP + Resmî Gazete takibi. Sonuç: yazar Apilex'i
  öneriyor. **[çıkarım — üçüncü taraf, sitenin bağımsızlığı doğrulanmadı;
  Apilex lehine yönlü olabilir]**
  *Not:* "Resmî Gazete takibi" iddiası De Jure'nin **kendi** yüzeylerinde
  geçmiyor.
- **Kullanıcı yorumları (arama motoru özeti üzerinden)** — tekrar eden iki
  tema: (i) tahminler/sonuçlar başarılı bulunuyor, (ii) **kota sürekli
  doluyor**, günlük/aylık limitlere takılınıyor. **[çıkarım]** — ekşi
  sözlük sayfası 403 verdiği için birinci elden görülmedi.
- **Kitle fonlama (narfon.com.tr, 13.12.2023–10.02.2024)** — hedef
  5.000.000 ₺, toplanan **1.008.140 ₺**, değerleme 74,1 mn ₺ (bağımsız
  değerleme 78 mn ₺ üzerinden %5 iskonto), %6,75 pay, 226 yatırımcı.
  Açıklanan metrikler: **2023'te 7.000 aktif hukukçu, 155.000 arama
  sorgusu, 19 baro anlaşması**. Yol haritası: 2024 ilk yarısı Almanya,
  **7 milyar parametreli kendi LLM'i**, **On-Premises ürün geliştirmesi**.
  **[doğrulandı — kampanya sayfası]**; kampanyanın hedefe ulaşıp ulaşmadığı
  ve on-prem ürünün hayata geçip geçmediği **doğrulanamadı** —
  bugün hiçbir yüzeyde on-prem/self-hosted seçenek ilan edilmiyor.
  **[çıkarım]** On-prem'i bir kez planlamış olmaları, "veri makineden
  çıkmasın" talebinin pazarda gerçek olduğunun teyididir.
- **Basın (hukukihaber.net, 09.10.2022 / güncelleme 10.01.2025)** —
  İstanbul, Ankara, Antalya barolarıyla protokol; üyelere 3 ay ücretsiz;
  hedef pazarlar Almanya/Avusturya/İsviçre, 2024'te Anglo-Sakson hukuku ve
  "Casetext ile rekabet". **[doğrulandı — haber metni]**
- **Üniversite kütüphaneleri** — İzmir/İstanbul/Bolu Abant İzzet Baysal/
  Yeni Yüzyıl/Erzincan Binali Yıldırım kütüphaneleri deneme erişimi
  duyurmuş; kullanım kılavuzu PDF'leri yayımlamış (14.05.2024 ve
  ~02.2025 tarihli). **[doğrulandı — duyuru listeleri]** SSS'deki
  "üniversite kütüphanelerinde yer alır" iddiasının kaynağı budur; bu bir
  **deneme erişimi** kanalıdır, akademik onay değil. **[çıkarım]**

---

## 7. Özellik-özellik matris: De Jure iddiası → ColleX bugünü → boşluk

Şiddet ölçeği: **P0** = güven/dürüstlük ya da avukatın işini bloke eden
boşluk · **P1** = rakibin sattığı, bizde parçaları hazır olan iş akışı ·
**P2** = değerli ama pahalı/bağımlı · **P3** = kovalanmamalı.

| # | De Jure iddiası (birebir/özet) | Etiket | ColleX bugün (kaynak) | Boşluk | Şiddet | Ne inşa edilmeli |
|---|---|---|---|---|---|---|
| 1 | "kaynakça bölümünde listelenen… kararlar gerçektir ve doğruluğu tarafımızca **garanti edilmektedir**" | [pazarlama] (dejure.ai SSS, 02.09.2026) | İddia yok, **reddetme** var: doğrulanamayan alıntı çıktıya giremez, dışa aktarım exit 2 ile durur (`export/`, CLAUDE.md invaryant) | **Yok — üstünlük.** Ama bunu tek cümlede söyleyen bir yüzeyimiz yok | P1 | Konsola ve DOCX/UDF kapağına tek satırlık **"Doğrulama sözü"** rozeti: "Bu belgedeki her alıntı SHA-256 + kod-noktası konumu ile bağlıdır; tarifi EK — DOĞRULAMA BİLGİLERİ'ndedir." + `/v1/health`'e `verificationContract: true` |
| 2 | "Rapor, her çıkarımın dayandığı kaynağı açıkça gösterir" — yeniden doğrulama tarifi yok | [doğrulandı-sayfa] / mekanizma [pazarlama] | Hash + Unicode kod-noktası aralığı + değişmez sürüm kimliği; üçüncü tarafın yeniden çalıştırabileceği DOĞRULAMA bölümü | Yok — üstünlük | — | Koru; §1'deki rozetle görünür kıl |
| 3 | Semantik + hibrit (pozitif/negatif kelime) + **daire ve yıl aralığı** filtresi ("Yargıtay 3. HD 2020-2023", "Bursa BAM 2018-2022") | [doğrulandı] semantik-arama | Hibrit getirme (exact-pin + FTS + trigram + citator, RRF); MCP araçları daire/tarih parametrelerini destekler | **Konsolda daire/yıl/merci filtresi ve negatif kelime yok** | **P1** | `Araştır` sekmesine merci + daire + yıl aralığı + "bu kelimeler geçmesin" alanları; `POST /v1/answer` `filters`'a `courts[]`, `chambers[]`, `yearFrom/yearTo`, `excludeTerms[]` (ek alan, kırıcı değil) |
| 4 | "Derin Araştırma… **ortalama 5-10 dakika**… kaynakçalı rapor"; Normal / Odaklı / Chat asistanı | [doğrulandı] derin-arastirma | Canlı derin araştırma `/v1/research`, bütçe tavanlı (≤24 çağrı / ≤10 tam belge / ≤120 s), adım izli, arama özeti asla kanıt değil | Bizde **tek mod** var; "Odaklı" (dar kapsam, hızlı) ve rapor sonrası **sohbet** yok | **P1** | (a) `mode: 'hizli' \| 'odakli' \| 'genis'` — bütçe ön ayarları; (b) tamamlanan koşu üzerinde **"Bu rapora sor"**: `POST /v1/answer` + `filters.runId` ile aynı kanıt havuzunda kalan, hash'li soru-cevap |
| 5 | **"Evrak ekleyerek araştırma başlatma"** (dilekçe/sözleşme yükle → araştırma) | [doğrulandı] derin-arastirma | `filters.fileIds` ile "Belgeye sor" var; **yüklenen belgeden canlı araştırma başlatma yok** | Orta | **P1** | `POST /v1/research` `seedFileIds[]`: intake analizinin çıkardığı atıf/anahtar terimlerden plan üret; belgeden gelen terimler **iddia değil sorgu** olarak işaretlensin (ADR-021 ile uyumlu) |
| 6 | Dilekçe: **normal / uzun (3-4 kat)** uzunluk seçeneği | [doğrulandı] dilekce | Bulut AI paragrafında `normal`/`uzun` var; **kural tabanlı taslakta uzunluk seçeneği yok** | Küçük | P2 | Şablon oluşturmaya `uzunluk: 'normal'\|'uzun'` — uzun mod yalnız **mevcut kanıttan** bölüm genişletir, yeni iddia üretmez |
| 7 | Dilekçede **içtihat kaynağı filtresi** (yalnız BAM / Yargıtay / Danıştay) + tarih aralığı | [doğrulandı] dilekce | Yok | Orta | **P1** | Taslak formuna "Dayanak olarak yalnız şu merciler / şu yıl aralığı" kutusu; alaka kapısına (ADR-022) ek bir merci filtresi olarak bağla |
| 8 | **Dilekçe Analizi**: dilekçe yükle + serbest analiz talimatı → zayıf nokta, eksik argüman, **karşı tarafın olası itirazları**, "karşı tarafın dilekçesindeki açıkları belirleyin" | [doğrulandı] dilekce | Parçalar var: intake sezgisel analizi, as-of pin, temporal kapanış, citator, karşıt tarama; **paketlenmiş akış yok** | **En büyük ürün boşluğu** | **P0** | **"Karşı dilekçe denetimi"** akışı: yükle → çıkarılan her atıf `POST /v1/answer` + `asOf = dilekçe tarihi` → çıktı: (i) yürürlük rozeti (yürürlükte/mülga/henüz değil), (ii) **çelişen otorite**, (iii) doğrulanamayan atıf listesi. Bizim versiyonumuzun onlarda olmayan tarafı: **her tespit hash'li alıntıya bağlı**, bağlanamayan tespit **yazılmaz**. `COMPETITIVE.md` §2 kalem 9'un ürünleşmiş hali |
| 9 | Dilekçe **asistanı (chat)**: bölüm ekle/genişlet/daralt, üslup değiştir, argüman güçlendir | [doğrulandı] dilekce | `PUT /v1/drafts/{id}` → sürüm+1, linter, sürüm geçmişi, "Bu paragrafı yaz (Bulut AI)" (entailment ≥0.85, fail-closed) | Sohbet döngüsü yok; düzenleme form-tabanlı | P2 | Şart değil. Onların iterasyonu **kaynaksız** paragraf üretebilir; bizim düzenlememiz kanıt kapısından geçer. **Bunu zayıflatarak paritesi kovalanmamalı.** |
| 10 | **"UDF olarak dışa aktarılabilir"** (dilekçe modülü ve masaüstü editör) | [doğrulandı] dilekce + dilekce-editoru | UDF yazıcı var ama **`deneysel`, imzasız, UYAP editöründe hiç açılmadı** (STATUS "Doğrulanmamış üç yüzey", ADR-019) | **Yetenek var, doğrulama yok** | **P0** | Kod işi değil, **doğrulama** işi: bir `.udf` UYAP Doküman Editörü'nde açılsın, sonuç `EXPORT.md` §5.3'e yazılsın (STATUS Next actions #4). Açılana kadar "deneysel" etiketi kalır — ve bu bizim dürüstlük duruşumuzdur, gizlenmez |
| 11 | **UDF görüntüleme/analizi** (mobil 2.6.0, 08.07.2026; "UDF Analizi", "UDF Görüntüleme") | [doğrulandı] App Store | `intake/` UDF **okur** ve chunk'lar; **konsolda UDF görüntüleyici yok** | Küçük ama görünür | P2 | `#belge/<fileId>` sayfasına UDF metin görüntüleyici (zaten çıkarılmış metni sayfa/blok olarak göster) — yeni ayrıştırıcı gerekmez |
| 12 | **UYAP entegrasyonlu masaüstü editör**: UYAP hesabına bağlanır, dosya bilgilerini (taraf, evrak, safahat) çeker, workspace açar; kurulum uzaktan erişimle; veri Google Cloud AB'ye gider | [doğrulandı] dilekce-editoru + /yasal Ek Protokol | Yok ve **bilinçli olarak vaat edilmiyor** | Yetenek boşluğu — ama **karşıt konum** | **P3 (kovalama)** / **P1 (anlatı)** | UYAP entegrasyonu inşa **edilmemeli** (kimlik bilgisi + yurt dışı aktarım gerektirir). Bunun yerine: (a) `KULLANIM-ColleX.md`'ye "UYAP'tan indirdiğiniz UDF/PDF'i sürükleyip bırakın" akışı; (b) satış anlatısı: *"UYAP dosyanız bilgisayarınızdan çıkmaz; kimse uzaktan bağlanıp kurulum yapmaz."* |
| 13 | **UETS entegrasyonu** (yalnız Pro) | [doğrulandı] fiyatlandırma | Yok | Yetenek boşluğu | **P3** | Kovalanmamalı (kurumsal kimlik doğrulama gerektirir). Yerine: elle tebligat tarihi girişi + süre hesabı zaten var |
| 14 | **Duruşma takibi** + "Takvim modülü: Duruşma ve **tebligat takibi**, **hatırlatıcılar ve bildirimler**" | [doğrulandı] fiyatlandırma + App Store 2.4.0 | `/v1/deadlines` (30 kural, **tamamı `dogrulanmadi`**), `/v1/matters/deadlines`, dosya sayfasında Süreler sekmesi | **Takvim görünümü, hatırlatıcı ve bildirim yok** | **P1** | (a) `GET /v1/matters/deadlines?format=ics` → **ICS akışı** (Outlook/Google takvime abone olunur; sunucu tarafı bildirim altyapısı gerekmez); (b) konsolda aylık takvim görünümü; (c) `Dosyalarım`'da "bu hafta/bu ay dolan süreler" bandı. **Uyarı metni (`DEADLINE_DISCLAIMER`) ICS açıklamasına da birebir girmeli** |
| 15 | **Sözleşme inceleme**: madde madde risk raporu + iyileştirme önerisi, "mevzuat ve içtihat referanslarıyla desteklenir", kaynaklar aynı ekranda | [doğrulandı] sozlesme | 13 şablondan 6'sı sözleşme **oluşturma**; **sözleşme inceleme/risk analizi yok** | **Gerçek modül boşluğu** | **P1** | `POST /v1/contracts/review` (yeni yol): yüklenen sözleşmeyi madde madde böl → her madde için (i) korpus/mevzuat karşılığı, (ii) **yalnız hash'li alıntıya bağlanabilen** risk notu, (iii) bağlanamayan gözlem **⚠ KAYNAKSIZ**. Mevcut `answerPipeline` + `coverage` + `relevance` yeniden kullanılabilir |
| 16 | Sözleşme **hazırlama** (kira, NDA, iş, satış, hizmet, lisans, distribütörlük, tedarik…) | [doğrulandı] sozlesme | 6 sözleşme şablonu (`domain` etiketli, `fieldGroups`) | Tür sayısı azlığı | P2 | Şablon sayısını artırmadan önce §15'i yap; inceleme, hazırlamadan daha çok satar |
| 17 | **"Gelişmiş hafıza" / "Memory (Hafıza)"** — oturumlar arası bellek | [doğrulandı] JS paketi + mağaza açıklaması | Dava dosyası kalıcı; **cevaplar arası bağlam yok** | Orta | P2 | Dosya bazlı **"Bu dosyada daha önce sorulanlar"**: `GET /v1/answers?matterId=` zaten var; konsolda dosya sayfasına özet şeridi + yeni soruya "önceki cevapları bağlam olarak ekle" (kanıt havuzu birleştirme, **iddia taşıma yok**) |
| 18 | **"İlgililer"** (ilgili kişi/kurum çıkarımı) | [doğrulandı] JS paketi | `intake/analysis.py` atıf/tarih/talep çıkarır; **taraf/kişi görünümü yok** | Küçük | P2 | `#belge/<fileId>`'ye "Belgede geçen taraflar/kurumlar" listesi (yalnız çıkarılan, konumlu; yorum yok) |
| 19 | **"Keşif araması" / "Sorgu iyileştirme" / "Arama Sorgumu İyileştir"** | [doğrulandı] JS + mağaza | Yok | Küçük | P2 | Kapsam kapısı %40'ın altında kaldığında **"soruyu şöyle daraltın"** önerisi (deterministik: eksik soru sözcükleri + bulunan mercilerden türetilir, model gerektirmez) |
| 20 | **"Mevzuat ekleme" / "Mevzuat" / "Başlıkla Arama"** | [doğrulandı] JS + mağaza (pazarlama listesinde YOK) | 26 mevzuat aracı: tam metin, **gerekçe**, **madde ağacı**, kanun/KHK/tüzük/yönetmelik/tebliğ/CBK/genelge, `search_within_*` | **Bizde daha güçlü, ama konsolda görünmüyor** | **P1** | `Araştır`'a "Mevzuat" şeridi: kanun no/ad → madde ağacı → madde metni + **gerekçe**; her madde "Dayanak olarak ekle" ile taslağa geçsin. Bu, De Jure'nin hiçbir yerde göstermediği bir yetenek |
| 21 | Korpus: **karar sayısı / güncellik tarihi / tazeleme sıklığı hiçbir yerde yok**; SSS "Genişliğine güvenerek kullanabilirsiniz" | [doğrulandı — yokluk] + [pazarlama] | Statik kopya korpus yok; 54 araçlık **canlı resmî kaynak geçidi**, her yanıtta alınma zaman damgası | Yok — üstünlük | **P1** | **Kapsam manifestosu** sayfasını üret (COMPETITIVE.md §2 kalem 8'de yol haritasıydı): kaynak başına canlı durum + son erişim + **bilinen boşluklar** (ilk derece kararı yok, doktrin yok, Reklam Kurulu/RTÜK yok). `check_government_servers_health` + `/v1/health` verisi zaten var; sayfa yok |
| 22 | **Literatür** (makale, kitap, tez, dergi) + doktrin atıfı | [doğrulandı] derin-arastirma | Yok | Gerçek boşluk | **P3** | Kovalanmamalı — lisanslı içerik gerektirir. Kapsam manifestosunda **açıkça** yazılmalı: "doktrin taranmaz" |
| 23 | **İlk derece + bölge idare mahkemesi kararları**; Reklam Kurulu, RTÜK | [doğrulandı] derin-arastirma + demo verisi | Yok (Bedesten/Emsal üzerinden kısmî) | Gerçek boşluk | P2 | Kapsam manifestosunda açıkça yaz; RTÜK/Reklam Kurulu ileride MCP aracı olarak eklenebilir (tool yüzeyi 54'te sabit — **önce invaryant kararı gerekir**) |
| 24 | **Kota** — sitede yok, Mesafeli Satış m.6.6'da "aylık 100 / 160 kullanım kotası" örnekleriyle var; m.8.2 kota zararından sorumsuzluk | [doğrulandı] /yasal | Kota kavramı yok (yerel, tek kullanıcı) | Yok — üstünlük | **P1** | `Ayarlar › Sistem durumu`'na tek satır: **"Kota yok. Sorgu, dilekçe ve dışa aktarma sayısı sınırsızdır; sınır yalnız makinenizin hızıdır."** Satış konuşmasında §2.3 birebir alıntılanabilir |
| 25 | Veri: Google Cloud (AB), SCC, 72 saat ihlal bildirimi, model eğitimi yok; **LLM sağlayıcısı adlandırılmamış** | [doğrulandı] /yasal §8 | Her şey `127.0.0.1`; bulut hattı **varsayılan KAPALI**, istek başına onay, anahtar `.env`'e asla yazılmaz, `[gizli]` | Yok — üstünlük | **P1** | `Ayarlar`'da **"Verilerim nerede?"** kartını (zaten var) De Jure'nin metniyle karşılaştırmalı hale getirme yerine, tek cümlelik güçlendirme: "Bulut AI kapalıyken **hiçbir bayt** bu bilgisayardan çıkmaz." + `docs/implementation/AI.md`'ye "ne gider" tablosunun konsoldan linki |
| 26 | Mobil uygulama (iOS 4,6/25 · Play 4,1/17, 1.000+ indirme; son 3 yorum çökme şikâyeti) | [doğrulandı] mağazalar | Yok, vaat de edilmiyor | Boşluk | **P3** | Kovalanmamalı |
| 27 | 72 baro anlaşması (İzmir dahil), baro odalarında ücretsiz arama, %40/%25 yıllık indirim | [doğrulandı] map SVG + İstanbul Barosu PDF | Yok | Dağıtım boşluğu | P2 | Ürün işi değil; ama fiyat karşılaştırmasında **indirimli** rakam kullanılmalı (48.000 / 36.000 ₺/yıl), liste fiyatı değil — aksi hâlde karşılaştırma dürüst olmaz |
| 28 | "Otomatik atıf" + "Çoklu vurgulama" | [doğrulandı] fiyatlandırma | Tam-belge içinde konumlu vurgulama var (snippet kanıt sayılmaz) | Yok — üstünlük | — | Koru |

---

## 8. `docs/COMPETITIVE.md` için zorunlu düzeltmeler (sentezleyiciye)

Aşağıdaki üç satır 28.08/02.09 anlık görüntüsünde **yanlış** ya da eksik
kalmıştır; W13 sentezinde düzeltilmelidir:

1. **"Dosya / proje çalışma alanı" satırı** — mevcut metin *"De Jure:
   resmî sayfalarda dosya/proje/klasör kavramı geçmiyor [çıkarım]"* diyor.
   **Yanlış.** De Jure'de (a) ürün içi `Klasörlerim`, (b) Pro'da UYAP
   workspace'i ("dava dosyanızı açabileceğiniz bir workspace"), (c) mobilde
   **"Dava dosyalarım"** (19.02.2026'dan beri) vardır. Yeni ayrım noktası
   *varlık* değil, **nerede durduğu**: onlarınki Google Cloud AB'de, bizimki
   `collex_local`'da.
2. **"Belgeyle sohbet / belge analizi" satırı** — De Jure'nin sözleşme
   inceleme akışı ("madde madde risk raporu, mevzuat ve içtihat
   referanslarıyla") eksik kalmış; ayrıca "Dokümanı incele / Doküman özeti /
   İlgililer" adlı üç ayrı modülü var.
3. **"Fiyat" satırı** — kota konusunda *"kota rakamları sayfada yok"*
   doğru ama eksik: **kotanın kendisi Mesafeli Satış Sözleşmesi m.6.6'da
   örnek rakamlarla (100 / 160) kabul edilmiştir** ve Temel paket JS'te
   "Derin Araştırma (**Normal, sınırlı**)" olarak etiketlidir. Ayrıca
   paket→özellik kilidi eklenmelidir: dilekçe ≥ 6.800 ₺/ay, UYAP/UETS/duruşma
   yalnız 80.000 ₺/yıl.
4. **"Doğruluk iddiası" satırı** — garantinin **birebir** ve **dar**
   kapsamı yazılmalı (kaynakçadaki kararların *gerçek olduğu* iddiası),
   yoksa bizim eleştirimiz haksız görünür.
5. **Yeni satır önerisi: "Kurulum ve erişim"** — De Jure Pro: satıcı
   uzaktan erişimle (AnyDesk/TeamViewer) masaüstüne kurar, UYAP kimlik
   bilgisiyle bağlanır, veri AB'ye gider. ColleX: `ColleX-Baslat.cmd` çift
   tık, tek makine, kimse bağlanmaz.

---

## 9. Bunlarda olan, bizde olmayan — dürüst liste (vaporware yasağı)

Kovalanmayacaklar dahil, tek yerde:
literatür/doktrin taraması · ilk derece ve bölge idare mahkemesi kararları ·
Reklam Kurulu ve RTÜK · UYAP canlı entegrasyonu · UETS · mobil uygulama ·
baro dağıtım kanalı · oturumlar arası "gelişmiş hafıza" · sözleşme risk
incelemesi · takvim/hatırlatıcı/bildirim · rapor-sonrası sohbet asistanı ·
**doğrulanmış** UDF (bugünkü deneyseldir) · **canlı sınanmış** bulut AI ·
**doğrulanmış** süre kuralları.

Bunlardan **P0/P1 olarak inşa edilmesi önerilenler** yalnız şunlardır
(§7'den): karşı dilekçe denetimi (8) · UDF doğrulaması (10) · takvim + ICS
(14) · sözleşme inceleme (15) · mevzuat şeridi (20) · daire/yıl/negatif
filtre (3) · araştırma modları + rapora sor (4) · belgeden araştırma (5) ·
kapsam manifestosu (21) · kota-yok ve veri-yeri cümleleri (24, 25).

---

## 10. Kaynak listesi

| Kaynak | Erişim | Ne için |
|---|---|---|
| <https://www.dejure.ai/> (308 `dejure.ai` → `www`) | 02.09.2026 | hero, 15 kalem, fiyat tablosu, SSS birebir, güvenlik bölümü, referanslar |
| <https://www.dejure.ai/robots.txt> · `/sitemap.xml` | 02.09.2026 | yüzey sayımı (9 sitemap URL'i; `/search`, `/dokuman` disallow) |
| <https://www.dejure.ai/fiyatlandirma> | 02.09.2026 | paket × özellik matrisi, baro indirimli tutarlar |
| <https://www.dejure.ai/semantik-arama> | 02.09.2026 | semantik/hibrit, daire + yıl aralığı filtresi, literatür |
| <https://www.dejure.ai/derin-arastirma> | 02.09.2026 | 5-10 dk, 16 karar + 4 literatür veritabanı, merci/yıl filtresi, evrakla başlatma, asistan |
| <https://www.dejure.ai/dilekce> | 02.09.2026 | evrak yükleme, içtihat filtresi, normal/uzun (3-4×), **UDF dışa aktarım**, Dilekçe Analizi |
| <https://www.dejure.ai/dilekce-editoru> | 02.09.2026 | Pro-only masaüstü editör, UYAP workspace, rapordan dayanak, UDF |
| <https://www.dejure.ai/sozlesme> | 02.09.2026 | hazırlama + inceleme, madde madde risk raporu |
| <https://www.dejure.ai/anlasmali-barolar> · `/baro` | 02.09.2026 | baro kanalı, baro odası girişi |
| <https://www.dejure.ai/map/turkey-mapchart.svg> | 02.09.2026 | **72 anlaşmalı baro** (İzmir dahil), 9 anlaşmasız il |
| <https://www.dejure.ai/blog> (+ `?page=37`) | 02.09.2026 | 368 yazı, tamamı 09.01.2026 → SEO çiftliği |
| <https://www.dejure.ai/yasal> (10 belge) | 02.09.2026 | m.8.3/8.5 sorumsuzluk, Ek Protokol (UYAP/masaüstü/uzaktan kurulum), m.5.5 saklama, m.6.6 **kota**, alt işleyenler, SCC, çerezler |
| `_next/static/chunks/*.js` (49 paket) | 02.09.2026 | render edilmeyen paket özellik listeleri, SSS verisi, ürün içi sözlük, referans listesi |
| <https://apps.apple.com/tr/app/de-jure-ai/id6449427444?l=tr> + iTunes lookup | 02.09.2026 | **tam sürüm geçmişi**, 2.6.1/10.08.2026, 4,6 · 25 puan, açıklama |
| <https://play.google.com/store/apps/details?id=com.dejure> | 02.09.2026 | 4,1 · 17 yorum, 1 B+, 06.08.2026, üç olumsuz yorum, geliştirici adresi |
| <https://storage.istanbulbarosu.org.tr/public/2026/04/7aff7cc7-…​.pdf> | 02.09.2026 | %40/%25 yalnız yıllık, Baronet kampanya kodu, baro odasında **yalnız arama** |
| <https://narfon.com.tr/kampanyalar/…/de-jure-ai-…> | 02.09.2026 | 2023-24 kampanyası: 5 mn ₺ hedef / 1.008.140 ₺, 74,1 mn ₺ değerleme, 7.000 kullanıcı, 19 baro, 7B LLM + **on-prem** planı |
| <https://www.hukukihaber.net/karar-arama-motoru-dejureai-…> | 02.09.2026 | kurucular, ilk baro protokolleri, Almanya/Anglo-Sakson hedefi |
| <https://www.hukukiyapayzeka.com/2026/01/06/apilex-de-jure-karsilastirma/> | 02.09.2026 | üçüncü taraf kıyas — **tarafsızlığı doğrulanmadı** |
| Wayback (`web.archive.org`) | 02.09.2026 | **alınamadı** — CDX/snapshot 429, WebFetch host reddi |
| ekşi sözlük `de-jure-ai--7848489` | 02.09.2026 | **403** — yalnız arama motoru özeti üzerinden [çıkarım] |

---

## 11. Bir cümlelik konum (satış için)

De Jure, bir Türk avukatına UYAP'ı, UETS'yi ve duruşma takibini **yılda
80.000 ₺**'lik tek pakette, **satıcının uzaktan bilgisayarına kurduğu** bir
masaüstü uygulamayla, **dosya içeriğini Google Cloud AB'ye taşıyarak** ve
**yayımlanmamış bir aylık kota** altında satar; kaynakçadaki kararların
gerçekliğini "garanti" ederken sözleşmesinde "tamamen yanlış sonuçlar
üretebilir" yazar. ColleX'in cevabı ne daha fazla özellik ne daha ucuz
paket olmalı: **kota yok, veri makineden çıkmaz, ve doğrulanamayan hiçbir
cümle çıktıya giremez — bize güvenmeyin, doğrulayın.**
