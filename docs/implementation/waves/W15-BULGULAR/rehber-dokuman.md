# rehber-dokuman

Kılavuz (docs/KULLANIM-ColleX.md, 1075 satır) avukata yazılmaya çalışılmış ama fiilen bir sürüm notu ile karışmış durumda: 1-7. bölümler günlük kullanımı anlatırken, 8. bölümün tamamı "bu turda ne değişti", "motor hazır, düğme yok", "W14", "Faz B" gibi geliştirici diliyle yazılmış ve avukatın hiç kullanamayacağı özellikleri öğretiyor. Kılavuz baştaki sözünü ("teknik terim kullanmamaya çalıştık") tutamıyor: korpus, parmak izi, uç, pasaj, JSON, MCP, PAYLOAD_TOO_LARGE, parça, milisaniye gibi sözcükler tanımsız geçiyor; ANTHROPIC_API_KEY'i komut penceresinden vermeyi tarif eden bir bölüm var. Asıl kusur ise şu: uygulamanın kendini anlatan bütün metni bu belgede duruyor — console.html içinde tek bir "Yardım", "Kılavuz" ya da "Sözlük" ekranı yok (tek geçiş bir kod yorumudur) ve ekranda yalnızca 1 adet açılır açıklama (<details>) var. Buna karşılık ekranın kendisi karşılama kartında "SHA-256 özetiyle bağlar", iş listesinde "Unicode konumu ve SHA-256 ile bağlar", kapsam seçiminde "Yerel korpus" yazıyor; yani avukat tanımı olmayan terimlerle ekranda yalnız kalıyor. Öncelik sırası: (1) uygulamaya bir Sözlük ekranı ve üst çubukta bir "?" düğmesiyle kılavuzu içeriden açma, (2) ekrandaki terimleri sadeleştirip her damganın yanına tek cümlelik açıklama koyma, (3) kılavuzu ikiye ayırma — avukat kılavuzu ve sürüm notu.

Bulgu: 36

## [P0] ui-kusuru — satir 3

**Mevcut:**
```
Sürüm tarihi: 03.09.2026 (son güncelleme: ilerleme/vazgeç turu sonrası). Bu kılavuz ColleX'i her gün kullanacak avukat için
```

**Neden:** Kılavuz uygulamanın içinden hiçbir yerden açılamıyor: console.html'de "kılavuz", "rehber" ya da "yardım" diye bir düğme, bağlantı ya da ekran yok. Avukat bir terimi anlamadığında Windows'ta klasör gezip .md dosyası aramak zorunda; pratikte hiç okumaz.

**Öneri:**
```
Üst çubuğa bir "?" düğmesi konmalı ve tıklayınca kılavuz uygulamanın içinde açılmalı; ayrıca her ekranın başlığının yanında o ekranı anlatan tek satırlık "Bu ekran ne yapar?" bağlantısı bulunmalı.
```

**Not:** console.html içinde arama yapıldı: 'kılavuz/rehber/Yardım/KULLANIM' hiç geçmiyor; sayfada yalnız 1 adet açılır açıklama (<details>) var.

## [P0] eksik-aciklama — satir 4

**Mevcut:**
```
yazıldı. Teknik terim kullanmamaya çalıştık; ekranlarda gördüğünüz kısa
```

**Neden:** Kılavuz terimleri açıklıyor ama uygulamanın İÇİNDE hiçbir tanım yok: console.html'de "Sözlük", "Yardım" ya da "Kılavuz" diye bir ekran yok ("Sözlük" kelimesi yalnız 2916. satırdaki bir kod yorumunda geçer). Avukat ekranda "korpus", "ÇEKİMSER", "KAYNAKSIZ", "KESİNLEŞTİRİLEBİLİR" görünce bakacağı bir yer bulamıyor; 1075 satırlık bir dosyayı açması beklenemez.

**Öneri:**
```
Ayarlar'a (ve üst çubuktaki "?" düğmesine) bir SÖZLÜK ekranı eklenmeli; her terim ekranda geçtiği yerde de bu tanıma bağlanmalı. Tanımlar:
1. Yerel arşiv (bugünkü adı: yerel korpus) — Bu bilgisayarda saklanan kanun ve karar metinleri; ColleX buradan alıntı yapabilir.
2. Yüklediğim belgeler — Sizin verdiğiniz dava belgeleri; bunlar delildir, hukukî dayanak sayılmaz.
3. Canlı araştırma — Sorunuzun aramasını resmî karar ve mevzuat sunucularına gönderip bulunan metinleri getirme yolu.
4. Arama yeri (bugünkü adı: kapsam) — Sorunun nerede aranacağı: yerel arşivde mi, resmî kaynaklarda mı, kendi belgelerinizde mi.
5. Soru karşılama oranı (bugünkü adı: kapsam yüzdesi) — Sorunuzdaki sözcüklerin kaç tanesinin bulunan metinlerde karşılığı olduğu; hukukî isabet ölçüsü değildir.
6. Kaynak listesi sayfası (bugünkü adı: kapsam manifestosu) — Hangi resmî kaynakların bağlı, hangilerinin kapsam dışı olduğunu gösteren liste.
7. Tespit — ColleX'in cevapta kurduğu tek cümlelik iddia; her biri altındaki alıntılara dayanır.
8. Alıntı — Bir karar ya da kanun metninden birebir alınan bölüm.
9. Kaynak kartı — Bir alıntının künyesini (mahkeme, esas-karar no, tarih, madde) ve metnini gösteren kutu.
10. TAM — Cevaptaki bütün iddialar, metniyle karşılaştırılmış alıntılara bağlı.
11. ŞERHLİ — İddialar kaynaklı; ancak çekince ya da aksi yönde karar var, ikisi de gösteriliyor.
12. KISMİ — İddiaların bir kısmı için kaynak doğrulanamadı; cevap eksiktir.
13. ÇEKİMSER — Elindeki kaynaklarda karşılık bulunamadığı için cevap yazılmadı.
14. KAYNAKSIZ — Bu paragrafın dayandığı bir alıntı yok; cümle sizindir.
15. Makine kontrolleri tamam / eksik (bugünkü adı: KESİNLEŞTİRİLEBİLİR / KESİNLEŞTİRİLEMEZ) — Alıntının kaynak metinde aynen durup durmadığı ve kaynağın o tarihte yürürlükte olup olmadığı gibi kontrollerin sonucu; hukukî isabet değerlendirmesi değildir.
16. Alıntı denetimi (bugünkü adı: parmak izi) — Alıntının kaynak metinde harfi harfine aynı yerde durduğunun bilgisayarca karşılaştırılması.
17. Yürürlük kontrolü — Dayanılan maddenin belirttiğiniz tarihte yürürlükte olup olmadığının kontrolü.
18. Değerlendirme tarihi — Hangi tarihteki hukuka göre bakılacağı; geçmiş bir tarih girerseniz o günkü metin esas alınır.
19. Aksi yönde içtihat taraması — Bulunan görüşün tersini söyleyen kararların ayrıca aranması.
20. Kenara alınan bölümler — Sorunuzla yalnız kelime benzerliği taşıyan, dayanak sayılmayan metin parçaları.
21. Bulut yapay zekâ (bugünkü adı: Bulut AI) — İsteğe bağlı, varsayılan kapalı bir dış servis; açarsanız seçtiğiniz metin internete gider.
22. Taramadan metne çevirme (bugünkü adı: Bulut OCR) — Resim hâlindeki PDF sayfalarını okunabilir metne çevirir; sayfalar dış servise gönderilir.
23. Aktif dosya — Üst çubukta seçili dava dosyası; yaptığınız her iş kendiliğinden ona bağlanır.
24. Örnek veri (bugünkü adı: SENTETİK / DENEME KORPUSU) — Kurulumla gelen deneme metinleri; gerçek kanun ya da içtihat değildir, dilekçede kullanılmaz.
25. Şablon — Bir dilekçenin ya da sözleşmenin hazır iskeleti.
26. Kanıt kaynağı — Taslağın hangi araştırmadan ya da hangi belgelerden besleneceği seçimi.
27. Alaka kontrolü — Bulunan kaynağın şablonun hukuk alanına ve anlattığınız olaya uyup uymadığının kontrolü.
28. Sürüm — Her kaydedişte oluşan numaralı kopya (v1, v2…); önceki kopya silinmez.
29. Denetim kopyası / nihai kopya — Denetim kopyası kaynakları ve uyarıları taşır (sizin için); nihai kopya yalnız dilekçe gövdesidir (mahkeme için).
30. Atıf denetimi — Bir dilekçedeki kanun ve karar atıflarının gerçekten var olup olmadığının tek tek kontrolü.
31. "bulunamadı" ile "belirsiz" farkı — "bulunamadı" taradığımız kaynaklarda yok demektir; "belirsiz" bakılamadı demektir.
32. Adli tatil: tartışmalı — Bu kuralda adli tatilin süreyi uzatıp uzatmadığı tartışmalıdır; ekran kısa ve güvenli tarihi verir.
33. DOĞRULANDI / DOĞRULANMADI (süre kuralı) — Kuralın süresi madde metniyle karşılaştırıldı mı, karşılaştırılmadı mı.
34. Yedek — Verilerinizin başka bir diske alınmış, eksiksizliği sonradan denetlenebilen kopyası.
35. UDF — UYAP'ın kendi dilekçe dosya biçimi.
```

**Not:** docs/KULLANIM-ColleX.md. Sözlük ekranı yazılana kadar bu 35 tanım yalnız bu belgede duruyor.

## [P0] jargon — satir 170

**Mevcut:**
```
- **Belge + korpus** — belgeye ek olarak yerel mevzuat/karar deposu.
```

**Neden:** Belge sayfasındaki üç seçenekten biri (console.html 10309: "Belge + korpus"). "Korpus" tanımsız; ayrıca artı işareti avukat arayüzünde ne olduğunu söylemiyor.

**Öneri:**
```
- **Bu belge + yerel arşiv** — hem bu belgenin metni hem bilgisayarınızdaki kanun/karar arşivi taranır.
```

**Not:** docs/KULLANIM-ColleX.md ve console.html 10309.

## [P0] jargon — satir 205

**Mevcut:**
```
| **Yerel korpus** | Bilgisayarınızdaki mevzuat/karar deposunda arar |
```

**Neden:** "Korpus" ekranda kapsam seçeneğinin adı (console.html 2315: "Yerel korpus"). Kılavuz terimi açıklamak yerine kullanıyor. Avukat bu kelimeyi bilmez; radyo düğmesini seçmez.

**Öneri:**
```
| **Yerel arşiv (bu bilgisayardaki mevzuat ve karar metinleri)** | Bilgisayarınıza kurulmuş kanun ve karar arşivinde arar |
```

**Not:** Ekrandaki etiket de değişmeli (console.html 2315, 2332, 4525).

## [P0] tanimsiz-terim — satir 234

**Mevcut:**
```
Hemen altında kesinleştirme satırı: **"KESİNLEŞTİRİLEBİLİR — teknik
```

**Neden:** "Kesinleştirilebilir" hukukta bir anlam taşımaz; avukat bunu "karar kesinleşti" ile karıştırır ve ekranda bir cevabın "kesinleşmesi" ne demek anlamaz. Uydurulmuş bir terim ve tanımı yalnız bu belgede.

**Öneri:**
```
Hemen altında kontrol satırı: **"Makine kontrolleri tamam — alıntılar kaynak metinle karşılaştırıldı; hukukî değerlendirme sizindir."** ya da **"Makine kontrollerinden en az biri başarısız — nedenlerini okumadan kullanmayın."**
```

**Not:** Ekrandaki karşılığı console.html 2899-2900 (FINALIZE_TR).

## [P0] jargon — satir 487

**Mevcut:**
```
komut penceresi açıp `set ANTHROPIC_API_KEY=...` yazdıktan sonra aynı
```

**Neden:** Word + UYAP düzeyinde bilgisayar kullanan bir avukata komut penceresinde ortam değişkeni tanımlatmak gerçekçi değil; ayrıca "anahtar", "ortam" kavramları hiç açıklanmıyor. Bu bölümü okuyan avukat özelliği hiç açamaz.

**Öneri:**
```
Bu bölüm avukat kılavuzundan çıkarılmalı; yerine tek paragraf: "Bulut yapay zekâ varsayılan olarak kapalıdır ve ColleX onsuz tam çalışır. Açılması için Anthropic'ten alınmış bir erişim anahtarının bilgisayara tanıtılması gerekir; bu işlemi ColleX'i kuran kişi yapar (teknik kurulum belgesi: docs/…). Anahtar hiçbir ayara ya da dosyaya yazılmaz."
```

**Not:** docs/KULLANIM-ColleX.md 484-491.

## [P0] jargon — satir 631

**Mevcut:**
```
**Ekran neye göre açılır?** ColleX açılışta sağlık rozetine değil, **ucun
```

**Neden:** "Uç" (endpoint) mühendis kelimesidir; "sağlık rozeti", "kaynak geçidi" de tanımsız. Cümle avukata ne yapması gerektiğini de söylemiyor — sadece yazılımın iç işleyişini anlatıyor.

**Öneri:**
```
**Ekran ne zaman açılır?** Karar arama bu bilgisayarda çalışmıyorsa ekranın üstünde kırmızı bir şerit çıkar, form alanları kapanır ve sizi kaynak listesi sayfasına yönlendirir. Şerit nötr renkteyse arama denenebilir; hangi kaynağa ulaşılıp ulaşılamadığı ancak gerçek bir aramada belli olur.
```

**Not:** docs/KULLANIM-ColleX.md 631-636.

## [P0] jargon — satir 656

**Mevcut:**
```
döndürmüyor"* der. Bugün Yargıtay/Danıştay uçları arama yanıtında metin
```

**Neden:** "Uçları" ve "arama yanıtında metin döndürmüyor" tamamen mühendis dili. Avukatın anlaması gereken şey basit: liste satırında cümle görünmeyebilir.

**Öneri:**
```
…der. Bugün Yargıtay ve Danıştay arama sonuçlarında karardan cümle vermiyor; bu yüzden bu satırı sık göreceksiniz.
```

**Not:** docs/KULLANIM-ColleX.md.

## [P0] eksik-aciklama — satir 817

**Mevcut:**
```
**Ekran:** Belgeler sekmesine klasör bırakma alanı Faz B'de eklenecek.
```

**Neden:** Bölüm başlığı (802. satır) "ekran hazır — Belgeler'de klasör seçme ve sürükleme" diyor, on beş satır sonra aynı bölüm "ekran sonra eklenecek" diyor. Avukat hangisine inanacağını bilemez; ayrıca "Faz B" kimsenin bilmediği bir proje terimi.

**Öneri:**
```
Ya bu satır silinmeli (ekran gerçekten varsa), ya da başlıktaki "ekran hazır" ibaresi kaldırılıp bölüm "Bu iş henüz ekranda yok" başlığı altına alınmalı. Her hâlde "Faz B" ifadesi kılavuzdan çıkmalı.
```

**Not:** docs/KULLANIM-ColleX.md 802 ile 817 çelişiyor.

## [P0] ton — satir 847

**Mevcut:**
```
### 8.9 Dilekçenizi dosyalanabilir hâlde indirmek (**motor hazır, düğme HÂLÂ YOK**)
```

**Neden:** Kullanım kılavuzu, kullanılamayan bir özelliği dört paragraf boyunca anlatıyor. "Motor" avukat için hiçbir şey ifade etmez; "düğme hâlâ yok" ise okuyucuya boşuna okuduğunu söyler. Aynı kalıp 8.11, 8.12, 8.13'te de var.

**Öneri:**
```
Bu başlıklar günlük kullanım kılavuzundan çıkarılıp sonda tek bir listeye taşınmalı: "Henüz ekranda olmayan, üzerinde çalışılan işler: dilekçenin mahkemeye verilecek sade kopyası, dosyanın tek paket hâlinde dışa aktarılması, kişi kartları ve menfaat çatışması taraması, tek kutudan genel arama." Ayrıntı anlatılmamalı.
```

**Not:** docs/KULLANIM-ColleX.md 847, 897, 908, 923.

## [P0] ton — satir 871

**Mevcut:**
```
Bu, W14'ün en sıkı kuralıdır ve bir gün karşınıza çıkacaktır.
```

**Neden:** "W14" projenin iç geliştirme dönemi kodudur; avukat için hiçbir anlamı yok ve belgenin kime yazıldığı konusunda güveni kırar.

**Öneri:**
```
Bu, ColleX'in en katı kuralıdır ve bir gün karşınıza çıkacaktır.
```

**Not:** docs/KULLANIM-ColleX.md.

## [P0] jargon — satir 963

**Mevcut:**
```
`ColleX-Baslat.cmd` canlı modu açar; siyah pencerede "mcp" satırı "ok" olana kadar (5–10 sn) bekleyin.
```

**Neden:** "mcp" satırı "ok" — avukatın siyah pencerede üç harfli bir kısaltmayı ve İngilizce bir kelimeyi araması isteniyor. Kılavuzun başında "teknik terim kullanmıyoruz" denmişti.

**Öneri:**
```
`ColleX-Baslat.cmd` canlı araştırmayı açar; üst çubuktaki canlı araştırma rozeti yeşile dönene kadar (5–10 saniye) bekleyin.
```

**Not:** docs/KULLANIM-ColleX.md sorun giderme tablosu; avukatı siyah pencereye değil, kendi ekranındaki rozete bakmaya yönlendirin.

## [P0] jargon — satir 969

**Mevcut:**
```
| "İstek ya da dosya sunucu sınırını aşıyor" (`PAYLOAD_TOO_LARGE`) | Tek seferde çok büyük bir şey gönderildi: JSON istekleri en fazla 1 MB, belge 25 MB, Bulut OCR 32 MB / 100 sayfa, dosya kaydı 64 KB. Metni belge olarak yükleyin ya da bölün. |
```

**Neden:** Sorun giderme tablosu avukatın en çaresiz anında okuduğu yerdir; orada "PAYLOAD_TOO_LARGE" ve "JSON istekleri" yazıyor. Avukat JSON'un ne olduğunu bilmez, kendi yaptığı işle ilişkilendiremez.

**Öneri:**
```
| "Gönderdiğiniz şey sunucu sınırını aşıyor" | Tek seferde çok büyük bir şey gönderildi. Sınırlar: belge 25 MB, taramadan metne çevirme 32 MB ve 100 sayfa, not/olay metni 64 KB, ekrandan gönderilen diğer veriler 1 MB. Uzun metni belge olarak yükleyin ya da ikiye bölün. |
```

**Not:** docs/KULLANIM-ColleX.md sorun giderme tablosu.

## [P0] jargon — satir 9878

**Mevcut:**
```
line: "Yerel korpusta arar; her tespiti belge sürümü, Unicode konumu ve SHA-256 ile bağlar.",
```

**Neden:** İş listesindeki "Hukukî soru sor" satırının açıklaması. Tek cümlede üç anlaşılmaz terim var: korpus, Unicode konumu, SHA-256. Bu cümlenin görevi avukatı ikna etmek; onu kaçırıyor.

**Öneri:**
```
line: "Bu bilgisayardaki arşivde arar; her cümleyi aldığı alıntıya, alıntıyı da belgedeki tam yerine bağlar.",
```

**Not:** control-plane/public/console.html — iş kartı açıklaması.

## [P0] jargon — satir 13109

**Mevcut:**
```
var WELCOME_LEAD_TR = "Belgelerinizi ve mevzuatı tarar, her tespiti belge sürümü ve SHA-256 " +
```

**Neden:** Uygulamanın kendini anlattığı İLK cümle. Avukatın gördüğü ilk ekranda "SHA-256 özeti" yazıyor; bu kelimeyi bilen avukat yok ve kılavuzda da ilk sayfada açıklanmıyor. Kullanıcının şikâyeti birebir buradan başlıyor.

**Öneri:**
```
"Belgelerinizi ve mevzuatı tarar; yazdığı her cümleyi aldığı alıntıya bağlar ve alıntının kaynak metinde aynen durduğunu kendisi denetler. Süreleri hesaplar, dilekçe taslağı yazar. Dayanağı olmayan cümleyi KAYNAKSIZ diye işaretler."
```

**Not:** control-plane/public/console.html — karşılama kartı metni.

## [P1] eksik-aciklama — satir 52

**Mevcut:**
```
Boş bir karşılama kartı görürsünüz. İki şeyi yapın:
```

**Neden:** Kılavuzda tek bir baştan sona örnek yok: gerçek bir dosyada (ör. kira tahliye) belge yükleyip soru sorup taslak üretmenin on dakikalık anlatımı yok. Avukat 1075 satır okumadan ürünü hiç kullanamıyor; en çok ihtiyaç duyulan bölüm eksik.

**Öneri:**
```
1. bölümden hemen sonra "İlk on dakika — örnek bir dosya" başlığı eklenmeli: dosya aç → kira sözleşmesini yükle → "Belgeye sor" ile bir soru sor → cevabın damgasını oku → süre hesapla → cevap dilekçesi taslağı üret → DOCX indir. Her adım tek cümle ve ekrandaki düğme adıyla.
```

**Not:** docs/KULLANIM-ColleX.md — en yüksek etkili eksiklik.

## [P1] tanimsiz-terim — satir 65

**Mevcut:**
```
Üst çubuktaki damga **DENEME KORPUSU (sentetik deneme belgeleri)** yazıyorsa
```

**Neden:** Ekrandaki damganın kendisi iki bilinmeyen kelime taşıyor: "korpus" ve "sentetik". Bu damga tam da avukatın en çok anlaması gereken uyarı — çünkü o metinler gerçek içtihat değil.

**Öneri:**
```
Üst çubuktaki damga **ÖRNEK VERİ — bu metinler gerçek kanun ve karar değildir** yazıyorsa
```

**Not:** Ekrandaki damga metni de değişmeli (console.html 1333, 7904, 10994 civarı).

## [P1] jargon — satir 143

**Mevcut:**
```
  okuyamadığı sayfayı dizine almaz; soru sorarken o sayfalar görünmez.
```

**Neden:** "Dizine almak" (index) teknik bir işlemdir; avukat için önemli olan sonucudur: o sayfalar sorularda hiç kullanılmaz.

**Öneri:**
```
  okuyamadığı sayfayı hiç kullanmaz; sorularınızın cevabında o sayfalar yer almaz.
```

**Not:** docs/KULLANIM-ColleX.md 3. bölüm.

## [P1] anlasilmaz-cumle — satir 231

**Mevcut:**
```
| **KISMİ** | Bazı tespitler doğrulanamadı; cevap kesinleştirilemez. Bir de **süre bütçesi** hâli vardır: cevap 60 saniyede bitmezse ColleX tespit yazmayı bırakır, bulduğu pasajları gösterir ve "Cevap süre bütçesini (60 sn) aştı…" satırıyla KISMİ der — soruyu daraltıp yeniden sorun |
```

**Neden:** Tek tablo hücresine iki ayrı konu sıkıştırılmış; "süre bütçesi", "tespit", "pasaj", "kesinleştirilemez" aynı cümlede. Bir tablo hücresi bir cümleden uzun olmamalı.

**Öneri:**
```
| **KISMİ** | Bazı iddialar için kaynak doğrulanamadı; cevabı olduğu gibi kullanmayın. (Cevap 60 saniyede bitmezse de KISMİ olur: ekran bunu ayrıca yazar, soruyu daraltıp yeniden sorun.) |
```

**Not:** docs/KULLANIM-ColleX.md 4. bölüm cevap tablosu.

## [P1] tanimsiz-terim — satir 243

**Mevcut:**
```
- **Kapsam yüzdesi** — "Soru kapsamı: %63 — soru sözcüklerinin kaynaklarda
```

**Neden:** "Kapsam" kelimesi bu kılavuzda üç ayrı anlamda kullanılıyor: (1) sorunun nerede aranacağı, (2) sorunun karşılanma oranı, (3) "Kapsam" adlı kaynak listesi ekranı. Avukat aynı kelimeyi üç farklı şey için gördüğünde hiçbirini öğrenemez.

**Öneri:**
```
- **Soru karşılama oranı** — "Sorunuzun %63'ü karşılandı — sorudaki sözcüklerin bulunan metinlerde karşılığı"
```

**Not:** Üç anlam üç ayrı ada bölünmeli: "Arama yeri", "Soru karşılama oranı", "Kaynak listesi".

## [P1] jargon — satir 260

**Mevcut:**
```
  ve konum bilgileri o bölüme aittir; tam metin için **Tam metni aç**.
```

**Neden:** "Konum bilgisi" burada metindeki sayısal karakter aralığı demek; avukat bunu "mahkemenin bulunduğu yer" sanabilir. Cümle ayrıca ne yapması gerektiğini söylemiyor.

**Öneri:**
```
  ve denetim, gösterilen bu bölüm için yapılmıştır; kararın tamamını görmek için **Tam metni aç** deyin.
```

**Not:** docs/KULLANIM-ColleX.md 4. bölüm.

## [P1] jargon — satir 265

**Mevcut:**
```
(örneğin `QUESTION_NOT_COVERED`, `CORPUS_UNAVAILABLE`). Türkçesi her zaman
```

**Neden:** Ekranda İngilizce büyük harfli kodlar gösteriliyor ve kılavuz bunu normalleştiriyor. Avukat bu kodu gördüğünde bir arıza yaşadığını sanar; "sorun bildirirken kopyalamanız için" gerekçesi de avukatın bir hata bildirim sistemi olmadığı için karşılıksız.

**Öneri:**
```
Uyarıların Türkçesi her zaman önce yazılır. Bazı uyarıların yanında küçük ve soluk bir kod görebilirsiniz; bu kod yalnız destek istediğinizde işe yarar, sizin için bir anlam taşımaz — kararınızı Türkçe cümleye göre verin.
```

**Not:** Ekranda kodun varsayılan olarak gizlenip "ayrıntıyı göster" ile açılması daha doğru olur.

## [P1] tanimsiz-terim — satir 386

**Mevcut:**
```
kutusunu işaretlersiniz. Yazılan paragraf için her kaynak ayrıca **anlamsal
```

**Neden:** Devamındaki "anlamsal doğrulama (eşik %85)" tanımsız: avukat neyin %85'i olduğunu, eşiğin ne demek olduğunu bilemez; üstelik bu sayı bir doğruluk oranı sanılabilir ki değildir.

**Öneri:**
```
kutusunu işaretlersiniz. Yazılan paragrafın her kaynağı ayrıca kontrol edilir: paragrafın gerçekten o kaynağı anlatıp anlatmadığına bakılır; yeterince örtüşmeyen kaynak paragrafa bağlanmaz, hiçbiri bağlanamazsa paragraf **KAYNAKSIZ** gelir.
```

**Not:** Yüzdeli eşik ekranda da gösterilmemeli; bu sayı bir doğruluk iddiası gibi okunuyor.

## [P1] jargon — satir 477

**Mevcut:**
```
- **Verilerim nerede?**: kısa cevap: bilgisayarınızda, `collex_local`
```

**Neden:** "collex_local adlı veritabanı" avukata hiçbir şey söylemez; kendisi bir veritabanı açıp bakamaz. Avukatın gerçekten merak ettiği şey klasörün yeri ve yedeğin nasıl alınacağıdır.

**Öneri:**
```
- **Verilerim nerede?**: Bilgisayarınızda kalır. Ayarlar'daki bu kart size klasörün tam yolunu yazar; kopyalayıp Dosya Gezgini'ne yapıştırarak açabilirsiniz. Yüklediğiniz belgelerin aslı bu klasörün altındaki "uploads" klasöründedir.
```

**Not:** docs/KULLANIM-ColleX.md 7. bölüm.

## [P1] ton — satir 531

**Mevcut:**
```
**En büyüğü: artık beklerken ne olduğunu görüyorsunuz ve vazgeçebiliyorsunuz.**
```

**Neden:** 8.0 bölümünün tamamı bir sürüm notu: "eskiden şöyleydi, şimdi böyle". Kılavuzu ilk kez açan avukat için eski hâlin ne olduğu ilgisizdir ve belgeyi iki katına çıkarır.

**Öneri:**
```
Bu bölüm "Uzun süren işler" başlığıyla ve yalnız bugünkü davranışı anlatarak yeniden yazılmalı: "Uzun süren bir işte ekranda bir bekleme kartı çıkar: hangi aşamada olunduğu, geçen süre ve bir **Vazgeç** düğmesi. Yüzde gösterilmez, çünkü sunucu bunu bildirmiyor." "Eskiden" ile başlayan cümleler sürüm notuna taşınmalı.
```

**Not:** docs/KULLANIM-ColleX.md 8.0 (529-610) — kılavuz ile sürüm notu ayrılmalı.

## [P1] ton — satir 596

**Mevcut:**
```
   kart hâlâ uzundur, çünkü kalanın çoğu kaynak kartları ve uyarılardır.
```

**Neden:** Bir önceki cümledeki "Kazanç dürüstlükle söylenirse %17" ölçüsü avukat için hiçbir anlam taşımıyor; bu bir geliştirici ölçüm notudur.

**Öneri:**
```
   Cevap kartı yine uzundur; kısalan kısım yalnız ayrıntılardır, kaynaklar ve uyarılar her zaman görünür kalır.
```

**Not:** docs/KULLANIM-ColleX.md 8.0, 591-596.

## [P1] ton — satir 599

**Mevcut:**
```
4. **Ayarlar'da profili kaydettiğinizde sayfa artık zıplamıyor** ve ilk
```

**Neden:** Devamındaki "içerik ekranın dörtte birinde başlıyor (eskiden yaklaşık %37)" bir arayüz ölçümüdür; kullanım kılavuzunda yeri yok ve avukatın hiçbir kararını değiştirmez.

**Öneri:**
```
Bu madde kılavuzdan çıkarılmalı; arayüz iyileştirmeleri sürüm notunda kalmalı.
```

**Not:** docs/KULLANIM-ColleX.md 599-601.

## [P1] jargon — satir 624

**Mevcut:**
```
dediğinizde üretilir ve o pasaj mühürlenir (parmak izi + konum).
```

**Neden:** "Pasaj", "mühürlenir", "parmak izi", "konum" — dördü birden tanımsız. Anlatılmak istenen şey basit ve ürünün en güçlü tarafı, ama bu cümleyle kayboluyor.

**Öneri:**
```
dediğinizde üretilir; alınan bölüm kaydedilir ve o andan sonra metnin değişmediği ColleX tarafından denetlenebilir hâle gelir.
```

**Not:** docs/KULLANIM-ColleX.md 8.1.

## [P1] jargon — satir 812

**Mevcut:**
```
boyut sınırı, dosya türü doğrulaması, sıkıştırılmış dosya tuzağı kontrolü
```

**Neden:** "Sıkıştırılmış dosya tuzağı kontrolü" bir güvenlik terimidir; avukat ne olduğunu bilmez ve bilmesi de gerekmez.

**Öneri:**
```
boyut sınırı, dosya türü kontrolü, zararlı olabilecek dosyaların ayıklanması
```

**Not:** docs/KULLANIM-ColleX.md 8.7.

## [P1] jargon — satir 899

**Mevcut:**
```
Bir dosyanın tamamını tek bir ZIP olarak dışarı verebilirsiniz: dosya
```

**Neden:** Devamındaki "her girdinin parmak izini taşıyan bir liste" ve "ColleX'e ihtiyaç duymadan doğrulayabilir" cümleleri anlaşılmıyor: meslektaşın neyi, nasıl doğrulayacağı söylenmiyor.

**Öneri:**
```
Bir dosyanın tamamını tek bir sıkıştırılmış klasör (ZIP) olarak dışarı verebilirsiniz: dosya özeti, belgelerinizin aslı, taslakların son sürümleri ve araştırma kayıtları — yanında da paketteki her dosyanın eksiksiz geldiğini sonradan denetlemeye yarayan bir liste.
```

**Not:** docs/KULLANIM-ColleX.md 8.11.

## [P1] jargon — satir 1031

**Mevcut:**
```
  sıkıcı hâli, aradığınız şeyin arşivde olmadığı hâldir.** 20 000 parçalık
```

**Neden:** "Parça" burada metnin bölündüğü teknik birim (chunk). Avukat "20 000 parça" ile "20 000 karar" arasındaki farkı bilemez ve sayı ona hiçbir şey anlatmaz.

**Öneri:**
```
  sıkıcı hâli, aradığınız şeyin arşivde olmadığı hâldir.** Yaklaşık yirmi bin sayfalık bir arşivde
```

**Not:** docs/KULLANIM-ColleX.md 10. bölüm.

## [P1] ton — satir 1037

**Mevcut:**
```
  saliseler içinde cevap verir (ölçülen: 71–73 milisaniye). **Bu sürümde
```

**Neden:** Milisaniye ölçümü avukata bir şey söylemez; "saliseler içinde" zaten yeterli. Bu tür ölçüm parantezleri belgeye mühendis raporu havası veriyor.

**Öneri:**
```
  saliseler içinde cevap verir. **Bu sürümde
```

**Not:** docs/KULLANIM-ColleX.md 10. bölüm.

## [P1] eksik-aciklama — satir 1073

**Mevcut:**
```
isteyenler için: `docs/implementation/STATUS.md` (durum ve ölçülen
```

**Neden:** Avukat kılavuzunun son satırı okuyucuyu İngilizce yazılmış geliştirici belgelerine yönlendiriyor (docs/README.md tamamen İngilizce ve "W14 phase M", "pgvector", "endpoint" gibi kelimelerle dolu). Avukat oraya giderse ürüne olan güveni azalır.

**Öneri:**
```
Bu satır kılavuzdan çıkarılmalı. Yerine: "Bir sorunuz olursa Ayarlar › Sistem durumu ekranını açın; orada ekranın ne durumda olduğu Türkçe yazar."
```

**Not:** docs/KULLANIM-ColleX.md 1072-1075; hedef dosyalar avukat için yazılmamış.

## [P2] ton — satir 1

**Mevcut:**
```
# Bağımsız Yargı + Mevzuat MCP Kullanım Rehberi
```

**Neden:** Dosya adı "KULLANIM-REHBERİ" olduğu için avukat önce bunu açar; oysa içerik baştan sona kurulum, token üretme ve araç adlarıdır ("search_bedesten_unified", "MCP_API_TOKEN"). İki farklı kılavuzun adı birbirine çok benziyor ve yanlış olan daha çekici duruyor.

**Öneri:**
```
Bu dosyaya DOKUNULMAMALI (kullanıcının kendi dosyası). Ancak avukat kılavuzunun adı ayırt edici olmalı: docs/KULLANIM-ColleX.md dosyası kök dizine "ColleX-Kullanim-Kilavuzu-AVUKAT.md" adıyla da konmalı ve uygulamadaki "?" düğmesi onu açmalı.
```

**Not:** KULLANIM-REHBERI.md — yalnız okundu, değiştirilmedi.

## [P2] ton — satir 3

**Mevcut:**
```
Kişisel olarak barındırılabilen tek bir FastMCP sunucusunda Türk içtihat,
```

**Neden:** README-INDEPENDENT.md'nin ilk cümlesi. Bu dosya tamamen geliştiriciye yazılmış (FastMCP, endpoint, token, Docker) ama adı avukatın açacağı bir ad gibi duruyor ve içinde "bu belge size göre değil" uyarısı yok.

**Öneri:**
```
Dosyanın en başına tek satır: "> Bu belge ColleX'i kuran teknik kişi içindir. Avukat kullanım kılavuzu: docs/KULLANIM-ColleX.md" ve ardından mevcut metin.
```

**Not:** README-INDEPENDENT.md, satır 3 — bu dosya değiştirilebilir; KULLANIM-REHBERI.md kullanıcının kendi dosyasıdır, dokunulmadı.

## [P2] ui-kusuru — satir 5

**Mevcut:**
```
kodların ne anlama geldiğini yeri geldikçe açıkladık. Ekran adları bu
```

**Neden:** 1075 satırlık belgede içindekiler listesi ve hiç ekran görüntüsü yok. Avukat aradığı konuyu bulamıyor; "ekran adları kalın" demek, ekranı hiç görmemiş biri için yeterli değil.

**Öneri:**
```
Belgenin başına numaralı içindekiler listesi ve her ana bölümün başına o ekranın küçük bir görüntüsü konmalı; ayrıca sık sorulan altı sorunun ("cevabım neden ÇEKİMSER?", "KAYNAKSIZ ne demek?", "süre yanlış mı?" gibi) doğrudan bağlantısı en üste alınmalı.
```

**Not:** docs/KULLANIM-ColleX.md.
