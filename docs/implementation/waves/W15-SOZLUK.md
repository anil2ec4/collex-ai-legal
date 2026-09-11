# W15 — denetim şeritlerinin ortak sözlüğü

23 denetim şeridinin 820 bulgusundan süzülmüş kanonik terim listesi.
Uygulama sırasında bağlayıcı olan dosya [W15-DEGISMEZLER.md](W15-DEGISMEZLER.md);
bu dosya onun ayrıntılı dayanağıdır ve son cila turunda birleştirme ölçütüdür.

## Görünen hiçbir metinde geçmeyecek sözcükler

- `SHA-256`
- `hash`
- `özet değeri`
- `parmak izi`
- `korpus`
- `chunk`
- `pasaj`
- `parça (metin birimi olarak)`
- `dizin / dizine alma`
- `endpoint`
- `uç / ... ucu`
- `istek (request karşılığı)`
- `JSON`
- `CSV`
- `UUID`
- `kimlik (makine numarası olarak)`
- `Unicode`
- `offset / konum (sayısal)`
- `token`
- `jeton`
- `API`
- `ağ geçidi`
- `geçit`
- `abstain / ABSTAIN`
- `sunucu`
- `veritabanı`
- `PostgreSQL`
- `collex_local`
- `log`
- `günlük`
- `ms / milisaniye`
- `OCR`
- `Markdown`
- `snippet`
- `pano`
- `migrasyon`
- `şema`
- `entailment`
- `skor`
- `eşik`
- `bütçe (süre/sayı anlamında)`
- `araç çağrısı`
- `kova`
- `manifesto`
- `sezgisel çıkarım`
- `salt okunur`
- `oturum`
- `zaman aşımı`
- `düştü (çöktü anlamında)`
- `ızgara`
- `KESİNLEŞTİRİLEBİLİR`
- `KESİNLEŞTİRİLEMEZ`
- `ÇEKİMSER`
- `ŞERHLİ`
- `KISMİ (durum damgası)`
- `KAYNAKSIZ`
- `SENTETİK`
- `kapsanmadı`
- `alaka kapısı`
- `tespit (claim karşılığı)`

## Terim karşılıkları

| Şu an | Bundan sonra | Sözlük tanımı | Teknik ad nerede kalır |
|---|---|---|---|
| korpus, yerel korpus, DENEME KORPUSU, belge deposu, yerel kütüphane | **bu bilgisayardaki arşiv (kısa hâli: arşiv)** | ColleX kurulurken bilgisayarınıza yüklenmiş, internete çıkılmadan aranan karar ve mevzuat metinleri. | "korpus" hiçbir yerde kalmaz; teknik ad gerekiyorsa yalnız Ayarlar > Sistem durumu > Teknik ayrıntı satırında. |
| tespit, maddî tespit, claim | **cevap maddesi** | Cevabın, ColleX'in tek tek numaralandırıp her birini bir kaynağa bağladığı ifadelerinden biri. | Tek başına "madde" denmez — kanun maddesiyle karışır; her zaman "cevap maddesi". |
| pasaj, chunk, parça, bölüm (metin birimi olarak) | **belge bölümü** | Bir belgenin, ColleX'in ayrı ayrı arayıp alıntıladığı parçası. | Bölüm numarası (chunkId) yalnız katlanmış "Teknik ayrıntı" bölümünde. |
| KESİNLEŞTİRİLEBİLİR / KESİNLEŞTİRİLEMEZ | **damga kaldırılır; yerine tam cümle: "Alıntıların hepsi kaynağıyla karşılaştırıldı ve aynı çıktı" / "En az bir alıntı kaynağıyla eşleşmedi"** | Cevaptaki alıntıların, alındıkları belgedeki metinle karşılaştırılıp aynı çıkıp çıkmadığını söyleyen satır. | finalizable alanı kodda kalır; ekranda hiçbir biçimde "kesinleştir" kökü görünmez. |
| TAM (durum damgası) | **KAYNAKLI** | Cevaptaki her maddenin bir kaynağı var ve alıntılar kaynağıyla aynı çıktı; hukukî değerlendirme yine avukata aittir. | — |
| ŞERHLİ (durum damgası) | **ÇEKİNCELİ** | Her maddenin kaynağı var; ancak aksi yönde karar ya da çekince de bulundu. | — |
| KISMİ (durum damgası) | **EKSİK CEVAP** | Cevabın bir bölümü kaynağa bağlanamadı; bu hâliyle dilekçeye konulmamalıdır. | — |
| ÇEKİMSER, abstain, ABSTAIN | **CEVAP VERİLMEDİ** | Bu soruya dayanak olacak kaynak bulunamadı; ColleX uydurmamak için bilerek cevap üretmedi. | ABSTAIN kodu yalnız veri alanında; ekranda hiçbir yerde. |
| KAYNAKSIZ | **dayanağı yok** | Bu paragrafın altında, karar ya da mevzuat metnine bağlanmış bir alıntı yok. | Sayaç "Dayanağı olmayan paragraf: 3" biçiminde; sıfırken "Dayanağı olmayan paragraf yok". |
| SENTETİK, sentetik deneme belgeleri, DENEME KORPUSU | **örnek metin (deneme belgesi) — banttaki damga: DENEME MODU** | Gerçek mahkeme kararı ya da mevzuat değil, ColleX'i sınamak için yazılmış uydurma metin; hiçbir dosyada kullanılamaz. | — |
| parmak izi, SHA-256, özet değeri, hash, alıntı özeti, sağlama | **görünen satırda: "değişmezlik denetimi" — değerin kendisi: "denetim kodu"** | Alıntının, alındığı belgedeki metinle harf harf aynı olduğunun kendiliğinden denetlenmesi; belgede tek harf değişse bu denetim bunu yakalar. | "SHA-256" adı ve kodun kendisi yalnız katlanmış "Teknik ayrıntı" içinde; kart altında görünen tek satır "Bu alıntının karardaki metinle birebir aynı olduğu denetlendi." |
| Kapsam (arama alanı seçimi) | **Nerede aransın?** | Cevabın hangi kaynaklardan çıkarılacağı: bu bilgisayardaki arşiv, resmî kaynaklar ya da yüklediğiniz belgeler. | — |
| kapsam (cevabın soruyu karşılaması), coverage | **soruyu karşılama** | Sorunuzdaki sözcüklerin, bulunan kaynaklarda ne ölçüde karşılık bulduğu. | — |
| kapsam manifestosu, Kapsam sayfası, kapsam ucu | **kaynak listesi — "Hangi kaynaklara bakabiliyoruz"** | ColleX'in bağlanmayı denediği bütün resmî kaynakların ve her birinin bugünkü durumunun listesi. | — |
| uç, ... ucu (endpoint), POST /v1/..., GET /v1/... | **kaldırılır — yerine özelliğin Türkçe adı ("Belge listesi", "Taslak oluşturma", "Süre takibi")** | — | Adres ve HTTP kodu yalnız katlanmış "Teknik ayrıntı" içinde: "(Destek için: <adres>, yanıt 404)". |
| sunucu, sunucu penceresi, bu sunucuda | **ColleX (ya da: bu bilgisayardaki program / bu kurulumda)** | ColleX'in bu bilgisayarda çalışan bölümü. | — |
| veritabanı, PostgreSQL, collex_local, yerel veritabanı | **kayıtlarınız (üst çubukta: Kayıtlarım)** | Dava dosyalarınızın, cevapların, taslakların ve ayarlarınızın bu bilgisayarda saklandığı yer. | PostgreSQL ve collex_local yalnız Ayarlar > Sistem durumu > Teknik ayrıntı içinde. |
| istek, istek gönderildi, istek başarısız | **soru / işlem ("Sorunuz gönderildi", "Cevap alınamadı")** | — | — |
| zaman aşımı, zaman aşımına uğradı, timeout | **süresinde cevap vermedi** | — | — |
| ızgara, Belge × soru ızgarası | **karşılaştırma tablosu — ekran adı: "Aynı soruyu birçok belgeye sor"** | Seçtiğiniz her belgeye aynı soruların tek tek sorulduğu, her satırı bir belge her sütunu bir soru olan tablo. | — |
| kanıt, kanıt kümesi, kanıt bağı | **kaynak / cevabın kaynakları / dayanak** | Kaynak: cevabın dayandığı belge ve ondan alınan alıntı. Dayanak: bir paragrafın belirli bir kaynağa bağlanmış olması. | — |
| kanıt paketi | **cevapla birlikte saklanan belge metinleri** | Bir cevap üretilirken kullanılan belgelerin, o andaki hâliyle saklanan tam metinleri. | — |
| şerit, arama şeridi, lane | **arama yöntemi** | Bir sorunun cevaplanması için yapılan ayrı arama biçimlerinden biri (madde numarasıyla arama, kelime benzerliğiyle arama gibi). | — |
| araç, araç envanteri, araç çağrısı | **kaynak bağlantısı / "Hangi kaynaklara ulaşabiliyoruz" / arama** | ColleX'in bir resmî kaynağa bağlanıp orada arama yapmasını sağlayan bağlantı. | Makine adları yalnız "Teknik ayrıntı" içinde; dışarıda "18 kaynak bağlantısı hazır" gibi tek satır. |
| bütçe, araştırma bütçesi, süre bütçesi | **arama için ayrılan süre ve arama sayısı** | Bir araştırmanın en çok ne kadar sürebileceği ve kaç arama yapabileceği sınırı. | — |
| ağ geçidi, kaynak geçidi, geçit, gateway | **resmî kaynaklara bağlantı** | ColleX'in UYAP karar arama sistemine ve kurumların resmî sitelerine bağlandığı yol. | — |
| jeton, token, giriş/çıkış jetonu | **kaldırılır** | — | Gerekiyorsa yalnız Teknik ayrıntı içinde "gönderilen metin uzunluğu / dönen metin uzunluğu". |
| ms, milisaniye, 4213 ms | **saniye ("4,2 saniye sürdü") ya da doğrudan sonuç cümlesi ("Taslak hazır.")** | — | — |
| Unicode, Unicode karakter sayımı, konum 1240–1533, offset | **belgedeki yeri: "belgenin başından itibaren 1240. ve 1533. harfler arası"** | Alıntının, belgenin başından sayarak kaçıncı harfte başlayıp kaçıncı harfte bittiği. | "Unicode" sözcüğü tamamen kaldırılır; sayılar yalnız Teknik ayrıntı içinde kalabilir. |
| CSV, CSV indir, CSV'yi panoya kopyala | **tablo — "Tabloyu indir (Excel'de açılır)" / "Tabloyu kopyala — Word veya Excel'e yapıştırın"** | — | İndirilen dosyanın adı da düzeltilmeli: izgara.csv yerine belge-soru-tablosu.csv. |
| Markdown | **düz metin (yedek kopya)** | — | — |
| OCR, Bulut OCR, AI OCR | **taranmış belgeyi metne çevirme** | Fotoğraf hâlindeki (taranmış) bir belgenin içindeki yazının okunup metne dönüştürülmesi. | — |
| Bulut AI | **Bulut AI — korunur, ama her geçtiği yerde tek satırlık açıklamasıyla** | Sorunuzun ve ilgili belge metninin, cevabı yazdırmak üzere ABD'deki Anthropic şirketine gönderildiği seçenek; varsayılan olarak kapalıdır. | Model adı (claude-...) üst çubuktan kaldırılır; yalnız Ayarlar > Teknik ayrıntı içinde. |
| dosya (yüklenen belge anlamında) | **belge** | Sizin ColleX'e yüklediğiniz PDF, Word ya da UYAP dosyası. | — |
| dosya, aktif dosya (dava dosyası anlamında) | **dava dosyası / seçili dava dosyası** | Üst çubuktan seçtiğiniz dosya; bundan sonra sorduğunuz sorular, yüklediğiniz belgeler ve yazdığınız taslaklar bu dosyaya işlenir. | — |
| görünüm, Araştır görünümü, Belgeler görünümü | **ekran** | — | — |
| dizine alınmadı, dizin, index | **aramaya girmedi / aramada çıkmaz** | — | — |
| metin katmanı yok, taranmış | **taranmış görüntü olduğu için içindeki yazı okunamadı** | — | — |
| kapsanmadı | **bu belgede bulunamadı** | Soru bu belgeye de soruldu, ama belgede karşılığı olan bir yer çıkmadı. | — |
| alaka kapısı, alaka kapısını geçen | **program tarafından ilgisiz bulunan kaynaklar** | ColleX'in, o paragrafla doğrudan ilgili görmediği için dayanak listesine koymadığı kaynaklar. | — |
| entailment, anlamsal bağ, skor, eşik | **uyum denetimi ("denetimi geçmeyen dayanaklar çıkarıldı")** | Bir cümlenin, dayandırıldığı alıntıyla gerçekten örtüşüp örtüşmediğinin ayrıca denetlenmesi. | — |
| citator, atıf zinciri, çözümleyici sürümü | **bu maddeyi değiştiren ya da kaldıran düzenleme** | Alıntılanan hükmün sonradan değiştirilip değiştirilmediğini gösteren bağlantı. | — |
| sezgisel çıkarım, kural tabanlı | **program belgeden okudu — kesin değildir / yapay zekâ kullanılmadı** | — | — |
| snippet, arama snippet'i | **arama sonucundaki kırpık satır** | Arama listesinde görünen kısa alıntı parçası; ColleX bunu dayanak olarak kullanmaz. | — |
| Merci (kaynak listesi başlığı olarak) | **Hangi kaynaklarda aransın?** | — | — |
| filtre, filtre desteklenmiyor | **daraltma** | Aramayı mahkeme, daire ya da tarihe göre sınırlamanız. | — |
| sorgu | **aranan kelimeler** | — | — |
| kova, üç kovalı, bu kovada satır yok | **başlık / bulundu — bulunamadı — bakılamadı üçlüsü** | — | — |
| migrasyon, şema eksik, migrasyon 13/13 | **kurulum tamamlanmadı — ColleX'i kapatıp yeniden açın** | — | Sürüm/migrasyon sayıları yalnız Ayarlar > Teknik ayrıntı içinde. |
| düştü (canlı araştırma düştü) | **kesildi — ColleX'i yeniden başlatın** | — | — |
| günlük, log, sunucu penceresindeki günlük | **siyah ColleX penceresindeki son satırlar** | — | — |
| pano, panoya kopyalandı | **kopyalandı — Word veya Excel'e yapıştırabilirsiniz** | — | — |
| v3, sürüm gösterimi "v" | **3. sürüm** | Her Kaydet işleminde oluşan yeni kayıt; eski sürümler silinmez. | — |
| izin listesi, izinli alan adı değil | **ColleX'in tanıdığı resmî adresler** | Bağlantının tıklanabilir yapıldığı, önceden tanınan resmî kaynak adresleri. | — |
| talimat kalıbı, talimat biçimli içerik | **metnin içinde, programa emir vermeye çalışır gibi görünen gizli yazı** | Kaynak metnin içine gizlenmiş, bilgisayara iş yaptırmayı deneyen ifadeler; ColleX bunları emir saymaz, metni de değiştirmeden gösterir. | — |
| araştırma izi | **Bu cevap nasıl bulundu** | Cevap hazırlanırken hangi resmî kaynaklarda arama yapıldığının ve hangi kararların tam metninin indirildiğinin dökümü. | — |
| kaynak kartı | **kaynak kartı — korunur, ama tanımıyla** | Cevabın altında, bir kaynağı ve ondan alınan birebir alıntıyı gösteren kutu. | — |
| K-1, K-2 (kaynak numarası) | **korunur — tanımıyla** | Cevap metninde köşeli parantezle gösterilen kaynak numarası; aşağıdaki kaynak kartlarından aynı numaralıyı açar. | — |
| Kanıtsız (yalnız beyan) | **Dayanak eklemeden yaz** | Bu seçenekte taslaktaki hiçbir cümle karar ya da mevzuat metnine bağlanmaz; belgede bunu belirten bir uyarı satırı yer alır. | — |
| harici no | **kurumdaki numarası** | — | — |
| belirsiz, UNCERTAIN, kapsamımızın dışında | **bakılamadı** | Bu atıf taramadığımız bir kaynağa ait olduğu için hakkında bir şey söylenemiyor. | — |
| kanonik, kanonik metin | **belgenin kayıtlı metni** | Belgenin ColleX'e yüklendiği andaki, hiç değiştirilmemiş hâli. | — |
| salt okunur, oturum, çip (arayüz anahtarı), model | **elle değiştirilemez / program açık kaldığı sürece / anahtar / (model adı kaldırılır)** | — | — |

## Yapısal işler

### [P0] Ekranda görünen terimler sözlüğü — fare ipucu tek tanım kaynağı olmaktan çıkarılmalı

**Sorun:** Ürünün merkezî terimlerinin (seçili dava dosyası, dayanağı yok, K-n, sürüm, deneysel, kaynak kartı) TEK tanımı defineTerm ile fareyle üzerine gelince çıkan title ipucunda. Bu ipucu dokunmatik ekranda hiç çıkmaz, klavyeyle gezene ulaşmaz, yazdırılan çıktıda görünmez ve kimse fareyi rastgele bekletmez. Tanımı hiç görünmeyen terim, tanımsız terimle aynıdır.

**Çözüm:** Her özel terimin yanına küçük, görünür ve tıklanabilir bir "?" işareti konsun; tıklanınca tanım, satırın altında açık metin kutusu olarak açılsın (title ipucu yedek olarak kalabilir). Ayrıca cevabın ve editörün altına katlanmış bir "Bu ekrandaki terimler ne demek?" bölümü eklensin; bu bölüm yukarıdaki kanonik sözlükten beslensin ve tek yerden yönetilsin.

### [P0] Tek bir "Teknik ayrıntı" kalıbı — makine çıktısı ana akıştan tümüyle çıkarılmalı

**Sorun:** Ham makine dizeleri doğrudan avukatın önünde: reddedilen atıf satırında ev-9f2a... (NOT_IN_EVIDENCE), ilişki satırında bölüm kimliği ve çözümleyici sürümü, kart altında (Teknik: /v1/... -> 404), yükleme hatasında (EXTRACTION_FAILED: pdf text layer empty), denetim ekranında NOT_YET_WIRED, arama envanterinde search_bedesten_unified. Ürünün kendi kuralı bunu yasaklıyor ama uygulanmamış.

**Çözüm:** Tek bir details.mini kalıbı tanımlansın: summary "Teknik ayrıntı — destek için", varsayılan kapalı. Kural: ekranda görünen her satır önce Türkçe tam cümledir; makine kodu, adres, kimlik, HTTP kodu, sürüm ve sayaç YALNIZ bu kabın içinde ve Türkçe cümlenin ardından parantezde durur. Ana akışta tek başına duran hiçbir kod kalmasın.

### [P0] Durum damgası sistemi baştan kurulmalı — dört damga + kesinleştirme satırı

**Sorun:** Cevabın en üstündeki iki ayrı damga sistemi de uydurma ve tanımsız: STATUS_TR (TAM / ŞERHLİ / KISMİ / ÇEKİMSER) ve FINALIZE_TR (KESİNLEŞTİRİLEBİLİR / KESİNLEŞTİRİLEMEZ). Avukat aynı anda iki damga görüyor, hangisine bakacağını bilmiyor; "kesinleşme" ve "şerh" hukukta bambaşka şeyler demek. Üstelik damga CSS'te all-small-caps ve açılmış harf aralığıyla, yani cevabın en kritik satırı en zor okunan biçimde çiziliyor.

**Çözüm:** Damgalar kanonik sözlükteki karşılıklarla değiştirilsin (KAYNAKLI / ÇEKİNCELİ / EKSİK CEVAP / CEVAP VERİLMEDİ). Kesinleştirme satırı damga olmaktan çıkarılıp tam cümleye çevrilsin. .verdict .fin için font-variant-caps: all-small-caps ve letter-spacing kaldırılsın, normal punto ve kalınlıkta yazılsın. Her damganın yanındaki açıklama cümlesi her zaman görünsün.

### [P0] Yazdırmada uyarılar siliniyor — kâğıda basılan nüsha uyarısız çıkıyor

**Sorun:** @media print kuralları .strip'i (dosyasız çalışma uyarısı, deneme verisi uyarısı) gizliyor; editör kipinde ayrıca .stamp (zorunlu kontrol bandı), #edissues (uyarı/eksik listesi) ve footer.note da kâğıttan kaldırılıyor. Avukat çıktıyı alıp dosyaya koyduğunda ya da müvekkile verdiğinde ekranda kendisini uyaran hiçbir şey kalmıyor; taslak son hâli gibi görünüyor.

**Çözüm:** .strip, .stamp, #edissues ve footer.note yazdırma gizleme listesinden çıkarılsın; kâğıtta sadeleşerek kalsın (beyaz zemin, siyah metin, ince siyah çerçeve, 12 punto). #edissues son sayfaya "KONTROL EDİLECEK NOKTALAR" başlığıyla bassın. Yalnızca hiçbir uyarı taşımayan bilgi şeritleri (.strip.mute) gizlenebilir.

### [P0] "Kapalı" görünen form ve kartlar gerçekten kapatılmalı, gerekçeleri okunabilir kalmalı

**Sorun:** form.gateoff yalnız %55 saydamlaştırılıyor: saydamlık tıklamayı ve yazmayı engellemez, avukat alanları doldurup düğmeye basıyor ve hiçbir şey olmuyor. Aynı anda formun neden kapalı olduğunu anlatan cümle de soluklaşıp okunamaz hâle geliyor. Devre dışı iş kartlarında da gerekçe zaten en soluk renkteyken üstüne %62 saydamlık biniyor; ayrıca gerekçe yazılınca kartın NE İŞE YARADIĞINI söyleyen satır tümüyle kayboluyor — kapalı kart hiçbir zaman öğretici olmuyor.

**Çözüm:** Gerçek kapatma eklensin (alanlarda disabled + pointer-events: none); saydamlık 0,75'e çıkarılsın; gerekçe satırı soluklaştırmanın DIŞINDA, tam opak tutulsun ve önüne sabit "Şu an kullanılamıyor — " öneki gelsin. İş kartında açıklama satırı her zaman kalsın, gerekçe onun ALTINA ayrı satır olarak eklensin.

### [P0] Takvim ve duruşma hazırlığı ekranlarında zorunlu süre uyarısı yok

**Sorun:** Takvim hesaplanmış süreleri tarihleriyle ve "3 gün kaldı / GECİKMİŞ" damgalarıyla gösteriyor; duruşma hazırlığı kartı açık süreleri listeliyor. İkisinde de hesabın bir öneri olduğunu ve asıl sürenin tebliğ tarihinden doğrulanması gerektiğini söyleyen tek satır yok. Avukat duruşmaya giderken bakacağı ekran budur.

**Çözüm:** Her iki ekrana da sabit ve gizlenemez tek satır: "Buradaki süreler ColleX'in hesabıdır; bağlayıcı değildir. Her süreyi dosyanızdaki tebliğ tarihinden ve ilgili maddeden doğrulayın." Takvimde ay başlığının hemen altına, duruşma hazırlığında "Açık süreler" listesinin altına konsun.

### [P0] Teknik arıza ile "sonuç yok" aynı cümleyle anlatılıyor

**Sorun:** Atıf denetiminde sunucu cevap veremediğinde ekranda "Atıflar bulunamadı" yazıyor; avukat metninde atıf olmadığını sanıyor. Aynı karışıklık "Araç çağrısı kaydı yok" (hiç arama yapılmadı mı, kaydı mı tutulmadı?) ve boş künye hücresinde de var. Bu, ürünün kendi ilkesinin ("bulamadı" ile "hiç çalışmadı" aynı şey değildir) doğrudan ihlali.

**Çözüm:** Her boş sonuçta üç durum ayrı cümlelerle ayrılsın: (1) arandı, bulunamadı; (2) aranamadı / arıza; (3) hiç aranmadı. Denetim ekranında arıza başlığı "Metin okunamadı" olsun ve altına "bu, metinde atıf olmadığı anlamına gelmez" cümlesi eklensin. Boş künye hücresine "künye okunamadı — elle bakınız" yazılsın; tablo altına "ColleX künye uydurmaz" açıklaması konsun.

### [P0] Alıntı ve uyarı metinleri görsel olarak zayıflatılmış

**Sorun:** Ürünün tek vaadini taşıyan alıntı bloğunun zemini (--quote-bg #f7f3e7) kart zeminine (#fcfaf4) karşı 1,06:1 kontrast veriyor — yani hiçbir fark yok; alıntıyı ayıran tek şey soldaki 3 px'lik iç gölge. Aynı anda dürüstlük uyarısını taşıyan .livebanner üç kanaldan birden zayıflatılmış: 13,5 px (gövdenin altında), italik ve soluk renk. İtalik bu dosyada yer tutucuda, dipnotta ve açıklamada da kullanıldığı için artık "önemsiz" demeye başlamış.

**Çözüm:** --quote-bg açık temada #f1eadb, koyu temada #16120e olsun; soldaki mühür şerit 4 px ve tam opak. Uyarı bandı: sol kenarda 4 px bronz şerit, gövde rengi, gövde boyu, normal (italik değil). Kural: italik yalnız alıntı ve yabancı sözcük için; uyarı metni hiçbir zaman italik olmasın ve gövde boyunun altına inmesin. Amaç: sayfaya bakan avukat hangi cümlenin karardan alındığını OKUMADAN görebilsin.

### [P0] Tıklanabilirlik yanlış işaretleniyor — üç ayrı "kart" dili var

**Sorun:** Tıklanamayan .card ile tıklanabilir button.tpl aynı "havalanma" efektini alıyor; üçüncü tıklanabilir kart (button.workcard) bambaşka davranıyor. Seçili şablon kendi seçim işareti yerine ODAK HALKASINI kullanıyor, dolayısıyla sekme tuşuyla gezen avukat her kartın sırayla "seçilmiş" gibi yandığını görüyor. Ayrıca tıklanabilir her ögenin kenarlığı --line (#e5ddcb) ile çiziliyor: panel üstünde 1,30:1, yani seçili olmayan mod hapı pratikte görünmüyor.

**Çözüm:** Tek kural: kalkıyorsa tıklanır, kalkmıyorsa tıklanmaz. .card:hover'dan transform kaldırılsın; kalkma efekti yalnız button.tpl ve button.workcard'da ve aynı biçimde kalsın. Tıklanabilir her ögenin kenarlığı --border olsun (rchip, themebtn, nav.views, ghost, rowdel, mchip, trace); --line yalnız süsleme çizgilerinde. Seçim RENK + KALIN KENARLIK + "Seçili" YAZISI olmak üzere üç kanaldan anlatılsın, odak halkası yalnız odağı anlatsın.

### [P0] Ölçüt yüzdeleri kaldırılmalı — açıklamasız "%100" doğruluk iddiası yaratır

**Sorun:** Beş ayrı ölçüt için çıplak yüzde gösteriliyor ve gerektiğinde "%100" de yazabiliyor. Ürün doğruluk yüzdesi iddia etmiyor; açıklamasız bir %100 tam da bu iddiayı yaratır. Yüzdenin neye göre hesaplandığı hiçbir yerde yazmıyor; ayrıca bilgi yalnız çubuk RENGİYLE taşınıyor (renk körlüğünde ayırt edilemez) ve sayı ekranın en küçük, en soluk yazısı.

**Çözüm:** Yüzde yerine üç kademeli sözel etiket ("güçlü / orta / zayıf") gösterilsin; ölçer başlığına "Bunlar kaynak eşleşmesinin gücünü gösterir; cevabın doğruluk oranı DEĞİLDİR." cümlesi eklensin. Kademe hem renkle hem sözcükle yazılsın. Aynı kural taslak editöründeki "anlamsal bağ %87" ve "Skor" sütunu için de geçerli.

### [P0] Silme işlemleri onaysız ve geri alınamaz

**Sorun:** Editörde "Sil" düğmesi paragrafı tek tıkla, onay sormadan yok ediyor ve "Yukarı/Aşağı" düğmelerinin hemen yanında duruyor. Karar arada kayıtlı arama "×" ile onaysız siliniyor. Taslak formunda taraf/olay satırı onaysız gidiyor. Taslaktan ayrılma onayı ise tarayıcının kendi penceresiyle soruluyor: düğmeler "Tamam/İptal" yazdığı için hangisinin yazılanı kaybettireceği belli değil.

**Çözüm:** Dosyada zaten var olan confirmDelete kalıbı her yıkıcı işlemde uygulansın; onay metni silinecek içeriğin ilk 60 karakterini göstersin. Düğmeler etiketlensin ("Paragrafı sil", "Sil", "Bu satırı sil"), düzen düğmelerinden boşlukla ayrılsın ve en sağda dursun. window.confirm yerine uygulamanın kendi onay kartı kullanılsın; düğmeler ne yapacağını söylesin: "Taslakta kal" (varsayılan) ve "Kaydetmeden ayrıl".

### [P0] Kayıtlı taslaklar kartı arama yazılınca kayboluyor (işleyiş hatası)

**Sorun:** renderTemplates ilk iş olarak kabın içini siliyor ve "Kayıtlı taslaklar" kartını bir daha eklemiyor. Avukat şablon arama kutusuna tek harf yazdığı ya da tür süzgecine bastığı anda üzerinde çalıştığı taslakların listesi ekrandan kayboluyor ve sayfa yenilenmeden geri gelmiyor. Taslağa dönüş yolu kayboluyor.

**Çözüm:** "Kayıtlı taslaklar" kartı #templates kabının DIŞINDA, kendi kabında dursun. Geçici çözüm olarak her renderTemplates çağrısının ardından renderSavedDrafts() çağrılsın.

### [P0] Karşılama kartı mühendis diliyle açılıyor

**Sorun:** Avukatın ColleX'te okuduğu İLK paragrafta "SHA-256", "özet", "tespit" ve "KAYNAKSIZ" geçiyor; kartın son satırı "Sistem: veritabanı ..." ile başlıyor ve veri gelmezse "?" basıyor. İlk ekranda dört anlaşılmaz sözcük görmek programı kapattırır.

**Çözüm:** Karşılama metni kanonik sözlükle yeniden yazılsın. Durum satırı tek cümleye insin: "Program çalışmaya hazır: kayıtlarınız bu bilgisayarda tutuluyor." Ayrıntılı sistem durumu yalnız Ayarlar ekranında kalsın; "?" yedeği hiç basılmasın.

### [P1] İki ayrı tipografi sistemi ve 13 px altı yazılar

**Sorun:** Dosyada iki :root bloğu var: ilk bölgedeki yirmiden fazla elle yazılmış piksel değeri, 1698. satırdaki bir "düzeltme bloğu" tarafından sessizce eziliyor; ölçek jetonları ise ikinci bir :root'ta duruyor. Sonuç: aynı seviyedeki başlık bir ekranda 17 px bir ekranda 22 px; ayrıca hâlâ yayında olan 10,5–12,5 px satırlar var (takvim ögeleri, ölçer değerleri, künye satırları, satır düğmeleri). Bir sayfada bir sayıyı değiştiren kişi ekranda hiçbir şey değişmediğini görüyor.

**Çözüm:** İki :root birleştirilsin, düzeltme bloğu dağıtılıp silinsin; bir ögenin boyu dosyada TEK yerde, kendi kuralında yazılsın. Tek sınır: ekranda 13 px'in altında hiçbir şey yazılmaz; düğmeler en az 14 punto ve 34 px yükseklikte olsun. Hiçbir metin ögesinde satır yüksekliği 1,2'nin altına inmesin — Türkçe Ş, Ç, Ğ harflerinin kuyrukları kırpılıyor.

### [P1] Boş durumlar yol göstermiyor

**Sorun:** Boş ekranda 92 px boşluk + 62 px'lik dev bir "§" işareti yer kaplıyor; asıl iş gören talimat cümlesi onun altında 14 px ve en soluk renkte. Yani ekranın en büyük ögesi anlamsız, en küçüğü talimat. Aynı kusur "Şablon tanımlı değil", "Bölüm yok", "Bilinen boşluklar", "kayıtlı araştırma yok" gibi birçok boş durumda tekrar ediyor: durum bildiriliyor, çözüm söylenmiyor. Bazı boş durumlar ise seçilebilir seçenek kılığında.

**Çözüm:** Süsleme kaldırılsın (.placeholder .mark { display: none; }), talimat büyütülsün (18 px, gövde rengi, en çok 34em). Kural: her boş durum üç şeyi söyler — ne yok, neden yok, şimdi ne yapılmalı. Boş liste asla seçilebilir bir seçenek kılığına girmesin (disabled olsun).

### [P1] Bilgi yalnız renkle taşınıyor

**Sorun:** Aciliyet rozetleri (.days.orange / .days.red) yalnız renk değiştiriyor; denetim durumu (bulundu / bulunamadı / kontrol edilemedi) yalnız renkle ayrılıyor ve "kontrol edilemedi" ekranın EN SOLUK rengiyle çiziliyor — oysa avukatın elle bakması gereken tek satır odur. Bölüm durumu göstergesi de yalnız renkli noktalarla anlatılıyor. Erkeklerin yaklaşık %8'i kırmızı-yeşil ayrımı yapamıyor.

**Çözüm:** Hiçbir durum yalnız renkle anlatılmasın: her rozetin yanında sözcük dursun ("3 GÜN — ACİL", "Bulundu", "Bulunamadı", "Bakılamadı"). "Bakılamadı" normal koyulukta metin + içi boş halka ile çizilsin. Bölüm göstergesinin açıklaması yazıyla verilsin.

### [P1] Belge kartındaki altı düğme aynı ağırlıkta ve "dosya" iki anlamda

**Sorun:** Her belge kartında altı düğme eşit ağırlıkta yan yana: Belgeye sor · Tam metni aç · Bu dosyayla araştır · Taslakta kullan · Dosyaya ekle · Sil. "Belgeye sor" ile "Bu dosyayla araştır" arasındaki fark ekrandan anlaşılmıyor; "Dosyaya ekle"deki dosya dava dosyası, "Bu dosyayla araştır"daki dosya ise yüklenen belge. Aynı yığılma taslak editöründeki paragraf araç çubuğunda da var.

**Çözüm:** Düğmeler ikiye ayrılsın: birincil satırda "Bu belgeye soru sor" ve "Tam metnini aç"; ikincil (soluk) satırda "Sorularımda bu belgeyi kullan", "Dilekçe yazarken kullan", "Dava dosyasına bağla", "Sil". Yüklenen belge için hiçbir etikette "dosya" sözcüğü kullanılmasın. Editörde de içerik işleri solda, düzen işleri sağda ve aralarında belirgin boşlukla dursun.

### [P1] Bulut AI ve KVKK bilgisi görünmez yerlerde duruyor

**Sorun:** Ülke dışına veri gönderildiği bilgisi birkaç yerde yalnız fare ipucunda (title) saklı; onay penceresi ham alan adını (useCloudAi) ve "çip" sözcüğünü gösteriyor; üst çubukta ham model adı duruyor. Bu, avukatın onay vermeden önce mutlaka görmesi gereken bilgidir.

**Çözüm:** Bulut AI anahtarının altına kalıcı, küçük punto tek satır: kapalıyken ne olduğu, açıkken tam olarak neyin kime gittiği. Düğme etiketi de bunu söylesin ("Bu paragrafı Bulut AI'ya yazdır — metin dışarı gönderilir"). Onay penceresinden useCloudAi, "çip" ve model adı çıkarılsın. Model adı üst çubuktan kaldırılıp Ayarlar > Teknik ayrıntı'ya alınsın.

### [P1] Uzun işlemlerde ilerleme kartı ve çalışan bir "Vazgeç" yok

**Sorun:** Taslak üretimi en uzun süren işlemlerden biri ama ekranda küçük bir gri satır ve ince bir çizgiden başka bir şey yok; vazgeçme düğmesi yok, ne kadar süreceğine dair bir söz de yok — avukat sayfayı kapatmaya yöneliyor. Bitince de sonuç yerine "1843 ms" yazıyor.

**Çözüm:** Dosyada zaten var olan ilerleme kartı taslak üretiminde de çağrılsın: aşama cümlesi ("Şablon dolduruluyor", "Kaynaklar bağlanıyor"), geçen süre ve gerçekten çalışan bir "Vazgeç". Yüzde gösterilmesin. Bitince ölçüm değil sonuç yazılsın: "Taslak hazır."

### [P1] Metin sessizce kırpılıyor ve tabloların kaydırılabildiği söylenmiyor

**Sorun:** Karar künyesi tek satıra zorlanıp üç noktayla kesiliyor (esas numarasının yarısı gidiyor); şablonun ne işe yaradığını söyleyen tek cümle tek satıra kırpılıyor; kanıt alıntısı 180 piksellik bir kutuda kayıyor ve taştığına dair hiçbir işaret yok; belge seçme listesi 240 pikselde bitiyor. Geniş tablolar yatay kayıyor ama Windows'ta kaydırma çubuğu ancak fare üzerine gelince beliriyor; ipucu ise yalnız 900 px altında görünüyor, oysa denetim tablosu 940 px'e kadar taşıyor.

**Çözüm:** Künye ve şablon amacı iki satıra izinli olsun (-webkit-line-clamp: 2), üç nokta yerine satır sonunda kessin. Kaydırılabilir her kutunun kenarına solma (mask-image / kenar gradyanı) ve "devamı var" satırı eklensin. Listelerin başına sayım konsun. Tablo ipucu eşiği 1000 px'e çekilsin ya da her zaman görünsün. Tablo başlıklarındaki text-transform: uppercase kaldırılsın — Türkçede noktalı i'yi bozuyor (İÇTİHAT yerine ICTIHAT).

### [P1] Bildirimler okunmadan kayboluyor, hatalar boş durum gibi görünüyor

**Sorun:** Bildirimler 3,6 saniyede kayboluyor ve kapatma düğmesi yok; uzun bir uyarı okunmadan siliniyor. Ayrıca bağlantı hatası birçok yerde boş durum satırı biçiminde (soluk gri) yazılıyor; avukat bunu "kayıt yok" sanıp geçiyor, oysa liste alınamadı.

**Çözüm:** Hata tonlu bildirim (tone === "bad") kendiliğinden kaybolmasın, sağına "Kapat" düğmesi konsun; bilgi bildirimleri 6000 ms'ye çıkarılsın. Hata her zaman hata kartıyla (errCard) çizilsin, boş durum satırıyla asla karıştırılmasın.

### [P1] Aynı liste ekranda üç ayrı adla anılıyor

**Sorun:** Kayıtlı araştırmalar listesi bir yerde "Kayıtlı araştırmalarım", bir yerde "Kayıtlı cevaplar", bir yerde "Araştırmalar sekmesi" olarak geçiyor. Avukat üç ayrı yer arıyor. Aynı tutarsızlık "parça/bölüm" ve "dosya/belge" çiftlerinde de var; ayrıca "Belge bırakın veya seçin" diyen alan boş durumda "tepsi" olarak anılıyor.

**Çözüm:** Her ekranın, listenin ve düğmenin adı tek yerde tanımlansın ve o adla anılsın. Bir metin başka bir ekrana gönderme yapıyorsa, o ekranın ekrandaki GERÇEK adını kullansın. Kanonik sözlük bu ekran ve düğme adlarını da kapsasın.

### [P1] Izgarada altı soru sınırı sessizce uygulanıyor

**Sorun:** Avukat kutuya sekiz soru yazarsa son ikisi hiçbir uyarı olmadan atılıyor; tabloda o sütunlar hiç çıkmıyor ve avukat sorduğunu sandığı soruların cevapsız kaldığını fark etmiyor. Ekranda "en çok 6 soru" bilgisi de yok.

**Çözüm:** Kutunun üstüne sabit satır: "Her satıra bir soru yazın — en çok 6 soru." Fazla satır varsa kırpmadan önce görünür uyarı çıksın: "En çok 6 soru sorulabilir; ilk 6 satır kullanıldı, sonrakiler tabloya alınmadı."

### [P1] Ölçülmemiş bilgi ölçülmüş gibi gösteriliyor

**Sorun:** Resmî kaynak çipinde tarih-saatin yalnız son beş karakteri, yani saat gösteriliyor: üç ay önce çekilmiş bir karar "alınma 14:22" görünüyor ve avukat güncellik değerlendirmesi yapamıyor. Karar arada kaynak seçilmemişken ekran "Sorgulanan kaynaklar: Yargıtay · Danıştay" diye bir varsayım yazıyor — bu bir ölçüm değil. Süre kartı "30 usul kuralı" ve "her sonuç DOĞRULANMADI etiketiyle gelir" diyor; ikisi de ürünün kendi verisiyle uyuşmuyor.

**Çözüm:** Tam tarih yazılsın ("03.09.2026 tarihinde alındı"). Kaynak seçilmemişken varsayım listesi hiç yazılmasın; hangi kaynakların cevap verdiği sonuç geldiğinde bildirilsin. Kart metinlerindeki sayi iddiaları gerçek veriyle karşılaştırılıp düzeltilsin ya da sayı verilmeden yazılsın. Kural: ölçülmemiş her alanda "bilinmiyor" yazılır, sıfır ya da tahmin yazılmaz.

### [P2] Dar ekran (telefon) düzeni kullanılamaz durumda

**Sorun:** Dar ekranda takvim ögesi 10,5 puntoya iniyor ve 7 sütunlu ızgarada hücre ~50 piksel kalıyor: her öge 4-5 harf gösteriyor, avukat yalnız renkli çizgiler görüyor. Dosya kartı etiketleri small-caps ve 12,5 punto (Türkçede noktalı i bozuluyor). Üst çubukta 481-640 px arasında açıklanamayan boş bir satır oluşuyor. Dosya tablosu satırları karta dönüşünce hiçbir "aç" işareti kalmıyor.

**Çözüm:** Dar ekranda ay ızgarası yerine listeye geçilsin (14 punto tarih + dosya adı + kalan gün). Kart etiketlerinde small-caps kaldırılsın, en az 13 punto olsun. Boş grid alanı kaldırılsın. Kart görünümünde altına tam genişlikte "Dosyayı aç" düğmesi eklensin.

## En önemli 30 metin değişikliği

- **Mevcut:** DENEME KORPUSU (sentetik deneme belgeleri) — bu sunucu sentetik deneme belgeleriyle çalışıyor; hiçbir sonuç gerçek hukukî değerlendirme değildir.
  **Yeni:** DENEME MODU — Bu kurulumda gerçek mahkeme kararı ve mevzuat yok; sınama için yazılmış örnek metinler var. Ekranda çıkan hiçbir sonucu bir dosyada kullanmayın.
  **Neden:** Ürünün en kritik uyarısı üç bilinmeyen sözcükle açılıyor: KORPUS, sentetik, sunucu. Anlaşılmayan bir damga avukatı durdurmaz; burada durdurmaması gerçek bir zarar demektir. Aynı metin hem DEMO_CORPUS_TEXT sabitinde hem HTML gövdesinde geçiyor, ikisi de düzeltilmeli.

- **Mevcut:** KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır
  **Yeni:** Bu cevaptaki alıntıların hepsi kaynağıyla karşılaştırıldı ve aynı çıktı. Hukukî değerlendirme size aittir.
  **Neden:** "Kesinleştirilebilir" ekranın en görünür damgası ve hiçbir yerde tanımı yok; avukat "kesinleşme"yi kararın kesinleşmesi olarak bilir. "Teknik kontrol" de neyin kontrol edildiğini söylemiyor. Damga kaldırılıp ne yapıldığını söyleyen tam cümleye çevrilmeli.

- **Mevcut:** KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan kullanmayın
  **Yeni:** En az bir alıntı kaynağıyla eşleşmedi — bu cevabı olduğu gibi kullanmayın; aşağıdaki gerekçeleri okuyup kaynakları kendiniz açın.
  **Neden:** Aynı tanımsız damganın olumsuzu. "En az bir doğrulama başarısız" hangi doğrulamanın neden başarısız olduğunu söylemiyor; avukat ne yapması gerektiğini öğrenemiyor.

- **Mevcut:** COMPLETE: ["TAM", "ok", "✓", "Tüm tespitler doğrulanmış kaynağa bağlı."],
  **Yeni:** COMPLETE: ["KAYNAKLI", "ok", "✓", "Cevaptaki her maddenin bir kaynağı var ve alıntılar kaynağıyla aynı çıktı; hukukî değerlendirme size aittir."],
  **Neden:** "TAM" tek başına bir doğruluk iddiası gibi okunur; oysa ürün doğruluk iddia etmiyor, yalnız her cümlenin bir kaynağa bağlandığını söylüyor. "Tespit" de tanımsız.

- **Mevcut:** QUALIFIED: ["ŞERHLİ", "warn", "§", "Tespitler kaynaklı; çekince veya çelişen otorite var."],
  **Yeni:** QUALIFIED: ["ÇEKİNCELİ", "warn", "§", "Her maddenin kaynağı var; ancak aksi yönde karar ya da çekince de bulundu — kararı okumadan dayanak yapmayın."],
  **Neden:** "Şerhli" hukukta tapu şerhi ya da karara şerh demektir; burada kastedilen bambaşka bir şey. "Otorite" de bu bağlamda avukat dili değil.

- **Mevcut:** PARTIAL: ["KISMİ", "bad", "!", "Bazı tespitler doğrulanamadı; cevap kesinleştirilemez."],
  **Yeni:** PARTIAL: ["EKSİK CEVAP", "bad", "!", "Cevabın bir bölümü kaynağa bağlanamadı — bu hâliyle dilekçeye koymayın."],
  **Neden:** "KISMİ" neyin kısmi olduğunu söylemiyor (kaynak mı, cevap mı, süre mi); açıklaması ise tanımsız iki terimle (tespit, kesinleştirilemez) yine tanımsız bir terime gönderme yapıyor.

- **Mevcut:** ABSTAIN: ["ÇEKİMSER", "abstain", "—", "Yeterli doğrulanabilir kaynak yok."]
  **Yeni:** ABSTAIN: ["CEVAP VERİLMEDİ", "abstain", "—", "Bu soruya dayanak olacak kaynak bulunamadı; ColleX uydurmamak için bilerek cevap üretmedi."]
  **Neden:** "Çekimser" hukukta oy için kullanılır; bir cevabın çekimser kalması avukat için anlamsızdır. Ürünün en dürüst davranışı, en anlaşılmaz sözcükle anlatılıyor.

- **Mevcut:**     "Bu cevap KESİNLEŞTİRİLEMEZ: aşağıdaki gerekçeleri okumadan kullanmayın.";
  **Yeni:**     "Bu cevabı olduğu gibi kullanmayın: aşağıdaki gerekçeleri okuyun ve kaynakları kendiniz açın.";
  **Neden:** Uyarılar kartının giriş cümlesi tanımı olmayan bir damgayla açılıyor. Avukatın burada okuması gereken tek şey "bu cevabı olduğu gibi dilekçeye koyma" uyarısıdır.

- **Mevcut:** Alıntı parmak izi (SHA-256) 
  **Yeni:** Bu alıntının bozulmadığını denetlemeye yarayan kod — alıntıda tek harf değişse bu kod da değişir: 
  **Neden:** Ürünün EN DEĞERLİ vaadi bu satırda saklı ve avukatın bilmediği iki sözcükle söyleniyor. Kart altında görünen tek satır "Bu alıntının karardaki metinle birebir aynı olduğu denetlendi. [Denetim kaydını göster]" olmalı; 64 haneli dizi katlanmış Teknik ayrıntı içine alınmalı.

- **Mevcut:**  Belge parmak izi (SHA-256) eşleşti.
  **Yeni:**  Aşağıdaki metin, cevabın hazırlandığı andaki belgeyle bire bir aynı; ColleX bunu kendiliğinden denetledi.
  **Neden:** Avukatın en çok güven araması gereken yer burası: belgenin tam metnini açtığında çıkan doğrulama satırı. Anlamadığı bir güvenceye güvenmez. Teknik doğruluk "metnin bozulmadığı otomatik denetlendi" denerek tamamen korunur.

- **Mevcut:** ⚠ Belge parmak izi (SHA-256) EŞLEŞMEDİ — bu metni kullanmayın; belgeyi yeniden yükleyin, 
  **Yeni:** ⚠ Bu belge, cevabın hazırlandığı andaki hâliyle aynı değil — dosyada bir değişiklik olmuş. Bu metni dilekçede kullanmayın; belgeyi Belgeler ekranından yeniden yükleyip soruyu tekrar sorun. 
  **Neden:** Ürünün en ciddi uyarısı ve tam burada dört anlaşılmaz sözcük var: SHA-256, parmak izi, sunucu penceresi, günlük. Devam cümlesindeki "sunucu penceresindeki günlüğü saklayın" da uygulanamaz bir talimat; "siyah ColleX penceresindeki son satırların ekran görüntüsünü alın" olmalı.

- **Mevcut:** <span>Yerel korpus</span>
  **Yeni:** <span>Bu bilgisayardaki arşiv</span>
  **Neden:** Bu, ekranın VARSAYILAN seçeneğidir: avukat programın neyi tarayacağını ilk saniyede anlayamıyor. Altına küçük punto açıklama da eklenmeli: "bu bilgisayara önceden yüklenmiş karar ve mevzuat metinleri; internete çıkılmaz".

- **Mevcut:** <div class="fieldlabel">Kapsam</div>
  **Yeni:** <div class="fieldlabel">Nerede aransın?</div>
  **Neden:** "Kapsam" bu dosyada üç ayrı anlamda kullanılıyor (arama kaynağı, Ayarlar'daki kaynak listesi, cevabın soruyu karşılaması). Aynı sözcüğün üç anlamı avukatı doğrudan yanıltır; buradaki alan bir soruya cevap veriyor, o soru yazılmalı.

- **Mevcut:** Belgelerinizi ve mevzuatı tarar, her tespiti belge sürümü ve SHA-256 
  **Yeni:** Belgelerinizi ve mevzuatı tarar; yazdığı her maddenin altına alıntının hangi belgeden alındığını koyar ve alıntının bozulmadığını kendiliğinden denetler. Süreleri hesaplar, dilekçe taslağı yazar. Dayanağı olmayan cümleyi ayrıca işaretler.
  **Neden:** Bu, ürünü ilk kez açan avukatın gördüğü İLK paragraf ve içinde dört anlaşılmaz sözcük var: SHA-256, özet, tespit, KAYNAKSIZ. İlk ekranda bu yoğunlukta jargon görmek programı kapattırır. Sabitin devamındaki iki satır da birlikte değiştirilmeli.

- **Mevcut:** Dosyalarınız, cevaplar, taslaklar, dava dosyaları ve ayarlar bu bilgisayardaki yerel PostgreSQL veritabanında (<span id="wheredb">collex_local</span>) tutulur;
  **Yeni:** Dava dosyalarınız, cevaplar, taslaklar ve ayarlarınız yalnız bu bilgisayarda saklanır; hiçbiri internete gönderilmez.
  **Neden:** "PostgreSQL", "veritabanı" ve "collex_local" avukat için hiçbir şey ifade etmiyor. Avukatın öğrenmek istediği tek şey: dosyalarım bu bilgisayarda mı, hangi klasörde. Klasör yolu cümlenin devamında sade Türkçeyle verilmeli; makine adı yalnız Ayarlar > Teknik ayrıntı satırında kalmalı.

- **Mevcut:** Her kart, bu sunucuda bugün çalışan bir uca sabit bir istek gönderir. Çalışmayan bir iş burada kart olarak görünmez.
  **Yeni:** Aşağıdaki kartlar bugün çalışır durumda olan işlerdir. Çalışmayan bir iş kart olarak hiç gösterilmez; böylece boşuna tıklamış olmazsınız.
  **Neden:** Tek cümlede üç yazılım terimi: sunucu, uç, istek. Cümle ayrıca avukata ne yapması gerektiğini değil programın içini anlatıyor.

- **Mevcut:**       k.textContent = "KAYNAKSIZ: " + n;
  **Yeni:**       k.textContent = n === 0 ? "Dayanağı olmayan paragraf yok" : "Dayanağı olmayan paragraf: " + n;
  **Neden:** Editör üst çubuğundaki bu sayaç belgenin en önemli göstergesi ama neyi saydığını söylemiyor: "KAYNAKSIZ: 3" avukata hiçbir şey ifade etmez.

- **Mevcut:**     var badge = defineTerm(el("span", "kaynaksiz", "⚠ KAYNAKSIZ"), "KAYNAKSIZ");
  **Yeni:**     var badge = el("span", "kaynaksiz", "⚠ Dayanağı yok — alıntı ekleyin");
  **Neden:** "KAYNAKSIZ" uydurulmuş bir damga; tek açıklaması fareyle üzerine gelince çıkan gizli baloncukta, yani dokunmatik ekranda ve klavyeyle hiç görünmüyor. Avukat büyük harfli kırmızı bir uyarı görüyor, ne yapması gerektiğini anlamıyor.

- **Mevcut:** <span class="t">Veritabanı</span>
  **Yeni:** <span class="t">Kayıtlarım</span>
  **Neden:** Üst çubukta her ekranda görünen ilk rozet bu; avukatın gördüğü ilk sözcük anlamadığı bir sözcük oluyor. Rozetin ipucu metni de ne yapması gerektiğini söylemeli: "Dosyalarınızın ve cevapların saklandığı yer çalışıyor mu — ayrıntı için tıklayın".

- **Mevcut:**   var DB_STATE_TR = { ok: "bağlı", missing: "şema eksik", down: "kapalı", off: "yok" };
  **Yeni:**   var DB_STATE_TR = { ok: "çalışıyor", missing: "kurulum tamamlanmadı — ColleX'i kapatıp yeniden açın", down: "açılmadı", off: "kurulu değil" };
  **Neden:** "Şema eksik" saf mühendis dilidir; avukat için hiçbir anlamı yok ve ne yapacağını da söylemiyor. "Bağlı" ve "yok" da neye bağlı olduğunu söylemiyor. Bu değerler üst çubukta sürekli görünüyor.

- **Mevcut:** <button type="submit" class="seal" id="go">Ara ve doğrula</button>
  **Yeni:** <button type="submit" class="seal" id="go">Cevabı hazırla</button>
  **Neden:** Düğme neyin doğrulanacağını söylemiyor; avukat "doğrulanmış cevap" gibi bir garanti bekleyebilir. Oysa doğrulanan şey alıntının kaynağıyla birebir aynı olmasıdır. Yanına küçük punto: "Her alıntı, alındığı belgeyle karşılaştırılarak gösterilir."

- **Mevcut:** <h2 class="fname" id="gridtitle" tabindex="-1">Belge × soru ızgarası</h2>
  **Yeni:** <h2 class="fname" id="gridtitle" tabindex="-1">Aynı soruyu birçok belgeye sor</h2>
  **Neden:** "Izgara" uydurulmuş bir terim, "×" ise matematik gösterimi. Avukat başlığa bakıp ekranın ne işe yaradığını anlayamıyor. Alt satır eklenmeli: "Bir tabloda, her belge için ayrı ayrı cevap alırsınız."

- **Mevcut:**     metaRow(list, "Parmak izi (SHA-256)", shortHash(f.sha256));
  **Yeni:**     metaRow(list, "Değişmezlik denetimi", "Bu belgenin içeriği yüklendiği andaki hâliyle kaydedildi; alıntılarınız her seferinde bu asıl metinle karşılaştırılır.");
  **Neden:** Belge künyesinin EN ÜST satırı bu ve yanında "a3f9c1e02b74…" gibi bir dizi duruyor. Avukat ilk bakışta ekranın kendisi için yazılmadığını düşünüyor. Hemen altındaki "48213 karakter · 62 bölüm" satırı da kaldırılıp Teknik ayrıntı'ya alınmalı.

- **Mevcut:** Belgeler bu bilgisayarda işlenir; yalnız siz Bulut AI / Bulut OCR seçerseniz Anthropic'e gönderilir.
  **Yeni:** Belgeler bu bilgisayarda açılır ve yazısı burada çıkarılır; internete hiçbir şey gönderilmez. Tek istisna: taranmış (fotoğraf hâlindeki) bir belgeyi okutmak için bulut yapay zekâyı (Bulut AI) siz açarsanız, yalnız o belgenin metni ABD'deki Anthropic şirketine gönderilir; bu seçenek varsayılan olarak kapalıdır.
  **Neden:** "OCR" ve "Anthropic" tanımsız; avukat müvekkil belgesinin nereye gittiğini anlamadan yükleme yapamaz. Bu cümle KVKK açısından ekranın en önemli cümlesidir ve anlaşılır olmak zorundadır.

- **Mevcut:**       "$1 kaynak çağrısı zaman aşımına uğradı; sonuç eksik olabilir."],
  **Yeni:**       "$1 kaynak süresinde cevap vermedi; sonuç eksik olabilir — biraz sonra yeniden deneyin."],
  **Neden:** "Zaman aşımı" bir avukat için mutlaka TBK/TCK anlamındaki zamanaşımıdır; burada kastedilen kaynağın geç cevap vermesidir. Arayüzdeki yanlış anlaşılmaya en açık cümle. Aynı düzeltme bir alt satırdaki "Kaynak sunucu zamanında cevap vermedi; bazı çağrılar zaman aşımına uğradı." için de yapılmalı.

- **Mevcut:**       section(out, "Tespitler", "sec-tespitler", "Tespitler");
  **Yeni:**       section(out, "Cevap — kaynağa bağlı maddeler", "sec-tespitler", "Cevap maddeleri");
  **Neden:** "Tespit" bu üründe claim karşılığı kullanılıyor ve ekranda tanımı yok. Avukat "tespit" deyince mahkemenin tespitini ya da delil tespitini anlar; burada kastedilen, ColleX'in kaynağa bağladığı cümlelerdir. Bölüm başlığı bu yanlış anlamayı büyütüyor.

- **Mevcut:**       ab.appendChild(el("h3", null, "ÇEKİMSER — cevap üretilmedi"));
  **Yeni:**       ab.appendChild(el("h3", null, "Cevap verilmedi — dayanak bulunamadı"));
  **Neden:** "Çekimser" hâkimin çekinmesini çağrıştırıyor ve kastedilen bu değil. Başlığın kendisi terimi açıklamıyor; açıklama bir alttaki cümlede saklı kalıyor.

- **Mevcut:**       box.appendChild(el("div", "quote-label", "Kanonik metinden birebir alıntı"));
  **Yeni:**       box.appendChild(el("div", "quote-label", "Belgenin kayıtlı metninden harfi harfine alınmıştır"));
  **Neden:** "Kanonik" ne hukuk ne günlük Türkçe terimidir; ekranda hiçbir yerde tanımı yok. Avukat satırı okuyup atlıyor, oysa satır "bu metne dokunulmadı" demek istiyor. Aynı sözcük kaynak bölümü girişinde de geçiyor, orası da düzeltilmeli.

- **Mevcut:**       line: "Yerel korpusta arar; her tespiti belge sürümü, Unicode konumu ve SHA-256 ile bağlar.",
  **Yeni:**       line: "Bu bilgisayardaki karar ve mevzuat arşivinde arar; verdiği her cevap maddesinin altına alındığı belgeyi, o belgedeki tam yeri ve birebir alıntıyı koyar.",
  **Neden:** Ürünün ANA iş kartının tek açıklama satırı bu ve içinde avukatın bilmediği dört şey var: korpus, tespit, Unicode konumu, SHA-256. Avukat bu satırı okuyunca kartın ne yaptığını değil, kendisine yabancı bir şey olduğunu anlıyor.

- **Mevcut:** <p class="tagline">Yargı &amp; Mevzuat Kanıt Sistemi</p>
  **Yeni:** <p class="tagline">Karar ve mevzuat araştırması — her alıntı kaynağıyla birlikte</p>
  **Neden:** "Kanıt Sistemi" mühendis adlandırmasıdır ve "&" işareti Türkçe metinde yabancı durur. Marka adının hemen altındaki bu satır avukata ürünün ne yaptığını söylemiyor.
