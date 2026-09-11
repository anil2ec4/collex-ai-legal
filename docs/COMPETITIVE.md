# Rakip karşılaştırması: Apilex · De Jure · ColleX

**Belge tarihi: 02.09.2026** (rakip profilleri o güne aittir; ColleX sütunları **03.09.2026** Faz C kapanışına güncellendi). Bu belge W13 istihbarat dalgasının
(`docs/implementation/waves/W13-APILEX.md`, `W13-DEJURE.md`,
`W13-TRMARKET.md`, `W13-GLOBAL.md`) ve W13 backlog'unun §A/§B/§C bölümlerinin
ürünüdür; 28.08.2026 tarihli önceki sürümün yerini alır.

Rakip bilgileri **yalnızca kamuya açık resmî yüzeylerden** derlenmiştir:
ürün siteleri, mağaza kayıtları, sözleşme metinleri, baro duyuruları, basın.
Hesap açılmadı, kimlik veya ödeme bilgisi hiçbir forma girilmedi, giriş
denenmedi, ürünün içine bakılmadı. Apilex Kullanım Koşulları m.3.2(vi) rakip
ürün geliştirmek için erişimi ve (viii) sistematik çıktı toplamayı yasaklıyor;
buna uyuldu.

## Etiketler (her hücrede zorunlu)

- **[doğrulandı]** — rakibin kendi yüzeyinde (site HTML'i, JS paketi, mağaza
  kaydı, sözleşme metni, resmî PDF) yazılı erişim tarihinde bizzat görüldü.
- **[pazarlama]** — rakibin beyanı; mekanizması gösterilmiyor, doğrulanamaz.
- **[çıkarım]** — iki kaynağın karşılaştırmasından ya da bir şeyin
  **yokluğundan** çıkan sonuç. Kanıt değil, değerlendirme.
- **[kullanıcı beyanı]** — üçüncü kişinin kamuya açık ifadesi. İfadenin
  **var olduğu** doğrulandı; **içeriğinin doğruluğu doğrulanmadı**. Ürün
  hatası kanıtı değildir; sinyaldir.

> **DÜRÜSTLÜK NOTU (bağlayıcı).** Bu belgedeki ColleX hücreleri yalnız bu
> depoda **bugün testli çalışan mekanizmaları** sayar ve her sayı
> `docs/implementation/STATUS.md` → "Ölçülen sayılar" tablosundan bir satır
> kimliğiyle (`S1`…`S36`) alınır; bu belge hiçbir sayıyı kopyalamaz.
> ColleX ölçümleri **SENTETİK** korpustadır: mekanizma kanıtıdır, hukukî
> kalite iddiası değildir. **Sekiz yüzey doğrulanmamıştır** ve burada da öyle
> anılır (STATUS "sekiz doğrulanmamış yüzey"). Rakiplerin asıl sattığı
> eksende — geniş bir içtihat havuzunda **iyi sıralanmış** arama — ColleX
> bugün **geridedir, ama artık başka bir sebeple** (03.09.2026 güncellemesi):
> canlı karar arama **çalışıyor ve gerçek künye getiriyor** (yedi gerçek
> arama, üç tam metin — S34); ölçülmeyen şey **isabettir**: sıralamayı
> kaynak sunucu yapar, ColleX yalnız elindeki 20 satırlık sayfayı dizer ve
> bunu ekranda söyler. Yerel korpusta ise 20 000 parçada yaygın bir sözcük
> ≈3,8 sn, korpusta hiç geçmeyen bir ifade **≈7,5 sn ve boş** (S25‴).

---

## 1. Konumlandırma — tek cümle

> **ColleX, müvekkil dosyası bilgisayardan çıkmadan çalışan, kotasız ve
> aboneliksiz bir kanıt sistemidir: her alıntıyı belge sürümü, Unicode
> konumu ve SHA-256 ile bağlar; bağlayamadığı cümleyi yazmaz; doğrulanamayan
> tek bir atıf varsa dosyayı hiç üretmez — Apilex ve De Jure doğruluğu iddia
> edip kendi sözleşmelerinde o iddiayı geri alırken, ColleX iddia etmez,
> reddeder.**

Neden bugün doğru:

- **Hash-bağlı alıntı + offset + belge sürümü.** `export/` sözleşme testleri;
  bir karakterlik tahrifat → exit 2, dosya yazılmaz. W14 bunu bir adım
  ileri götürdü: paragraf, atıf yaptığı alıntıyı **birebir içermek**
  zorunda; içermiyorsa dışa aktarım **409 `QUOTE_ALTERED`** ile reddedilir
  (STATUS B-01 satırı, `TRACEABILITY.md`).
- **Çekimserlik.** `run_evals` kapsam kapısı çekimserlik kesinliği/duyarlılığı
  %100/%100 ve **yanlış çekimserlik 0** (S6, tripwire).
- **Yerel.** `serve.mjs` yalnız `127.0.0.1`'e bağlanır; bulut hattı varsayılan
  KAPALI, istek başına onaylı (ADR-018). W14'ün `localGuard`'ı DNS rebinding
  ve CSRF deliklerini de kapattı (421 / 403).
- **Kotasızlık.** Sınır makinenin hızıdır. Rakiplerin ikisinde de kota var ve
  ikisi de sayısını yayımlamıyor (§4).

Bu cümleye **eklenmeyecek** olan: doğruluk yüzdesi, "halüsinasyonsuz",
"%100 kaynaklı", "en iyi", kapsam büyüklüğü. Gerekçe §6.

---

## 2. Apilex profili (erişim 02.09.2026)

| Alan | Bulgu | Etiket / kaynak |
|---|---|---|
| Tüzel kişi | **Apilex Teknoloji A.Ş.**, Altınbaş Teknopark, Esenyurt/İstanbul, VN 3852066694 | [doğrulandı] apilex.ai/tr/kullanim-kosullari |
| İkinci tüzel kişi | Google Play geliştirici adresi Şişli; App Store telif satırı **"© Fitty Teknoloji A.Ş."**; Kütahya Barosu duyurusu "APİLEX FİTTY TEK. A.Ş" — **iki tüzel kişi ve iki adres kamusal yüzeylerde yan yana** | [doğrulandı] play.google.com / apps.apple.com / kutahyabarosu.org.tr → [çıkarım] |
| Ölçek | 9. ayında **ARR 8 M USD**'yi aştı, 3. haftada başabaş, **dış yatırım almadı**; **120 kişi** | [doğrulandı-haber] egirisim.com, 23.06.2026 (şirket beyanı) |
| Pazarlar | Türkiye · Fransa (21 Ocak) · Almanya (28 Mart); "Yakında: İtalya, İspanya, Brezilya" | [doğrulandı] apilex.ai/tr |
| Fiyat | **Yayımlı değil.** App Store TR uygulama içi satın alma: **₺24.999,99 / ₺39.999,99** | [doğrulandı] apps.apple.com |
| Kota | Sayısal kota yok; ToU **m.3.5** "adil kullanım" + **ek maliyet tahsili hakkı** | [doğrulandı] apilex.ai/tr/kullanim-kosullari |
| Doğruluk iddiası | İkili tablo: rakipler "Halüsinasyon Riskli", kendisi **"%100 Kaynaklı"**, "Denetlenmiş İçerik" | [pazarlama] apilex.ai/tr/asistan |
| Aynı sözleşmede geri alma | ToU **m.9.1**: hizmetin doğruluğu için **"hiçbir garanti vermez"** | [doğrulandı] |
| Kapsam sayısı | İki resmî yüzeyde **12 M ↔ 11 M** çelişik karar sayısı | [çıkarım] |
| UYAP | **Chrome eklentisi ile UYAP'tan indirme** | [doğrulandı] apilex.ai |
| Veri yeri | **Yurt dışı hosting**; AI sağlayıcısı **adsız**; ToU m.8.3'ün işaret ettiği Sub-Processor tablosu **yayında değil** | [doğrulandı — yokluk] |
| Temizlenmemiş şablon | `/tr/hakkimizda` sayfasında hâlâ **"Felix Rowe"**, **"138+"**, **"%96 Glassdoor"** duruyor | [doğrulandı] — yayımlanan sayı, doğrulanmadıkça bir yükümlülüktür |
| Ölçek davranışı | Ekşi/şikayetvar: haftalarca süren kesinti, "evrak yüklenmiyor" | [kullanıcı beyanı] |

**Okuma.** Rakip bir MVP değil: kâr eden, 120 kişilik, üç ülkede satan bir
şirket. Fiyat/özellik yarışına girilemez. Savunulabilir tek konum, onların
ürün **sözleşmesinin bile veremediği** şeydir: doğrulanabilirlik.

---

## 3. De Jure profili (erişim 02.09.2026)

| Alan | Bulgu | Etiket / kaynak |
|---|---|---|
| Tüzel kişi | **Detech Yazılım A.Ş.** ("De Jure"), Entertech İstanbul Teknokent, Avcılar/İstanbul | [doğrulandı] dejure.ai/yasal |
| Yüzey | `www` (pazarlama) · `app` (ürün) · `baro` (baro odası) · **`desktop.dejure.ai`** (sözleşmede tanımlı) | [doğrulandı] /yasal §2 |
| Barındırma | Vercel + Next.js; PostHog, Google Analytics, GTM, LinkedIn Insight | [doğrulandı] |
| Fiyat (yayımlı) | Ücretsiz · **1.500 ₺/ay** Temel · **6.800 ₺/ay** Tam · **60.000 ₺/yıl** Tam · **80.000 ₺/yıl** Pro | [doğrulandı] dejure.ai/fiyatlandirma |
| Baro indirimi | Yıllık paketlerde 0–5 yıl **%40**, 5+ yıl **%25** → 36.000 / 45.000 / 48.000 / 60.000 ₺; **İzmir Barosu anlaşmalı** | [doğrulandı] (indirimli tutarlar sayfada birebir yazılı, tarafımızca hesaplanmadı) |
| Kota | Mesafeli Satış Sözleşmesi **m.6.6**: "aylık kullanım limitiniz (sorgu, dilekçe…)", örnekler **100 / 160**. **Sitede hiçbir yerde yayımlanmıyor** | [doğrulandı] /yasal → [çıkarım]: fiyat sayfası kotayı göstermiyor |
| Doğruluk iddiası | SSS: doğruluk **"garanti edilmektedir"** | [pazarlama] |
| Aynı sözleşmede geri alma | /yasal **m.8.3**: **"HİÇBİR GARANTİ VERMEZ"** (büyük harfle) | [doğrulandı] |
| Doğruluk iddiasının GERÇEK kapsamı | Garanti dar kapsamlıdır: **kaynakçadaki kararların var olduğu** iddiasıdır, cevabın hukukî doğruluğu değil | [çıkarım] — bu satır olmadan eleştirimiz haksız olurdu |
| Arama | Daire + il BAM + yıl aralığı + **pozitif/negatif kelime** filtresi | [doğrulandı] dejure.ai/semantik-arama |
| Dosya çalışma alanı | **"Klasörlerim"**, UYAP workspace (**yalnız 80.000 ₺/yıl Pro**), mobil **"Dava dosyalarım"** (19.02.2026 sürümü) | [doğrulandı] |
| Dilekçe | ≥ **6.800 ₺/ay** paketten itibaren; normal/uzun uzunluk; **UDF çıktısı**; mobilde UDF görüntüleme (08.07.2026) | [doğrulandı] |
| Sözleşme incelemesi | **Madde madde risk raporu** + mevzuat/içtihat referansı | [doğrulandı] dejure.ai/sozlesme |
| Takvim | Takvim modülü + hatırlatıcı + bildirim (19.02.2026); **duruşma takibi yalnız Pro** | [doğrulandı] |
| Masaüstü Dilekçe Editörü | Satıcı **AnyDesk ile uzaktan kuruyor**, avukatın **kendi kimliğiyle UYAP'a bağlanıyor**, veri **Google Cloud AB**'ye gidiyor; Ek Protokol: *"tüm hukuki, cezai ve mesleki sorumluluk münhasıran Üye'ye aittir"* | [doğrulandı] /yasal Ek Protokol |
| Alt işleyenler | Yalnız **Google Cloud + İyzico**; **hiçbir LLM sağlayıcısı adlandırılmıyor** | [doğrulandı — yokluk] |
| Güncellik | Kapsam tarihi, sıklığı ya da sayısı **hiçbir yerde yayımlanmıyor**; "üniversite kütüphanelerinde" otorite argümanı | [doğrulandı — yokluk] |
| Yedekleme | m.5.5 "gizli yedek alınmaz" ↔ Gizlilik Politikası §7 "Günlük yedekler" — **iki metin çelişiyor** | [doğrulandı] |
| Ölçek davranışı | Google Play'de son üç yorumun üçü de çökme / oturum düşmesi | [doğrulandı] |

### Önceki sürümün DÜZELTİLMESİ (önemli)

Bu belgenin 28.08.2026 sürümü **"De Jure'de dosya/proje/klasör kavramı
geçmiyor"** diyordu. **Bu artık yanlıştır** ve düzeltiliyor: De Jure'de
"Klasörlerim", bir UYAP workspace'i ve mobilde "Dava dosyalarım" vardır
[doğrulandı, 02.09.2026].

**Ayrım varlık değil, KONUMDUR.** De Jure'nin dosyası buluttadır ve en
pahalı pakete kilitlidir; ColleX'in dosyası avukatın kendi diskindedir ve
paket kavramı yoktur. Bir rakibin sahip olmadığı şeyi saymak kolaydır ve
yanlıştır; doğru olan, aynı şeyin **nerede durduğunu** söylemektir.

---

## 4. Parite matrisi — dürüst hücreler (22 satır)

"Bugün" = 02.09.2026. Rakip hücreleri yalnız kendi kamusal yüzeylerinden;
ColleX hücreleri yalnız bu depoda **testli çalışan** mekanizmalardan.
`→ B-nn` = W13 backlog kalemi; W14'te ne olduğu `TRACEABILITY.md`'de.

| # | Alan | ColleX bugün | Apilex bugün | De Jure bugün |
|---|---|---|---|---|
| 1 | **Alıntı doğrulama** | Hash + Unicode offset + belge sürümü; doğrulanamayan atıfta dışa aktarım **reddedilir** (exit 2). **W14 (B-01):** editörde alıntının içi değiştirilirse de yakalanıyor — paragraf KAYNAKSIZ'a düşer, üç biçimin üçü de **409** | Mekanizma ilan edilmiyor; "%100 Kaynaklı" [pazarlama] ↔ ToU m.9.1 "hiçbir garanti vermez" [doğrulandı] | Mekanizma ilan edilmiyor; SSS "garanti edilmektedir" ↔ m.8.3 "HİÇBİR GARANTİ VERMEZ" [doğrulandı] |
| 2 | **Çekimserlik** | Var, çalışıyor. **W14 (B-07):** çıplak kanun kısaltması ("TBK'ya göre") kapıyı artık devirmiyor | İlan edilmiyor | İlan edilmiyor |
| 3 | **Karşıt otorite** | Her cevapta zorunlu; taslakta ayrı bölüm. **W14 (B-27):** tablo artık **belge bazında** tekilleşiyor | İlan edilmiyor | İlan edilmiyor |
| 4 | **As-of yürürlük** | Var (ADR-012, veritabanı katmanında). **W14 (B-09):** zamansal soru, iki sürüm yan yana konmadan **TAM ilan edilemiyor** | "Güncellik Faktörü" [pazarlama]; as-of sorgusu yok | Güncellik tarihi hiç yayımlanmıyor [doğrulandı — yokluk] |
| 5 | **Kapsam şeffaflığı** | **W14 (B-14):** `GET /v1/sources/manifest` — kaynak başına durum, **8 bilinen boşluk**, ölçülmemiş her hücre `null`. Ekran Faz B'de | 12 M ↔ 11 M iki resmî yüzeyde çelişik [çıkarım] | Hiçbir sayı, tarih, sıklık yok [doğrulandı — yokluk] |
| 6 | **Karar arama** | **W14 (B-15/B-16):** 54 aracın tamamı bir kod yolundan çağrılabiliyor; `POST /v1/sources/search` merci/daire/yıl/tam ifade/hariç kelime alıyor. **Canlı upstream'e ulaşıyor ve gerçek künye döndürüyor** (S34), ama **ilgililik ölçülmedi**: sıralamayı kaynak sunucu yapar (STATUS #5). Ekran Faz B2'de indi, Faz C'de eşleşen cümle satırı ve tam-ifade varsayılanı eklendi | "Semantik Karar Arama" [doğrulandı] | Daire + il BAM + yıl aralığı + pozitif/negatif kelime [doğrulandı] |
| 7 | **Dosya çalışma alanı** | Davalarım: kalıcı, otomatik bağlama, **7 öğe türü** (W14: `hearing`), yeniden başlatmada eksiksiz. **W14 (B-43):** "nerede kalmıştım" akışı | "Projeler" — toplu analiz, belgeler arası karşılaştırma [pazarlama] | "Klasörlerim" + UYAP workspace (**yalnız Pro**) + mobil "Dava dosyalarım" [doğrulandı] |
| 8 | **Belgeye soru** | Hash'li, konumlu pasajlardan; yüklenen belge **asla** hukukî değerlendirme kaynağı değil (ADR-021). **W14 (B-26):** silinmiş belgeye sorulan soru artık **404 `FILE_NOT_FOUND`**, sessiz çekimserlik değil | Mekanizma tarif edilmiyor [pazarlama] | "Dilekçe Analizi"; yüklenen evrak **doğrudan dilekçe metnine giriyor** [doğrulandı] — biz bunu bilinçle yapmıyoruz |
| 9 | **Çok belgeli karşılaştırma** | **W14 (B-21):** belge × soru ızgarası; **hiçbir hücre boş kalmaz**, dolu hücre kendi parçasına ve Unicode konumuna bağlanır, CSV'de fileId + parça + konum + alıntı SHA-256 **ayrı sütun**. DOCX yarısı inmedi | "kritik farklar … tablolama" [pazarlama] | Yok (resmî sayfalarda) |
| 10 | **Dosya kronolojisi** | **W14 (B-18):** belgedeki tarihler **tek istekle** (≤ 50) zaman çizelgesine aktarılıyor, her satır "belgeden sezgisel çıkarım — doğrulanmadı" çipiyle; ikinci basış hiçbir şey eklemiyor | "dava dosyası özeti" [doğrulandı — baro PDF + iOS] | Yok |
| 11 | **Dilekçe üretimi** | 13 şablon, kanıt disiplini, KAYNAKSIZ rozeti, sürümlü editör. **W14 (B-02/B-25):** çıktı artık **A4, biçimli ve dosyalanabilir**; nihai kopyada hash/şema/kural kimliği 0 kez; 24 hukukî içerik düzeltmesi | "Otomatik dilekçe ve sözleşme hazırlama" [doğrulandı] | Dilekçe ≥ **6.800 ₺/ay**; normal/uzun uzunluk; UDF çıktısı [doğrulandı] |
| 12 | **UDF** | Yazma var; W14 biçim sadakatini (hizalama) düzeltti. **Hâlâ deneysel, imzasız, UYAP editöründe hiç açılmadı** (STATUS #2) | Girişsiz ücretsiz UDF↔PDF↔DOCX dönüştürücü [doğrulandı] | UDF dışa aktarım + mobilde UDF görüntüleme [doğrulandı] |
| 13 | **Süre hesabı** | **41 kural** (W12: 30), adli tatil, HMK m.92/2. **W14 (B-11):** iki yürürlükten düşmüş kural düzeltildi ve **16 kural madde metniyle doğrulandı**; **25'i hâlâ `dogrulanmadi`** ve her biri "şu maddeyi açın" cümlesi taşıyor | Yalnız yetim bir sayfada, sahte ilerleme çubuklarıyla [pazarlama] | Takvim modülü; duruşma takibi **yalnız Pro** [doğrulandı] |
| 14 | **Takvim / duruşma / hatırlatma** | **W14 (B-17):** duruşma öğesi, hazırlık kartı, `.ics` akışı (`VALARM`, `TZID=Europe/Istanbul`, `DEADLINE_DISCLAIMER` her VEVENT'te birebir). **Gerçek takvim istemcisinde hiç açılmadı** (STATUS #6); ekran Faz B'de | "Takvim senkronizasyonu" [pazarlama] | Takvim + hatırlatıcı + bildirim [doğrulandı] |
| 15 | **Sözleşme İNCELEME** | **W14 (B-24):** kural tabanlı VAR/YOK/BELİRSİZ + avukatın kendi kontrol listesi; **"risk" kelimesi yalnız hash'li alıntıya bağlı satırda kalabiliyor**; `YOK`'un anlamı raporda yazılı. Ekran Faz B'de | Yok (resmî sayfalarda) | Madde madde risk raporu + mevzuat/içtihat referansı [doğrulandı] |
| 16 | **Mevzuat derinliği** | 26 araç: tam metin + gerekçe + madde ağacı + tür bazlı `search_within_*`. **W14 (B-15):** dokuz tür aracının hepsi artık çağrılabiliyor | Kapsamda sayılıyor, mekanizma yok | "Mevzuat ekleme" JS'te var, pazarlanmıyor [doğrulandı] |
| 17 | **UYAP / UETS bağlantısı** | **Yok ve bilinçli olarak vaat edilmiyor.** Giriş yolu sürükle-bırak; **W14 (B-19):** `--dir` ile klasör intake, aynı karantina/magic-byte/ZIP-bomba kapılarından geçerek | Chrome eklentisiyle UYAP'tan indirme [doğrulandı] | Masaüstü editör: satıcı AnyDesk ile kuruyor, avukatın kimliğiyle UYAP'a bağlanıyor, veri Google Cloud AB'ye gidiyor, sorumluluk "münhasıran Üye'ye ait" [doğrulandı] |
| 18 | **Veri yeri / KVKK** | Her şey `collex_local`; bulut varsayılan KAPALI, istek başına onay. **W14 (B-23):** göndermeden önce **yerel** maskeleme + önizleme, metni saklamayan kayıt defteri, saatlik/günlük tavan; **W14 (B-04):** yabancı `Host` 421, yabancı `Origin` 403 | Yurt dışı hosting; AI sağlayıcısı **adsız**; Sub-Processor tablosu yayında değil [doğrulandı — yokluk] | Alt işleyen listesi yalnız Google Cloud + İyzico; **hiçbir LLM sağlayıcısı adlandırılmıyor** [doğrulandı — yokluk] |
| 19 | **Yedekleme** | **W14 (B-03):** dump + asıllar + **manifest** (her dosyanın boyutu ve SHA-256'sı); geri yükleme **asla `drop database` ile başlamaz**, yeniden adlandırır; felaket tatbikatı gerçekten koşuldu (STATUS S19). Zamanlanmış görev yok | Bilinmiyor (bulut) | Bilinmiyor (bulut); m.5.5 "gizli yedek alınmaz" ↔ Gizlilik §7 "Günlük yedekler" [doğrulandı] |
| 20 | **Kota** | **Yok** — sınır makinenin hızı | Sayısal kota yok; "adil kullanım" + **ek maliyet tahsili hakkı** (ToU m.3.5) [doğrulandı] | Sözleşmede **var** (m.6.6, "100/160" örnekleri), sitede hiçbir yerde yayımlanmıyor [doğrulandı] |
| 21 | **Fiyat** | Ticari paketleme kapsam dışı | Yayımlı değil; App Store TR uygulama içi ₺24.999,99 / ₺39.999,99 [doğrulandı] | Yayımlı: 1.500 ₺/ay … 80.000 ₺/yıl; İzmir Barosu anlaşmalı → yıllıkta %25–40 indirim [doğrulandı] |
| 22 | **Ölçek davranışı** | **W14 (B-06):** trigram şeridi artık indeksi kullanıyor (seçici korpusta ≈490×, S16); doymuş korpusta ayar fark yaratmıyor ve şerit 15 s zaman aşımında **görünür bir uyarıyla** düşüyor (S17). **Hız iddiası yapılmıyor** | Ekşi/şikayetvar: haftalarca kesinti, "evrak yüklenmiyor" [kullanıcı beyanı] | Play'de son üç yorumun üçü de çökme/oturum düşmesi [doğrulandı] |

---

## 5. Rakiplerin kendi sözleşmeleriyle çelişkisi — ve bunun bizi bağlayan yanı

Her iki rakip de pazarlama yüzeyinde doğruluk beyan ediyor ve **aynı
şirketin hukuk metninde** o beyanı geri alıyor:

| Rakip | Pazarlama yüzeyi | Aynı şirketin sözleşmesi |
|---|---|---|
| Apilex | "%100 Kaynaklı", "Denetlenmiş İçerik" [pazarlama] | ToU **m.9.1**: doğruluk için "hiçbir garanti vermez" [doğrulandı] |
| De Jure | SSS: doğruluk "garanti edilmektedir" [pazarlama] | /yasal **m.8.3**: "HİÇBİR GARANTİ VERMEZ" [doğrulandı] |

Bunu göstermek yalnızca rakibi eleştirmek değildir; **kendimize bağladığımız
kuraldır**: ColleX'in hiçbir yüzeyi, hiçbir sözleşmesinde geri alacağı bir
şey söylemez. Bu yüzden ürün doğruluk iddia etmez — **reddeder**, ve
reddettiği yeri gösterir.

De Jure'nin garantisinin **dar kapsamlı** olduğunu da yazmak zorundayız
(§3): kaynakçadaki kararların var olduğu iddiasıdır. Bunu yazmadan yapılan
bir eleştiri haksızdır.

---

## 6. Yapmayacağımız yedi şey

Bu liste bağlayıcıdır; her biri bir rakibin bugün yaptığı ya da yapabildiği
bir şeydir ve **bilinçle** yapılmayacaktır.

1. **Sayı iddiası kurmak.** Doğruluk yüzdesi, "halüsinasyonsuz", "%100
   kaynaklı", korpus büyüklüğü, "N kaynak taradık" — hiçbiri. Stanford
   RegLab'in ön-kayıtlı çalışması Lexis+ AI'da %17+, Westlaw AI-AR'da ~%34
   halüsinasyon ölçtü ve "hallucination-free" iddialarını abartılı buldu
   [üçüncü taraf]. Apilex'in `/tr/hakkimizda` sayfasında hâlâ temizlenmemiş
   şablon metni duruyor [doğrulandı] — **yayımlanan sayı, doğrulanmadıkça bir
   yükümlülüktür**. Kural: `STATUS.md` "Ölçülen sayılar" tablosunda satırı
   olmayan hiçbir sayı hiçbir yüzeye yazılmaz.
2. **Kapıları gevşetmek.** `DEFAULT_COVERAGE_FLOOR 0,4`, entailment `0,85`,
   `DEFAULT_LEXICAL_MIN_COVERAGE 0,25`, ADR-022 alaka kapısı,
   `EXPORT_REFUSED`. "Daha az uyarı" ve "daha çok kesinleştirilebilir cevap"
   kapıyı gevşeterek de elde edilebilir — **elde edilmeyecek**. W14'te
   hiçbiri oynatılmadı (STATUS S24) ve B-31'in kesinleştirilebilir oran
   artışı her yerde "**bir kusurun kalkması, kalite artışı değil**" diye
   yazılıdır.
3. **UYAP/UETS kimlik entegrasyonu veya tarayıcı eklentisi yazmak.**
   De Jure'nin Ek Protokolü mekanizmayı gösteriyor: satıcı uzaktan kuruyor,
   avukatın kendi kimliğiyle UYAP'a bağlanıyor, veri Google Cloud AB'ye
   gidiyor, sorumluluk "münhasıran Üye'ye ait" [doğrulandı]. Bu, tek net
   karşıt konumumuzu yok eder. Karşılığı **B-19**: klasör + toplu
   sürükle-bırak intake. **Bağlanmıyoruz, sürtünmeyi kaldırıyoruz.**
4. **Bulut bağımlılığı yaratmak.** Hiçbir P0/P1 kalemi bulut AI'a bağlı
   değildir; hepsi kural tabanlıdır — B-13 atıf denetimi, B-24 sözleşme
   incelemesi, B-35 harç hesabı dâhil. Bulut hattı varsayılan KAPALI kalır,
   istek başına onaylıdır ve `liveTested:false` etiketi bir canlı sınama
   kaydı yazılana kadar durur. Yeni npm paketi, yeni uzak servis,
   `package.json` düzenlemesi yok.
5. **Yanlış eksende parite kovalamak.** Doktrin/literatür havuzu (lisans
   riski), mobil uygulama (yerel-makine mimarisiyle çelişir), içerik/SEO
   pazarlaması, kopya-korpus yarışı. Kapsam manifestosu (**B-14**) bu
   boşlukları **ilan eder** — ilan edilmiş bir boşluk, ölçülemeyen bir
   kapsam listesinden güçlüdür.
6. **Dürüstlüğü gürültüye çevirmek.** W13'te bir KISMİ cevap ekranında
   11–14 uyarı bloğu / 20–24 cümle vardı, ikisi birebir tekrar [ölçüldü].
   Tekrar eden uyarı okunmayan uyarıdır ve **bu üründe uyarı ürünün
   kendisidir**. Tavan: bir cevap ekranında en fazla **4 blok / 8 cümle**,
   hiçbir cümle iki kez yazılmaz (B-27; ölçülen en yüksek 4 blok / 6 cümle,
   STATUS S20).
7. **Reklam yasağı çizgisini zorlamak ve makine metnini mahkemeye
   göndermek.** TBB Reklam Yasağı Yönetmeliği (09.08.2024 değişikliği)
   karşısında "başarı oranı", "davanızı kazandırır", "%N doğruluk", "en
   iyi", "avukata gerek kalmadan" ifadeleri yasaktır
   [doğrulandı-ikincil]; avukat için pazarlama/SEO metni üreten bir şablon
   **asla** eklenmez. Aynı disiplinin ikinci yarısı: dilekçe gövdesine ham
   kural kimliği (`hmk-istinaf`), şema etiketi
   (`collex.export.evidence-report/v1`), "kiracı yüklemesi" ya da "süre
   hesabını Süreler ekranından doğrulayın" gibi uygulama talimatı **girmez**
   — B-02 ve B-25 bunu temizledi ve bir test 13 şablonun tamamını tarıyor.

---

## 7. Bu belgenin kendi sınırları

- Rakiplerin **ürün içine bakılmadı**. Her rakip hücresi kamusal bir
  yüzeyden okunmuştur; ürünün gerçekte ne yaptığı bilinmiyor.
- **Wayback Machine bu makineden `429` döndürdü**; 12 aylık değişim izi
  arşivden çıkarılamadı. De Jure için App Store sürüm geçmişi kullanıldı
  (tarihli ve birebir olduğu için daha güçlü); Apilex için böyle bir kaynak
  yoktu.
- **Fiyat karşılaştırması yapılmamıştır.** ColleX'in ticarî paketlemesi
  yoktur; "ucuz" ya da "bedava" bir konum iddiası bu belgede yer almaz.
- ColleX hücrelerinin hepsi **sentetik korpus** üzerinde ölçülmüştür ve
  dokuz yüzeyi doğrulanmamıştır (STATUS). Bir rakiple karşılaştırılan şey
  **mekanizmadır**, sonuç kalitesi değildir.

---

## W16 (05.09.2026) — üç eksende ölçülen fark ve kapatılanlar

Kullanıcının sorusu: *"Apilex ve De Jure'ye göre eksik yönlerimiz var mı?"*
Cevap evetti ve üç eksende ölçüldü. Önce dürüst çıkış noktası:

| Eksen | Onlar ne satıyor | Bizde ne vardı (ölçüldü) |
|---|---|---|
| Semantik arama | Apilex "Doğal Dil ile Anlamsal Arama", 12M karar · De Jure "anlam ilişkisi üzerinden", "benzer olay kurgularını ortaya çıkarır" | `hybrid.ts` yoğun şeridi **STUB**; arama tam künye + Türkçe FTS + trigram + atıf ağı. Kavram tablosu **18 madde** |
| Konu/olayla karar arama | Olayı anlat, benzer olgulu kararları getir | **Yoktu.** Karar ara tam ifade arıyordu |
| Dilekçe | Serbest metinden dilekçe, normal/uzun, sohbetle düzenleme, **dilekçe analizi** | 13 alan doğrulamalı şablon, kanıta bağlı paragraf, **karşıt içtihat bölümü** (ikisinde de yok). Olay anlatısı ve dilekçe analizi **yoktu** |

**Rakibin iddiasında bulunan boşluk.** Elimizdeki `search_bedesten_semantic`
aracının ne yaptığı okundu: 12M kararda semantik arama **değil** — anahtar
kelimeyle en çok **10 aday** çekip onları gömme benzerliğiyle yeniden sıralıyor.
Yani Apilex/De Jure'nin gerçek üstünlüğü indeks değil, **korpusu kendilerinin
barındırması**. Bu yerelde kopyalanamaz; ama aynı kararların tamamı zaten resmî
kaynaklardadır ve ColleX oraya bağlıdır.

**Kapatılanlar.**

1. **Kavram genişletme 18 → 164.** Her kavramda 3-6 terim ve (160'ında) kanunî
   çapa. Emin olunmayan madde numarası yazılmadı — süre kurallarındaki
   `dogrulanmadi` ve harç tarifelerindeki `amount: null` disiplininin aynısı.
2. **"Olayı anlat → ilgili kararlar"** (`POST /v1/sources/related`). Olay
   metninden en çok 8 sorgu üretilir, 26 resmî kaynakta koşar, karar kimliğine
   göre tekilleşir ve **mutabakat sayısıyla** sıralanır. Üretilen sorguların
   tamamı avukata gösterilir — rakiplerin hiçbirinde bu şeffaflık yok. Sabit
   cümle: *"Bu sıra … bir İLGİLİLİK PUANI DEĞİLDİR."*
3. **Semantik yeniden sıralama.** Varsayılan kapalı, kapalıysa tipli neden;
   yalnız **tam metni getirilmiş** belgede çalışır (arama özeti reddedilir);
   yüzde yok, üç sözel kademe; ağ hatasında sıra **değişmez**.
4. **Karşı dilekçe analizi** (`POST /v1/contracts/petition-analysis`). Kural
   tabanlı, modelsiz. İddia başına üç kova: atıf denetimi · aleyhe kaynak ·
   dayanaksız ifade. Aleyhe kaynağın **dört ayrı durumu** vardır ve
   çalıştırılmamış bir şerit asla "aleyhe kaynak yok" diye çizilmez. De Jure'nin
   modülü "zayıf noktaları tespit eder" diyor; bizimki her bulguyu ya kaynağa
   bağlar ya da açıkça KAYNAKSIZ der ve o satırda "risk/zayıf/hatalı" gibi
   değerlendirme sözcüğü geçmesine izin vermez.
5. **Olaydan dilekçe + hukukî mütalaa.** Olay anlatısı avukatın beyanıdır ve
   hiçbir koşulda hukukî değerlendirmeye dayanak olmaz (ADR-021) — De Jure kendi
   sayfasında yüklenen evrakın dilekçe metnine karıştığını yazıyor, bizim
   ayrımımız testle sabit. Uzunluk seçeneği yerine **kapsam** seçeneği: geniş
   kapsam daha çok KAYNAK demektir, daha çok CÜMLE demek değildir.
6. **Yerel kütüphane yayımı** (`ingestion/library.py`). Canlı araştırmanın
   getirdiği her tam metin `collex_local`'a kalıcı yayımlanıyor; başlatıcı bunu
   her açılışta çağırıyor. **Onların arşivi kiralık, bizimki avukatın diskinde
   birikiyor** — abonelik bitince kaybolmuyor, kotası yok, internetsiz çalışıyor.

**Hâlâ bizde olmayan, dürüstçe:** barındırılan 12M kararlık indeks, literatür
(makale/kitap/tez/dergi), Reklam Kurulu ve RTÜK kararları, UYAP entegre masaüstü
editör. Bunlar korpus ve entegrasyon işidir, algoritma işi değil.
