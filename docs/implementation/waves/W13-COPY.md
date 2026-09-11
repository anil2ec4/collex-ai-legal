# W13 — LANE COPY

Türkçe dil, terminoloji, ton ve hukukî isabet denetimi — her kullanıcıya dönük
dize. Salt okunur denetim; bu rapor dışında hiçbir depo dosyası değiştirilmedi,
hiçbir git işlemi yapılmadı.

Tarih: **02.09.2026**. Denetlenen sürüm: W12 + FIX + FIX-2 + CLOSEOUT.

## 0. Kapsam ve yöntem

Çıkarılan yüzeyler: `control-plane/public/console.html` (1 148 dize, 2410.
satırdan sonrası), `control-plane/src/**/*.ts` (2 703 dize, sözlük/durak-sözcük
listeleri elendikten sonra 1 563), `export/*.py`, `intake/*.py`,
`control-plane/scripts/serve*.mjs`, `ColleX-Baslat.cmd`, `ColleX-Durdur.cmd`,
`docs/KULLANIM-ColleX.md`, ve tam metin okunan iki yüksek riskli dosya:
`control-plane/src/drafting/templates.ts` (13 şablon, 2 104 satır) ile
`control-plane/src/deadlines/rules.ts` (30 kural, 600 satır).

**Hukukî doğrulama.** Denetim günü `yargi-mevzuat` MCP üzerinden
mevzuat.gov.tr ERİŞİLEBİLİRDİ. Aşağıdaki maddelerin yürürlükteki metni
**gerçekten çekildi ve okundu** (02.09.2026): İİK m.62, İİK m.363, HMK m.176,
HMK m.342, HMK m.364, TBK m.344, TBK m.352, CMK m.268, İş K. m.41,
FSEK m.52, Avukatlık K. m.163–166 ve m.173. Bu maddelere dayanan bulgular
**[doğrulandı]** işaretlidir ve alıntılanan ibare madde metnindendir. Metni
çekilmeyen maddelere dayanan bulgular **[çıkarım]** işaretlidir ve build
ajanının aynı yolla doğrulaması gerekir. Hiçbir madde numarası, süre ya da
oran uydurulmadı.

> **Bu, süre kuralları için doğrudan bir fırsattır.** STATUS S12 "30 kuralın
> tamamı `dogrulanmadi`" diyor ve gerekçesi "derleme oturumunda ağ yoktu".
> Ağ bugün var. `search_within_kanun` ile madde metni saniyeler içinde
> geliyor. En az 6 kural bu denetimde madde metniyle karşılaştırıldı; biri
> **yanlış çıktı** (L1–L3). Kalan 24 kural aynı yolla bir oturumda
> doğrulanabilir.

---

## 1. Yönetici özeti — bir hukukçu-editörün gördüğü beş şey

1. **İki süre kuralı yürürlükten düşmüş hukuku yazıyor.** `iik-icra-mahkemesi-istinaf`
   "10 gün, tefhimden" diyor; İİK m.363/1 **7499 sayılı Kanun'la (yür. 01.06.2024)**
   "iki hafta, **tebliğ tarihinden**" oldu ve "tefhim veya" ibaresi madde
   metninden çıkarıldı. Aynı yanlış sayı `hmk-istinaf` notunda da tekrarlanıyor.
   Bir kural motoru için bu en pahalı hata türüdür: yanlış olan sonuç değil,
   **dayanak cümlesidir** — ve avukat dayanağı okuyup güvenir. (L1–L3)
2. **Şablonlarda dört adet "imzalanacak metne giren" hukukî hata var**:
   tahliye taahhütnamesinde TBK m.352/1'in **bir aylık hak düşürücü süresi
   hiç yok** ve "el yazısı" şartı **uydurulmuş** (kanun yalnız "yazılı"
   diyor); avukatlık ücret sözleşmesi Av.K. m.164/2'yi **ters** anlatıyor
   (%25 her ücretin tavanı değil, yalnız nispi ücretin tavanıdır); hizmet
   sözleşmesinin fikri mülkiyet hükmü **FSEK m.52'nin "hakların ayrı ayrı
   gösterilmesi" şartını atlıyor** ve kendi varsayılan metniyle geçersiz
   doğuyor. (L5, L6, L12, L15)
3. **İstinaf ve temyiz dilekçesi taslakları kanunun saydığı bir zorunlu unsuru
   taşımıyor**: HMK m.342/2-d ve m.364/2-e "**Kararın özeti**". Şablonların
   ikisinde de böyle bir bölüm yok. (L20, L21)
4. **Mahkemeye sunulacak dilekçenin gövdesine uygulama talimatı sızıyor**:
   "süre hesabını Süreler ekranından **(hmk-istinaf)** doğrulayın" cümlesi
   istinaf ve temyiz dilekçesi metninin İSTİNAFA KONU KARAR bölümünde, ham
   makine kural kimliğiyle birlikte duruyor. (L18)
5. **Dışa aktarılan her dilekçenin doğrulama ekinde İngilizce bir SaaS terimi
   Türkçe hukuk terimine dönüşmüş**: `appendix.ts` "Doğrulama: **kiracı
   yüklemesi**" yazıyor. Kastedilen "tenant upload" (kiracı = veritabanı
   tenant'ı). Bir **kira dosyasında** bu satır, ekin kiracı tarafından
   sunulduğunu söylüyor gibi okunur. (M1)

Bunların dışında dil kalitesi genel olarak **yüksek**: sayı ekleri doğru
(`scannedText` "N tanesinde" çözümü örnek bir düzeltme), tarihler GG.AA.YYYY,
makine kodları Türkçe karşılığından sonra parantezde, kesme işareti kullanımı
tutarlı. Sorunlar dağınık değil, **üç yerde kümelenmiş**: (a) doğrulama uçları
ve zod mesajları (İngilizce ve ham enum sızıntısı), (b) sözleşme şablonlarının
hukukî hükümleri, (c) `.cmd` başlatıcı ile sunucu penceresi (avukatın gördüğü
ilk ve son ekran, ASCII ve yarı İngilizce).

**Uyarı bütçesi.** Bir KISMİ cevap ekranında hukukçu **11–14 ayrı uyarı bloğu
/ ~20 cümle** görüyor; kesinleştirme cümlesi iki kez, veri kaynağı cümlesi iki
kez yazılıyor. Önerilen sayı: **3 sabit + 1 koşullu** (§4).

---

## 2. Düzeltme tablosu (115 kalem)

Dağılım: **L1–L33** hukukî hata/eksik · **M1–M27** makine kodu / İngilizce
sızıntısı · **C1–C20** terminoloji ve "aynı cümle her yüzeyde" ihlali ·
**D1–D35** mikro metin, boş durum, ton.

Sıra: **hukukî hata → karışıklık → cila**. `dosya:satır` denetim günündeki
çalışma ağacına aittir.

### 2.1 Hukukî hatalar ve eksikler (P0/P1)

| # | Dosya:satır | Şu anki metin | Önerilen metin | Gerekçe (kategori) |
|---|---|---|---|---|
| L1 | `control-plane/src/deadlines/rules.ts:477-480` | `period: { value: 10, unit: "gun" }`, `periodLabel: "10 gün"`, `startKind: "tefhim"` | `period: { value: 2, unit: "hafta" }`, `periodLabel: "2 hafta"`, `startKind: "teblig"`; ayrıca `transition: { effectiveFrom: "2024-06-01", before: "on gün (tefhim veya tebliğden)", law: LAW_7499 }` | **YÜRÜRLÜKTEN DÜŞMÜŞ SÜRE.** İİK m.363/1 yürürlükteki metni: "İstinaf yoluna başvuru süresi … tebliğ tarihinden itibaren **iki haftadır**." Dipnot 135: "2/3/2024 tarihli ve 7499 sayılı Kanunun 37 nci maddesiyle bu fıkrada yer alan '**tefhim veya**' ibaresi madde metninden **çıkarılmış** ve 'on gündür.' ibaresi 'iki haftadır.' şeklinde değiştirilmiştir." [doğrulandı — mevzuat.gov.tr, 02.09.2026] (hukukî hata) |
| L2 | `rules.ts:484` | "İstinaf yoluna başvurulabilen kararlar İİK m.363/1'de sayılanlarla sınırlıdır; diğer kararlar kesindir." | "İİK m.363/1, istinafa **kapalı** (kesin) kararları sayar; bunların **dışındaki** icra mahkemesi kararlarına karşı, alacak/hak/malın değeri kanunda yazılı parasal sınırı (ek m.1 ile her yıl güncellenir) geçmek şartıyla istinafa başvurulabilir. Güncel sınırı kontrol edin." | **TERSİNE OKUMA.** Madde metni: "İcra mahkemesince [sayılan işler] … kararları **dışındaki** kararlarına karşı, ait olduğu alacak, hak veya malın değer veya miktarının yedi bin Türk lirasını geçmesi şartıyla istinaf yoluna başvurulabilir." Not hem kapsamı ters çeviriyor hem parasal sınırı hiç anmıyor. [doğrulandı] (hukukî hata) |
| L3 | `rules.ts:132` | "…icra mahkemesi kararlarına karşı istinaf süresi **on gündür** (İİK m.363/1)…" | "…icra mahkemesi kararlarına karşı istinaf süresi, kararın **tebliğinden** itibaren **iki haftadır** (İİK m.363/1; 7499 s.K. ile 01.06.2024'ten itibaren)…" | Aynı yürürlükten düşmüş sayı `hmk-istinaf` notunda tekrar ediyor; L1 düzeltilirse bu satır çelişir. [doğrulandı] (hukukî hata) |
| L4 | `rules.ts:208` | "Her taraf, **davanın her aşamasında** sadece bir kez ıslah yapabilir (HMK m.176/2)." | "**Aynı davada taraflar ancak bir kez** ıslah yoluna başvurabilir (HMK m.176/2)." | Madde metni birebir: "(2) Aynı davada, taraflar ancak bir kez ıslah yoluna başvurabilir." Mevcut cümle "her aşamada bir kez" izlenimi veriyor — ıslah hakkını **çoğaltan** ve dosyayı kaybettirebilecek bir yanlış. [doğrulandı] (hukukî hata) |
| L5 | `drafting/templates.ts:1416-1418` | "Taahhüt, kiralananın tesliminden SONRA ve kiracının **el yazısı**/imzasıyla düzenlenmelidir" | "Taahhüt, kiralananın tesliminden SONRA ve **yazılı** olarak verilmelidir (TBK m.352/1). El yazısı geçerlilik şartı değildir; imza aranır." | TBK m.352/1 birebir: "…kiralananı belli bir tarihte boşaltmayı **yazılı olarak** üstlendiği hâlde…". "El yazısı" kanunda yok; şablonun kendi açıklaması avukata olmayan bir geçerlilik şartı öğretiyor. [doğrulandı] (hukukî hata) |
| L6 | `templates.ts:1457-1464` (TAHLİYE, `taahhut` bölümü) | "…kiraya verenin 6098 sayılı TBK m.352/1 ve 2004 sayılı İİK m.272 vd. uyarınca tahliye talebiyle icra dairesine başvurabileceğini…" | Aynı cümleye ekleyin: "…**taahhüt edilen tahliye tarihinden başlayarak bir ay içinde** icraya başvurmak veya dava açmak suretiyle (TBK m.352/1)…" Ayrıca `tahliyeTarihi` alanına `help`: "TBK m.352/1: taahhüde uyulmazsa kiraya veren **bu tarihten başlayarak bir ay içinde** icra takibi başlatmalı veya dava açmalıdır; süre hak düşürücüdür." | **KRİTİK EKSİK.** Madde metni: "…boşaltmamışsa kiraya veren, kira sözleşmesini **bu tarihten başlayarak bir ay içinde** icraya başvurmak veya dava açmak suretiyle sona erdirebilir." Tahliye taahhüdünde kaybedilen dosyaların birinci sebebi bu bir aydır ve şablon hiç anmıyor. [doğrulandı] (hukukî hata) |
| L7 | `templates.ts:1377-1382` (KİRA, `tahliye` bölümü) | "TBK m.352/1 uyarınca tahliye taahhüdü ancak kiralananın tesliminden SONRA, yazılı ve ayrı bir belgeyle verilirse geçerlidir…" | Aynı yere: "…; taahhüde uyulmaması hâlinde kiraya veren **taahhüt edilen tarihten başlayarak bir ay içinde** icraya başvurmalı veya dava açmalıdır (TBK m.352/1)." | L6 ile aynı eksik, ikinci şablonda. [doğrulandı] (hukukî hata) |
| L8 | `templates.ts:1304-1306` | "…**konutlarda** artış TBK m.344/1 uyarınca bir önceki kira yılının **TÜFE on iki aylık ortalamasını** aşamaz." | "…**konut ve çatılı işyeri kiralarında** yenilenen dönem kira bedeline ilişkin anlaşma, bir önceki kira yılında **tüketici fiyat endeksindeki on iki aylık ortalamalara göre değişim oranını** geçmemek koşuluyla geçerlidir (TBK m.344/1)." | İki hata: (a) m.344 "Konut ve çatılı işyeri kiraları" bölümündedir, yalnız konuta özgü değildir; (b) tavan, endeksin *ortalaması* değil **ortalamalara göre değişim oranıdır**. Madde metni birebir: "…tüketici fiyat endeksindeki oniki aylık ortalamalara göre **değişim oranını** geçmemek koşuluyla geçerlidir." [doğrulandı] (hukukî hata) |
| L9 | `templates.ts:1220-1222` | placeholder "TÜFE on iki aylık ortalaması (TBK m.344 üst sınırı)"; help "Konut kiralarında artış TÜFE on iki aylık ortalamasını aşamaz (TBK m.344/1)." | placeholder "TÜFE on iki aylık ortalamalara göre değişim oranı (TBK m.344/1 üst sınırı)"; help "Konut ve çatılı işyeri kiralarında artış, bir önceki kira yılının TÜFE on iki aylık ortalamalara göre değişim oranını aşamaz (TBK m.344/1)." | L8'in alan metnindeki karşılığı. [doğrulandı] (hukukî hata) |
| L10 | `templates.ts:1294-1310` (KİRA, `bedel` bölümü) | — (yok) | Yeni cümle: "Beş yıldan uzun süreli veya beş yıldan sonra yenilenen kira sözleşmelerinde ve sonraki her beş yılın sonunda kira bedeli, TÜFE değişim oranı, kiralananın durumu ve emsal kira bedelleri gözetilerek **hâkim tarafından hakkaniyete uygun biçimde** belirlenir (TBK m.344/3)." | Şablonun varsayılan süresi 1 yıl ve TBK m.347 ile kendiliğinden uzuyor; beşinci yıl kaçınılmaz. m.344/3 hiç anılmıyor. [doğrulandı] (hukukî eksik) |
| L11 | `templates.ts:1285-1288` | "Süre sonunda kiracı sözleşmeyi bildirimle sona erdirmedikçe Sözleşme aynı koşullarla birer yıl uzamış sayılır; kiraya veren, sürenin bitimine dayanarak sözleşmeyi sona erdiremez (TBK m.347)." | "…kiracı, sürenin bitiminden **en az on beş gün önce** bildirimde bulunmadıkça sözleşme aynı koşullarla bir yıl uzamış sayılır. Kiraya veren, sözleşme süresinin bitimine dayanarak sözleşmeyi sona erdiremez; ancak **on yıllık uzama süresinin sonunda**, her uzama yılının bitiminden en az üç ay önce bildirimde bulunarak, sebep göstermeksizin sona erdirebilir (TBK m.347/1)." | Kiracının **15 günlük** bildirim süresi ve kiraya verenin **10 yıl sonraki** fesih hakkı hükmün en operasyonel iki parçası; ikisi de yok. [çıkarım — TBK m.347 metni bu oturumda çekilmedi; build ajanı `search_within_kanun` ile doğrulamalı] (hukukî eksik) |
| L12 | `templates.ts:1925-1929` | "Ücret, Avukatlık K. m.164/2 uyarınca **dava veya hükmolunacak şeyin değerinin yüzde yirmi beşini aşamaz** ve m.164/4 uyarınca Avukatlık Asgari Ücret Tarifesi'nin altında kararlaştırılamaz." | "Ücret, Avukatlık Asgari Ücret Tarifesi'nin altında kararlaştırılamaz (Av.K. m.164/4). Ücret, dava veya hükmolunacak şeyin değerinin **belli bir yüzdesi olarak** kararlaştırılmışsa bu oran **yüzde yirmi beşi aşamaz** (m.164/2); ücret tavanını aşan sözleşme, tavan miktarında geçerlidir (m.163/2)." | **HÜKMÜN TERSİ.** Madde metni: "**Yüzde yirmibeşi aşmamak üzere**, dava veya hükmolunacak şeyin değeri yahut paranın **belli bir yüzdesi** avukatlık ücreti olarak kararlaştırılabilir." %25 her ücretin değil, **nispi ücretin** tavanıdır; maktu ücret bu sınıra tabi değildir. Şablon avukata kendi ücretini gereksiz yere kısıtlatıyor. [doğrulandı] (hukukî hata) |
| L13 | `templates.ts:1857` ve `templates.ts:1875` | description: "m.164 — dava değerinin %25'ini aşamaz"; help: "Avukatlık K. m.164: dava değerinin %25'ini aşamaz; AAÜT'nin altında olamaz." | description: "m.164 — **nispi** ücret dava değerinin %25'ini aşamaz; hiçbir ücret AAÜT'nin altında olamaz"; help: aynı düzeltme | L12'nin açıklama ve alan yardımındaki karşılığı; aynı yanlış üç yerde. [doğrulandı] (hukukî hata) |
| L14 | `templates.ts:1933-1937` | "…m.164/son uyarınca avukata aittir; **bu tutar, kararlaştırılan ücretten mahsup edilmez** ve iş sahibinin borcu için avukatın hapis hakkı (m.166) saklıdır." | "…m.164/son uyarınca avukata aittir ve **iş sahibinin borcu nedeniyle takas/mahsup edilemez, haczedilemez**. Taraflar bu tutarın kararlaştırılan ücretten mahsup edilip edilmeyeceğini burada ayrıca kararlaştırır: ☐ mahsup edilmez ☐ mahsup edilir." | Kanunun yasakladığı, tutarın **iş sahibinin borcu nedeniyle** takas/mahsubudur; "kararlaştırılan ücretten mahsup edilmez" sözleşmesel bir seçimdir, kanunî bir zorunluluk değildir. Şablon seçimi kanun gibi sunuyor. [doğrulandı] (hukukî hata) |
| L15 | `templates.ts:1105-1112` | "…5846 sayılı FSEK uyarınca mali hakların devri **yazılı şekle tabidir**; manevi haklar eser sahibinde kalır." + placeholder "hizmet çıktılarının mali hakları bedelin ödenmesiyle Hizmet Alan'a devredilir" | "…5846 sayılı FSEK m.52 uyarınca mali haklara ilişkin sözleşmelerin **yazılı olması ve devredilen hakların ayrı ayrı gösterilmesi şarttır**; aşağıda sayılmayan mali hak devredilmemiş sayılır. Devredilen mali haklar: işleme (m.21), çoğaltma (m.22), yayma (m.23), temsil (m.24), umuma iletim (m.25). Manevi haklar eser sahibinde kalır." | Madde metni birebir: "Mali haklara dair sözleşme ve tasarrufların yazılı olması ve **konuları olan hakların ayrı ayrı gösterilmesi şarttır**." Şablonun kendi varsayılan metni hakları saymadığı için **FSEK m.52 karşısında geçersiz doğuyor**. [doğrulandı] (hukukî hata) |
| L16 | `templates.ts:1576-1580` | "Fazla çalışma için işçinin **yazılı onayı** gerekir ve her fazla çalışma saati için ücret … %50 yükseltilmesiyle ödenir (İş K. m.41); işçi dilerse zamlı ücret yerine **serbest zaman** kullanabilir." | "Fazla çalışma için **işçinin onayı** alınır (İş K. m.41; onayın yazılı alınması Fazla Çalışma Yönetmeliği m.9 gereğidir). Her fazla çalışma saati için ücret, normal saat ücretinin %50 yükseltilmesiyle ödenir. İşçi dilerse zamlı ücret yerine, fazla çalıştığı her saat karşılığında **bir saat otuz dakika** serbest zaman kullanabilir ve bu zamanı **altı ay içinde**, çalışma süreleri içinde ve ücretinden kesinti olmadan kullanır. Fazla çalışma süresi **yılda iki yüz yetmiş saati** aşamaz." | Madde metni: "Fazla saatlerle çalışmak için işçinin **onayının** alınması gerekir." (yazılı demiyor); "…her saat karşılığında **bir saat otuz dakikayı** … serbest zaman olarak kullanabilir"; "İşçi hak ettiği serbest zamanı **altı ay** zarfında … kullanır"; "Fazla çalışma süresinin toplamı bir yılda **ikiyüzyetmiş saatten** fazla olamaz." Üç emredici sayı da şablonda yok. [doğrulandı] (hukukî eksik) |
| L17 | `templates.ts:985-987` (HİZMET description) | "İki taraf arasında hizmet alımına ilişkin sözleşme taslağı (**TBK m.393 vd.** / m.470 vd. niteliğine göre)" | "Bağımsız hizmet sağlayıcıdan hizmet alımına ilişkin sözleşme taslağı (**TBK m.502 vd. vekâlet** veya **m.470 vd. eser**, işin niteliğine göre). **Uyarı:** bağımlılık ilişkisi doğuran bir düzen, adı ne olursa olsun TBK m.393 / 4857 s.K. m.8 anlamında iş sözleşmesi sayılabilir — talimat, çalışma saati ve münhasırlık hükümlerini buna göre yazın." | TBK m.393 **hizmet (iş) sözleşmesidir**; iki işletme arasındaki hizmet alımını m.393'e bağlamak, sözleşmenin iş ilişkisi olarak nitelendirilme riskini metnin kendi başlığına yazmak demektir. (hukukî risk) [çıkarım] |
| L18 | `templates.ts:521` ve `templates.ts:616` | "…iki haftalık istinaf süresi (HMK m.345) bu tarihten hesaplanır — **süre hesabını Süreler ekranından (hmk-istinaf) doğrulayın**." (temyizde: `(hmk-temyiz)`) | Cümleyi dilekçe gövdesinden **çıkarın**; aynı metni şablonun `tebligTarihi` alanının `help`'ine taşıyın: "Süre hesabını Süreler ekranındaki 'İstinaf başvuru süresi (HMK m.345)' kuralıyla doğrulayın." | Mahkemeye sunulacak dilekçenin gövdesinde uygulama talimatı ve **ham makine kural kimliği** (`hmk-istinaf`) duruyor. Avukat silmeyi unutursa dosyaya girer. (makine kodu / dilekçeye sızan arayüz metni) |
| L19 | `templates.ts:577` | help: "**HMK m.364/1-c**: temyiz edilen kararın hangi bölge adliye mahkemesi dairesinden verildiği, tarihi ve sayısı." | "**HMK m.364/2-c**: temyiz edilen kararın hangi bölge adliye mahkemesi **hukuk dairesinden** verilmiş olduğu, tarihi ve sayısı." | Madde metni: "(2) Temyiz dilekçesinde aşağıdaki hususlar bulunur: … c) Temyiz edilen kararın hangi bölge adliye mahkemesi **hukuk dairesinden** verilmiş olduğu, tarihi ve sayısı." Fıkra numarası yanlış (1 → 2). [doğrulandı] (hukukî atıf hatası) |
| L20 | `templates.ts:501-551` (ISTINAF `sections`) | — (yok) | `kunye` ile `konu` arasına yeni bölüm: `{ id: "karar-ozeti", title: "KARARIN ÖZETİ", slots: [{ kind: "hukum", text: "{kararOzeti}", bilgi: ["kararOzeti"] }] }` + zorunlu `ek("kararOzeti", "Kararın özeti", { required: true, multiline: true, help: "HMK m.342/2-d: istinaf dilekçesinde kararın özeti bulunmalıdır." })` | HMK m.342/2 sayılan unsurlar arasında "**d) Kararın özeti.**" var; şablonda karşılığı yok. m.342/3 dilekçeyi bu yüzden reddettirmese de kanunun saydığı unsur eksik kalıyor. [doğrulandı] (hukukî eksik) |
| L21 | `templates.ts:596-651` (TEMYİZ `sections`) | — (yok) | Aynı biçimde "KARARIN ÖZETİ" bölümü ve zorunlu alan; help: "HMK m.364/2-e: temyiz dilekçesinde kararın özeti bulunmalıdır." | HMK m.364/2-e "Kararın özeti." [doğrulandı] (hukukî eksik) |
| L22 | `templates.ts:492-495` ve `templates.ts:582-585` | `ek("tebligTarihi", …)` — `required` verilmemiş | `required: true` ekleyin; help: "HMK m.342/2-ç (temyizde m.364/2-d): kararın başvurana tebliğ edildiği tarih dilekçede bulunmalıdır." | Tebliğ tarihi kanunun saydığı zorunlu unsur; şablonda isteğe bağlı. Boş bırakılırsa dilekçe gövdesine "[Kararın tebliğ tarihi — doldurun]" basılıyor. [doğrulandı] (hukukî eksik) |
| L23 | `templates.ts:396-412` (CEVAP `fields`) | — (yok) | Yeni alan: `ek("defiler", "Def'iler (zamanaşımı, takas, hapis hakkı …) — her satır bir def'i", { multiline: true, kind: "list", help: "Def'iler cevap dilekçesiyle ileri sürülmelidir; sonradan ileri sürülmesi savunmanın genişletilmesi yasağına (HMK m.141) takılır." })` + `usul` bölümünden sonra "DEF'İLERİMİZ" bölümü | Cevap dilekçesi şablonunun **zamanaşımı def'ini soracak hiçbir alanı yok**. Bir cevap dilekçesi taslağında bu, en sık kaybedilen savunmadır. (hukukî eksik) [çıkarım] |
| L24 | `templates.ts:382-465` (CEVAP) | — (yok) | `ek("karsiDava", "Karşı dava talepleri (varsa) — her satır bir talep", { multiline: true, kind: "list", help: "Karşı dava, cevap dilekçesiyle veya cevap süresi içinde ayrı bir dilekçeyle açılır (HMK m.133)." })` | Karşı dava sorulmuyor; süresi cevap süresine bağlı olduğu için taslak anında hatırlatmalı. (hukukî eksik) [çıkarım] |
| L25 | `templates.ts:1302-1304` | "…banka veya PTT aracılığıyla ödenir, elden ödeme yapılmaz (GVK Genel Tebliği Seri No 268, Seri No 323 ile değişik — **tebliğ numarasını güncel metinden doğrulayın**)." | Sözleşme gövdesi: "…kira bedeli banka veya PTT aracılığıyla ödenir; elden ödeme yapılmaz." Parantez içindeki tebliğ künyesi ve doğrulama talimatı `odemeGunu` alanının `help`'ine taşınsın. | İmzalanacak sözleşmenin içinde **kendi yazarına verilmiş bir talimat** duruyor. Ayrıca bu bir vergi usulü yükümlülüğüdür, taraflar arası bir borç değildir; sözleşme hükmü gibi yazılması yanlış yer. (hukukî/tasarım) |
| L26 | `templates.ts:303-312` (`dayanakNotlariSection`) — HİZMET 1181, KİRA 1397, TAHLİYE 1474, İŞ 1678, SATIŞ 1840, VEKÂLET 1987 | "HUKUKÎ DAYANAK NOTLARI (BİLGİ AMAÇLI)" bölümü **imza bloğundan hemen önce** | Bölümü imza bloğunun **altına** taşıyın ve başlığı "EK — HUKUKÎ DAYANAK NOTLARI (SÖZLEŞMENİN PARÇASI DEĞİLDİR; İMZAYA GİRMEZ)" yapın; ya da `kind: "sozlesme"` şablonlarında hiç üretmeyin. | Altı sözleşme şablonunda taraflar, makine üretimi "bilgi amaçlı" bir hukukî not bölümünün **altına imza atıyor**. İmzalı bir sözleşmede o notlar sözleşme metninin parçası sayılabilir. (hukukî risk) |
| L27 | `templates.ts:1758-1762` | "Bedelin süresinde ödenmemesi hâlinde alıcı, **ihtara gerek olmaksızın** vadenin dolmasıyla temerrüde düşer (TBK m.117/2)…" | "Ödeme günü bu Sözleşmede belirlenmiş olduğundan, bedelin süresinde ödenmemesi hâlinde alıcı, ihtara gerek olmaksızın **bu günün geçmesiyle** temerrüde düşer (TBK m.117/2). Ödeme günü belirlenmemişse temerrüt, TBK m.117/1 uyarınca **ihtarla** doğar." | TBK m.117/2 yalnız **sözleşmede belirlenmiş bir ifa günü** varken işler; `odemeSekli` serbest metin alanıdır ve gün içermeyebilir ("%30 peşin, bakiye teslimde"). Koşulsuz yazılan hüküm yanlış sonuç doğurur. [çıkarım] (hukukî hata) |
| L28 | `templates.ts:1805-1811` | "Mülkiyeti saklı tutma kaydı: {mulkiyetiSakliTutma}. **Kayıt varsa** mülkiyet … satıcıda kalır …; **kayıt yoksa** mülkiyet teslimle alıcıya geçer." | Seçime göre tek dal yazılsın: "yok" → "Mülkiyet, satılanın teslimiyle alıcıya geçer."; "var" → "Bedelin tamamı ödeninceye kadar mülkiyet satıcıda kalır; bu kayıt TMK m.764 uyarınca alıcının yerleşim yerindeki noterlikçe tutulan özel sicile tescil edilmedikçe hüküm doğurmaz." | İmzalanan sözleşmede "varsa şöyle, yoksa böyle" koşullu şablon metni kalıyor. Aynı kalıp `arabuluculuk` ve `tahliyeTaahhudu` hükümlerinde de var. (hukukî/tasarım) |
| L29 | `rules.ts:417` ve `rules.ts:420` | `label: "İİK m.168/1-5"`; not: "…imzaya itiraz da beş gün içinde icra mahkemesine yapılır (**İİK m.170/1**)." | `label: "İİK m.168/1 (4) ve (5) numaralı bentler"`; not: "…borca itiraz beş gün içinde icra mahkemesine bildirilir (İİK m.168/1-5); **imzaya itiraz da aynı beş günlük süre içinde** ve **ayrıca ve açıkça** yapılmalıdır (İİK m.168/1-4); imzaya itirazın incelenmesi m.170'e tabidir." | İmzaya itirazın **süresi** m.168/1'in (4) numaralı bendinde; m.170 incelemeyi düzenler. Süreyi m.170/1'e bağlamak atıf hatası. [çıkarım — İİK m.168/170 metni bu oturumda çekilmedi] (hukukî atıf hatası) |
| L30 | `rules.ts:493` | `title: "Anayasa Mahkemesine bireysel başvuru süresi"` | `title: "Anayasa Mahkemesine bireysel başvuru süresi (6216 s.K. m.47/5)"` | 30 kuralın 29'unun başlığı madde atfı taşıyor; yalnız bu taşımıyor. Liste ekranında kural kartları arasında tek başına "kaynaksız" görünüyor. (tutarlılık) |
| L31 | `rules.ts:68` (`DEADLINE_DISCLAIMER`) | "…kaçırılan süreden **uygulama** sorumlu değildir." | "…kaçırılan süreden **ColleX sorumlu değildir**." | Hukuk Türkçesinde "uygulama" = yerleşik uygulama/içtihat. Bir sorumsuzluk kaydında "uygulama sorumlu değildir" cümlesi hukukçuya "içtihat sorumlu değildir" diye okunuyor. Bu cümle **her ekranda, her kartta ve her çıktıda** birebir geçtiği için tek noktadan düzelir. (terminoloji) |
| L32 | `rules.ts:209` | "…bu bir haftalık süre **'ozel'** süre olarak ayrıca hesaplanabilir." | "…bu bir haftalık süre, hesaplayıcıda **Özel süre** seçeneğiyle ayrıca hesaplanabilir." | `'ozel'` ham makine değeri, üstelik diakritiksiz, tırnak içinde kullanıcıya gösteriliyor. (makine kodu) |
| L33 | `rules.ts:326`, `rules.ts:542` (×3) | "…bunun için **'amme-odeme-emri-dava'** kuralını seçin.", "…**'is-ise-iade-arabulucu-basvuru'** …, **'is-ise-iade-dava'** …" | "…bunun için **'Ödeme emrine karşı dava (6183 s.K. m.58)'** kuralını seçin." / "…**'İşe iade — arabulucuya başvuru süresi'** ve **'İşe iade davası açma süresi'** kurallarını ayrı ayrı hesaplayın." | Ham kural kimlikleri kullanıcıya gösteriliyor; avukat ekranda o adı bulamaz (ekranda kuralların **başlığı** yazar). (makine kodu) |

### 2.2 Makine kodu / İngilizce sızıntısı (P1)

| # | Dosya:satır | Şu anki metin | Önerilen metin | Gerekçe (kategori) |
|---|---|---|---|---|
| M1 | `drafting/appendix.ts:170` | " — Doğrulama: **kiracı yüklemesi**; hukukî dayanak değildir" | " — Doğrulama: **avukatın yüklediği belge**; hukukî dayanak değildir" | "tenant upload" (çok kiracılı veritabanı terimi) hukukî "kiracı"ya çevrilmiş ve **her dışa aktarılan dilekçenin EK — DOĞRULAMA BİLGİLERİ bölümüne** basılıyor. Bir kira dosyasında satır, ekin kiracı tarafından sunulduğunu iddia ediyor gibi okunur. (İngilizce sızıntı / hukukî yanlış anlam) |
| M2 | `drafting/templates.ts:2031` | `"matter.matterId": "Dosya (**matter**) kimliği"` | `"matter.matterId": "Dosya numarası"` | İngilizce makine sözcüğü kullanıcıya dönük etiketin içinde. `labelForPath` bu etiketi 400 hatalarında ekrana basar. (İngilizce sızıntı) |
| M3 | `control-plane/public/console.html:5585` | `selectInput([["normal", "normal"], ["uzun", "uzun"]], "normal")` — açılır listede "normal" / "uzun" | `[["normal", "Normal — tek paragraf"], ["uzun", "Uzun — ayrıntılı gerekçeli paragraf"]]` | Bulut AI paragraf penceresinde kullanıcıya **ham enum değerleri** gösteriliyor; üstelik biri İngilizce ("normal"), biri Türkçe ("uzun"), ikisi de küçük harfle. (makine kodu / mikro metin) |
| M4 | `matters/routes.ts:93, 96, 138, 155, 169, 172, 181` | "Tür: dava, **danismanlik, sozlesme, icra veya diger** olmalı."; "Durum: **acik, beklemede veya kapali** olmalı."; "Kaynak: **manual, ai veya belge:<dosya kimliği>** olmalı."; "Kayıt türü: **file, answer, draft, note, event veya deadline** olmalı." | "Tür şunlardan biri olmalı: Dava, Danışmanlık, Sözleşme, İcra, Diğer."; "Durum şunlardan biri olmalı: Açık, Beklemede, Kapalı."; "Kaynak: elle girildi, Bulut AI veya bir belge."; "Kayıt türü: belge, cevap, taslak, not, olay veya süre." | Diakritiksiz makine değerleri ve **İngilizce enum adları** doğrulama hatasında hukukçuya gösteriliyor. Konsol bu mesajları `err.message` olarak aynen basar. (makine kodu) |
| M5 | `deadlines/routes.ts:32`, `deadlines/calc.ts:238` | "Birim **'gun', 'hafta', 'ay' veya 'yil'** olmalı." | "Birim: gün, hafta, ay veya yıl." | Aynı sorun; `UNIT_LABELS_TR` zaten var, kullanılmıyor. (makine kodu) |
| M6 | `settings/routes.ts:49, 54` | "Varsayılan tarih **'today'** veya ISO tarih (YYYY-AA-GG) olmalı."; "Tema: **system, light veya dark** olmalı." | "Varsayılan değerlendirme tarihi 'bugün' ya da GG.AA.YYYY biçiminde bir tarih olmalı."; "Tema: Sistem, Açık veya Koyu." | Ekrandaki tema seçeneği zaten "Sistem / Açık / Koyu" (console 1935-1937); hata mesajı İngilizce değerleri gösteriyor. (İngilizce sızıntı) |
| M7 | `drafting/routes.ts:215, 654` | "Belge türü **'dilekce' veya 'sozlesme'** olmalı."; "Dışa aktarma biçimi **'docx', 'md' veya 'udf'** olmalı (format parametresi)." | "Belge türü: dilekçe veya sözleşme."; "Dışa aktarma biçimi: Word (DOCX), Markdown veya UYAP (UDF)." | Diakritiksiz makine değerleri + "format parametresi" API sözlüğü. (makine kodu) |
| M8 | `api/answerService.ts:41, 76`, `api/server.ts:234` | "expected an ISO date (YYYY-MM-DD)", "question must be at least 3 characters", "query must not be empty" | "Tarih GG.AA.YYYY biçiminde olmalı (ör. 03.09.2026).", "Soru en az 3 karakter olmalı.", "Arama metni boş olamaz." | **Tamamen İngilizce doğrulama mesajları** `/v1/answer` 400 gövdesinde; `research/routes.ts:130,143` aynı kontrolleri Türkçe yazıyor — iki uçta iki dil. (İngilizce sızıntı) |
| M9 | `ai/routes.ts:159-160`, `deadlines/routes.ts:61`, `settings/routes.ts:70`, `drafting/routes.ts:395-396`, `matters/routes.ts:204` | zod eşleşme anahtarı olarak "Invalid enum value" / "Invalid literal value" — eşleşme tutmazsa bu metin doğrudan kullanıcıya gider | Eşleştirmeyi `issue.code` (`invalid_enum_value`, `invalid_literal`) üzerinden yapın; metin yolunu hiç bırakmayın | Beş dosyada aynı kalıp; zod sürümü mesaj metnini değiştirdiği anda hukukçu İngilizce hata görür. (İngilizce sızıntı / kırılganlık) |
| M10 | `ai/routes.ts:99-100, 128, 148` | "Bulut yapay zekâ için istek başına onay gerekir: **gövdede useCloudAi:true gönderin**"; "**useCloudAi** tam olarak true olmalı." | "Bu istek için Bulut AI onayı verilmedi. Onay kutusunu işaretleyip yeniden gönderin — seçtiğiniz belge/kanıt metni Anthropic sunucularına gider."; "Bulut AI onayı verilmedi." | API gövdesi alan adı ve "gövde" sözcüğü hukukçuya dönük mesajda. Konsolun kendi karşılığı (`AI_CONSENT_REQUIRED`) zaten doğru; sunucu metni onunla aynı olmalı. (makine kodu) |
| M11 | `api/matterLink.ts:43` | "Dava dosyası bulunamadı; **matterId alanını** kontrol edin." | "Dava dosyası bulunamadı; üst çubuktaki aktif dosya seçimini kontrol edin." | Makine alan adı; konsolun `MATTER_NOT_FOUND` metni zaten doğru cümleyi kullanıyor (console 2201). (makine kodu / tutarlılık) |
| M12 | `deadlines/calc.ts:405, 439, 443, 453` | "**applyAdliTatil=true** CMK'da HMK m.104 uzamasını uygulamaz…"; "…**applyAdliTatil=true** ile zorlandı."; "**applyAdliTatil=false**: … uzaması kapatıldı" | "Adli tatil kutusu işaretli olsa da CMK'da HMK m.104 uzaması uygulanmaz…"; "…adli tatil kutusu işaretlendiği için uygulandı."; "Adli tatil kutusu işaretli değil: … uzaması hesaba katılmadı" | Bu cümleler **hesap adımları** listesinde, avukatın süreyi denetlediği yerde duruyor; ekranda böyle bir parametre yok, "Adli tatil (20 Temmuz–31 Ağustos) uzatmasını uygula" kutusu var. (makine kodu) |
| M13 | `deadlines/calc.ts:319, 326, 338` | "**ruleId** ve **custom** birlikte verilemez…"; "**ruleId** (kural) veya **custom** (özel süre) alanlarından biri gerekli."; "…**GET /v1/deadlines/rules** ile geçerli kural kimliklerini listeleyin." | "Aynı anda hem bir süre kuralı hem özel süre seçilemez; birini seçin."; "Bir süre kuralı seçin ya da özel süre girin."; "Bu süre kuralı bulunamadı; listeden bir kural seçin." | HTTP metodu ve uç yolu hukukçuya gösteriliyor. (makine kodu) |
| M14 | `answer/renderer.ts:298-299` | "- Kapsam kapısı: atıf yapılan hüküm doğrudan alındı; öteki pasajlar tek tek soru sözcükleriyle sınandı **(bypassed-by-reference)**" | Parantezi kaldırın; kod yalnız JSON kanıt paketinde kalsın | Markdown dışa aktarımında İngilizce iç mekanizma adı. Konsol aynı cümleyi kodsuz yazıyor (console 7538). (İngilizce sızıntı / tutarlılık) |
| M15 | `drafting/revise.ts:379-381, 395, 402` | "'X' için anlamsal (**entailment**) bağlama bu yoldan kabul edilmez…"; "…**entailment** bağlaması geçersiz (skor 0-1 ve **yargıç** adı gerekir)."; "… (**judge**=…, **score**=…)" | "'X' için anlamsal bağ bu yoldan kabul edilmez…"; "…anlamsal bağ geçersiz (0–1 arası puan ve doğrulayıcı adı gerekir)."; "…(doğrulayıcı: …, puan: …)" | "entailment" ve `judge=`/`score=` İngilizce; ayrıca "**yargıç**" burada model hakemini kastediyor — hukuk ürününde en yanlış seçilebilecek sözcük. "doğrulayıcı" kullanın. (İngilizce sızıntı / terminoloji) |
| M16 | `drafting/composer.ts:431, 439, 453`; `drafting/evidence.ts:198, 204, 227` | "… (**UPLOAD_NOT_LEGAL_SOURCE**)."; "…: **CONFLICTING_AUTHORITIES** — destekleyen taraf…"; "…(**CONTEXT_ONLY**)."; "…tespiti '**${claim.verdict}**' olduğu için…" | Türkçe önce, kod parantezde ve yalnız teknik ayrıntıda: "…yüklenen belge hukukî dayanak sayılmadı."; "…kaynaklar çelişiyor (ÇELİŞEN OTORİTELER)…"; "…yalnız bağlam için getirildi."; "…tespitin sonucu '**YETERSİZ KANIT**' olduğu için…" (`VERDICT_TR` zaten var) | Bu uyarılar **taslak uyarıları kartında** ekranda görünüyor; ham enum'lar Türkçesiz. Konsolun sözlük kuralı ("Türkçe önce, kod parantezde") burada uygulanmamış. (makine kodu) |
| M17 | `drafting/composer.ts:280, 332, 350, 439`; `drafting/evidence.ts:198, 204, 227` | Uyarılar `${claim.claimId}` ile başlıyor: "c-3: dayandığı kanıtlar bu belgeyle alakasız görünüyor (DOMAIN_MISMATCH+NOT_RELEVANT); taslağa yazılmadı." | "Bir hukukî değerlendirme, dayandığı kaynaklar bu belgenin hukuk alanıyla örtüşmediği için taslağa yazılmadı." (kimlik teknik ayrıntıda kalsın) | Hukukçu `c-3`'ün ne olduğunu bilmiyor; kimlik ancak "Teknik doğrulama ayrıntıları" açılır bölümünde anlam taşır. (makine kodu) |
| M18 | `drafting/markdown.ts:123` | "- Kaynak: `${entry.source === "UPLOAD" ? "yüklenen belge" : entry.source}`" → "Kaynak: **BEDESTEN**" | Kaynak kodları için sözlük: BEDESTEN → "Bedesten (UYAP karar arama)", MEVZUAT → "mevzuat.gov.tr", UPLOAD → "yüklediğiniz belge"; bilinmeyen kod olduğu gibi kalsın | Markdown dışa aktarımında ham veri kaynağı kodları. `ORIGIN_TR` konsolda var, dışa aktarımda yok. (makine kodu / tutarlılık) |
| M19 | `export/petition.py:348-349` | "oluşturulma **(ISO)**: {draft.created_at} · üretim **(ISO)**: {generated_at} · sistem sürümü: {version}" | "oluşturulma: 15.03.2026 14:02 · üretim: 02.09.2026 09:31 · sistem sürümü: …" (yerel saat, GG.AA.YYYY SS:dd) | **Dışa aktarılan DOCX dilekçede ISO zaman damgası.** W12-FIX2 #9 "yerel saat + dosya adları" düzeltmesi konsolu ve dosya adını kapsamış, DOCX künyesini kapsamamış. `KULLANIM-ColleX.md:367-368` "Belgenin içindeki tarih ve saatler bilgisayarınızın yerel saatidir" diyor — bu satır için doğru değil. (ISO tarih / kılavuz-ürün uyumsuzluğu) |
| M20 | `export/text.py:37-39` | "…yerel test/geliştirme için üretilmiş sentetik **fixture** metinleridir." | "…yerel sınama için bu proje tarafından yazılmış örnek metinlerdir." | SENTETİK bandı avukatın gördüğü en önemli dürüstlük cümlesi ve içinde İngilizce bir geliştirici terimi var. (İngilizce sızıntı) |
| M21 | `export/text.py:31` | "Sistem kullanıcı adına imza atmaz, UYAP'a evrak göndermez, PIN/**token**/özel anahtar işlemez…" | "…PIN, **elektronik imza şifresi** ve özel anahtar işlemez…" | "token" İngilizce; her sayfanın altbilgisinde geçen zorunlu uyarıda. (İngilizce sızıntı) |
| M22 | `intake/extract.py:132, 190, 234` | "PDF ayrıştırılamadı: **{type(exc).__name__}: {exc}**" (DOCX ve UDF için aynısı) | "PDF okunamadı; dosya bozuk ya da desteklenmeyen bir sürümle üretilmiş olabilir. Kaynağından yeniden indirip deneyin." (Python istisna metni yalnız sunucu günlüğüne) | Python istisna sınıf adı kullanıcıya dönük uyarı metnine giriyor. Konsolun kendi karşılığı (console 3743) zaten doğru cümleyi kuruyor. (makine kodu) |
| M23 | `intake/extract.py:208-209` | "karakter kodlaması **windows-1254 (Türkçe latin-5) VARSAYILDI** — dosya UTF-8 değil" | "Metin dosyasının karakter kodlaması Windows Türkçe olarak kabul edildi; Türkçe harfler bozuk görünürse belgeyi UTF-8 olarak kaydedip yeniden yükleyin." | Kodlama adı ve "VARSAYILDI" kelimesi; avukat ne yapacağını bilmiyor. (mikro metin) |
| M24 | `intake/extract.py:8, 53`, `intake/__init__.py:20` | "taranmış PDF — **OCR bu modda devre dışı**" | "taranmış PDF — bu belgede seçilebilir metin yok; Bulut OCR ile metne çevirebilirsiniz" | "mod" burada hiçbir kullanıcı kavramına karşılık gelmiyor; ayrıca sonraki adımı söylemiyor. Aynı durumun konsol karşılığı (console 3738-3740) doğru yazılmış. (mikro metin / tutarlılık) |
| M25 | `intake/extract.py:228` | "UDF içinde **content.xml** bulunamadı" | "UDF dosyası okunamadı; UYAP Doküman Editörü'nde açıp yeniden kaydedip deneyin." | İç dosya adı. (makine kodu) |
| M26 | `control-plane/scripts/serve.mjs:385-401` | `konsol :` / **`health :`** / **`korpus :`** / **`db :`** / `kayıt :` / **`ai :`** / **`mcp :`** / **`repo :`** / **`pid :`** | `konsol :` / `sağlık :` / `veritabanı :` / `durum :` / `kayıt :` / `Bulut AI:` / `canlı araştırma:` / `klasör :` / `süreç :` | Bu pencere avukatın **tek teşhis yüzeyi**; kılavuz (`KULLANIM-ColleX.md:488`) ona "siyah pencerede 'mcp' satırı 'ok' olana kadar bekleyin" diyor. Dokuz anahtarın altısı İngilizce/makine. Ayrıca **"korpus"** burada ürün veritabanını (`collex_local`) gösteriyor; ürünün her yerinde "korpus" = hukuk metni deposu. (İngilizce sızıntı / terminoloji çakışması) |
| M27 | `console.html:3019-3021` | indirilen dosya adı `"kanit-paketi-" + runId + ".json"` | `"Kanit Paketi - " + runId + ".json"` ya da taslak dışa aktarımıyla aynı kural: `"Kanıt Paketi - <Dosya> - <runId>.json"` | Taslak dışa aktarım adları düzgün Türkçe ("Cevap Dilekçesi - Yılmaz Kira tahliye - v2.docx"); kanıt paketi diakritiksiz ve tire-küçük harf. Aynı üründe iki dosya-adı geleneği. (tutarlılık) |

### 2.3 Terminoloji ve "aynı cümle her yüzeyde" ihlalleri (P1)

| # | Dosya:satır | Şu anki metin | Önerilen metin | Gerekçe (kategori) |
|---|---|---|---|---|
| C1 | `console.html:1994-1997` ↔ `answer/renderer.ts:66-71` ↔ `export/text.py:71-74` | Konsol: "TAM — Tüm tespitler doğrulanmış kaynağa bağlı." / Markdown: "tüm tespitler kaynak doğrulamalı" / DOCX: "TAM (tüm tespitler kaynak doğrulamalı)". ŞERHLİ, KISMİ, ÇEKİMSER için de üç ayrı ifade. | Tek sözlük, üç yüzeyde birebir: TAM = "Tüm tespitler doğrulanmış kaynağa bağlı." · ŞERHLİ = "Tespitler kaynaklı; çekince veya çelişen otorite var." · KISMİ = "Bazı tespitler doğrulanamadı; cevap kesinleştirilemez." · ÇEKİMSER = "Yeterli doğrulanabilir kaynak yok." | Ürün sözlüğünün dört ana etiketi **üç yüzeyde üç farklı cümleyle** açıklanıyor. Aynı cevabı ekranda, Markdown'da ve DOCX'te okuyan hukukçu üç ayrı ifade görüyor. (tutarlılık — sözlük) |
| C2 | `export/text.py:79-81` | `FINALIZE_OK = "Teknik kontroller tamamlandı — nihai hukukî değerlendirme avukatındır"` | `FINALIZE_OK = "KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır"` | DOCX/Markdown çıktısında **"KESİNLEŞTİRİLEBİLİR" damgası hiç yazmıyor**; konsol (2121) ve `renderer.ts:105` yazıyor. Yanındaki `FINALIZE_BLOCKED` damgayı taşıyor — asimetri, üstelik olumlu tarafta. CLAUDE.md'nin "sözlük" kuralının en görünür ihlali. (tutarlılık — sözlük) |
| C3 | `console.html:2120-2123` ↔ `renderer.ts:105-106` ↔ `KULLANIM-ColleX.md:232-235` | Konsolda cümle **noktasız**, `renderer.ts`'te **noktalı**, kılavuz noktalı alıntılıyor | Üç yerde de nokta**suz** dize tutulsun; noktayı çağıran yer eklesin | "Birebir aynı" sözü noktalama farkıyla bozuluyor; `console.test.ts` bunu yakalamıyor. (tutarlılık) |
| C4 | `KULLANIM-ColleX.md:337` ↔ `console.html:5255-5256` | Kılavuz: neden çipleri "**alan uyuşmuyor**" / "**metinle örtüşmüyor**" | Kılavuzu ekrana uydurun: "**hukuk alanı bu belgeyle uyuşmuyor**" / "**talep/olay metniyle ortak sözcük yok**" | Kılavuz kendi 5-6. satırında "ekran adları ekrandaki yazılarla birebir aynıdır" diyor; alaka kapısı çiplerinde değil. (kılavuz-ürün uyumsuzluğu) |
| C5 | `KULLANIM-ColleX.md:277-280` | "…(hizmet, kira, **tahliye taahhütnamesi**, iş, satış, **vekâlet ücreti**)" | Ekran başlıklarıyla: "Hizmet Sözleşmesi, Kira Sözleşmesi (Konut/İşyeri), Tahliye Taahhütnamesi (TBK m.352/1), Belirsiz Süreli İş Sözleşmesi, Satış Sözleşmesi (Taşınır), **Avukatlık Ücret Sözleşmesi**" | Şablon **"Avukatlık Ücret Sözleşmesi"** adını taşıyor; kılavuz "vekâlet ücreti" diyor. Dilekçe tarafında da altı ad kısaltılmış. Kılavuzun kendi kuralı ihlal ediliyor. (kılavuz-ürün uyumsuzluğu) |
| C6 | `KULLANIM-ColleX.md:447, 499` ↔ `console.html:6377` | Kılavuz "Bulut AI'**yi** açmak"; konsol "Bulut AI'**yı** aç" | Her yerde "**AI'yı**" (ve "AI'nın", "AI'dır", "AI'ya") | "AI" İngilizce okunuşuyla kalın ünlüyle biter; kılavuzun kendisi 445 ve 475. satırlarda "AI'**dır**" ve "AI'**nın**" yazıyor — aynı belgede iki ünlü uyumu. LANG-7'ye ek madde olarak yazılmalı. (ünlü uyumu / kesme) |
| C7 | `console.html:2282`, `files/routes.ts:80` ↔ `KULLANIM-ColleX.md:146` | "Belge işleme süresi aşıldı (**180 sn**)" ↔ "Yükleme **3 dakikayı** aşarsa" | Her yerde: "Belge işleme süresi aşıldı (3 dakika)" | Aynı sınır iki birimle. Hukukçuya "180 sn" değil "3 dakika" söylenir. Aynı sorun `AI_TIMEOUT_TEXT`'te de var: "60 sn; OCR 300 sn" → "1 dakika; OCR 5 dakika". (tutarlılık / mikro metin) |
| C8 | `console.html:3620-3623` ↔ `intake/extract.py:91-93` | Konsol: "10 sayfanın 9 tanesinde metin yok — taranmış olabilir; bu sayfalar dizine alınmadı (sayfa …)" ↔ Python: "9 / 10 sayfada **metin katmanı** yok (taranmış olabilir): sayfa … — bu sayfalar dizine alınmadı; **OCR bu modda devre dışı**" | Python tarafını konsol cümlesiyle birebir aynı yapın (konsol cümlesi daha iyi: ek uyumu çözülmüş, jargon yok) | Aynı olay iki farklı cümleyle iki yüzeyde. Python metni `SCANNED_PAGES` uyarısı olarak cevap ekranına da düşebiliyor. (tutarlılık) |
| C9 | `console.html:2283` ↔ `ai/routes.ts:99-100` | Konsol: "Bulut AI için bu istekte onay verilmedi." ↔ Sunucu: "Bulut yapay zekâ için istek başına onay gerekir: gövdede useCloudAi:true gönderin (seçilen belge/kanıt metni Anthropic sunucularına gönderilir)." | Sunucu metni konsolunkiyle aynı olsun; teknik yönerge `openapi.yaml` açıklamasında kalsın | Tek olay, iki metin, biri API sözlüğüyle. (tutarlılık) |
| C10 | `templates.ts:1122, 1637` ↔ `templates.ts:258, 887, 908, 1175` | "**ticarî** sır" (2×) ↔ "**ticari** uyuşmazlık" (4×) | TDK yazımı: her yerde "**ticari**" | Aynı dosyada aynı sözcüğün iki yazımı. (diakritik tutarlılığı) |
| C11 | `templates.ts:1003` ↔ `templates.ts:1608-1609` | "KDV **dâhil** değildir" ↔ "beş yıl **dahil**" (2×) | TDK yazımı: her yerde "**dahil**" | Aynı dosyada iki yazım. (diakritik tutarlılığı) |
| C12 | `rules.ts:207` | "…ortaya çıkan **hukuki** durum kısmen veya tamamen ortadan kaldırılamaz…" | "…ortaya çıkan **hukukî** durum…" | Ürünün tamamı "hukukî" yazıyor (HUKUKÎ SEBEPLER, hukukî değerlendirme, Hukukî soru); tek istisna burası. (diakritik tutarlılığı) |
| C13 | `templates.ts:372` ↔ `548, 647, 869` ↔ `461` | "**HUKUKÎ DELİLLER**" (dava dilekçesi) ↔ "**DELİLLER**" (istinaf, temyiz, icra) ↔ "**KARŞI DELİLLER**" (cevap) | Dava dilekçesinde de "**DELİLLER**"; cevap dilekçesinde "KARŞI DELİLLER" kalabilir (rol farkı gerçek) | HMK m.119/1-f "deliller" der; "hukukî delil" diye bir kavram yoktur (delil hukukî olmaz, hukukî **sebep** olur). Dört şablonda üç farklı başlık. (terminoloji / hukukî isabet) |
| C14 | `console.html:3014-3016` | `lrow("**Değerlendirme tarihi**", …)`, `lrow("**kaynak**", …)`, `lrow("**tespit**", …)` | "Değerlendirme tarihi", "Kaynak sayısı", "Tespit sayısı" | Aynı künye satırında biri büyük harfle başlayan tam ad, ikisi küçük harfli tek sözcük. (mikro metin) |
| C15 | `templates.ts:670-671, 897-898, 995-996, 1206-1207, 1422-1427, 1500-1501, 1703-1704, 1865-1866` | 8 şablonda `matter.tarih` ve `ekBilgiler.yer` alanları `group: FIELD_GROUPS.mahkeme` = "**Mahkeme ve dosya**" başlıklı alan kümesinde | Yeni grup: `FIELD_GROUPS.belge = "Belge künyesi"`; sözleşme/ihtarname/arabuluculuk şablonlarında bu grup kullanılsın | Altı **sözleşme** şablonu, ihtarname ve arabuluculuk başvurusu formunda hukukçu "Mahkeme ve dosya" başlıklı, içinde hiç mahkeme alanı olmayan bir kutu görüyor. (bilgi mimarisi / mikro metin) |
| C16 | `templates.ts:257, 588, 1719` | select seçenekleri: "**evet**"/"**hayır**"; "**istenmiyor**"/"**isteniyor**"; "**yok**"/"**var (TMK m.764 …)**" | "Evet"/"Hayır"; "Duruşma istenmiyor"/"Duruşma isteniyor"; "Yok"/"Var — TMK m.764 uyarınca noter sicilinde tescil edilecek" | Seçim değerleri hem forma hem **oluşan cümleye** aynen giriyor: "Duruşma istemi: istenmiyor (HMK m.369)." — dilekçeye böyle yazılmaz. Doğrusu: "Duruşma yapılması talep edilmemektedir." (mikro metin) |
| C17 | `console.html:3005-3006` ve `3031-3036` | `fin` satırı: "KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan kullanmayın" + hemen altında tam genişlik bant: "**Kesinleştirilemez** — Bu cevap KESİNLEŞTİRİLEMEZ: en az bir doğrulama başarısız. Aşağıdaki gerekçeleri okumadan kullanmayın." | Tek blok: durum damgasının içinde kesinleştirme cümlesi; ayrı bant kaldırılsın (ya da bant kalsın, `fin` satırı kaldırılsın) | Aynı cümle **iki santim arayla iki kez**. Tekrarlanan uyarı, uyarı olmaktan çıkar. (uyarı bütçesi) |
| C18 | `console.html:1707` ve `console.html:7566` | Üstte `.stamp` "Veri kaynağı — …" + cevap künyesinde "Veri kaynağı: …" | Cevap ekrandayken üstteki damga gizlensin; veri kaynağı cümlesi yalnız cevabın künyesinde dursun | Aynı cümle iki kez, biri kalıcı. (uyarı bütçesi) |
| C19 | `rules.ts:520, 523` ve `rules.ts:552, 555` | `label: "TKHK m.70/3"` ↔ not: "6502 sayılı Kanun m.70/3"; `label: "İş Kanunu m.20/1"` ↔ not: "4857 sayılı Kanun m.20/1" | Tek gelenek: kısaltması yerleşik kanunlar için kısaltma (HMK, CMK, İYUK, İİK, TBK, TCK, TKHK, İş K.), diğerleri için "NNNN sayılı Kanun". Aynı kuralın hem `label`'da hem `notes`'ta uygulanması. | Aynı kural kartında künye ve not farklı atıf biçimi kullanıyor. (tutarlılık) |
| C20 | `console.html:5642, 8029` ↔ `console.html:3661, 7821, 8192` | "**parça**" (AI analiz kartı, kanıt tablosu) ↔ "**bölüm**" (belge kartı, belge metni, önizleme) | Tek sözcük: kullanıcıya dönük her yerde "**bölüm**"; "parça" yalnız teknik ayrıntıda | Aynı nesne (chunk) iki adla. Belge sayfasında sol tarafta "Bölüm 3", sağ tarafta "parça 3" yazıyor. (terminoloji) |

### 2.4 Mikro metin, boş durumlar, ton (P2)

| # | Dosya:satır | Şu anki metin | Önerilen metin | Gerekçe (kategori) |
|---|---|---|---|---|
| D1 | `console.html:2446-2448`; `ai/routes.ts:290`; `api/server.ts:696` | "Bu özellik bu sunucuda henüz açık değil. **Sistemi başlatan kişiden isteyin**; açıldığında bu ekran kendiliğinden çalışır." / "…**sistemi başlatan kişiye bildirin**." | "Bu özellik bu sunucuda henüz açık değil; açıldığında bu ekran kendiliğinden çalışır." / "…Sorun sürerse sunucu penceresindeki günlüğü saklayın." | Ürün **tek kullanıcılı**; "sistemi başlatan kişi" avukatın kendisi. `STORE_UNAVAILABLE_TEXT` bu düzeltmeyi almış (console 2022'deki yorum bunu söylüyor), üç yer almamış. (ton / tutarlılık) |
| D2 | `console.html:4081` | "Şablon tanımlı değil" | "Bu şablon bu sunucuda tanımlı değil — listeden başka bir şablon seçin." | Boş durum sonraki adımı söylemiyor. (boş durum) |
| D3 | `console.html:8280, 8301, 8323, 8336` | "Taraf tespit edilmedi." / "Atıf bulunamadı." / "Tarih bulunamadı." / "Talep tespit edilmedi." | "Belgede taraf adı bulunamadı — taraf bilgilerini taslak formuna elle girin." / "Belgede kanun veya karar atfı bulunamadı." / "Belgede tarih bulunamadı — süreleri Süre hesabı ekranından elle başlatın." / "Belgede talep cümlesi bulunamadı — talepleri taslak formuna elle yazın." | Dört boş durum da yalnız yokluğu bildiriyor. Ön inceleme sezgisel olduğu için "bulunamadı" sık; her seferinde çıkmaz sokak. (boş durum) |
| D4 | `console.html:5538` | "Sürüm kaydı yok." | "Henüz sürüm yok — ilk **Kaydet** ile v1 oluşur." | (boş durum) |
| D5 | `console.html:7142` | "Bu dosyada süre kaydı yok." | "Bu dosyada süre yok — **Süre ekle** ile ilk süreyi hesaplayın." | (boş durum) |
| D6 | `console.html:7218` | "Henüz not yok." | "Henüz not yok — **Not ekle** ile görüşme özeti veya hatırlatma yazın." | (boş durum) |
| D7 | `console.html:2273` (`ERROR_KIND_TR.NOT_FOUND`) | "Kayıt bulunamadı." | "Kayıt bulunamadı; silinmiş ya da başka bir dosyaya taşınmış olabilir." | En genel hata metni ve hiçbir sonraki adım vermiyor. (hata metni) |
| D8 | `console.html:1726` ve `1954` ↔ `1872` | "**Yenile**" (süreler paneli), "**Yenile**" (sistem durumu) ↔ "**Listeyi yenile**" (belgeler) | "Süreleri yenile" / "Durumu yenile" / "Listeyi yenile" | Aynı üründe aynı düğme üç ekranda iki farklı ada sahip; ikisi nesnesiz. Kural: fiil + nesne. (düğme etiketi) |
| D9 | `console.html:3459` ↔ `console.html:3629, 3671, 6890` | "Belgeyi **çıkar**" ↔ "**Dosyadan çıkar**" | "Belgeyi kapsam dışı bırak" (araştırma kapsamı) ↔ "Dosyadan çıkar" (dava dosyası bağı) | İki farklı işlem için aynı fiil; "çıkar" ayrıca "metnini çıkar" (extract) ile karışıyor — ürün metnin çıkarılmasına da "çıkar" diyor ("Çıkarılan metin", console 3659). (belirsiz fiil) |
| D10 | `console.html:3712` | "silme ucu henüz bağlanmadı (404)" | "Belge silme bu sunucuda henüz açık değil." | Toast'ta "uç" (endpoint) ve ham HTTP kodu. (makine kodu / mikro metin) |
| D11 | `console.html:3569, 4046, 6511, 6575, 7670, 8457` | `notYetCard(..., "**Dosya ucu**")`, "**Taslak şablon ucu**", "**Süre listesi ucu**", "**Dava dosyası ucu**", "**Derin araştırma ucu**", "**Ayar ucu**" | "Belge listesi", "Taslak şablonları", "Süre listesi", "Dava dosyaları", "Canlı araştırma", "Ayarlar" | "uç" mühendis sözcüğü ve altı yerde kullanıcıya gösteriliyor. (makine kodu) |
| D12 | `drafting/templates.ts:2099` | "'{şablon}' şablonu için bu alan zorunludur — **lütfen** doldurun." | "'{şablon}' şablonu için bu alan zorunludur; doldurup yeniden gönderin." | Üründeki **tek "lütfen"**. Ses tonu kuralı: özür dileyen değil, açık ve sakin. (ton) |
| D13 | `console.html:2571-2572` | "**Dikkat**: '{boyut}' boyutu zayıf (%n) — dayanak yapmadan önce kaynağı **mutlaka** okuyun." | "'{boyut}' boyutu zayıf (%n); dayanak yapmadan önce kaynağı okuyun." | Üründeki tek "Dikkat:" + tek "mutlaka". Bu iki sözcük, geri kalanı sakin olan bir arayüzde alarm tonu kuruyor ve tekrar ettikçe değerini yitiriyor. (ton) |
| D14 | `console.html:3697` | "Silinsin mi? Belge, sürümleri ve parçaları kalıcı olarak kaldırılır." | "'{dosya adı}' silinsin mi? Belge, sürümleri ve bölümleri kalıcı olarak kaldırılır; bu işlem geri alınamaz." | Yıkıcı onayda nesnenin adı yok ("Belge" hangi belge?) ve geri alınamazlık söylenmiyor. Ayrıca "parça" → "bölüm" (C20). (onay metni) |
| D15 | `console.html:6794` | "Dosya, notları, süreleri ve bağları silinsin mi? Belgelerin kendisi ve cevaplar silinmez; bu dosyaya bağlı taslaklar silinmez ama dosyasız kalır (Taslak › Kayıtlı taslaklar'dan açılır)." | "**'{dosya başlığı}' silinsin mi?** Silinecek: dosya kaydı, notları, süreleri ve bağları. Silinmeyecek: belgeler, cevaplar ve taslaklar — taslaklar dosyasız kalır ve Taslak › Kayıtlı taslaklar'dan açılır. Bu işlem geri alınamaz." | 34 sözcüklük tek cümle; iki listeyi ayırmak okunurluğu ikiye katlar. Nesnenin adı yine yok. (onay metni) |
| D16 | `templates.ts:210` | `field("matter.vekil.ad", "Vekil (**Av.**)")` | "Vekil avukat" | Etiketin sonundaki parantezli kısaltma etiket değil, biçim ipucu; `placeholder` zaten "Av. Mehmet Demir". (etiket) |
| D17 | `templates.ts:204-206` (`PARTY_HELP_DILEKCE`) | "T.C. kimlik no, adres ve vekil bilgileri **HMK m.119 için** taraf kaydına eklenir." | "T.C. kimlik no, adres ve vekil bilgileri **HMK m.119/1-b, c ve ç uyarınca** taraf bloğuna yazılır." | "m.119 için" bir hukuk metninde eksik atıf; hangi bendin ne istediği söylenmiyor. (hukukî atıf / mikro metin) |
| D18 | `templates.ts:679-682` | help: "İhtarnamenin tebliğinden itibaren ifa için tanınan süre; boşsa **'doldurun' olarak bırakılır**." | "İhtarnamenin tebliğinden itibaren ifa için tanınan süre. Boş bırakırsanız metinde doldurulacak bir boşluk kalır." | Yer tutucu mekanizmasının kendisi kullanıcı metninde anlatılıyor. (mikro metin) |
| D19 | `templates.ts:688-692` | `{ id: "noter", slots: [{ kind: "hukum", text: "**Sayın {noter}**" }] }` → "Sayın İstanbul 5. Noterliği" | `text: "{noter}'NE"` → "İSTANBUL 5. NOTERLİĞİ'NE" (başlık hizasında) | Noterliğe "Sayın" diye hitap edilmez; ihtarnamede hitap satırı "…NOTERLİĞİ'NE" biçimindedir. (uygulama biçimi) |
| D20 | `drafting/composer.ts:248` | `[${label} — doldurun]` — etiket tam alan adı: "[İstinafa konu karar (Mahkeme, E. .../..., K. .../..., T. ...) — doldurun]" | `TemplateField`'a kısa `placeholderLabel` ekleyin ("İstinafa konu karar"); yer tutucu onu kullansın | Alan etiketleri parantez içinde form yardımı taşıyor; o yardım **dilekçe gövdesine** basılıyor. (yer tutucu) |
| D21 | `templates.ts:447, 842` ↔ `1162, 1393, 1660, 1822` | "[Usul itirazları — doldurun **veya bu bölümü silin**]" / "[İtirazlar — doldurun]" ↔ "Taraflarca kararlaştırılmış ayrıca bir özel şart yoktur." | Tek kalıp: doldurulması gereken yerler `[… — doldurun]`; olumlu boşluk cümleleri `emptyText` olarak açıkça yazılsın. "veya bu bölümü silin" talimatı `warnings`'e taşınsın. | Üç ayrı boş-alan kalıbı; biri dilekçe gövdesinde kullanıcıya talimat veriyor. (yer tutucu) |
| D22 | `templates.ts` — 13 şablonda `placeholder: "İstanbul"`, "İstanbul Barosu", "İstanbul 3. Asliye Hukuk Mahkemesi", "İstanbul 5. Noterliği", "İstanbul Anadolu 5. İcra Müdürlüğü", "İstanbul (Çağlayan)" | | Ayarlar'daki `defaultCity` ile doldurun; varsayılan **İzmir** olsun ("İzmir 3. Asliye Hukuk Mahkemesi", "İzmir Barosu", "İzmir 5. Noterliği") | Ürün **İzmir Barosu**'na kayıtlı tek bir avukat için; konsolun kendi ayar örnekleri "İzmir Barosu"/"İzmir" (console 1920, 1931). Şablonların tamamı İstanbul diyor. (kişiselleştirme / tutarlılık) |
| D23 | `console.html:1739, 1744` ↔ `5561` ↔ `templates.ts:205` | "**Örn.** Yılmaz / Kira tahliye" ↔ "Talimat — **örn.** depozito…" ↔ "(**örn.** 'Davacı : Ayşe Yılmaz')" ↔ `KULLANIM:` "**örneğin**" | Tek biçim: cümle içinde "örn."; cümle başında "Örn." | Üç yazım. Küçük ama her formda görünüyor. (yazım tutarlılığı) |
| D24 | `console.html:6149` ↔ `matters/routes.ts:169` | Rozet "tamamlandı" ↔ durum değeri `tamam` ("Durum: acik veya tamam olmalı.") | Durum değeri kullanıcıya hiç gösterilmesin; hata mesajı "Durum: Açık veya Tamamlandı." | Aynı durumun iki adı; biri diakritiksiz makine değeri. (terminoloji) |
| D25 | `console.html:1860` ↔ `KULLANIM-ColleX.md:131` | Bırakma alanı: "Belge bırakın veya seçin — **PDF · DOCX · TXT · UDF**" ↔ kılavuz: "Word (DOCX), PDF, düz metin (TXT), UYAP belgesi (UDF)" | Bırakma alanı: "Belge bırakın veya seçin — PDF, Word (DOCX), düz metin (TXT), UYAP belgesi (UDF)" | Ürünün ilk temas ekranı yalnız uzantı kısaltmaları gösteriyor; kılavuz açıklamalı ad kullanıyor ve daha iyi. (mikro metin) |
| D26 | `drafting/types.ts:43` | `"beyan/**İRADE** — kanıt gerektirmez"` | `"beyan — kanıt gerektirmez"` (dilekçe) / `"taraf iradesi — kanıt gerektirmez"` (sözleşme) | Karma büyük-küçük harfli, eğik çizgili etiket; "İRADE" hukukçuya sözleşme bağlamını çağrıştırıyor ama dilekçe paragrafında da gösteriliyor. (etiket) |
| D27 | `ColleX-Baslat.cmd` (tüm `echo` satırları) ve `ColleX-Durdur.cmd` | "Veritabani baslatiliyor", "Sunucu ayri pencerede baslatiliyor", "Hazir. Arayuz aciliyor", "Yerel veritabanina ulasilamadi" — **diakritiksiz ASCII** | Aynı metinler Türkçe diakritiklerle: "Veritabanı başlatılıyor", "Sunucu ayrı pencerede başlatılıyor", "Hazır. Arayüz açılıyor", "Yerel veritabanına ulaşılamadı" | Avukatın gördüğü **ilk ve son ekran** diakritiksiz. Dosya zaten `chcp 65001` yapıyor (18. satır, tüm `echo`'lardan önce) ve `ColleX-Baslat.cmd` içinde hâlihazırda UTF-8 çok baytlı karakter var (6 bayt, `rem` satırlarında) — yani teknik olarak mümkün. **Değişiklikten sonra hedef makinede bir kez gözle doğrulanmalıdır** (cmd.exe kod sayfası davranışı ve `ColleX-Baslat.cmd`'nin LF-only satır sonu). (diakritik / ilk izlenim) |
| D28 | `ColleX-Baslat.cmd` (PostgreSQL bulunamadı dalı) | "**scoop install postgresql** ile kurun ya da **PGROOT yolunu** duzenleyin." | "ColleX'in veritabanı bulunamadı. Kurulumu yapan kişiye bu satırı gösterin: PostgreSQL beklenen yerde değil ({yol})." | Avukata verilen paket yöneticisi komutu ve ortam değişkeni adı. (ton / hedef kitle) |
| D29 | `ColleX-Baslat.cmd` (venv uyarısı) | "Uyari: **.venv\Scripts\python.exe** yok; dosya yukleme ve MCP gecidi calismaz." | "Uyarı: kurulum eksik — belge yükleme ve canlı araştırma çalışmayacak. Kurulumu yapan kişiye bildirin." | Depo içi yol ve "MCP geçidi" terimi; kılavuz canlı araştırmaya hiçbir yerde "MCP geçidi" demiyor. (ton / terminoloji) |
| D30 | `ColleX-Baslat.cmd` (`:failed` bloğu) | `- "veritabani: CALISMIYOR"  -> PostgreSQL ayaga kalkmadi; %TEMP%\collex-postgres.log` / `- "portu kullanimda" -> eski bir sunucu aciktir` | "Sunucu penceresinde kırmızı satırı okuyun: 'veritabanı: ÇALIŞMIYOR' yazıyorsa veritabanı açılmamıştır (günlük: {yol}); '8787 portu kullanımda' yazıyorsa ColleX zaten açıktır — önce ColleX-Durdur.cmd çalıştırın." | Ham sunucu dizeleri tırnak içinde, ASCII karşılıklarıyla; avukat pencerede **diakritikli** metin göreceği için eşleşmiyor bile. (mikro metin) |
| D31 | `console.html:2021` (`AI_TIMEOUT_TEXT`) | "Bulut yapay zekâ süresinde yanıt vermedi (**60 sn; OCR 300 sn**) — yeniden deneyin." | "Bulut AI süresinde yanıt vermedi (1 dakika; Bulut OCR için 5 dakika) — yeniden deneyin." | Saniye birimi + LANG-7'ye göre kısa etiket "Bulut AI" olmalıydı (bu bir bildirim çipi metni). (mikro metin / adlandırma) |
| D32 | `console.html:2236`, `2289`, `KULLANIM:494` | "İstek ya da dosya sunucu sınırını aşıyor (**JSON ≤ 1 MB**, belge ≤ 25 MB, Bulut OCR ≤ 32 MB / ≤ 100 sayfa)." | "Gönderilen içerik sunucu sınırını aşıyor: metin istekleri en fazla 1 MB, belgeler 25 MB, Bulut OCR 32 MB ve 100 sayfa, dosya kayıtları 64 KB." | "JSON" hukukçuya hiçbir şey söylemiyor; `matters` 64 KB sınırı bu listede yok ama aynı hatayı üretiyor. (mikro metin) |
| D33 | `console.html:2450` | "(Teknik: {uç} → **404**)" | "(Teknik ayrıntı: {uç} — sunucuda tanımlı değil)" | Ham HTTP kodu; ürünün geri kalanı kodları Türkçe açıklamadan sonra parantezde veriyor. (makine kodu) |
| D34 | `answer/renderer.ts:124` | `"- Kesinleştirme: **…**"` (üç nokta yer tutucu dize olarak duruyor) | Yer tutucuyu kaldırın; `Kesinleştirme:` satırı yalnız gerçek değerle yazılsın | Markdown çıktısında yer tutucu bir "…" kalabiliyor. (mikro metin) |
| D35 | `console.html:5254-5256` (`UNUSED_REASON_TR`) + `5298` | "yine de kullan" / "**Yine de** dayanak olarak kullan" ↔ "Dayanak olarak kullan" | Anahtar etiketi her iki durumda "Dayanak olarak kullan"; alakasız kaynak için altına açıklama satırı: "Bu kaynak alakasız görünüyor; yine de kullanabilirsiniz." | Aynı anahtarın iki farklı etiketi ("Yine de …" / "…") kullanıcıya iki farklı denetim gibi görünüyor. (mikro metin) |

---

## 3. Doğrulanan hukukî atıflar — build ajanı için hazır kayıt

Aşağıdaki maddelerin **yürürlükteki metni 02.09.2026'da mevzuat.gov.tr'den
`yargi-mevzuat` MCP ile çekildi**. `rules.ts`'te `verified` alanı bu kayıtla
`dogrulandi`'ya çevrilebilir (test "ağ yoktu" kaynağını reddediyor; kaynak
metni bu bölüme atıf yapmalı).

| Madde | Çekilen ibare (kısa) | ColleX'teki hâli | Sonuç |
|---|---|---|---|
| İİK m.62/1 | "…ödeme emrinin tebliği tarihinden itibaren **yedi gün** içinde … icra dairesine bildirmeye mecburdur." | `iik-odeme-emri-itiraz` 7 gün / tebliğ | **DOĞRU** — `verified` çevrilebilir |
| İİK m.62 (fıkra sırası) | Yaşayan fıkralar: 1 süre · 2 tebliğ · 3 adres · **4 kısmî itiraz** · (mülga) · **5 imza reddi** · 6 belge | Şablon: kısmî itiraz m.62/4, imza reddi m.62/5 | **DOĞRU** (mülga fıkra araya girdiği için tartışmalı görünüyordu; yaşayan fıkra sayımıyla tutuyor) |
| İİK m.363/1 | "…tebliğ tarihinden itibaren **iki haftadır**"; dipnot: 7499 s.K. m.37 ile "tefhim veya" **çıkarıldı**, "on gün" → "iki hafta" | `iik-icra-mahkemesi-istinaf` **10 gün / tefhim** | **YANLIŞ** → L1, L2, L3 |
| HMK m.176/2 | "Aynı davada, taraflar **ancak bir kez** ıslah yoluna başvurabilir." | "davanın **her aşamasında** sadece bir kez" | **YANLIŞ** → L4 |
| HMK m.342/2 | a) sıfat/ad/**TCKN**/adres · b) vekil · c) karar künyesi · **ç) tebliğ tarihi** · **d) kararın özeti** · e) sebepler · f) talep · g) imza | "Kararın özeti" bölümü yok; tebliğ tarihi zorunlu değil | **EKSİK** → L20, L22 |
| HMK m.364/2 | a) taraflar/TCKN · b) vekil · **c) BAM hukuk dairesi künyesi** · ç) bozma/direnme kararı · d) tebliğ tarihi · **e) kararın özeti** · f) sebepler · g) duruşma istemi · ğ) talep · h) imza | Şablon "m.364/**1**-c" diyor; "Kararın özeti" bölümü yok | **YANLIŞ/EKSİK** → L19, L21, L22 |
| TBK m.344/1 | "…bir önceki kira yılında tüketici fiyat endeksindeki **oniki aylık ortalamalara göre değişim oranını** geçmemek koşuluyla geçerlidir." (Konut **ve çatılı işyeri** kiraları bölümünde) | "konutlarda … TÜFE on iki aylık **ortalamasını** aşamaz" | **YANLIŞ** → L8, L9 |
| TBK m.344/3 | Beş yıldan uzun / beşten sonra yenilenen sözleşmelerde bedeli **hâkim** hakkaniyete göre belirler | yok | **EKSİK** → L10 |
| TBK m.352/1 | "Kiracı, kiralananın teslim edilmesinden sonra … belli bir tarihte boşaltmayı **yazılı olarak** üstlendiği hâlde boşaltmamışsa kiraya veren … **bu tarihten başlayarak bir ay içinde** icraya başvurmak veya dava açmak suretiyle sona erdirebilir." | "el yazısı/imzasıyla"; bir aylık süre yok | **YANLIŞ + EKSİK** → L5, L6, L7 |
| CMK m.268/1 | "…ilgililerin kararı **öğrendiği günden itibaren iki hafta** içinde…" | `cmk-itiraz` 2 hafta / öğrenme | **DOĞRU** — `verified` çevrilebilir |
| İş K. m.41 | "%50 yükseltilmesi"; "işçinin **onayının** alınması gerekir" (yazılı demiyor); "her saat karşılığında **bir saat otuz dakika**"; "**altı ay** zarfında"; "bir yılda **ikiyüzyetmiş saatten** fazla olamaz" | %50 doğru; "yazılı onay" m.41'e bağlanmış; 1,5 saat / 6 ay / 270 saat yok | **KISMEN YANLIŞ + EKSİK** → L16 |
| FSEK m.52 | "Mali haklara dair sözleşme ve tasarrufların **yazılı olması** ve konuları olan hakların **ayrı ayrı gösterilmesi** şarttır." | yalnız "yazılı şekle tabidir" | **EKSİK (hükmü geçersiz kılan)** → L15 |
| Av.K. m.164/2 | "**Yüzde yirmibeşi aşmamak üzere**, dava veya hükmolunacak şeyin değeri yahut paranın **belli bir yüzdesi** avukatlık ücreti olarak kararlaştırılabilir." | "ücret … değerin %25'ini **aşamaz**" | **YANLIŞ** → L12, L13 |
| Av.K. m.164/3 | "İkinci fıkraya göre yapılacak sözleşmeler, dava konusu para dışındaki **mal ve haklardan bir kısmının aynen avukata ait olacağı** hükmünü taşıyamaz." | yok | **EKSİK** → L12 |
| Av.K. m.164/4 | "Avukatlık asgarî ücret tarifesi altında vekâlet ücreti kararlaştırılamaz." | doğru alıntılanmış | **DOĞRU** |
| Av.K. m.164/son | "…karşı tarafa yüklenecek vekâlet ücreti avukata aittir. Bu ücret, **iş sahibinin borcu nedeniyle** takas ve mahsup edilemez, haczedilemez." | "kararlaştırılan ücretten mahsup edilmez" diye aktarılmış | **YANLIŞ AKTARIM** → L14 |
| Av.K. m.163/2 | "Avukatlık ücret tavanını aşan sözleşmeler, bu Kanunda belirtilen **tavan miktarında geçerlidir**." | yok | **EKSİK** → L12 |
| Av.K. m.166 | hapis hakkı | doğru atıflanmış | **DOĞRU** |
| Av.K. m.173/2 | masraf/avans, "ilk istekte avukata … ödenir" | doğru atıflanmış | **DOĞRU** |

**Doğrulanmayı bekleyen ve riskli görünen kalanlar** (aynı yolla bir oturumda
bitirilebilir): HMK m.127/136/345/347/361/366/96, CMK m.273/291/173 (7499
geçişleri), İYUK m.7/16/45/46/8/61/20A, İİK m.16/67/68/168/170, 6216 m.47,
6502 m.70, 4857 m.20, 6183 m.58, TBK m.347.

---

## 4. Uyarı bütçesi — kaç uyarı, nerede

### 4.1 Bugün ne görülüyor

Bir **KISMİ** cevap ekranında (canlı kapsam, aktif dosya seçili, gerçek
korpus) hukukçunun tek ekranda gördüğü uyarı/çekince blokları:

| # | Blok | Kaynak | Cümle |
|---|---|---|---|
| 1 | "Veri kaynağı — …" damgası (kalıcı) | `console.html:1707` | 1 |
| 2 | Canlı mod bandı + bütçe ipucu (form ekrandayken) | 1790-1793 | 2 |
| 3 | Durum damgası + açıklaması | 3002-3003 | 1 |
| 4 | `fin` kesinleştirme satırı | 3005 | 1 |
| 5 | "Kesinleştirilemez" tam genişlik bandı (**4'ün tekrarı**) | 3031-3036 | 2 |
| 6 | Kapsam satırı + kapsam kapısı açıklaması | 7537-7538 | 2 |
| 7 | "Kenara alınan pasajlar" satırı + eksik sözcükler | 7542-7544 | 2 |
| 8 | "Üretim: …" satırı | 7560-7561 | 1 |
| 9 | "Veri kaynağı: …" satırı (**1'in tekrarı**) | 7566 | 1 |
| 10 | Tespit başına "boyutu zayıf" notu | 2571-2575 | 1–n |
| 11 | "Kanıt kümesine alınmayan pasajlar" açıklaması | 3163-3164 | 2 |
| 12 | "Reddedilen kanıt adayları" bölümü | 3193 | 1 |
| 13 | Uyarılar kartı: "İşleyiş uyarıları" + "Doğrulama gerekçeleri" | 3204-3213 | 2 + n |
| 14 | Altbilgi notu (kalıcı, 5 cümle) | 5693-5698 | 5 |

**Toplam: 11–14 blok, 20–24 cümle**; ikisi birebir tekrar (4↔5, 1↔9). Demo
korpusunda 15. blok (`#demobanner`), dosyasız çalışırken 16. blok
(`#nomatterstrip`), yalnız-yükleme kapsamında 17. blok
(`UPLOAD_ONLY_EVIDENCE`) ekleniyor.

Sonuç: dürüstlük cümleleri **gürültüye dönüşüyor**. Tekrar eden bir uyarı,
okunmayan bir uyarıdır; ve bu üründe uyarı, ürünün kendisidir.

### 4.2 Önerilen: 3 sabit + 1 koşullu

| Yer | İçerik | Neden orada |
|---|---|---|
| **1. Cevabın başı — tek blok** | Durum damgası (TAM/ŞERHLİ/KISMİ/ÇEKİMSER) + tek cümlelik anlamı + **aynı blok içinde** kesinleştirme cümlesi | Hukukçunun ilk baktığı yer; kesinleştirme ayrı bant olmaktan çıkar (C17). Bugünkü 3+4+5 → 1 blok, 2 cümle. |
| **2. Cevabın künyesi — tek liste** | Kapsam %'si + eksik sözcükler + üretim yolu + veri kaynağı + (varsa) süre bütçesi / alıntı kısaltıldı / yalnız-yükleme | Bugünkü 6+7+8+9. Üst damga (1) cevap ekrandayken gizlenir (C18). Her satır bir olgu, uyarı tonu yok. |
| **3. Cevabın sonu — Uyarılar kartı** | İşleyiş uyarıları + doğrulama gerekçeleri; P0 sınıfı kod yoksa **kapalı** açılır bölüm ("3 uyarı") | Bugünkü 13. Okumak isteyene açık, akışı kesmez. |
| **4. Koşullu şerit** | Yalnız SENTETİK/DENEME KORPUSU'nda: `#demobanner` | Gerçek kullanımda hiç görünmez; göründüğünde tek başına kalır ve gücünü korur. |

Kalanlar uyarı olmaktan çıkıp **kendi bölümlerinin altına** taşınır:
"boyutu zayıf" notu tespit kartının içinde (10), "kenara alınan" /
"reddedilen" açıklamaları kendi bölüm başlıklarının altında bir kez (11, 12).
Altbilgi notu (14) kalıcı beş cümle yerine tek satır bağlantı olur:
"**Bu konsol nasıl çalışır? / Verileriniz nereye gider?**" → Ayarlar ›
Verilerim nerede?

**Ölçüt:** bir cevap ekranında hukukçu **en fazla 4 uyarı bloğu, en fazla 8
cümle** görmeli; hiçbir cümle iki kez yazılmamalı.

---

## 5. Ses ve terminoloji rehberi (build ajanları için — bir sayfa)

### 5.1 Ses

- **Kesin, sakin, saygılı.** Olayı söyle, nedenini söyle, sonraki adımı söyle.
  Üç parça: *ne oldu · neden · şimdi ne yapın*.
- **Özür dileme.** "Üzgünüz", "maalesef", "lütfen" kullanılmaz. (Tek istisna
  yok — bugünkü tek "lütfen" için D12.)
- **Alarm kurma.** "Dikkat!", "mutlaka", "asla" (kural cümlesi dışında),
  ünlem işareti kullanılmaz. Ciddiyet büyük harfli damgayla (KAYNAKSIZ,
  KESİNLEŞTİRİLEMEZ, DOĞRULANMADI) verilir, ton yükseltmekle değil.
- **Şirinlik yok.** Emoji yok, espri yok, "Hadi başlayalım" yok.
- **Satış yok.** "güçlü", "akıllı", "gelişmiş", "kolayca" gibi sıfatlar
  kullanılmaz. Ürün ne yaptığını söyler, ne kadar iyi olduğunu söylemez.
- **Fail belli.** "Yapılamadı" yerine "ColleX bunu yapamadı" ya da "Sunucu
  cevap vermedi". Edilgen çatı yalnız failin gerçekten önemsiz olduğu yerde.
- **Hukukçuya hukukçu gibi.** "dava şartı", "hak düşürücü süre", "def'i",
  "tefhim" açıklanmadan kullanılır. Buna karşılık "uç", "mod", "parametre",
  "gövde", "enum", "token", "entailment", "fixture", "chunk", "upstream",
  "cache", "timeout", "snippet" **hiçbir yerde** kullanılmaz.
- **Tek kullanıcı.** "Sistemi başlatan kişi", "yöneticinize başvurun",
  "ekibiniz" yok — okuyan kişi ürünün tek sahibidir.

### 5.2 Sözlük — bir kavram, bir sözcük

| Kavram | Tek doğru sözcük | Kullanılmayacak |
|---|---|---|
| Dava/danışmanlık işi | **dosya** (dava dosyası) | matter, iş, klasör |
| Yüklenen belge | **belge** | dosya, doküman, evrak (yüklenen için) |
| Belgenin bir parçası | **bölüm** | parça, chunk, segment |
| Kanıt olarak gösterilen pasaj | **kaynak** (kart) / **kanıt** (küme) | referans, delil (bu bağlamda) |
| Dilekçede sayılan delil | **delil** / **Ek-n** | kanıt |
| Paragrafın bağlandığı kaynak | **dayanak** | referans, atıf (atıf = gövdedeki [K-n] işareti) |
| Cevaptaki tek önerme | **tespit** | iddia, claim, bulgu |
| Bulut hattı — kısa etiket | **Bulut AI** | Bulut Yapay Zekâ, bulut ai, Cloud AI |
| Bulut hattı — düzyazı | ilk anışta **bulut yapay zekâ (Bulut AI)**, sonra "Bulut yapay zekâ …" | yapay zeka (şapkasız) |
| "Bulut AI" ekleri | AI'**yı**, AI'**nın**, AI'**dır**, AI'**ya** | AI'yi, AI'nin |
| Hukuk metni deposu | **yerel korpus** | veritabanı, depo |
| Ürün veritabanı | **veritabanı** (`collex_local`) | korpus |
| Canlı derin araştırma | **canlı araştırma** | MCP geçidi, deep research |
| Süre hesabı | **süre** | deadline, termin |

### 5.3 Değişmez cümleler (her yüzeyde birebir, noktasız)

Bu altı dize `console.html`, `answer/renderer.ts`, `export/text.py` ve
`drafting/markdown.ts`'te **karakteri karakterine aynı** olmalıdır. Aynılık
bir testle sabitlenmelidir (`console.test.ts`'in "names cloud AI" testi gibi):

1. `TAM — Tüm tespitler doğrulanmış kaynağa bağlı.`
2. `ŞERHLİ — Tespitler kaynaklı; çekince veya çelişen otorite var.`
3. `KISMİ — Bazı tespitler doğrulanamadı; cevap kesinleştirilemez.`
4. `ÇEKİMSER — Yeterli doğrulanabilir kaynak yok.`
5. `KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır`
6. `KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan kullanmayın`

Ayrıca birebir sabit kalanlar: `DEADLINE_DISCLAIMER` (L31 düzeltmesiyle),
`yüklediğiniz belge — yürürlük değerlendirilemez`,
`deneysel — UYAP Doküman Editörü'nde açarak doğrulayın`,
`DOĞRULANMADI — madde metniyle kontrol edin`,
`Bu taslak makine üretimidir; avukat incelemesi zorunludur.`

### 5.4 Yazım kuralları

- **Tarih:** her zaman `GG.AA.YYYY` (ör. 03.09.2026). Saat `SS:dd`, **yerel
  saat**. ISO (`YYYY-MM-DD`) yalnız JSON gövdesinde ve "Teknik doğrulama
  ayrıntıları" açılır bölümünde. Hata mesajlarında biçim tarif ederken
  "GG.AA.YYYY biçiminde (ör. 03.09.2026)" yazılır, `YYYY-AA-GG` yazılmaz.
- **Madde atfı:** `HMK m.127/1`, `TCK m. 157` — kısaltma, boşluk, `m.`,
  madde no, `/` fıkra. Kanun kısaltması yerleşikse kısaltma (HMK, CMK, İYUK,
  İİK, TBK, TCK, TKHK, FSEK, İş K., Av.K., HUAK), değilse `NNNN sayılı
  Kanun m.X`. Aynı belgede iki biçim karışmaz (C19).
- **Diakritik:** `hukukî`, `resmî`, `millî`, `hâl/hâlinde`, `derhâl`,
  `kâtip`, `zekâ`, `vekâlet` şapkalı; `ticari`, `cezai`, `idari`, `dahil`,
  `hukuken` şapkasız. Bir sözcük dosya içinde iki türlü yazılmaz (C10–C12).
- **Sayı eki:** rakama gelen ek okunuşa göre — `9'unda`, `3'ü`, `2026'da`,
  `%25'ini`, `13.00'ten`, `5'i`. Emin olunamayan yerde sayıya ek
  getirilmez: "N tanesinde" kalıbı kullanılır (`scannedText`, console 3618
  — doğru yapılmış örnektir).
- **Kısaltma eki:** kesme ile — `HMK'da`, `UYAP'ta`, `KVKK'ya`, `AI'yı`.
  Kurum adlarına gelen ekler mahkeme hitabında uygulama biçimiyle yazılır:
  `…MAHKEMESİ'NE`, `…MÜDÜRLÜĞÜ'NE`, `…BAŞKANLIĞI'NA` (TDK bu ekleri kesmesiz
  yazar; **burada uygulama biçimi bilinçle tercih edilmiştir** ve tutarlıdır
  — değiştirilmemelidir).
- **Yüzde:** `%50`, `%0,5`; işaret sayıdan önce, ondalık virgülle.
- **Tire:** düşünce çizgisi `—` (uzun), aralık `–` (orta: `20 Temmuz–31
  Ağustos`), birleştirme `-`.
- **Tırnak:** kullanıcıya dönük metinde `“…”`; kod/kimlik için tırnak yerine
  kalın ya da tek tırnak.

### 5.5 Mikro metin kalıpları

- **Düğme:** fiil + nesne. "Kaydet" tek başına yalnız Ctrl+S'nin karşılığı
  olduğu için kalır; "Yenile", "Aç", "Sil" tek başına kullanılmaz →
  "Listeyi yenile", "Taslağı aç", "Belgeyi sil".
- **Boş durum:** *ne yok · nasıl doldurulur*. "Henüz X yok — **Y** ile
  ekleyin." Yalnız yokluğu bildiren boş durum yazılmaz.
- **Hata:** *ne oldu · neden · sonraki adım*. Üçü de tek cümlede olabilir.
  Makine kodu varsa Türkçe cümleden **sonra**, parantez içinde ve teknik
  satırda.
- **Onay (yıkıcı):** nesnenin **adı** + ne silinir + ne silinmez + "geri
  alınamaz". Onay düğmesi "Evet, sil" değil, "**{Nesne}'yi sil**".
- **Bildirim (toast):** tek cümle, geçmiş zaman, nesne adlı. "Taslak
  kaydedildi — v3." "Süre dosyaya kaydedildi: {başlık}."
- **İpucu (`title`):** cümle değil, tamlama. Sonunda nokta yok.
- **Yer tutucu (`placeholder`):** gerçekçi bir örnek, talimat değil.
  "Örn. Yılmaz / Kira tahliye" ✔ · "Buraya başlık yazın" ✘.
- **Sözleşme/dilekçe gövdesi:** arayüz talimatı, ekran adı, makine kimliği,
  koşullu şablon metni ("varsa şöyle, yoksa böyle") ve yazara verilmiş not
  **asla** girmez (L18, L25, L28, D21).

---

## 6. Ne yapılmadı

- Şablonların ve süre kurallarının **tamamı** madde metniyle karşılaştırılmadı;
  §3'te doğrulanan 19 madde dışındakiler `[çıkarım]`dır.
- Playwright yürüyüşü yapılmadı (bu tarayıcı hattı değildir); uyarı sayımı
  (§4.1) koddan, satır satır izlenerek çıkarıldı.
- Hiçbir sunucu başlatılmadı, hiçbir port kullanılmadı, `collex_local`'a
  dokunulmadı; yalnız `yargi-mevzuat` MCP üzerinden mevzuat.gov.tr'ye
  salt-okunur sorgu yapıldı.
- Depo dosyası değiştirilmedi; bu rapor dışında yazılan tek şey scratchpad'deki
  dize çıkarma betikleri ve dökümleridir.
