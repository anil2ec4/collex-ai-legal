# persona-ilk-10-dakika

Ekrani ilk actigimda ne ise yaradigini anlamadim: baslikta "Kanit Sistemi" yaziyor, bu bana bir sey soylemiyor; karsilama kartinin ikinci cumlesinde daha ilk saniyede "SHA-256" ve "KAYNAKSIZ" geciyor. Ilk tiklamamin ne olmasi gerektigini ancak karsilama kartindaki uc adimdan cikarabildim; o kart da profil doldurulup ilk dosya acilinca bir daha hic gorunmuyor, yani ikinci gun actigimda ekran bana hicbir sey anlatmiyor. "Arastir" sekmesindeki uc secenekten ikisini anlamadim: varsayilan secili gelen "Yerel korpus"un ne oldugu hicbir yerde yazmiyor. Bir soru sordum, ekran "CEKIMSER" dedi; hata mi yaptim anlamadim, ustelik onerdigi ilk cikis yolu (Canli kaynaklarda ara) sunucuda canli arastirma kapaliyken de tiklanabiliyor ve beni calismayan bir kapsama sokuyor. Cevabin altindaki "Alinti parmak izi (SHA-256)", "Konum ... (Unicode karakter sayimi)" ve uzun harf-rakam dizisi benim icin tamamen sessiz; oysa urunun en degerli iddiasi tam burada. Taslak ve Ayarlar ekranlarinda ayni sorun suruyor: "Kanitsiz (yalniz beyan)", "migrasyon 13/13", "54 arac", "ANTHROPIC_API_KEY", "Korpus" satirlari bana ne yapmam gerektigini soylemiyor; rozet kirmizi ise ne yapacagimi hicbir ekran yazmiyor.

Bulgu: 40

## [P0] eksik-aciklama — satir 2200

**Mevcut:**
```
<div class="pills" id="statuspills" aria-label="Sistem durumu">
          <button type="button" class="pill" id="pill-db" title="Sistem durumu — Ayarlar"><span class="dot"></span><span class="t">Veritabanı</span></button>
          <button type="button" class="pill" id="pill-mcp" title="Sistem durumu — Ayarlar"><span class="dot"></span><span class="t">Canlı araştırma</span></button>
          <button type="button" class="pill" id="pill-ai" title="Sistem durumu — Ayarlar"><span class="dot"></span><span class="t">Bulut AI</span></button>
```

**Neden:** Üç rozet ekranın en üstünde sürekli duruyor ama ne olduklarını, kırmızı olduklarında neyin çalışmayacağını ve ne yapılacağını söylemiyorlar. "Veritabanı" ve "Bulut AI" avukat sözcüğü değil.

**Öneri:**
```
<div class="pills" id="statuspills" aria-label="Sistem durumu">
          <button type="button" class="pill" id="pill-db" title="Kayıtlarınızın tutulduğu yer — kırmızıysa dosya, cevap ve taslak kaydedilemez"><span class="dot"></span><span class="t">Kayıtlarım</span></button>
          <button type="button" class="pill" id="pill-mcp" title="Resmî kaynaklara bağlantı — kırmızıysa yalnız bu bilgisayardaki arşivde arama yapılabilir"><span class="dot"></span><span class="t">Resmî kaynaklar</span></button>
          <button type="button" class="pill" id="pill-ai" title="İsteğe bağlı bulut yardımcı — kapalıyken hiçbir belgeniz bilgisayardan çıkmaz"><span class="dot"></span><span class="t">Bulut yardımcı</span></button>
```

**Not:** Rozet kırmızıysa üzerinde “ne yapmalı” cümlesi de çıkmalı; şu an yalnız Ayarlar'a götürüyor.

## [P0] jargon — satir 2233

**Mevcut:**
```
<div class="strip demo" id="demobanner" hidden role="status">DENEME KORPUSU (sentetik deneme belgeleri) — bu sunucu sentetik deneme belgeleriyle çalışıyor; hiçbir sonuç gerçek hukukî değerlendirme değildir.</div>
```

**Neden:** Ekranın en tepesindeki en kritik uyarı üç anlaşılmaz sözcükle başlıyor: KORPUS, sentetik, sunucu. Avukat uyarıyı okumadan geçer — oysa bu uyarı gerçek mevzuatla çalışmadığını söylüyor.

**Öneri:**
```
<div class="strip demo" id="demobanner" hidden role="status">DİKKAT — BU KURULUMDA GERÇEK MEVZUAT YOK. Elinizdeki arşiv, programı denemek için yazılmış örnek metinlerden oluşuyor. Burada çıkan hiçbir sonuç dosyanızda kullanılamaz.</div>
```

**Not:** Aynı metin DEMO_CORPUS_TEXT sabitinde (satır ~2790) tekrar ediyor; ikisi birlikte değişmeli.

## [P0] jargon — satir 2304

**Mevcut:**
```
<p class="empty" id="worknote">Her kart, bu sunucuda bugün çalışan bir uca sabit bir istek gönderir. Çalışmayan bir iş burada kart olarak görünmez.</p>
```

**Neden:** "Sunucu", "uç", "istek" — üçü de mühendis sözcüğü. Cümle avukata hiçbir şey söylemiyor; oysa söylemek istediği şey değerli: burada gördüğün her düğme gerçekten çalışıyor.

**Öneri:**
```
<p class="empty" id="worknote">Burada yalnızca bugün gerçekten çalışan işler görünür. Çalışmayan bir iş listeye hiç eklenmez; geçici olarak kullanılamayan iş soluk görünür ve nedenini üzerinde yazar.</p>
```

## [P0] tanimsiz-terim — satir 2315

**Mevcut:**
```
<label class="rchip"><input type="radio" name="mode" id="mode-local" value="local" checked><span>Yerel korpus</span></label>
```

**Neden:** "Korpus" Türkçe hukuk dilinde yok; ekranın hiçbir yerinde tanımı yok ve üstelik VARSAYILAN seçili seçenek bu. Avukat hangi kapsamı seçtiğini bilmeden soru soruyor.

**Öneri:**
```
<label class="rchip"><input type="radio" name="mode" id="mode-local" value="local" checked><span>Bu bilgisayardaki mevzuat ve karar arşivi</span></label>
```

**Not:** Aynı düzeltme dosya boyunca "korpus" geçen her etikette tekrarlanmalı.

## [P0] tanimsiz-terim — satir 2457

**Mevcut:**
```
<div class="fieldlabel">Kanıt kaynağı</div>
```

**Neden:** "Kanıt kaynağı" bu üründe uydurulmuş bir başlık; avukatın anladığı "delil" değil, taslaktaki cümlelerin dayanağı kastediliyor. Başlık ne seçmem gerektiğini söylemiyor.

**Öneri:**
```
<div class="fieldlabel">Taslaktaki hukukî gerekçe neye dayansın?</div>
```

## [P0] tanimsiz-terim — satir 2462

**Mevcut:**
```
<label class="rchip"><input type="radio" name="evsrc" id="ev-none" value="none" checked><span>Kanıtsız (yalnız beyan)</span></label>
```

**Neden:** Taslak ekranının VARSAYILAN seçeneği bu. "Kanıtsız" avukata suçlayıcı gelir, "yalnız beyan" belirsizdir; taslağın ne olacağını söylemiyor.

**Öneri:**
```
<label class="rchip"><input type="radio" name="evsrc" id="ev-none" value="none" checked><span>Dayanak bağlamadan yaz — hukukî gerekçeyi ben ekleyeceğim</span></label>
```

## [P0] jargon — satir 2548

**Mevcut:**
```
Dosyalarınız, cevaplar, taslaklar, dava dosyaları ve ayarlar bu bilgisayardaki yerel PostgreSQL veritabanında (<span id="wheredb">collex_local</span>) tutulur; yüklediğiniz belgelerin aslı veri klasörünüzün altındaki <span class="ep">&lt;veri klasörü&gt;/uploads (varsayılan: var/uploads)</span> klasöründe durur.
```

**Neden:** "Verilerim nerede?" avukatın en çok merak ettiği sorulardan biri, ama cevabı "PostgreSQL veritabanı", "collex_local", "<veri klasörü>/uploads" gibi tamamen makine diliyle verilmiş.

**Öneri:**
```
Dosyalarınız, cevaplar, taslaklar ve ayarlar YALNIZ bu bilgisayarda saklanır; internete hiçbir kopya çıkmaz. Yüklediğiniz belgelerin asılları da aynı bilgisayarda, aşağıda tam yolu yazan klasörde durur.
```

**Not:** Veritabanı adı “Teknik ayrıntılar” katlanır bölümüne inmeli; klasörün tam yolu zaten alttaki satırda yazılıyor.

## [P0] tanimsiz-terim — satir 2754

**Mevcut:**
```
    ABSTAIN: ["ÇEKİMSER", "abstain", "—", "Yeterli doğrulanabilir kaynak yok."]
```

**Neden:** "ÇEKİMSER" hukukta oy için kullanılır; bir arama sonucunun durumu olarak uydurulmuştur. Avukat bunu okuyunca "hata mı yaptım?" diye düşünür, oysa program kasten cevap üretmemiştir.

**Öneri:**
```
    ABSTAIN: ["CEVAP ÜRETİLMEDİ", "abstain", "—", "Elinizdeki kaynaklarda bu soruyu karşılayan hüküm veya karar bulunamadı."]
```

**Not:** Durum damgasının kendisi durumu bildirmeli; sonraki kart zaten çıkış yollarını sayıyor.

## [P0] anlasilmaz-cumle — satir 2899

**Mevcut:**
```
    yes: "KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır",
    no: "KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan kullanmayın"
```

**Neden:** "Kesinleştirmek" bu üründe uydurulmuş bir fiil; avukat "kararın kesinleşmesi"ni anlar, cevabın kesinleşmesini anlamaz. Cümle ayrıca ne yapacağımı söylemiyor.

**Öneri:**
```
    yes: "Dilekçeye alınmaya hazır — her cümlenin altındaki alıntı belgesiyle eşleşiyor; son hukukî değerlendirme size aittir",
    no: "Olduğu gibi kullanmayın — aşağıdaki cümlelerin en az birinin dayanağı doğrulanamadı; nedenlerini okuyun"
```

## [P0] jargon — satir 3675

**Mevcut:**
```
    hash.appendChild(document.createTextNode("Alıntı parmak izi (SHA-256) "));
    hash.appendChild(hashSpan(item.quoteSha256));
    hash.appendChild(document.createTextNode(" · Belge parmak izi (SHA-256) "));
```

**Neden:** Ürünün en güçlü iddiası burada, ama avukatın anlayacağı tek kelime yok: "parmak izi", "SHA-256" ve ardından 64 karakterlik bir dizi. Bunun ona ne faydası olduğu yazmıyor.

**Öneri:**
```
    hash.appendChild(document.createTextNode("Alıntının değişmediğini gösteren denetim değeri "));
    hash.appendChild(hashSpan(item.quoteSha256));
    hash.appendChild(document.createTextNode(" · Belgenin tamamı için denetim değeri "));
```

**Not:** Satırın üstüne tek cümle gerekir: “Bu değer sayesinde alıntının tek harfi bile sonradan değiştirilse program fark eder; karşı taraf da aynı denetimi bağımsız yapabilir.”

## [P0] jargon — satir 3679

**Mevcut:**
```
      " · Konum " + item.startChar + "–" + item.endChar + " (Unicode karakter sayımı)" +
      " · Belge sürümü " + item.documentVersionId));
```

**Neden:** "Unicode", sayısal "konum" ve ekrana çıplak basılan uzun kimlik dizisi avukat için tamamen sessiz.

**Öneri:**
```
      " · Alıntının belgedeki yeri: " + item.startChar + ".–" + item.endChar + ". karakter" +
      " · Belgenin bu kaydı: " + (fmtDateTR(item.versionDate) || item.documentVersionId)));
```

**Not:** Sürüm tarihi alanı yoksa kimlik dizisi “Teknik ayrıntılar” katlanır bölümünde kalmalı.

## [P0] ui-kusuru — satir 4005

**Mevcut:**
```
      acts.appendChild(ghostBtn("Canlı kaynaklarda ara", function () {
        gotoView("arastir");
        document.getElementById("mode-live").checked = true;
        syncMode();
      }, "primary small"));
```

**Neden:** Cevap üretilmediğinde önerilen İLK çıkış yolu bu düğme. Ama canlı araştırma bu sunucuda kapalıyken (radyo devre dışıyken) düğme yine tıklanabiliyor ve kapsamı programatik olarak canlıya çeviriyor. Avukat çalışmayan bir kapsama sokuluyor; bu, ürünün kendi “çalışmayan iş gösterilmez” kuralının ihlali.

**Öneri:**
```
Canlı araştırma kapalıysa bu düğme ya hiç çizilmemeli ya da soluk çizilip üzerinde nedeni yazmalı: “Resmî kaynaklara bağlantı şu an kapalı — ColleX-Baslat.cmd ile açın”. Açıkken etiket ne olacağını söylemeli: “Resmî kaynaklarda ara (en çok 2 dakika sürer)”.
```

**Not:** liveAvailable değişkeni zaten mevcut; kart çizilirken okunmalı.

## [P0] eksik-aciklama — satir 8130

**Mevcut:**
```
    var first = settingsCache !== null && !settingsCache.profile.ad && mattersCache.length === 0;
```

**Neden:** Program ne yaptığını yalnızca profil BOŞ ve hiç dosya YOKKEN anlatıyor. Adımı yazıp ilk dosyamı açtığım anda karşılama kartı bir daha hiç görünmüyor; ikinci gün ekranı açtığımda hiçbir yerde “bu program ne yapar / önce ne yapmalıyım” yazmıyor.

**Öneri:**
```
Karşılama kartı kapandıktan sonra da Dosyalarım ekranının üstünde tek satırlık kalıcı bir yön çubuğu kalmalı: “Soru sormak için Araştır, belge yüklemek için Belgeler, dilekçe için Taslak sekmesi. Programın ne yaptığını hatırlamak için: Nasıl çalışır?” — bu bağlantı karşılama kartını yeniden açmalı.
```

**Not:** Kart HTML'de zaten var (id="welcome"); yalnız gösterim koşulu ve bir “Nasıl çalışır?” düğmesi gerekiyor.

## [P0] jargon — satir 10986

**Mevcut:**
```
    row("Veritabanı", (DB_STATE_TR[h.db] || h.db || "?") + (h.dbName ? " · " + h.dbName : "") +
      (mig ? " · migrasyon " + mig.applied + "/" + mig.expected + (mig.missing && mig.missing.length ? " · eksik: " + mig.missing.join(", ") : "") : ""));
```

**Neden:** Kırmızı rozete tıklayınca gelinen yer burası. Avukat "veritabanı", "migrasyon 13/13" ve bir teknik ad görüyor; ne olduğunu ve NE YAPMASI gerektiğini söyleyen tek kelime yok.

**Öneri:**
```
    row("Kayıtlarınız", (DB_STATE_TR[h.db] || "?") + " — dosyalarınız, cevaplarınız ve taslaklarınız burada saklanır" +
      (h.db === "ok" ? "" : ". Yapmanız gereken: ColleX-Durdur.cmd, ardından ColleX-Baslat.cmd. Sorun sürerse sunucu penceresini kapatmayın."));
```

**Not:** Teknik ad ve migrasyon sayısı katlanmış “Teknik ayrıntılar” bölümüne inmeli.

## [P0] jargon — satir 13109

**Mevcut:**
```
var WELCOME_LEAD_TR = "Belgelerinizi ve mevzuatı tarar, her tespiti belge sürümü ve SHA-256 " +
    "özetiyle bağlar, süreleri hesaplar ve dilekçe taslağı yazar. Kaynağı olmayan cümleyi " +
    "KAYNAKSIZ diye işaretler."
```

**Neden:** Programı ilk açan avukatın gördüğü İKİNCİ cümlede "SHA-256", "özet" ve tanımsız bir büyük harfli terim ("KAYNAKSIZ") var. Bunlar okunduğu anda ekran kapanır. Teknik iddia doğru ama avukatın diliyle söylenmemiş.

**Öneri:**
```
var WELCOME_LEAD_TR = "Yüklediğiniz belgeleri ve mevzuatı tarar; yazdığı her cümlenin altına o cümlenin dayandığı " +
    "belgeden birebir alıntıyı koyar ve alıntının sonradan değişmediğini otomatik denetler. " +
    "Süre hesaplar, dilekçe taslağı yazar. Dayanağı bulunamayan cümleyi kırmızı işaretler, gizlemez."
```

**Not:** Kart bütçesi 12 satır / 90 sözcük; öneri bu bütçenin içinde.

## [P1] jargon — satir 2218

**Mevcut:**
```
<p class="tagline">Yargı &amp; Mevzuat Kanıt Sistemi</p>
```

**Neden:** İlk 5 saniyede okunan tek tanıtım cümlesi bu ve ne yaptığını söylemiyor. "Kanıt Sistemi" avukatta delil dosyası çağrışımı yapar; oysa kastedilen, cevapların kaynağa bağlanmasıdır.

**Öneri:**
```
<p class="tagline">Sorduğunuz her soruyu mevzuat ve karar metnine bağlar — kaynağını gösteremediği cümleyi yazmaz</p>
```

## [P1] ui-kusuru — satir 2221

**Mevcut:**
```
<nav class="views" aria-label="Görünümler" role="tablist">
      <button type="button" class="viewtab" id="tab-dosyalarim" data-view="dosyalarim" role="tab" aria-selected="false" aria-controls="view-dosyalarim">Dosyalarım</button>
```

**Neden:** Üstte beş sekme var, ama ürünün en değerli yedi ekranı (Karar ara, Takvim, Atıf denetimi, Harç hesabı, Sözleşme incelemesi, Belge×soru tablosu, Kapsam) hiçbir sekmede yok — yalnız Araştır ekranındaki iş kartlarından gizli yollarla açılıyor. Avukat bu özelliklerin varlığını bilmiyor.

**Öneri:**
```
Sekme çubuğuna “Araçlar” adında altıncı bir sekme eklenmeli; içinde bu yedi ekran, adı ve tek satırlık ne işe yaradığıyla listelenmeli. Alternatif: Araştır ekranındaki iş kartları listesinin başına “Bu programın yapabildiği tüm işler” başlığı konması.
```

## [P1] tanimsiz-terim — satir 2313

**Mevcut:**
```
<div class="fieldlabel">Kapsam</div>
```

**Neden:** "Kapsam" bu üründe üç ayrı anlamda kullanılıyor: buradaki arama alanı, Ayarlar'daki "Kapsam sayfası" (hangi kaynaklara bağlıyız) ve ızgaradaki "kapsanmadı" damgası. Aynı sözcüğün üç anlamı avukatı kaybettirir; başlık ayrıca hangisini seçeceğimi söylemiyor.

**Öneri:**
```
<div class="fieldlabel">Nerede aransın?</div>
```

**Not:** Ayarlar'daki “Kapsam sayfası” da “Hangi kaynaklara bağlıyız?” olmalı.

## [P1] tanimsiz-terim — satir 2316

**Mevcut:**
```
<label class="rchip"><input type="radio" name="mode" id="mode-live" value="live"><span>Canlı kaynaklar — derin araştırma</span></label>
```

**Neden:** "Derin araştırma" tanımsız bir pazarlama terimi; "canlı" da avukat için belirsiz. Ne kadar süreceği ve ne getireceği ancak seçtikten sonra alttaki şeritte yazıyor.

**Öneri:**
```
<label class="rchip"><input type="radio" name="mode" id="mode-live" value="live"><span>Resmî kaynaklarda ara (internete bağlanır, en çok 2 dakika)</span></label>
```

## [P1] jargon — satir 2318

**Mevcut:**
```
<span class="statusline" id="livehint" role="status" hidden>Canlı mod bu sunucuda kapalı — ColleX-Baslat.cmd ile yeniden başlatın; durumu üst çubuktaki “Canlı araştırma” rozetinden görebilirsiniz.</span>
```

**Neden:** "Canlı mod", "sunucu" ve "rozet" avukat sözcüğü değil. Ayrıca ColleX-Baslat.cmd'nin nerede olduğu ve nasıl çalıştırılacağı yazmıyor.

**Öneri:**
```
<span class="statusline" id="livehint" role="status" hidden>Resmî kaynaklara bağlantı şu an kapalı. Açmak için masaüstündeki ColleX-Baslat.cmd dosyasına çift tıklayın; bu pencere kendini yeniler. O zamana kadar bu bilgisayardaki arşivde ve yüklediğiniz belgelerde arama yapabilirsiniz.</span>
```

## [P1] jargon — satir 2332

**Mevcut:**
```
<label class="checkline"><input type="checkbox" id="includecorpus"><span>korpusla birlikte — yerel korpus da taransın</span></label>
```

**Neden:** Tek cümlede "korpus" iki kez geçiyor ve hiçbir yerde tanımlı değil. Üstelik küçük harfle başlıyor, seçenek etiketi gibi durmuyor.

**Öneri:**
```
<label class="checkline"><input type="checkbox" id="includecorpus"><span>Bu belgelerin yanında, bilgisayardaki mevzuat ve karar arşivi de taransın</span></label>
```

## [P1] jargon — satir 2393

**Mevcut:**
```
<p class="note-p">Aynı soruyu birçok belgeye sorar: satır belge, sütun sorudur. Her hücre ayrı bir <code>POST /v1/answer</code> isteğidir ve yalnız o belgenin metniyle cevaplanır; dolu her hücre kaynağı olan parçaya bağlıdır. Bir belge soruyu karşılamıyorsa hücre boş kalmaz, <b>kapsanmadı</b> der.</p>
```

**Neden:** Avukatın önüne çıplak bir makine adresi (POST /v1/answer) konmuş. "Parça", "istek" ve "kapsanmadı" da tanımsız; ekranın adı ("ızgara") da uydurulmuş bir terim.

**Öneri:**
```
<p class="note-p">Aynı soruları birçok belgeye aynı anda sorar: her satır bir belge, her sütun bir sorudur. Her hücre yalnız o belgenin metniyle cevaplanır ve cevabın altında belgeden birebir alıntı bulunur. Belge o soruya cevap vermiyorsa hücre boş bırakılmaz, <b>bu belgede geçmiyor</b> yazar.</p>
```

**Not:** Ekran adı “Belge × soru ızgarası” yerine “Belgeleri toplu sorgula (tablo)” olmalı.

## [P1] jargon — satir 2407

**Mevcut:**
```
<a class="dl" id="gridcsv" hidden download="izgara.csv">CSV indir</a>
        <button type="button" class="ghost" id="gridcopy" hidden>CSV'yi panoya kopyala</button>
```

**Neden:** "CSV" avukat sözcüğü değil; indirdiği dosyayı neyle açacağını bilmiyor. İndirilen dosyanın adı da ("izgara.csv") anlamsız.

**Öneri:**
```
<a class="dl" id="gridcsv" hidden download="belge-soru-tablosu.csv">Tabloyu indir (Excel'de açılır)</a>
        <button type="button" class="ghost" id="gridcopy" hidden>Tabloyu kopyala — Word veya Excel'e yapıştırın</button>
```

## [P1] jargon — satir 2412

**Mevcut:**
```
<p class="empty" id="gridnote">Her hücre için ayrı bir istek yapılır ve her isteğin kendi 60 saniyelik süre bütçesi vardır; sıra tek tek ilerler ve “Durdur” ile kesilebilir.</p>
```

**Neden:** "İstek" ve "süre bütçesi" mühendis dili. Avukatın bilmesi gereken tek şey: uzun sürebilir, istediğinde durdurabilir, o ana kadarki sonuç kalır.

**Öneri:**
```
<p class="empty" id="gridnote">Her hücre tek tek hesaplanır; belge sayısına göre birkaç dakika sürebilir. Her hücre için en çok 60 saniye beklenir, sonra sıradakine geçilir. İstediğiniz an “Durdur” diyebilirsiniz; o ana kadar dolan hücreler kalır.</p>
```

## [P1] jargon — satir 2421

**Mevcut:**
```
<div class="sub">Belgeler bu bilgisayarda işlenir; yalnız siz Bulut AI / Bulut OCR seçerseniz Anthropic'e gönderilir. Metni çıkarılır, künyesi ve otomatik ön incelemesi burada listelenir. Aktif dosya varsa yüklenen belge o dosyaya bağlanır.</div>
```

**Neden:** "Bulut AI", "Bulut OCR" ve "Anthropic" avukat için üç yabancı ad; "işlenir" belirsiz. Cümle gizlilik güvencesini de net vermiyor: varsayılanda hiçbir şey dışarı çıkmıyor.

**Öneri:**
```
<div class="sub">Yüklediğiniz belge bu bilgisayardan çıkmaz. Metni okunur, künyesi ve ilk incelemesi burada listelenir. Yalnız siz açıkça “Bulut yardımcı” veya “Taranmış belgeyi metne çevir” derseniz o belgenin metni bulut hizmetine gönderilir; ikisi de varsayılan olarak kapalıdır. Üst çubukta bir dosya seçiliyse belge o dosyaya bağlanır.</div>
```

## [P1] jargon — satir 2428

**Mevcut:**
```
<span class="budgethint">Klasörü buraya da bırakabilirsiniz. Klasör özyinelemeli taranır; PDF · DOCX · TXT · UDF dışındaki dosyalar atlanır ve atlananlar adlarıyla listelenir. Dosyalar tek tek, sırayla yüklenir.</span>
```

**Neden:** "Özyinelemeli" bir bilgisayar bilimi terimi; avukat bilmez. "DOCX/TXT/UDF" de açıklamasız duruyor.

**Öneri:**
```
<span class="budgethint">Klasörü buraya da sürükleyebilirsiniz. Klasörün içindeki alt klasörler de taranır. PDF, Word, metin ve UYAP (UDF) dosyaları yüklenir; diğerleri atlanır ve adlarıyla listelenir. Dosyalar tek tek, sırayla yüklenir.</span>
```

## [P1] eksik-aciklama — satir 2449

**Mevcut:**
```
<div class="fieldlabel">Seçili şablon</div>
        <div class="statusline" id="tplchosen">şablon seçilmedi</div>
```

**Neden:** Taslak sekmesine geçtiğimde ne yapmam gerektiğini söyleyen tek cümle yok. "şablon seçilmedi" bir durum bildirimi, yönerge değil; küçük harfle başlıyor ve hangi listeden seçeceğimi söylemiyor.

**Öneri:**
```
<div class="fieldlabel">1. adım — hangi dilekçeyi yazacaksınız?</div>
        <div class="statusline" id="tplchosen">Henüz seçmediniz — yukarıdaki listeden bir dilekçe türü seçin, doldurulacak alanlar buraya gelsin.</div>
```

**Not:** Ekrana 2. adım (bilgileri doldur) ve 3. adım (gerekçenin dayanağını seç) yönergeleri de konmalı.

## [P1] tanimsiz-terim — satir 2752

**Mevcut:**
```
    QUALIFIED: ["ŞERHLİ", "warn", "§", "Tespitler kaynaklı; çekince veya çelişen otorite var."],
    PARTIAL: ["KISMİ", "bad", "!", "Bazı tespitler doğrulanamadı; cevap kesinleştirilemez."],
```

**Neden:** "ŞERHLİ" avukatta tapu şerhi / karşı oy şerhi çağrışımı yapar, cevap durumu olarak uydurulmuştur. "KISMİ" neyin kısmi olduğunu söylemiyor; açıklamalar da "tespit" ve "kesinleştirilemez" gibi tanımsız terimlere dayanıyor.

**Öneri:**
```
    QUALIFIED: ["ÇEKİNCELİ", "warn", "§", "Cümlelerin dayanağı var, ancak aksi yönde karar veya çekince bulundu — aşağıdaki karşıt otorite bölümünü okuyun."],
    PARTIAL: ["EKSİK", "bad", "!", "Bazı cümlelerin dayanağı doğrulanamadı; bu cevabı olduğu gibi dilekçeye almayın."],
```

## [P1] ui-kusuru — satir 3884

**Mevcut:**
```
  var TERM_TR = {
    "aktif dosya": "Aktif dosya: üst çubuktan seçtiğiniz dava dosyası — bu ekranda ürettiğiniz cevap ve taslak ile yüklediğiniz belge otomatik olarak ona bağlanır.",
    "KAYNAKSIZ": "KAYNAKSIZ: bu paragrafın metni, taslağa bağlı kanıtların hiçbirinin alıntısıyla örtüşmüyor — dayanağını siz eklemelisiniz.",
```

**Neden:** Ürünün tek sözlüğü var ama iki kusurlu: (1) yalnız fareyle üstüne gelince çıkan bir balon olarak gösteriliyor — avukat fareyle bekleyip terim aramaz; (2) ekranı asıl kilitleyen terimler sözlükte hiç yok: ÇEKİMSER, KESİNLEŞTİRİLEMEZ, ŞERHLİ, korpus, tespit, parmak izi, kapsam.

**Öneri:**
```
Sözlük terimleri ekranda görünür bir işaretle (küçük yuvarlak “?”) çizilmeli ve tıklanınca tanım açılmalı; ayrıca ÇEKİMSER / KESİNLEŞTİRİLEMEZ / ŞERHLİ / korpus / tespit / parmak izi maddeleri sözlüğe eklenmeli. En iyisi bu terimlerin hiç kullanılmaması; kullanılacaksa ilk geçtikleri yerde kendilerini bir cümleyle açıklamaları.
```

## [P1] tanimsiz-terim — satir 3974

**Mevcut:**
```
    lrow("kaynak", String((data.evidence || []).length));
    lrow("tespit", String((data.claims || []).length));
```

**Neden:** "tespit" bu üründe "programın ürettiği cümle" anlamında kullanılıyor; avukat için tespit, delil tespiti / bilirkişi tespitidir. Küçük harfli iki kelime ve iki sayı, neyin sayıldığını söylemiyor.

**Öneri:**
```
    lrow("Dayanak gösterilen pasaj", String((data.evidence || []).length));
    lrow("Üretilen cümle", String((data.claims || []).length));
```

**Not:** “Tespitler” bölüm başlığı da (section(out, "Tespitler"...)) “Programın vardığı sonuçlar” olmalı.

## [P1] jargon — satir 3978

**Mevcut:**
```
      var a = el("a", null, "Doğrulama dosyasını indir (JSON — alıntıların bağımsız denetimi için)");
```

**Neden:** "JSON" avukat için hiçbir şey ifade etmez; dosyayı indirse ne yapacağını bilmez. "Bağımsız denetim" kimin yapacağı belirsiz.

**Öneri:**
```
      var a = el("a", null, "Denetim dosyasını indir — bilirkişiye veya karşı tarafa verirseniz alıntıların değişmediğini kendileri doğrulayabilir");
```

## [P1] ton — satir 3998

**Mevcut:**
```
      ab.appendChild(el("h3", null, "ÇEKİMSER — cevap üretilmedi"));
      noticeLine(ab, null, "Doğrulanamayan içerik üretmek yerine cevap verilmedi: " +
        "aşağıda hiçbir kaynak kartı ve hiçbir tespit yoktur.");
```

**Neden:** Avukat hata yaptığını sanır. Cümle programın kendi işleyişini anlatıyor ("doğrulanamayan içerik üretmek yerine"), avukatın ne yapacağını değil. "Kaynak kartı" ve "tespit" yine tanımsız.

**Öneri:**
```
      ab.appendChild(el("h3", null, "Bu soruya cevap üretilmedi — hata yapmadınız"));
      noticeLine(ab, null, "Elinizdeki kaynaklarda bu soruyu karşılayan bir hüküm veya karar bulunamadı. " +
        "Uydurma bir cevap yazmaktansa boş bırakıldı. Aşağıdaki yollardan biriyle arama alanını genişletebilirsiniz.");
```

## [P1] anlasilmaz-cumle — satir 5356

**Mevcut:**
```
      hint.textContent = "kanıt bağlanmaz; hukukî değerlendirme paragrafları KAYNAKSIZ işaretlenir ve taslak yalnız beyan niteliğindedir";
```

**Neden:** Üç yan yana dizilmiş edilgen yapı, küçük harfle başlayan bir cümle ve tanımsız bir büyük harfli terim. Avukat bu seçeneği seçtiğinde eline ne geçeceğini anlamıyor.

**Öneri:**
```
      hint.textContent = "Taslak, belgeye bağlı dayanak olmadan yazılır: hukukî gerekçe paragraflarının üstünde kırmızı bir uyarı çıkar ve gerekçeyi siz eklersiniz. Olay ve talep bölümleri normal yazılır.";
```

## [P1] jargon — satir 8157

**Mevcut:**
```
      "Sistem: veritabanı " + (DB_STATE_TR[h.db] || h.db || "?") +
      " · canlı araştırma " + (MCP_STATE_TR[h.mcp] || h.mcp || "?") +
      " · Bulut AI " + (h.ai && h.ai.configured ? "açık" : "kapalı") + "."
```

**Neden:** Karşılama kartının son satırı. Avukat "veritabanı bağlı · canlı araştırma kapalı" okuyor ve bunun kendisi için ne anlama geldiğini bilmiyor; kapalı olanı açması gerekip gerekmediği de yazmıyor.

**Öneri:**
```
      "Şu an: kayıtlarınız " + (h.db === "ok" ? "çalışıyor" : "çalışmıyor") +
      " · resmî kaynaklara bağlantı " + (h.mcp === "ok" ? "açık" : "kapalı — yalnız bu bilgisayardaki arşivde arama yapılır") +
      " · bulut yardımcı " + (h.ai && h.ai.configured ? "açık" : "kapalı — hiçbir belgeniz bilgisayardan çıkmıyor") + "."
```

## [P1] jargon — satir 9878

**Mevcut:**
```
      line: "Yerel korpusta arar; her tespiti belge sürümü, Unicode konumu ve SHA-256 ile bağlar.",
```

**Neden:** "Hukukî soru sor" kartı — avukatın ilk tıklayacağı yer. Açıklama satırında dört anlaşılmaz terim üst üste: korpus, tespit, Unicode konumu, SHA-256.

**Öneri:**
```
      line: "Bu bilgisayardaki mevzuat ve karar arşivinde arar; yazdığı her cümlenin altına dayandığı metinden birebir alıntıyı koyar.",
```

## [P1] eksik-aciklama — satir 9908

**Mevcut:**
```
      line: "30 usul kuralı, adli tatil ve HMK m. 92/2 ile hesaplar; her sonuç DOĞRULANMADI etiketiyle gelir.",
```

**Neden:** İki kusur var. Sayı tutmuyor: programda 41 süre kuralı var (Ayarlar › Sistem durumu 41 yazıyor), kart 30 diyor — avukat iki ekranda iki farklı sayı görüyor. İkincisi "her sonuç DOĞRULANMADI etiketiyle gelir" cümlesi tüm özelliği güvenilmez gösteriyor ama neyin doğrulanmadığını söylemiyor.

**Öneri:**
```
      line: "Adli tatili ve HMK m. 92/2 kuralını da uygulayarak tarihi hesaplar, adım adım gösterir. Kuralların bir bölümünün madde metni henüz karşılaştırılmadığı için sonucu maddeden teyit etmeniz beklenir.",
```

**Not:** Sayı yazılacaksa /v1/deadlines/rules'tan canlı okunmalı, sabit yazılmamalı.

## [P1] jargon — satir 9914

**Mevcut:**
```
      line: "13 şablon; dayanağı olmayan her paragraf KAYNAKSIZ işaretlenir, doğrulanamayan atıfta dışa aktarım reddedilir.",
```

**Neden:** "Dışa aktarım reddedilir" mühendis dili ve tehdit gibi okunuyor; "KAYNAKSIZ" hâlâ tanımsız. Avukat bu kartın ona ne kazandıracağını anlamıyor.

**Öneri:**
```
      line: "13 hazır dilekçe türü. Dayanağı gösterilemeyen paragrafın üstüne kırmızı uyarı koyar; atfı doğrulanamayan bir taslağı Word'e çıkarmaz — yanlış atıflı dilekçe UYAP'a gitmesin diye.",
```

## [P2] jargon — satir 10988

**Mevcut:**
```
    row("Canlı araştırma (MCP)", (MCP_STATE_TR[h.mcp] || h.mcp || "?") +
      (typeof h.registeredToolCount === "number" ? " · " + h.registeredToolCount + " araç" : ""));
```

**Neden:** "(MCP)" avukat için tamamen anlamsız bir kısaltma; "54 araç" da neyi saydığını söylemiyor.

**Öneri:**
```
    row("Resmî kaynaklara bağlantı", (MCP_STATE_TR[h.mcp] || "?") +
      (h.mcp === "ok" ? " — Yargıtay, Danıştay, mevzuat.gov.tr ve kurum kararlarında arama yapılabilir" : " — şu an yalnız bu bilgisayardaki arşivde arama yapılabilir"));
```

**Not:** Araç sayısı ve MCP adı “Teknik ayrıntılar” bölümünde kalmalı.

## [P2] jargon — satir 10990

**Mevcut:**
```
    row("Bulut AI", ai.configured ? "yapılandırıldı · model " + (ai.model || "?") + (ai.liveTested ? "" : " · canlı sınanmadı") : "kapalı — bulut anahtarı tanımlı değil (ortam değişkeni: ANTHROPIC_API_KEY)");
```

**Neden:** "Yapılandırıldı", "model", "canlı sınanmadı", "bulut anahtarı", "ortam değişkeni: ANTHROPIC_API_KEY" — beş makine terimi tek satırda. Avukat kapalı olmanın iyi mi kötü mü olduğunu bilemiyor.

**Öneri:**
```
    row("Bulut yardımcı", ai.configured ? "Açık — yalnız sizin açıkça istediğiniz işlemde belge metni buluta gönderilir. Bu bağlantı henüz gerçek kullanımda sınanmadı." : "Kapalı — hiçbir belgeniz bu bilgisayardan çıkmıyor. Açmak isterseniz kurulumu yapan kişiden bulut anahtarı tanımlamasını isteyin.");
```

## [P2] jargon — satir 10994

**Mevcut:**
```
    row("Korpus", c ? c.publicDocuments + " korpus belgesi · " + c.uploads + " yüklenen belge" + (h.demoCorpus ? " · DENEME KORPUSU (sentetik)" : "") : "sayılamadı (veritabanı bağlı değil)");
```

**Neden:** Satır adı "Korpus"; avukat okuyamaz. "Sentetik" de tanımsız.

**Öneri:**
```
    row("Arşiv", c ? c.publicDocuments + " mevzuat/karar belgesi · " + c.uploads + " sizin yüklediğiniz belge" + (h.demoCorpus ? " — DİKKAT: bu belgeler gerçek mevzuat değil, programı denemek için yazılmış örneklerdir" : "") : "sayılamadı — kayıtlara ulaşılamıyor");
```
