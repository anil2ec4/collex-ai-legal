# bilgi-mimarisi

Ekran mimarisi bugün "beş sekme + dokuz gizli ekran" olarak kurulmuş ve bir avukatın günlük işi bu yapıya oturmuyor. En kritik kusur: bir avukatın en sık yaptığı iş olan KARAR ARAMA'nın sekmesi yok; "Araştır" sekmesinin içindeki on beş kartlık ızgarada dördüncü kart olarak duruyor ve ekranı ilk açan biri onu göremez. Aynı şekilde takvim, harç, sözleşme incelemesi, atıf denetimi ve kapsam sayfası da "Araştır" adının altında saklı — hiçbiri araştırma değil. Sekme adları da işin adı olmaktan çıkmış: "Dosyalarım" dava dosyasını, "Belgeler" bilgisayardaki dosyayı anlatıyor ama üst çubuk "Aktif dosya", Belgeler ekranı yine "Dosya" süzgeci diyor; avukat için "dosya" tek kelimedir ve ekran onu iki ayrı anlamda kullanıyor. Sekme sırası da günlük akışa ters: dosya aç → belge yükle → soru sor sırası varken sekmeler Dosyalarım · Araştır · Belgeler diye diziliyor, yani üçüncü adım ikinciden önce geliyor. Gizli ekranların "geri" düğmeleri geldiğiniz yeri değil sabit bir yeri gösteriyor (Kapsam'a Araştır'dan girip "← Ayarlar" ile çıkıyorsunuz). Ve en büyük eksik: uygulamanın kendini anlattığı bir "Nasıl çalışır?" sayfası ile ekranlardaki özel sözcükleri açıklayan bir "Sözlük" sayfası hiç yok — oysa gezinme yüzeyinin kendisi SHA-256, korpus, uç, istek, manifesto, ızgara gibi sözcüklerle dolu.

Bulgu: 31

## [P0] ui-kusuru — satir 2221

**Mevcut:**
```
    <nav class="views" aria-label="Görünümler" role="tablist">
```

**Neden:** Avukatın en sık yaptığı iş — bir karar aramak — sekme değil. "Karar ara" ekranına ulaşmanın tek yolu Araştır sekmesine geçip on beş kartlık ızgarada dördüncü kartı bulmak. Ekranı ilk açan bir avukat bu programın karar arayabildiğini göremez; rakip ürünlerde bu birinci sekmedir.

**Öneri:**
```
"Karar ara" sekme çubuğuna kendi sekmesi olarak çıkarılsın. Önerilen sıra: Dosyalarım · Belgeler · Karar ara · Soru sor · Taslak · Ayarlar · Nasıl çalışır?. Karar arama ekranı bugün zaten çalışıyor ve kendi ekranı var (#karar-ara); yapılacak tek şey onu gizli ekran olmaktan çıkarıp sekmeye bağlamak ve HIDDEN_VIEWS listesinden almak.
```

## [P0] ui-kusuru — satir 2221

**Mevcut:**
```
<nav class="views" aria-label="Görünümler" role="tablist">
```

**Neden:** Sekme sırası günlük akışa ters. Avukatın işi: dava dosyası aç → belge yükle → soru sor → dilekçe yaz → süre hesapla. Sekmeler ise Dosyalarım · Araştır · Belgeler · Taslak · Ayarlar. Yani ikinci adım (belge yükle) üçüncü sırada, üçüncü adım (soru sor) ikinci sırada. Soldan sağa okuyan biri yanlış sıra öğreniyor.

**Öneri:**
```
Sekmeler işin sırasına dizilsin: Dava dosyalarım · Belgeler · Karar ara · Soru sor · Taslak · Ayarlar · Nasıl çalışır?. Süre ve takvim, dava dosyası sekmesinin içinde kalsın (bugün olduğu gibi).
```

## [P0] ui-kusuru — satir 2222

**Mevcut:**
```
<button type="button" class="viewtab" id="tab-dosyalarim" data-view="dosyalarim" role="tab" aria-selected="false" aria-controls="view-dosyalarim">Dosyalarım</button>
```

**Neden:** Avukat için "dosya" dava dosyasıdır; bilgisayarda ise yüklenen belge de dosyadır. Arayüz ikisini karıştırıyor: sekme "Dosyalarım" (dava dosyası), yanındaki sekme "Belgeler" (yüklenen dosya), üst çubuk "Aktif dosya", Belgeler ekranındaki süzgecin etiketi yine "Dosya" ama orada dava dosyası kastediliyor, yükleme alanı "Belge bırakın veya seçin" diyor. Aynı ekranda iki farklı "dosya" var.

**Öneri:**
```
Sekme adı "Dava dosyalarım" olsun; üst çubuktaki seçicinin etiketi "Çalıştığım dava dosyası"; Belgeler ekranındaki süzgecin etiketi "Dava dosyası"; "Dosyasız çalışma" yerine "Dava dosyasına bağlamadan çalış". Yüklenen şeye her yerde "belge" denilsin, hiçbir yerde "dosya" denmesin.
```

## [P0] ui-kusuru — satir 2223

**Mevcut:**
```
<button type="button" class="viewtab" id="tab-arastir" data-view="arastir" role="tab" aria-selected="false" aria-controls="view-arastir">Araştır</button>
```

**Neden:** "Araştır" sekmesi bugün on beş ayrı işin toplandığı yer: takvim, harç hesabı, sözleşme incelemesi, atıf denetimi, kapsam sayfası, süre hesabı, kayıtlı cevaplar... Bunların hiçbiri araştırma değil. Sekme adı içindekini anlatmıyor; avukat harç hesabını "Araştır" altında aramaz.

**Öneri:**
```
Sekme ikiye ayrılsın. Soru sorma işi kendi sekmesinde kalsın: "Soru sor". Takvim, harç, sözleşme incelemesi, atıf denetimi, süre hesabı, toplu belge incelemesi gibi araçlar ise "Nasıl çalışır?" sayfasındaki "Bütün işler" listesine ve ilgili sekmelerin içine dağıtılsın (takvim ve süre → Dosyalarım; sözleşme incelemesi ve toplu belge incelemesi → Belgeler; atıf denetimi → Taslak). Hiçbir iş yalnızca kart ızgarasında yaşamasın.
```

## [P0] eksik-aciklama — satir 2226

**Mevcut:**
```
<button type="button" class="viewtab" id="tab-ayarlar" data-view="ayarlar" role="tab" aria-selected="false" aria-controls="view-ayarlar">Ayarlar</button>
```

**Neden:** Uygulamanın kendini anlattığı hiçbir sayfa yok. Avukat ekranı ilk açtığında "bu program ne yapar, ben ne yapmalıyım, şu yazan kelime ne demek" sorularının cevabını hiçbir yerde bulamıyor. Karşılama kartı üç satırdır ve profil girildikten sonra bir daha hiç görünmez; ondan sonra geri dönülecek bir açıklama sayfası kalmıyor.

**Öneri:**
```
Sekme çubuğuna ALTINCI ve EN SAĞDAKİ sekme olarak "Nasıl çalışır?" eklensin (Ayarlar'ın sağına): <button type="button" class="viewtab" id="tab-nasil" data-view="nasil" role="tab" aria-selected="false" aria-controls="view-nasil">Nasıl çalışır?</button>. Bu sayfa üç bölümden oluşsun: (1) "Bir günlük iş nasıl yürür" — dosya aç, belge yükle, soru sor, dilekçe yaz, süre hesapla adımları, her adımda o ekrana giden düğmeyle; (2) "Bu program neyi vaat eder, neyi etmez" — her cevabın alıntısını kaynağına bağladığı, alıntının bozulmadığını kendiliğinden denetlediği, hukukî değerlendirme yerine geçmediği; (3) "Ekranda geçen sözcükler" — Sözlük (ayrı bulgu). Sayfa her zaman aynı yerde durmalı; karşılama kartı gibi kaybolmamalı.
```

## [P0] eksik-aciklama — satir 2227

**Mevcut:**
```
    </nav>
```

**Neden:** Ekranda tanımı hiçbir yerde yazmayan onlarca özel sözcük var: yerel korpus, kapsam, tespit, kaynak kartı, çekimser, kaynaksız, ızgara, kapsanmadı, künye, deneme korpusu, bulut AI. Avukat bunlardan birine takılınca soracak kimse yok; ekranı kapatır.

**Öneri:**
```
"Nasıl çalışır?" sayfasının üçüncü bölümü "Ekranda geçen sözcükler" olsun ve her sözcük TEK CÜMLEYLE tanımlansın; ayrıca ekranlarda bu sözcüklerin ilk geçtiği yere, tıklanınca sözlüğün o satırına giden küçük bir "nedir?" bağlantısı konsun. Örnek satırlar: "Kaynak kartı — cevaptaki bir cümlenin dayandığı alıntının künyesi, tarihi ve metni." · "Çekimser — dayanağı yeterli bulunmadığı için cevap üretilmedi; ekranda hiçbir tespit yoktur." · "Kaynaksız — bu cümlenin arkasında doğrulanmış bir alıntı yok, yalnız beyandır." · "Kapsanmadı — bu belge bu soruya cevap verecek bir bölüm içermiyor."
```

## [P0] jargon — satir 2233

**Mevcut:**
```
<div class="strip demo" id="demobanner" hidden role="status">DENEME KORPUSU (sentetik deneme belgeleri) — bu sunucu sentetik deneme belgeleriyle çalışıyor; hiçbir sonuç gerçek hukukî değerlendirme değildir.</div>
```

**Neden:** Ekranın en üstündeki en önemli uyarı, üç anlaşılmaz sözcükle açılıyor: KORPUS, SENTETİK, SUNUCU. Uyarının işlevi avukatı durdurmak; anlaşılmayan uyarı okunmaz.

**Öneri:**
```
DENEME ARŞİVİ — Bu kurulumda gerçek mevzuat ve kararlar değil, sınama için yazılmış örnek metinler var. Buradan çıkan hiçbir sonucu bir dosyada kullanmayın.
```

## [P0] anlasilmaz-cumle — satir 2304

**Mevcut:**
```
Her kart, bu sunucuda bugün çalışan bir uca sabit bir istek gönderir. Çalışmayan bir iş burada kart olarak görünmez.
```

**Neden:** "Sunucu", "uç", "istek" — üçü de avukatın bilmediği mühendislik sözcüğü. Cümle üstelik avukata ne yapacağını da söylemiyor; sadece programın iç işleyişini anlatıyor.

**Öneri:**
```
Aşağıdaki işlerden birini seçin. Bugün çalışmayan bir iş listede soluk görünür ve nedenini yazar.
```

## [P0] tanimsiz-terim — satir 2313

**Mevcut:**
```
          <div class="fieldlabel">Kapsam</div>
```

**Neden:** "Kapsam" bu arayüzde ÜÇ ayrı anlamda kullanılıyor: (1) burada, sorunun nerede aranacağı; (2) Ayarlar'daki "Kapsam sayfası" — hangi resmî kaynaklara bağlıyız; (3) "Yüklediğim belgeler kapsamında" ifadesinde. İkisi de gezinilebilir bir ekrana götürüyor. Avukat aynı kelimeyi tıklayıp farklı yerlere düşüyor.

**Öneri:**
```
Bu etiket "Nerede aransın?" olsun. Ayarlar'daki sayfanın adı "Hangi kaynaklara bağlıyız?" olsun ve "kapsam" sözcüğü oradan da kalksın. Üçüncü kullanım "seçtiğiniz belgelerde" diye yazılsın. Tek kelime tek anlam.
```

## [P0] jargon — satir 2315

**Mevcut:**
```
<label class="rchip"><input type="radio" name="mode" id="mode-local" value="local" checked><span>Yerel korpus</span></label>
```

**Neden:** "Korpus" hiçbir avukatın bilmediği bir sözcük ve VARSAYILAN seçenek. Yani avukat programa girdiğinde ilk gördüğü seçim, adını anlamadığı bir seçenektir. "Yerel" de bilgisayarcı sözcüğüdür.

**Öneri:**
```
<span>Bu bilgisayardaki arşiv</span> — altına açıklama: "Programla birlikte gelen mevzuat ve karar arşivi. İnternete çıkmaz."
```

## [P0] tanimsiz-terim — satir 2390

**Mevcut:**
```
<h2 class="fname" id="gridtitle" tabindex="-1">Belge × soru ızgarası</h2>
```

**Neden:** "Izgara" uydurulmuş bir addır; hiçbir yerde tanımı yok ve avukat sözlüğünde yeri yoktur. "×" işareti de matematik gösterimidir. Ekranın adı ne iş yaptığını söylemiyor.

**Öneri:**
```
<h2 class="fname" id="gridtitle" tabindex="-1">Aynı soruyu birçok belgeye sor</h2> — alt satır: "Seçtiğiniz belgelerin her birine aynı soruları sorar ve cevapları tek tabloda yan yana koyar."
```

## [P0] jargon — satir 2393

**Mevcut:**
```
Her hücre ayrı bir <code>POST /v1/answer</code> isteğidir ve yalnız o belgenin metniyle cevaplanır; dolu her hücre kaynağı olan parçaya bağlıdır.
```

**Neden:** Ekranın gövdesinde çıplak bir teknik adres yazıyor. "POST", "/v1/answer", "istek", "parça" — dördü de avukat için anlamsız. Cümle ayrıca ne yapacağını değil, programın nasıl çalıştığını anlatıyor.

**Öneri:**
```
Her hücre ayrı ayrı hesaplanır ve yalnız o belgenin kendi metnine bakar; dolu her hücrenin altında dayandığı alıntı vardır.
```

## [P0] ui-kusuru — satir 2672

**Mevcut:**
```
      <button type="button" class="ghost small" id="kapsam-back">← Ayarlar</button>
```

**Neden:** Kapsam sayfasına ÜÇ ayrı yerden girilebiliyor: Ayarlar'daki karttan, Araştır'daki "Neyi tarıyoruz?" kartından ve Karar ara ekranındaki düğmeden. Ama geri düğmesi her hâlde "← Ayarlar" diyor. Karar ara ekranından girip geri basan avukat, hiç bulunmadığı Ayarlar ekranında buluyor kendini ve aramasını kaybediyor.

**Öneri:**
```
Geri düğmesi geldiğiniz ekranı göstersin: gotoView çağrısına gelinen ekranın adı taşınsın ve düğme "← Karar ara" / "← Ayarlar" / "← Soru sor" diye o ada göre yazılsın. Aynı düzeltme harc-back, sozlesme-back, denetim-back, takvim-back ve karar-ara-back için de geçerli.
```

## [P0] jargon — satir 9878

**Mevcut:**
```
line: "Yerel korpusta arar; her tespiti belge sürümü, Unicode konumu ve SHA-256 ile bağlar.",
```

**Neden:** Tek cümlede üç anlaşılmaz sözcük: korpus, Unicode konumu, SHA-256. Bu cümle "Hukukî soru sor" kartının açıklaması, yani avukatın programı kullanmaya başlayacağı yer. Burada ekranı kapatır.

**Öneri:**
```
line: "Bu bilgisayardaki mevzuat ve karar arşivinde arar; her cümlenin altına dayandığı alıntıyı, tarihini ve nereden geldiğini yazar.",
```

## [P0] jargon — satir 13109

**Mevcut:**
```
Belgelerinizi ve mevzuatı tarar, her tespiti belge sürümü ve SHA-256 
```

**Neden:** Karşılama kartının ikinci cümlesi — avukatın programda okuduğu ilk beş satırdan biri — SHA-256 yazıyor. Ayrıca "tespit" burada hukukî anlamında değil, teknik anlamda (üretilen cümle) kullanılıyor; avukat "mahkeme tespiti" sanır.

**Öneri:**
```
Belgelerinizi ve mevzuatı tarar, yazdığı her cümlenin altına dayandığı alıntıyı ve o alıntının hangi belgenin hangi sürümünden geldiğini koyar; alıntının sonradan bozulup bozulmadığını kendiliğinden denetler. Dayanağı olmayan cümleyi KAYNAKSIZ diye işaretler.
```

## [P1] jargon — satir 2201

**Mevcut:**
```
<button type="button" class="pill" id="pill-db" title="Sistem durumu — Ayarlar"><span class="dot"></span><span class="t">Veritabanı</span></button>
```

**Neden:** Üst çubukta sürekli görünen üç rozetten biri "Veritabanı" diyor. Avukat veritabanının ne olduğunu bilmez, kırmızı yandığında ne yapacağını da bilmez. Rozet tıklanabilir ama tıklanabilir göründüğü belli değil.

**Öneri:**
```
Etiket "Arşiv" olsun ve durumu Türkçe yazsın: "Arşiv: hazır" / "Arşiv: açılamadı". Kırmızı olduğunda tıklanınca gidilen yerde ne yapılacağı yazılsın ("ColleX-Baslat.cmd ile yeniden başlatın"). Rozetlerin tıklanabilir olduğu, üzerine gelince değişen bir çerçeveyle belli edilsin.
```

## [P1] anlasilmaz-cumle — satir 2231

**Mevcut:**
```
<b>Veri kaynağı</b> — <span class="notice-text" id="corpus-notice">bu sunucudaki belge deposuna ilişkin uyarı, ilk cevapla birlikte burada görünecek</span>
```

**Neden:** Ekranın en üst şeridi, açılışta boş bir vaatle duruyor: "uyarı burada görünecek". Bu satır avukata bugün hiçbir şey söylemiyor, yer kaplıyor ve "sunucu", "belge deposu" sözcükleriyle korkutuyor.

**Öneri:**
```
Şerit, söyleyecek bir şey olmadığında hiç çizilmesin. Söyleyecek şey olduğunda şöyle yazsın: "Bu cevap hangi arşivden geldi — " + gelen açıklama.
```

## [P1] ui-kusuru — satir 2249

**Mevcut:**
```
        <button type="button" class="ghost primary" id="quickdeadline">Süre hesapla</button>
```

**Neden:** Aynı iş iki ayrı yerde ve iki ayrı adla duruyor: burada "Süre hesapla" düğmesi, Araştır sekmesinde ise "Süre hesapla" adlı bir kart. Aynısı takvim için de geçerli (buradaki "Takvimi aç" ve Araştır'daki "Takvim ve duruşma hazırlığı" kartı). Avukat iki işin farklı şeyler olduğunu sanıyor; sonra ikisinin aynı pencereyi açtığını görüp programa güvenini yitiriyor.

**Öneri:**
```
Her işin TEK bir evi olsun. Süre hesabı ve takvim burada, dava dosyaları ekranında kalsın; Araştır'daki "Süre hesapla" ve "Takvim ve duruşma hazırlığı" kartları kaldırılsın. Bir işin ikinci girişi olacaksa, ikinci yerde aynı ad ve aynı simge kullanılsın — farklı ad kullanılmasın.
```

## [P1] ui-kusuru — satir 2300

**Mevcut:**
```
  <section id="view-arastir" aria-label="Araştır görünümü">
```

**Neden:** Beş ana ekranın dördü ve dokuz gizli ekranın hepsi hidden ile başlıyor, yalnız bu biri değil. Sayfa açılırken, adres çubuğunda hangi ekran yazarsa yazsın, önce Araştır ekranı bir an görünüp sonra kayboluyor. Avukat her açılışta bir titreme görüyor ve ilk gördüğü ekran istediği ekran olmuyor.

**Öneri:**
```
  <section id="view-arastir" hidden aria-label="Araştır görünümü"> — açılışta hangi ekranın çizileceğine yalnızca showView karar versin.
```

## [P1] eksik-aciklama — satir 2302

**Mevcut:**
```
      <div class="fieldlabel">Ne yapmak istiyorsunuz?</div>
```

**Neden:** On beş kart tek bir ızgarada, hiçbir gruplama olmadan diziliyor: belge işleri, karar arama, takvim, harç, dilekçe ve kayıtlı cevaplar aynı düzlemde. Avukat aradığını gözle taramak zorunda; kartlar arasında hiçbir öncelik ya da sıra yok. Ayrıca bu ızgara programın gerçek "başlangıç ekranı" işlevini görüyor ama Araştır sekmesinin altında saklı.

**Öneri:**
```
Kartlar üç başlık altında gruplansın ve her grubun kendi başlığı olsun: "Belgelerim üzerinde" (özet, kronoloji, aynı soruyu birçok belgeye sor, sözleşme incelemesi) · "Araştırma" (karar ara, soru sor, karşıt içtihat, canlı kaynaklar, kayıtlı cevaplar) · "Hesap ve takvim" (süre, harç, takvim, atıf denetimi). Bu gruplu liste ayrıca "Nasıl çalışır?" sayfasında "Bütün işler" başlığıyla da bulunsun, ki avukat bir işi Araştır sekmesine girmeden de bulabilsin.
```

## [P1] ui-kusuru — satir 2674

**Mevcut:**
```
    <div id="kapsam-out" aria-live="polite"></div>
```

**Neden:** Kapsam ekranının HTML gövdesinde hiçbir başlık yok — sadece bir geri düğmesi ve boş bir kutu. Diğer bütün gizli ekranlar (karar-ara, denetim, takvim, harç, sözleşme) kendi başlığını ve bir alt açıklama satırını taşıyor. Bu ekran açıldığında, içerik gelene kadar avukat nerede olduğunu bilmiyor; içerik gelmezse hiç bilmiyor.

**Öneri:**
```
Diğer ekranlarla aynı kalıp kullanılsın: <section class="card"><div class="screenhead"><h2 id="kapsam-title" tabindex="-1">Hangi kaynaklara bağlıyız?</h2><span class="sub">Bağlı olduğumuz resmî kaynaklar, bugün kapalı olanlar ve hiç taramadığımız alanlar. Ölçmediğimiz yere sayı yazmayız.</span></div></section> ve altında kapsam-out.
```

## [P1] ui-kusuru — satir 4402

**Mevcut:**
```
    if (name === "dosyalar") { return { name: "belgeler", arg: "" }; }
```

**Neden:** Bir sonraki satır, tanımadığı her adresi sessizce "Dosyalarım" ekranına düşürüyor. Avukat kaydettiği bir bağlantıyı açtığında ya da adres yanlış yazıldığında hiçbir açıklama görmeden başka bir ekranda buluyor kendini; ne olduğunu anlamıyor, hata sanıyor.

**Öneri:**
```
Bilinmeyen adres yine Dosyalarım'a düşsün ama sessizce değil: ekranın üstünde tek satır bir bilgi çıksın — "Aradığınız ekran bulunamadı; dava dosyalarınıza getirildiniz." (bugünkü toast düzeni bunun için yeterli).
```

## [P1] jargon — satir 9836

**Mevcut:**
```
      out: "üç kovalı denetim tablosu · DOCX",
```

**Neden:** "Kova" veri işleme terimi; avukat üç kovanın ne olduğunu bilmez. Tablonun üç sütunu "bulundu / bulunamadı / emin değiliz" demek ama ekran bunu söylemiyor.

**Öneri:**
```
      out: "her atıf için bulundu / bulunamadı / emin değiliz tablosu · Word belgesi",
```

## [P1] jargon — satir 9842

**Mevcut:**
```
      out: "künye listesi · hash'li tam metin kartı",
```

**Neden:** "hash" doğrudan mühendislik sözcüğü. Kartın "Çıktı:" satırı avukata elinde ne kalacağını söylemesi gereken yer; burada anlaşılmaz bir sözcükle söylüyor.

**Öneri:**
```
      out: "karar künyeleri · tam metin — metnin bozulmadığı otomatik denetlenir",
```

## [P1] jargon — satir 9866

**Mevcut:**
```
      out: "kapsam manifestosu",
```

**Neden:** "Manifesto" burada teknik anlamda (liste dosyası) kullanılmış; Türkçede manifesto bildirge demektir ve avukat bunun bir kaynak listesi olduğunu anlamaz. "Kapsam" da üç anlamlı sözcük.

**Öneri:**
```
      out: "bağlı olduğumuz resmî kaynakların listesi",
```

## [P1] ton — satir 9871

**Mevcut:**
```
      line: "Aynı soruları birçok belgeye sorar; satır belge, sütun soru, her hücre kaynağına bağlı.",
```

**Neden:** Cümle programın tablo düzenini anlatıyor (satır, sütun, hücre) — yani mühendisin gördüğü şeyi. Avukatın sorusu "bu bana ne kazandırır" — cevap yok.

**Öneri:**
```
      line: "Otuz sözleşmeye aynı üç soruyu tek seferde sorar; cevapları tek tabloda karşılaştırırsınız, her cevabın altında dayandığı alıntı durur.",
```

## [P2] eksik-aciklama — satir 2196

**Mevcut:**
```
<select id="matterselect" class="matterpick" title="Aktif dosya: araştırmalar, belgeler ve taslaklar bu dosyaya bağlanır">
```

**Neden:** Bu seçicinin ne işe yaradığı yalnızca fare üzerinde beklenince çıkan bir ipucunda yazıyor. Fare ipuçları okunmaz; dokunmatik ekranda hiç görünmez. Aktif dosya seçmenin sonucu (yüklenen her belgenin oraya bağlanması) ekranda kalıcı olarak yazmıyor.

**Öneri:**
```
İpucu metni seçicinin ALTINA kalıcı, küçük bir satır olarak yazılsın: "Seçtiğiniz dava dosyası: bundan sonra yüklediğiniz belgeler, aldığınız cevaplar ve yazdığınız taslaklar bu dosyaya bağlanır." Seçili dosya yokken bu satır sarı şeritteki uyarıyla aynı şeyi söylemesin — tekrar etmesin, tamamlasın.
```

## [P2] ui-kusuru — satir 2237

**Mevcut:**
```
    <button type="button" class="ghost" id="nomatter-go">Dosyalarım</button>
```

**Neden:** Düğme etiketi bir ekran adı; ne olacağını söylemiyor. Avukat "Dosyalarım"a basınca ne yapması gerektiğini de bilmiyor — oysa uyarı şeridi ondan bir dava dosyası SEÇMESİNİ istiyor.

**Öneri:**
```
    <button type="button" class="ghost" id="nomatter-go">Dava dosyası seç</button>
```

## [P2] ui-kusuru — satir 2444

**Mevcut:**
```
  <section id="view-taslak" hidden aria-label="Taslak görünümü">
```

**Neden:** "Taslak" sekmesi açıldığında ekranda önce şablon listesi çıkıyor, form ise gizli (draftform hidden). Sekmenin adı da tek başına ne yapılacağını söylemiyor: taslak neyin taslağı? Avukat "dilekçe" der.

**Öneri:**
```
Sekme adı "Dilekçe yaz" olsun. Ekranın en üstüne, şablon listesinden önce tek satırlık bir yön cümlesi konsun: "Bir şablon seçin; ardından hangi araştırmanın ya da hangi belgelerin dayanak olacağını söyleyin."
```

## [P2] ui-kusuru — satir 2536

**Mevcut:**
```
        <button type="button" class="ghost small" id="kapsam-open">Kapsam sayfasını aç</button>
```

**Neden:** Ayarlar ekranı dört ayrı iş barındırıyor: avukat profili, sistem durumu, yedekleme ve kaynak kapsamı. Kaynak kapsamı bir ayar değil, bir açıklamadır; oraya konması avukatın onu hiç bulamamasına yol açıyor.

**Öneri:**
```
Bu kart Ayarlar'dan alınıp "Nasıl çalışır?" sayfasına taşınsın ve orada "Hangi kaynaklara bağlıyız?" başlığıyla dursun. Düğme etiketi: "Kaynak listesini gör".
```

## [P2] ui-kusuru — satir 2563

**Mevcut:**
```
      <button type="button" class="ghost small" id="karar-ara-back">← Araştır</button>
```

**Neden:** Gizli ekranların hepsinde geri düğmesi tek başına, sayfanın sol üstünde duruyor ve o ekranın ADI ekranın gövdesinde, kartın içinde yazıyor. Yani avukat sayfanın tepesinde nerede olduğunu değil, nereden geldiğini okuyor. Kırıntı yolu (Dosyalarım › Yılmaz / Kira tahliye) düzeni dosya ve belge sayfalarında var, bu ekranlarda yok.

**Öneri:**
```
Geri düğmesi ile ekran adı tek satırda birleşsin: "← Soru sor  ·  Karar ara" — dosya ve belge sayfalarındaki kırıntı yolu düzeninin aynısı kullanılsın, böylece bütün ekranlar aynı biçimde okunur.
```
