# html-govde

Bu bölge avukatın ilk gördüğü metindir ve bugünkü hâliyle mühendis diliyle yazılmıştır. En ağır kusurlar üç yerde toplanıyor: (1) "korpus", "sunucu", "uç", "istek", "parça", "veritabanı", "PostgreSQL", "collex_local", "POST /v1/answer", "CSV", "OCR", "Anthropic", "özyinelemeli" gibi sözcükler doğrudan ekranda; (2) ürünün temel ayrımı olan "yerel arşiv / canlı resmî kaynaklar / benim belgelerim" seçimi "Kapsam" başlığı altında ve "Yerel korpus" etiketiyle sunulduğu için avukat neyin taranacağını bilemiyor; (3) "Bulut AI", "ızgara", "kapsanmadı", "Kanıtsız (yalnız beyan)", "Merci", "Bu penceredeki kayıtlar" gibi ürüne özgü terimler ekranda hiçbir yerde tanımlanmıyor. Ayrıca birkaç açıklama yalnız tooltip (title) içinde durduğu için görünmüyor; Taslak ve Sistem durumu ekranları boş durumda hiçbir şey anlatmıyor; "Dosyayı aç", "Ara ve doğrula" gibi buton etiketleri sonucun ne olacağını söylemiyor. Teknik doğruluk kaybedilmeden düzeltilebilir: alıntının bozulmadığının otomatik denetlendiği, belgelerin bu bilgisayarda kaldığı ve arama sonucunun kanıt sayılmadığı hepsi jargonsuz anlatılabilir. Aşağıdaki 36 bulgu önem sırasındadır.

Bulgu: 36

## [P0] jargon — satir 2201

**Mevcut:**
```
<span class="t">Veritabanı</span>
```

**Neden:** "Veritabanı" avukat için anlamsızdır; rozetin yeşil ya da kırmızı olması hâlinde ne yapacağını da söylemiyor.

**Öneri:**
```
<span class="t">Kayıtlar</span> (ipucu metni: Dosyalarınızın ve cevapların saklandığı yer çalışıyor mu — ayrıntı için tıklayın)
```

## [P0] eksik-aciklama — satir 2231

**Mevcut:**
```
<b>Veri kaynağı</b> — <span class="notice-text" id="corpus-notice">bu sunucudaki belge deposuna ilişkin uyarı, ilk cevapla birlikte burada görünecek</span>
```

**Neden:** Hem "sunucu" ve "belge deposu" jargon, hem de yer tutucu metin avukata kendi kendini anlatıyor ("burada bir uyarı görünecek"). Ekranın en üstündeki ilk cümle boş bir vaat olamaz.

**Öneri:**
```
<b>Neye göre cevap veriliyor?</b> — Şu an hangi kaynaklara bakıldığı, ilk sorunuzu sorduğunuzda burada yazacak.
```

## [P0] jargon — satir 2233

**Mevcut:**
```
DENEME KORPUSU (sentetik deneme belgeleri) — bu sunucu sentetik deneme belgeleriyle çalışıyor; hiçbir sonuç gerçek hukukî değerlendirme değildir.
```

**Neden:** "KORPUS" ve "sentetik" hiçbir avukatın bilmediği kelimelerdir; "sunucu" da öyle. Oysa bu uyarı ürünün en kritik uyarısıdır ve mutlaka anlaşılmalıdır.

**Öneri:**
```
DENEME MODU — Bu kurulumda gerçek mahkeme kararları ve mevzuat değil, sınama için yazılmış örnek metinler var. Ekranda çıkan hiçbir sonucu bir dosyada kullanmayın.
```

## [P0] jargon — satir 2304

**Mevcut:**
```
Her kart, bu sunucuda bugün çalışan bir uca sabit bir istek gönderir. Çalışmayan bir iş burada kart olarak görünmez.
```

**Neden:** "sunucu", "uç" (endpoint) ve "istek" üç ayrı yazılım terimidir. Cümle ayrıca avukata ne yapması gerektiğini değil, programın içini anlatıyor.

**Öneri:**
```
Aşağıdaki kartlar, bugün çalışır durumda olan işlerdir. Bir iş şu an çalışmıyorsa kartı hiç gösterilmez — böylece boşuna tıklamış olmazsınız.
```

## [P0] tanimsiz-terim — satir 2315

**Mevcut:**
```
<label class="rchip"><input type="radio" name="mode" id="mode-local" value="local" checked><span>Yerel korpus</span></label>
```

**Neden:** "Korpus" kimsenin bilmediği bir kelimedir ve bu, ekranın varsayılan seçeneğidir: avukat programın neyi tarayacağını ilk saniyede anlayamıyor.

**Öneri:**
```
<span>Bu bilgisayardaki arşiv</span> (altına küçük punto: bu bilgisayara önceden yüklenmiş karar ve mevzuat metinleri; internete çıkılmaz)
```

## [P0] jargon — satir 2326

**Mevcut:**
```
Canlı araştırma kapalı — ColleX-Baslat.cmd ile başlatın. Yerel korpus da boş olduğu için şu an yalnız yüklediğiniz belgeler üzerinde soru sorabilirsiniz.
```

**Neden:** "korpus" jargon; "ColleX-Baslat.cmd" bir dosya adıdır ve avukat onu nerede bulacağını bilmez. Cümle sorunu söylüyor ama çözümü göstermiyor.

**Öneri:**
```
Resmî kaynaklara bağlantı şu an kapalı ve bu bilgisayardaki arşiv de boş. Bu yüzden şimdilik yalnız kendi yüklediğiniz belgeler üzerinde soru sorabilirsiniz. Bağlantıyı açmak için programı kapatıp masaüstündeki ColleX kısayoluyla yeniden başlatın.
```

## [P0] jargon — satir 2332

**Mevcut:**
```
<label class="checkline"><input type="checkbox" id="includecorpus"><span>korpusla birlikte — yerel korpus da taransın</span></label>
```

**Neden:** Tek bir satırda "korpus" iki kez geçiyor. Ayrıca cümle küçük harfle başlıyor ve kutu işaretlenirse ne değişeceğini net söylemiyor.

**Öneri:**
```
<span>Bu bilgisayardaki arşiv de taransın — cevap yalnız seçtiğiniz belgelerden değil, arşivdeki karar ve mevzuat metinlerinden de beslensin</span>
```

## [P0] tanimsiz-terim — satir 2340

**Mevcut:**
```
<label class="rchip" id="cloudailabel"><input type="checkbox" id="cloudai"><span id="cloudaitext">Bulut AI: kapalı</span></label>
```

**Neden:** "Bulut AI" ekranın hiçbir yerinde tanımlanmıyor; avukat açtığında müvekkil belgesinin bilgisayardan çıkacağını bu etiketten anlayamaz. (Kısa etiket ürünün adlandırma kuralı gereği korunabilir, ama yanında açıklaması olmadan geçmesi kusurdur.)

**Öneri:**
```
Etiket aynı kalsın, altına küçük punto bir satır eklensin: "Kapalıyken her şey bu bilgisayarda kalır. Açarsanız yalnız bu sorunun metni ve dayanak paragrafları, cevabı yazdırmak üzere Anthropic'e (ABD) gönderilir. Her soru için ayrı ayrı sorulur; hatırlanmaz."
```

## [P0] tanimsiz-terim — satir 2390

**Mevcut:**
```
<h2 class="fname" id="gridtitle" tabindex="-1">Belge × soru ızgarası</h2>
```

**Neden:** "Izgara" uydurulmuş bir terimdir ve "×" işareti matematik gösterimidir. Avukat başlığa bakıp ekranın ne işe yaradığını anlayamaz.

**Öneri:**
```
<h2 class="fname" id="gridtitle" tabindex="-1">Aynı soruyu birçok belgeye sor</h2> (alt satır: Bir tabloda, her belge için ayrı ayrı cevap alırsınız)
```

## [P0] jargon — satir 2393

**Mevcut:**
```
Aynı soruyu birçok belgeye sorar: satır belge, sütun sorudur. Her hücre ayrı bir <code>POST /v1/answer</code> isteğidir ve yalnız o belgenin metniyle cevaplanır; dolu her hücre kaynağı olan parçaya bağlıdır. Bir belge soruyu karşılamıyorsa hücre boş kalmaz, <b>kapsanmadı</b> der.
```

**Neden:** "POST /v1/answer", "istek" ve "parça" (chunk) doğrudan yazılım terimidir; avukat ekranda kod görünce sayfayı kapatır. "kapsanmadı" da tanımsız bir damgadır.

**Öneri:**
```
Aynı soruyu seçtiğiniz bütün belgelere tek tek sorar: her satır bir belge, her sütun bir sorudur. Her belge yalnız kendi metniyle cevaplanır; hiçbir cevap başka bir belgeden alınmaz. Dolu her kutunun altında, cevabın alındığı paragraf gösterilir. Belge o soruya cevap vermiyorsa kutu boş bırakılmaz, <b>bu belgede yok</b> yazar.
```

## [P0] jargon — satir 2412

**Mevcut:**
```
Her hücre için ayrı bir istek yapılır ve her isteğin kendi 60 saniyelik süre bütçesi vardır; sıra tek tek ilerler ve “Durdur” ile kesilebilir.
```

**Neden:** "istek" ve "süre bütçesi" mühendis dilidir. Avukatın bilmesi gereken tek şey: uzun sürebilir, sırayla ilerler, istediğim an durdurabilirim.

**Öneri:**
```
Her kutu tek tek hesaplanır; bir kutu en çok 60 saniye sürer, sonra sıradakine geçilir. Beklerken “Durdur” ile kesebilirsiniz; o ana kadar dolan kutular ekranda kalır.
```

## [P0] jargon — satir 2421

**Mevcut:**
```
Belgeler bu bilgisayarda işlenir; yalnız siz Bulut AI / Bulut OCR seçerseniz Anthropic'e gönderilir. Metni çıkarılır, künyesi ve otomatik ön incelemesi burada listelenir. Aktif dosya varsa yüklenen belge o dosyaya bağlanır.
```

**Neden:** "OCR" ve "Anthropic" tanımsızdır; avukat müvekkil belgesinin nereye gittiğini anlamadan yükleme yapamaz. Bu cümle KVKK açısından ekranın en önemli cümlesidir ve anlaşılır olmak zorundadır.

**Öneri:**
```
Belgeler bu bilgisayarda açılır ve metni burada çıkarılır; internete hiçbir şey gönderilmez. Tek istisna: taranmış (resim hâlindeki) bir belgeyi okutmak ya da özetletmek için bulut yapay zekâyı (Bulut AI) siz açarsanız, yalnız o belgenin metni ABD'deki Anthropic şirketinin sunucusuna gönderilir. Bu seçenek varsayılan olarak kapalıdır. Yüklenen belge, üstte seçili dava dosyasına bağlanır.
```

## [P0] jargon — satir 2548

**Mevcut:**
```
Dosyalarınız, cevaplar, taslaklar, dava dosyaları ve ayarlar bu bilgisayardaki yerel PostgreSQL veritabanında (<span id="wheredb">collex_local</span>) tutulur; yüklediğiniz belgelerin aslı veri klasörünüzün altındaki <span class="ep">&lt;veri klasörü&gt;/uploads (varsayılan: var/uploads)</span> klasöründe durur. Veri klasörünün yeri kurulumda belirlenir; ColleX'i başlatan pencerede “veri” satırında yazılıdır.
```

**Neden:** "PostgreSQL", "veritabanı", "collex_local", "/uploads", "var/uploads" avukat için hiçbir şey ifade etmez; hepsi çıplak teknik ad ve yoldur. Avukatın öğrenmek istediği tek şey: dosyalarım bu bilgisayarda mı, hangi klasörde.

**Öneri:**
```
Dava dosyalarınız, cevaplar, taslaklar ve ayarlarınız yalnız bu bilgisayarda saklanır; hiçbiri internete gönderilmez. Yüklediğiniz belgelerin asılları da bu bilgisayardaki ColleX veri klasöründe durur. Klasörün tam yeri aşağıda yazılıdır; yedek alırken bu klasörü yedeklersiniz.
```

## [P0] jargon — satir 2556

**Mevcut:**
```
Canlı araştırma, sorunuzdan türetilen arama metnini resmî kaynak sunucularına (Bedesten/UYAP ve kurum servisleri) gönderir
```

**Neden:** "sunucu", "servis" ve "Bedesten" avukatın bilmediği sözcüklerdir; "sorunuzdan türetilen arama metni" de anlaşılmıyor.

**Öneri:**
```
Canlı araştırma açıkken, sorunuzdan çıkarılan arama kelimeleri UYAP'ın karar arama sistemine ve ilgili kurumların resmî sitelerine gönderilir — tıpkı siz o sitelerde arama yapmışsınız gibi. Dosya içeriğiniz gönderilmez.
```

## [P1] ui-kusuru — satir 2196

**Mevcut:**
```
<select id="matterselect" class="matterpick" title="Aktif dosya: araştırmalar, belgeler ve taslaklar bu dosyaya bağlanır">
```

**Neden:** Ürünün en önemli kuralı (yaptığınız her iş seçili dosyaya bağlanır) yalnız fare üzerine gelince çıkan tooltip'te duruyor; dokunmatik ekranda ve hızlı kullanımda hiç görünmez.

**Öneri:**
```
Aynı cümle, seçim kutusunun hemen altına küçük punto kalıcı bir satır olarak yazılsın: "Seçtiğiniz dosya: bundan sonra sorduğunuz sorular, yüklediğiniz belgeler ve yazdığınız taslaklar bu dosyaya işlenir."
```

## [P1] ton — satir 2218

**Mevcut:**
```
<p class="tagline">Yargı &amp; Mevzuat Kanıt Sistemi</p>
```

**Neden:** "Kanıt Sistemi" mühendis adlandırmasıdır ve "&" işareti Türkçe metinde yabancı durur. Avukata ürünün ne yaptığını söylemiyor.

**Öneri:**
```
<p class="tagline">Karar ve mevzuat araştırması — her alıntı kaynağıyla birlikte</p>
```

## [P1] ui-kusuru — satir 2283

**Mevcut:**
```
<button type="submit" class="seal" id="nm-save">Dosyayı aç</button>
```

**Neden:** "Dosyayı aç" avukat dilinde hem "dava açmak" hem "var olan dosyayı görüntülemek" demektir; buton ise yeni kayıt oluşturuyor. Etiket ne olacağını söylemiyor.

**Öneri:**
```
<button type="submit" class="seal" id="nm-save">Yeni dosyayı kaydet</button>
```

## [P1] tanimsiz-terim — satir 2313

**Mevcut:**
```
<div class="fieldlabel">Kapsam</div>
```

**Neden:** "Kapsam" sözcüğü bu dosyada üç ayrı anlamda kullanılıyor (arama kaynağı, Ayarlar'daki kaynak listesi, cevabın soruyu karşılaması). Aynı kelimenin üç anlamı avukatı şaşırtır.

**Öneri:**
```
<div class="fieldlabel">Nerede aransın?</div>
```

## [P1] anlasilmaz-cumle — satir 2347

**Mevcut:**
```
Ekli belgeler "Yüklediğim belgeler" kapsamında doğrudan, canlı araştırmada bağlam olarak kullanılır.
```

**Neden:** Cümle eksiltili ve iki farklı davranışı tek yükleme sıkıştırıyor; "bağlam" ise yapay zekâ terimidir. Avukat, ekli belgesine ne olacağını anlamıyor.

**Öneri:**
```
Ekli belgeler, “Yüklediğim belgeler” seçeneğinde cevabın doğrudan kaynağı olur. Canlı araştırmada ise kaynak sayılmaz; yalnız aramanın hangi konuda yapılacağını belirlemekte kullanılır.
```

## [P1] jargon — satir 2362

**Mevcut:**
```
Filtreler yalnızca siz doldurursanız isteğe eklenir.
```

**Neden:** "istek" (request) yazılım terimidir ve cümle edilgen. Avukat, boş bıraktığı filtrenin ne yapacağını merak eder.

**Öneri:**
```
Boş bıraktığınız filtre uygulanmaz; yalnız doldurduklarınız aramayı daraltır.
```

## [P1] ui-kusuru — satir 2369

**Mevcut:**
```
<button type="submit" class="seal" id="go">Ara ve doğrula</button>
```

**Neden:** Buton neyin doğrulanacağını söylemiyor; avukat "doğrulanmış cevap" gibi bir garanti bekleyebilir. Oysa doğrulanan şey alıntının kaynağıyla birebir aynı olmasıdır.

**Öneri:**
```
<button type="submit" class="seal" id="go">Cevabı hazırla</button> (yanına küçük punto: Her alıntı, alındığı belgeyle karşılaştırılarak gösterilir.)
```

## [P1] jargon — satir 2407

**Mevcut:**
```
<a class="dl" id="gridcsv" hidden download="izgara.csv">CSV indir</a>
```

**Neden:** "CSV" tanımsız bir dosya biçimi kısaltmasıdır; dosya adı da ("izgara.csv") uydurulmuş terimi indirme klasörüne taşıyor.

**Öneri:**
```
<a class="dl" id="gridcsv" hidden download="belge-soru-tablosu.csv">Tabloyu indir (Excel'de açılır)</a>
```

## [P1] jargon — satir 2408

**Mevcut:**
```
<button type="button" class="ghost" id="gridcopy" hidden>CSV'yi panoya kopyala</button>
```

**Neden:** Aynı kısaltma; ayrıca "pano" yerine avukatın günlük dili "kopyala/yapıştır"dır.

**Öneri:**
```
<button type="button" class="ghost" id="gridcopy" hidden>Tabloyu kopyala — Word veya Excel'e yapıştırın</button>
```

## [P1] jargon — satir 2428

**Mevcut:**
```
Klasörü buraya da bırakabilirsiniz. Klasör özyinelemeli taranır; PDF · DOCX · TXT · UDF dışındaki dosyalar atlanır ve atlananlar adlarıyla listelenir. Dosyalar tek tek, sırayla yüklenir.
```

**Neden:** "özyinelemeli" bir programlama terimidir; avukat alt klasörlerin de taranacağını bu kelimeden anlayamaz.

**Öneri:**
```
Klasörü buraya sürükleyip bırakabilirsiniz. Alt klasörler de taranır. PDF, DOCX, TXT ve UDF dışındaki dosyalar alınmaz; alınmayanların adları size listelenir. Dosyalar tek tek, sırayla yüklenir.
```

## [P1] eksik-aciklama — satir 2444

**Mevcut:**
```
<section id="view-taslak" hidden aria-label="Taslak görünümü">
```

**Neden:** Taslak ekranı, şablon listesi yüklenene kadar bomboştur; ekranın ne yaptığını, hangi belgeleri üretebildiğini ve çıktının nereye gideceğini söyleyen tek bir cümle yok.

**Öneri:**
```
Bölümün başına giriş metni eklensin: "Dilekçe ve yazı taslağı hazırlar. Önce bir şablon seçin, sonra dayanağınızı gösterin; taslaktaki her alıntı kaynağına bağlanır ve alıntının bozulmadığı otomatik denetlenir. Çıktıyı Word (DOCX) veya UYAP (UDF) olarak indirebilirsiniz."
```

## [P1] tanimsiz-terim — satir 2462

**Mevcut:**
```
<label class="rchip"><input type="radio" name="evsrc" id="ev-none" value="none" checked><span>Kanıtsız (yalnız beyan)</span></label>
```

**Neden:** Varsayılan seçenek budur ve "kanıtsız" damgasının taslakta ne sonuç doğuracağı hiçbir yerde yazmıyor. Avukat, oluşturduğu taslağın neden "KAYNAKSIZ" damgalı çıktığını anlayamaz.

**Öneri:**
```
<span>Dayanak eklemeden yaz — taslak yalnız sizin beyanınızla kurulur</span> (altına: Bu seçenekte taslaktaki hiçbir cümle karar veya mevzuat metnine bağlanmaz; belgede bunu belirten bir uyarı satırı yer alır.)
```

## [P1] eksik-aciklama — satir 2517

**Mevcut:**
```
<section class="card" id="sysstatus" aria-label="Sistem durumu">
```

**Neden:** "Sistem durumu" kartı, içi doldurulmadan önce hiçbir şey anlatmıyor; avukat buradaki satırların ne anlama geldiğini ve kırmızı bir satır görünce ne yapması gerektiğini bilmiyor.

**Öneri:**
```
Başlığın altına açıklama eklensin: "Programın hangi parçalarının bugün çalıştığını gösterir. Kırmızı bir satır görürseniz programı kapatıp masaüstündeki ColleX kısayoluyla yeniden başlatın; sorun sürerse bu sayfanın ekran görüntüsünü alın."
```

## [P1] tanimsiz-terim — satir 2536

**Mevcut:**
```
<button type="button" class="ghost small" id="kapsam-open">Kapsam sayfasını aç</button>
```

**Neden:** Kartın başlığı doğru soruyu soruyor ("Neyi tarıyoruz?") ama butonun etiketi yine tanımsız "Kapsam" terimine dönüyor; iki etiket birbirini tutmuyor.

**Öneri:**
```
<button type="button" class="ghost small" id="kapsam-open">Kaynak listesini aç</button>
```

## [P1] tanimsiz-terim — satir 2579

**Mevcut:**
```
<div class="fieldlabel">Merci — hangi kaynaklarda aransın</div>
```

**Neden:** "Merci" hukukta karar veren makamı anlatır; burada ise aranacak veri kaynakları kastediliyor. Terim yanlış yerde kullanıldığı için avukatı yanıltır.

**Öneri:**
```
<div class="fieldlabel">Hangi kaynaklarda aransın?</div>
```

## [P1] anlasilmaz-cumle — satir 2590

**Mevcut:**
```
Açık: kaynak yalnız bu ifadenin kendisini arar. Kapatırsanız sözcükler ayrı ayrı aranır; liste çok genişler ve kaynak onu genellikle ilgililiğe göre değil, karar tarihine göre sıralar.
```

**Neden:** Tek nefeste üç bilgi veriyor, "kaynak" sözcüğü özne olarak iki kez geçiyor ve "ilgililik" Türkçede yerleşmiş bir kelime değil. Avukat kutuyu kapatırsa ne olacağını değil, sistemin iç davranışını okuyor.

**Öneri:**
```
Açıkken: yazdığınız ifade, tam olarak o hâliyle aranır. Kapatırsanız kelimeler ayrı ayrı aranır — sonuç listesi çok uzar ve kararlar konuya yakınlığa göre değil, tarihe göre sıralanır. Sonuç bulunamazsa kutuyu kapatıp yeniden deneyin.
```

## [P1] anlasilmaz-cumle — satir 2620

**Mevcut:**
```
Dilekçedeki her atfı tek tek arar ve her satırın yürürlüğünü DİLEKÇENİN TARİHİNE göre okur.
```

**Neden:** "her satırın yürürlüğü" ne demek belli değil (madde mi, atıf mı, tablo satırı mı). Büyük harfle vurgulanan kısım da bağırma etkisi yapıyor, açıklamıyor.

**Öneri:**
```
Dilekçenizdeki her kanun maddesini ve her karar atfını tek tek arar; her birinin, dilekçenin tarihinde yürürlükte olup olmadığını söyler. Bulunamayan atıflar ayrı gösterilir ve “bulunamadı” ile “bakılamadı” asla aynı renkte yazılmaz.
```

## [P1] tanimsiz-terim — satir 2664

**Mevcut:**
```
<div class="filehead"><h3 class="fname">Bu penceredeki kayıtlar</h3><span class="chip mute" id="takvim-count"></span></div>
```

**Neden:** "Pencere" burada tarih aralığı anlamında kullanılmış; avukat bunu ekran penceresi sanır. Ayrıca "kayıtlar" neyin kaydı olduğunu söylemiyor.

**Öneri:**
```
<h3 class="fname">Görüntülenen aydaki süreler ve duruşmalar</h3>
```

## [P1] ton — satir 2704

**Mevcut:**
```
Kural tabanlıdır: metni sizin listenizle karşılaştırır. Hukukî değerlendirme yapmaz.
```

**Neden:** "Kural tabanlı" bir yazılım mimarisi terimidir. Avukatın anlaması gereken şey, bunun bir yapay zekâ yorumu değil, madde madde bir kontrol olduğudur.

**Öneri:**
```
Yapay zekâ yorumu değildir: sözleşme metnini sizin belirlediğiniz kontrol listesiyle madde madde karşılaştırır ve her başlık için VAR / YOK / BELİRSİZ der. Hukukî değerlendirmeyi siz yaparsınız.
```

## [P2] ui-kusuru — satir 2205

**Mevcut:**
```
<button type="button" class="themebtn" id="themebtn">◐ Tema</button>
```

**Neden:** "◐" işareti hiçbir şey anlatmıyor ve butona basınca ne olacağı (açık/koyu geçişi mi, ayar penceresi mi) belli değil.

**Öneri:**
```
<button type="button" class="themebtn" id="themebtn">Açık / koyu görünüm</button>
```

## [P2] ui-kusuru — satir 2436

**Mevcut:**
```
<label class="lab" for="filematter">Dosya</label>
```

**Neden:** Belgeler ekranında "Dosya" etiketi, hemen yanındaki "Belge ara" kutusuyla karışıyor: burada "dosya" dava dosyası, arama kutusunda ise belge kastediliyor. Aynı ekranda iki anlam.

**Öneri:**
```
<label class="lab" for="filematter">Dava dosyasına göre süz</label>
```

## [P2] ton — satir 2508

**Mevcut:**
```
<label class="checkline"><input type="checkbox" id="p-showDemoPresets"><span>Araştır ekranında demo senaryolarını göster</span></label>
```

**Neden:** "Demo" ve "senaryo" yazılım sunum dilidir; avukat bunların ekranda ne olarak görüneceğini bilmez.

**Öneri:**
```
<span>Araştır ekranında hazır örnek sorular gösterilsin</span>
```
