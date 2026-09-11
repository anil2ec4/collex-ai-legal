# rakip-anlatim

Apilex ve De Jure, avukata urunu DAIMA fayda cumlesiyle anlatiyor: "Arastirma, Analiz ve Uretim Tek Ekranda", "Dilekce yazdirma, derin arastirma, sozlesme hazirlama", "risk raporu", "kaynakcali rapor", "Klasorlerim", "Yeni Dilekce", "Analizi Gor". Hicbirinde tek bir teknik sozcuk yok; mekanizmayi hic anlatmiyorlar (zaten anlatamiyorlar - sozlesmelerinde garantiyi geri aliyorlar). ColleX'in gercek ustunlugu tam da mekanizma; ama ekran o mekanizmayi MUHENDIS SOZLUGUYLE anlatiyor: avukatin gordugu ilk cumlede "SHA-256", is kartlarinda "Unicode konumu", "hash'li tam metin karti", "uc kovali denetim tablosu", "kapsam manifestosu", "tablo + CSV"; hata kartlarinda "uc", "404"; Kapsam ekraninda "Gecidin bildirdigi arac", "Uygulanan migrasyon". Sonuc: en guclu satirimiz - "alintinin bozulmadigini sistem kendisi denetler" - rakibin pazarlama cumlesinden zayif duyuluyor, cunku avukat cumleyi okuyamiyor. Ikinci yapisal fark gezinmede: rakiplerin modulleri menude adlariyla durur (De Jure sol raf: Klasorlerim, Gecmis, Yeni Dilekce, Editor), bizde "Karar ara", "Takvim", "Harc", "Sozlesme incelemesi", "Atif denetimi", "Kapsam" menude YOK; yalniz Arastir sekmesindeki kart yigininda bulunuyor - yani rakibin en cok sattigi moduller bizde gizli. Alinmasi gereken aliskanlik: modulu adiyla menuye koymak, her ekrani "ne alacaksin" cumlesiyle acmak, mekanizmayi teknik adi olmadan tarif etmek (dogruluk iddiasi ATMADAN). Alinmamasi gereken aliskanlik: sayi ve yuzde iddiasi.

Bulgu: 33

## [P0] tanimsiz-terim — satir 2218

**Mevcut:**
```
<p class="tagline">Yargı &amp; Mevzuat Kanıt Sistemi</p>
```

**Neden:** Ekranın tepesindeki tek tanıtım cümlesi ve avukata ne işe yaradığını söylemiyor. "Kanıt Sistemi" hukukta delil hukukunu çağrıştırır; kastedilen ise kaynağa bağlılık. Apilex/De Jure aynı yerde ne yapıldığını sayar.

**Öneri:**
```
Karar ve mevzuat araştırması · süre ve harç hesabı · dilekçe taslağı — hepsi bu bilgisayarda, aboneliksiz.
```

**Not:** UXAUDIT U8: ekranın %60'ı başlık bloğu; bu satır o alanın tek işlevi, boşa gitmemeli.

## [P0] ui-kusuru — satir 2221

**Mevcut:**
```
<nav class="views" aria-label="Görünümler" role="tablist">
```

**Neden:** Menüde yalnız beş sekme var. Rakiplerin en pahalı paketlerine koyduğu ve en çok sattığı modüller — Karar ara, Takvim/duruşma, Harç hesabı, Sözleşme incelemesi, Atıf denetimi, Kapsam — bizde menüde HİÇ yok; yalnız Araştır sekmesindeki on iki kartlık yığının içinden bulunabiliyor. De Jure'de bunlar sol rafta adlarıyla durur. Avukat, sahip olduğumuz modülleri yok sanır.

**Öneri:**
```
Menüye ikinci satır ekleyin ve modülleri adıyla koyun: "Karar ara", "Takvim", "Süre ve harç", "Sözleşme incelemesi", "Atıf denetimi". Araştır sekmesindeki kart yığını menünün kopyası değil, kısayolu olsun.
```

**Not:** Rakipten alınacak en doğru anlatım alışkanlığı budur: modül menüde adıyla durur, kart yığınında saklanmaz.

## [P0] jargon — satir 2304

**Mevcut:**
```
Her kart, bu sunucuda bugün çalışan bir uca sabit bir istek gönderir. Çalışmayan bir iş burada kart olarak görünmez.
```

**Neden:** "uç", "sabit istek", "sunucu" — üç makine sözcüğü. Cümle ürünün en dürüst kuralını anlatıyor ama avukat için anlamsız; oysa bu, rakibin sahte ilerleme çubuklu yetim sayfasına karşı en güçlü cümlemiz.

**Öneri:**
```
Burada yalnız bugün gerçekten çalışan işler görünür. Çalışmayan bir iş listeye hiç konmaz — hazır olmayan bir düğmeye basmazsınız.
```

**Not:** Bu, rakibin "Dava Takip Süreci %75" maketine karşı tek cümlelik konumdur; okunabilir olması şart.

## [P0] jargon — satir 2315

**Mevcut:**
```
<span>Yerel korpus</span>
```

**Neden:** Arama kapsamı seçicisinin ilk ve varsayılan seçeneği. "Korpus" avukatın bilmediği bir terim ve ekranda hiçbir yerde tanımı yok. Rakipler aynı yerde mahkeme adı yazar (Yargıtay, Danıştay, BAM).

**Öneri:**
```
<span>Bu bilgisayardaki hukuk metinleri</span>
```

**Not:** Aynı düzeltme 2332, 2326, 9344, 10994 ve 12416 satırlarında da gerekir; sözlük tek elden değişmeli.

## [P0] jargon — satir 3273

**Mevcut:**
```
box.appendChild(el("span", "k", "henüz açık değil"));
```

**Neden:** Bu kart 17 ayrı yerde çiziliyor ("Dosya ucu", "Taslak ucu", "Kapsam ucu", "Harç hesabı ucu") ve sonunda "(Teknik: GET /v1/files → 404)" yazıyor. "uç" ve "404" avukatın sözlüğünde yok; kart ayrıca "Sistemi başlatan kişiden isteyin" diyor — tek kişilik büroda o kişi avukatın kendisi.

**Öneri:**
```
Etiketleri "... ucu" yerine ekran adıyla verin; kart metni: "Bu ekran bu kurulumda henüz açık değil. ColleX'i kapatıp yeniden açın; sorun sürerse kurulumu yapan kişiye bildirin." Ham yol ve 404 yalnız "Teknik ayrıntı" açılır satırında kalsın.
```

**Not:** Etiket örnekleri: "Dosya ucu" -> "Belge listesi", "Taslak ucu" -> "Dilekçe taslağı", "Kapsam ucu" -> "Neyi tarıyoruz sayfası", "Harç hesabı ucu" -> "Harç hesabı".

## [P0] jargon — satir 9842

**Mevcut:**
```
künye listesi · hash'li tam metin kartı
```

**Neden:** "Karar ara" kartının çıktı satırı — rakiplerin bir numaralı sattığı modülün bizdeki karşılığı. "hash'li" saf mühendis sözcüğü ve tam da avukatın en çok ilgilendiği yerde duruyor.

**Öneri:**
```
karar künyeleri; seçtiğinizin tam metni, alıntısı bozulmadan
```

**Not:** Rakip burada "Tam Metin Kararlar" der; biz aynı şeyi söyleyip üstüne bir de garanti veriyoruz, ama okunmuyor.

## [P0] jargon — satir 9878

**Mevcut:**
```
Yerel korpusta arar; her tespiti belge sürümü, Unicode konumu ve SHA-256 ile bağlar.
```

**Neden:** Ana ekrandaki iş kartlarının en çok tıklanacak olanı ("Hukukî soru sor"). Tek cümlede üç bilinmeyen terim: korpus, Unicode konumu, SHA-256. Rakiplerin karşılığı: "Somut olayı anlatın, benzer kararları getirsin."

**Öneri:**
```
Bu bilgisayardaki kararlarda ve mevzuatta arar; yazdığı her cümlenin altına aldığı kararın künyesini ve alıntıladığı satırı koyar.
```

**Not:** "tespit" yerine "cümle" kullanıldı; tespit de ekranda hiçbir yerde tanımlı değil.

## [P0] jargon — satir 12411

**Mevcut:**
```
gecitAracSayisi: "Geçidin bildirdiği araç",
```

**Neden:** Kapsam ekranı, Apilex'in "12 milyon karar" iddiasına verdiğimiz dürüst cevaptır ve stratejik olarak en değerli ekranımızdır. Ama sayı tablosu "Geçidin bildirdiği araç", "Kayıtlı araç", "Uygulanan migrasyon" diyor; avukat "araç"tan alet anlar. De Jure aynı yerde on altı merciin adını sayar. Dürüstlüğümüz okunamadığı için rakibin uydurma sayısına yeniliyor.

**Öneri:**
```
gecitAracSayisi: "Bugün bağlanabilen resmî kaynak",
```

**Not:** Aynı sözlükte: kayitliArac -> "Tanımlı resmî kaynak", baglananArac -> "Bugün cevap veren kaynak", baglanmayanArac -> "Bugün cevap vermeyen kaynak", migrasyon satırları avukat yüzeyinden kalksın, yerelKorpus -> "Bu bilgisayarda kayıtlı hukuk metni".

## [P0] jargon — satir 13109

**Mevcut:**
```
Belgelerinizi ve mevzuatı tarar, her tespiti belge sürümü ve SHA-256 
```

**Neden:** Avukatın üründe okuduğu İLK cümle. Apilex ilk cümlesinde "Araştırma, Analiz ve Üretim Tek Ekranda" der, De Jure "Dilekçe yazdırma, derin araştırma, sözleşme hazırlama" der; ikisi de tek teknik sözcük kullanmaz. Bizim ilk cümlemizde SHA-256 var. Avukat burada ekranı kapatır.

**Öneri:**
```
Belgelerinizi, kararları ve mevzuatı tarar; yazdığı her cümleyi aldığı belgeye ve o belgenin tam olarak hangi satırından geldiğine bağlar. Alıntının sonradan değişmediğini kendisi denetler. Süreleri hesaplar, dilekçe taslağı yazar. Dayanağını bulamadığı cümleyi KAYNAKSIZ diye işaretler ve kararı size bırakır.
```

**Not:** Teknik doğruluk kaybolmuyor: "alıntının sonradan değişmediğini kendisi denetler" SHA-256'nın avukata anlamlı tam karşılığıdır. Yüzde/garanti iddiası eklenmedi.

## [P1] eksik-aciklama — satir 2233

**Mevcut:**
```
DENEME KORPUSU (sentetik deneme belgeleri) — bu sunucu sentetik deneme belgeleriyle çalışıyor; hiçbir sonuç gerçek hukukî değerlendirme değildir.
```

**Neden:** Ürünün en dürüst şeridi, ama üç bilinmeyen terim taşıyor: DENEME KORPUSU, sentetik, sunucu. Avukat şeridi okuyamayınca ya görmezden gelir ya da ürünün tamamının sahte olduğunu sanır — ikisi de zararlı.

**Öneri:**
```
ÖRNEK BELGELERLE ÇALIŞIYORSUNUZ — bu kurulumdaki kararlar ve dilekçeler sınama için yazılmış uydurma metinlerdir. Gerçek dosyanızda kullanmayın; gerçek metinler yüklendiğinde bu şerit kendiliğinden kaybolur.
```

**Not:** Son cümle bugün eksik: avukat şeridin nasıl kalkacağını bilmiyor.

## [P1] tanimsiz-terim — satir 2390

**Mevcut:**
```
<h2 class="fname" id="gridtitle" tabindex="-1">Belge × soru ızgarası</h2>
```

**Neden:** "Izgara" Türkçede ilk anlamıyla mutfak aletidir; arayüz anlamı avukatta yok. Rakip aynı işe "karşılaştırmalı analiz" ve "kritik farklar tablosu" diyor — avukatın zaten kullandığı sözcükler.

**Öneri:**
```
<h2 class="fname" id="gridtitle" tabindex="-1">Belgeleri karşılaştır — aynı soruyu hepsine sor</h2>
```

**Not:** 9870 satırındaki iş kartı başlığı ve 2387 aria-label da aynı adı taşımalı.

## [P1] jargon — satir 2393

**Mevcut:**
```
Her hücre ayrı bir <code>POST /v1/answer</code> isteğidir ve yalnız o belgenin metniyle cevaplanır
```

**Neden:** Ekranın açıklama paragrafında ham bir API çağrısı duruyor. Bu modül Apilex'in "kritik farklar ve ortak noktalar tablolama" vaadinin bizdeki karşılığıdır; onlar bunu tek satırlık fayda cümlesiyle satıyor.

**Öneri:**
```
Her hücre ayrı ayrı hesaplanır ve yalnız o belgenin metniyle cevaplanır
```

**Not:** Ham yol gerekiyorsa "Teknik ayrıntılar" katlanır bloğuna taşınsın.

## [P1] eksik-aciklama — satir 2751

**Mevcut:**
```
COMPLETE: ["TAM", "ok", "✓", "Tüm tespitler doğrulanmış kaynağa bağlı."],
```

**Neden:** Dört damga (TAM, ŞERHLİ, KISMİ, ÇEKİMSER) ürünün en görünür işaretidir ve hiçbiri avukatın bildiği bir sözcük değil; açıklama cümlesi de "tespit" diyerek ikinci bir tanımsız terim getiriyor ve ne yapmam gerektiğini söylemiyor. Rakiplerde böyle bir damga yok — yani bu bizim ayırt edici özelliğimiz ve tam da onu anlatamıyoruz.

**Öneri:**
```
COMPLETE: ["TAM", "ok", "✓", "Cevaptaki her cümlenin dayanağı gösterildi — kaynakları okuyup kullanabilirsiniz."],
```

**Not:** Diğer üçü aynı kalıpla: ŞERHLİ = "Dayanaklar var ama çekince ya da aksi yönde karar var — karşıt otorite tablosunu okuyun."; KISMİ = "Bazı cümlelerin dayanağı bulunamadı — o cümleleri kendiniz doğrulamadan kullanmayın."; ÇEKİMSER = "Elimizdeki kaynaklarda bu soruya dayanak bulunamadı; uydurma cevap üretilmedi."

## [P1] tanimsiz-terim — satir 2899

**Mevcut:**
```
yes: "KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır",
```

**Neden:** "Kesinleştirilebilir/kesinleştirilemez" uydurulmuş bir terimdir ve hukukta "kesinleşme" bambaşka bir şeydir (kararın kesinleşmesi). Avukat bunu "karar kesinleşti" sanabilir — üründeki en tehlikeli terim çakışması. "Teknik kontroller" de mühendis tonudur.

**Öneri:**
```
yes: "Kullanıma hazır — bütün alıntılar doğrulandı; hukukî değerlendirme yine size aittir",
```

**Not:** Karşıtı: no: "Kullanmadan önce okuyun — en az bir alıntı doğrulanamadı; gerekçeler aşağıda". Aynı sözlük Markdown ve DOCX çıktısında da birebir aynı olmalı.

## [P1] ton — satir 3154

**Mevcut:**
```
["Değişiklik öncesi (1–5 yıl, 2025)", "TCK m. 157 dolandırıcılık suçunun cezası nedir?", "2025-06-01"],
```

**Neden:** Araştır ekranındaki "Örnek sorular" düğmeleri geliştirici senaryolarıdır ("Değişiklik öncesi", "Çekimser örnek") ve dördünün üçü ceza hukukudur. Hedef kullanıcı İzmir'de kira/tahliye/icra işi yapan tek kişilik bir büro. Apilex örnek istemleri günlük işten seçer ("Çatılı iş yeri kira sözleşmesi oluşturur musun?"), De Jure analiz yönergesi örneği verir.

**Öneri:**
```
["Kira — tahliye taahhüdü", "Yazılı tahliye taahhüdüne dayanan tahliye davasında taahhüdün geçerlilik şartları nelerdir?", "2026-06-01"],
```

**Not:** Diğer üçü de günlük işten: ecrimisil, iş sözleşmesinde rekabet yasağı, icra takibine itirazın iptali. Etiketler senaryo adı değil konu adı olsun; UXAUDIT'te ön-dolu ceza sorusu bir kira dosyasına yanlışlıkla kaydedilmişti.

## [P1] tanimsiz-terim — satir 3607

**Mevcut:**
```
box.appendChild(el("div", "quote-label", "Kanonik metinden birebir alıntı"));
```

**Neden:** "Kanonik" ilahiyat/matematik terimidir; hukukçu için tanımsız ve kaynak kartının ana akışında, katlanır bölümün DIŞINDA duruyor. Hemen üstündeki satır zaten aynı şeyi Türkçe söylüyor.

**Öneri:**
```
box.appendChild(el("div", "quote-label", "Belgenin kayıtlı metninden birebir alıntı"));
```

**Not:** Rakip kaynak kartında böyle bir garanti cümlesi hiç vermiyor; bizimkinin okunabilir olması kritik.

## [P1] jargon — satir 3675

**Mevcut:**
```
hash.appendChild(document.createTextNode("Alıntı parmak izi (SHA-256) "));
```

**Neden:** Aynı satırda "Alıntı parmak izi (SHA-256)", "Belge parmak izi (SHA-256)", "Konum 0-48 (Unicode karakter sayımı)" ve uzun bir belge sürümü kimliği yan yana. "Parmak izi" bile ekranda tanımsız. Katlanır bölümde olduğu için kalabilir, ama ne işe yaradığını söyleyen bir cümlesi yok.

**Öneri:**
```
Katlanır bölümün başına tek cümle: "Aşağıdaki değerler, alıntının ve belgenin sonradan değiştirilip değiştirilmediğini başkasının da kontrol edebilmesi içindir; günlük kullanımda okumanız gerekmez." Etiketler: "Alıntının denetim değeri", "Belgenin denetim değeri", "Alıntının belgedeki yeri (karakter 0-48)".
```

**Not:** Teknik değer korunuyor, yalnız ne işe yaradığı yazılıyor.

## [P1] jargon — satir 3978

**Mevcut:**
```
var a = el("a", null, "Doğrulama dosyasını indir (JSON — alıntıların bağımsız denetimi için)");
```

**Neden:** "JSON" avukatın bilmediği bir biçim adı. Cümlenin ikinci yarısı doğru ve değerli; parantez içi onu boğuyor.

**Öneri:**
```
var a = el("a", null, "Denetim dosyasını indir — bu cevaptaki bütün alıntıları başkası da tek tek kontrol edebilsin");
```

**Not:** İndirilen dosya adı (kanit-paketi-...) "denetim-dosyasi-..." olmalı; "kanıt paketi" ekranda tanımlı değil.

## [P1] ton — satir 7224

**Mevcut:**
```
Getirilen tüm metinler güvenilmeyen veri kabul " +
```

**Neden:** Sayfa altındaki tek tanıtım paragrafı: "Bu konsol yereldir", "sayfa yalnız bu sunucuyla konuşur", "güvenilmeyen veri kabul edilir" — üçü de mühendis cümlesi. Oysa buradaki mesaj (müvekkil dosyasının bilgisayardan çıkmaması) rakibin sözleşmesinin veremediği tek şeydir: Apilex'te adı verilmeyen yurt dışı AI sağlayıcısı, De Jure'de Google Cloud AB ve gayrikabili rücu beyan. En güçlü satışımız en soğuk cümleyle yazılmış.

**Öneri:**
```
Müvekkil dosyanız bu bilgisayardan çıkmaz: yüklediğiniz belgeler ve cevaplar burada kalır. İki istisna vardır ve ikisini de siz açarsınız — canlı araştırma yalnız arama metnini resmî kaynaklara gönderir; Bulut AI, siz o istek için açarsanız seçtiğiniz metni gönderir. Dışarıdan gelen metinler biçimsiz, düz metin olarak gösterilir. Hiçbir çıktı, sizin incelemenizden geçmeden kullanılamaz.
```

**Not:** "konsol" sözcüğü üründen tamamen çıkmalı; avukatın sözlüğünde "ekran" veya "uygulama" var.

## [P1] anlasilmaz-cumle — satir 9384

**Mevcut:**
```
noticeLine(box, "line", "Soru kapsamı: %" + pct(cov.ratio) + " — soru sözcüklerinin kaynaklarda karşılığı" +
```

**Neden:** Cevabın künyesinde çıplak bir yüzde duruyor ve ne yapmam gerektiğini söylemiyor: %48 iyi mi kötü mü? Ayrıca "kapsam" burada üçüncü bir anlamda (arama kapsamı seçicisi 2313 ve Kapsam ekranı ile birlikte).

**Öneri:**
```
noticeLine(box, "line", "Sorunuzdaki sözcüklerin " + pct(cov.ratio) + "'i kaynaklarda karşılık buldu" + (cov.ratio < 0.6 ? " — karşılık bulmayan sözcükler aşağıda; soruyu daraltmak sonucu düzeltebilir" : "") +
```

**Not:** 2313'teki "Kapsam" başlığı da "Nerede aransın?" olmalı.

## [P1] jargon — satir 9836

**Mevcut:**
```
out: "üç kovalı denetim tablosu · DOCX",
```

**Neden:** "Kova" (bucket) mühendislik terimidir; avukat üç kovanın ne olduğunu bilemez. Modülün kendisi rakipte hiç yok — anlatamadığımız için üstünlüğü kaybediyoruz.

**Öneri:**
```
out: "her atıf için üç sonuçtan biri — doğrulandı / yürürlükten kalkmış / bulunamadı; Word dosyası olarak da indirilir",
```

**Not:** "DOCX" da avukatın değil Word'ün iç adıdır; "Word dosyası" demek yeterli.

## [P1] tanimsiz-terim — satir 9866

**Mevcut:**
```
out: "kapsam manifestosu",
```

**Neden:** "Manifesto" siyasi metin çağrıştırır; burada kastedilen kaynak listesidir. Ekranın kendi başlığı zaten iyi ("Neyi tarıyoruz, neyi taramıyoruz?") — çıktı satırı onu bozuyor.

**Öneri:**
```
out: "bağlı olduğumuz resmî kaynakların listesi ve bugünkü durumu",
```

**Not:** "Kapsam" sözcüğü üründe üç anlamda kullanılıyor; bu ad yalnız bu ekrana bırakılmalı.

## [P1] jargon — satir 9872

**Mevcut:**
```
out: "tablo + CSV",
```

**Neden:** "CSV" avukatın bilmediği bir dosya biçimi adı. Rakip aynı yerde "Excel'e aktarın" der.

**Öneri:**
```
out: "karşılaştırma tablosu; Excel'de açılabilen dosya olarak da indirilir",
```

**Not:** 2407 ve 9495'teki "CSV indir" düğmesi de "Tabloyu indir (Excel'de açılır)" olmalı.

## [P1] eksik-aciklama — satir 9914

**Mevcut:**
```
line: "13 şablon; dayanağı olmayan her paragraf KAYNAKSIZ işaretlenir, doğrulanamayan atıfta dışa aktarım reddedilir.",
```

**Neden:** Cümle ürünü savunma diliyle anlatıyor: "reddedilir". Avukat bunu "program bana dilekçemi vermiyor" diye okur. De Jure aynı yerde "Dilekçeniz son haline geldiğinde UDF olarak dışa aktarabilirsiniz" der — kazanç cümlesi. Bizim kuralımız daha iyi ama kazanç olarak yazılmamış.

**Öneri:**
```
line: "13 hazır dilekçe ve sözleşme; her paragrafın dayanağı gösterilir, dayanağı olmayan paragraf KAYNAKSIZ diye işaretlenir. Bir atfı doğrulayamazsa dosyayı yazmaz — yanlış atıflı bir dilekçe elinizden çıkmaz.",
```

**Not:** Aynı mekanizma, aynı dürüstlük; avukatın kazancı olarak yazılmış.

## [P1] jargon — satir 10988

**Mevcut:**
```
row("Canlı araştırma (MCP)", (MCP_STATE_TR[h.mcp] || h.mcp || "?") +
```

**Neden:** Ayarlar > Sistem durumu, avukatın "çalışıyor mu?" diye baktığı tek yer. "MCP" hiçbir yerde tanımlı değil; satır ayrıca "54 araç" diyor — avukat neyin aracı olduğunu bilmez.

**Öneri:**
```
row("Canlı araştırma", (MCP_STATE_TR[h.mcp] || h.mcp || "?") + (typeof h.registeredToolCount === "number" ? " · " + h.registeredToolCount + " resmî kaynak sorgusu tanımlı" : ""));
```

**Not:** Üst çubuktaki rozet zaten doğru adı kullanıyor ("Canlı araştırma"); iki yüzey aynı adı taşımalı.

## [P1] jargon — satir 10991

**Mevcut:**
```
kapalı — bulut anahtarı tanımlı değil (ortam değişkeni: ANTHROPIC_API_KEY)
```

**Neden:** Ham bir ortam değişkeni adı avukatın ekranında duruyor ve ne yapması gerektiğini söylemiyor.

**Öneri:**
```
kapalı — bu kurulumda bulut yapay zekâ tanımlı değil; ColleX bulut olmadan da tam çalışır. Açılmasını istiyorsanız kurulumu yapan kişiye söyleyin.
```

**Not:** "Bulut olmadan da tam çalışır" cümlesi bilinçli bir konum: rakiplerin ürünü bulutsuz hiç çalışmaz.

## [P1] jargon — satir 10994

**Mevcut:**
```
row("Korpus", c ? c.publicDocuments + " korpus belgesi · " + c.uploads + " yüklenen belge"
```

**Neden:** Aynı satırda hem "korpus" var hem de W13-COPY'nin işaret ettiği terim çakışması (üründe "korpus" bazen hukuk metni deposu, bazen veritabanı). Avukat için anlamlı tek bilgi: kaç karar var, kaç belgem var.

**Öneri:**
```
row("Bu bilgisayardaki metinler", c ? c.publicDocuments + " hukuk metni · " + c.uploads + " yüklediğiniz belge"
```

**Not:** Rakip bu sayıyı "12 milyon" diye pazarlıyor; biz gerçek sayıyı gösteriyoruz — ama adı okunabilir olmalı.

## [P1] jargon — satir 11165

**Mevcut:**
```
"Sunucu resmî kaynak geçidine bağlı değil; bu ekran tek bir künye bile getiremez. " +
```

**Neden:** "Sunucu" ve "geçit" — Karar ara ekranının kapalı durumundaki ana cümlesi. Cümlenin devamı ("dolu bir form size çalışıyormuş izlenimi vermesin") mükemmel ve rakibin sahte maketlerine karşı en iyi cümlemiz; birinci yarısı onu okunamaz kılıyor.

**Öneri:**
```
"Bu kurulumda resmî kaynaklara bağlantı açık değil; bu ekran tek bir karar bile getiremez. " +
```

**Not:** 11153'teki "Kaynak geçidi bağlı" başlığı da "Resmî kaynaklara bağlantı açık" olmalı.

## [P2] ui-kusuru — satir 2195

**Mevcut:**
```
<label class="srlab" for="matterselect">Aktif dosya</label>
```

**Neden:** "Aktif dosya" yalnız ekran okuyucuya görünür bir etikette ve bir ipucu metninde tanımlı; gözle görünen açıklaması yok. UXAUDIT'te denetçi on dakika sonra hâlâ ne olduğunu bilmiyordu. De Jure aynı kavramı "Klasörlerim" diye adlandırır ve sol rafta hep görünür tutar.

**Öneri:**
```
Seçicinin yanına görünür ve kalıcı etiket: "Üzerinde çalıştığınız dosya". Boş seçenek "Dosyasız çalışma" yerine "Hiçbir dosyaya bağlama" olsun; altında tek satır: "Seçtiğiniz dosyaya bundan sonraki aramalar, belgeler ve taslaklar kendiliğinden bağlanır."
```

**Not:** Bizim üstünlüğümüz dosyanın avukatın kendi diskinde olması; adı anlaşılmazsa üstünlük görülmez.

## [P2] jargon — satir 2326

**Mevcut:**
```
Canlı araştırma kapalı — ColleX-Baslat.cmd ile başlatın. Yerel korpus da boş olduğu için şu an yalnız yüklediğiniz belgeler üzerinde soru sorabilirsiniz.
```

**Neden:** Bir dosya adı avukat cümlesinin ortasında çıplak duruyor ve "yerel korpus" yine geçiyor. Cümle ayrıca ne yapılacağını değil ne yapılamayacağını söylüyor.

**Öneri:**
```
Canlı araştırma şu an kapalı ve bu bilgisayarda kayıtlı hukuk metni de yok. Şimdilik yalnız kendi yüklediğiniz belgelere soru sorabilirsiniz. Canlı araştırmayı açmak için ColleX'i kapatıp masaüstündeki "ColleX'i Başlat" kısayolu ile yeniden açın.
```

**Not:** Dosya adı yerine avukatın gördüğü kısayol adı kullanılmalı; ürünün her yerinde aynı ad geçmeli.

## [P2] jargon — satir 2421

**Mevcut:**
```
Metni çıkarılır, künyesi ve otomatik ön incelemesi burada listelenir.
```

**Neden:** "Künye" hukukta karar künyesi demektir; burada dosya bilgileri kastediliyor — aynı sözcük üründe iki anlamda. "Otomatik ön inceleme" de ne çıkacağını söylemiyor; Apilex aynı yerde ne alacağınızı sayar.

**Öneri:**
```
Belgenin metni okunur; tarafları, tarihleri, talepleri ve atıfları çıkarılır ve aşağıda listelenir.
```

**Not:** Rakibin "binlerce sayfayı dakikalar içinde analiz edin" cümlesine karşı bizim cümlemiz somut olmalı: ne çıkarıyoruz.

## [P2] jargon — satir 3652

**Mevcut:**
```
metaRow(tech, "Atıf zinciri (citator)", relationLine(prov.relation));
```

**Neden:** "Citator" İngilizce bir hukuk-teknolojisi terimi ve Türk avukatının sözlüğünde yok. Katlanır bölümde olduğu için P2, ama parantez tamamen gereksiz — Türkçesi zaten doğru.

**Öneri:**
```
metaRow(tech, "Atıf zinciri", relationLine(prov.relation));
```

**Not:** Aynı bölümdeki "Arama şeritleri" ve "Ham sonuç yönü" de "Bu pasajı hangi aramalar buldu" ve "Kararın yönü (ham etiket)" olmalı.

## [P2] jargon — satir 12527

**Mevcut:**
```
det.appendChild(el("summary", null, "Araç envanteri (" + inv.length + " araç)"));
```

**Neden:** Kapsam ekranının alt bölümü. "Araç envanteri" depo/lojistik terimi gibi okunur; içerik aslında hangi resmî kaynağa hangi sorgunun yapılabildiğidir — avukat için değerli bilgi, yanlış adla saklanmış.

**Öneri:**
```
det.appendChild(el("summary", null, "Hangi kaynakta ne sorabiliyoruz (" + inv.length + " sorgu)"));
```

**Not:** De Jure aynı bilgiyi merci adı listesi olarak verir; bizimki daha ayrıntılı, yalnız adı yanlış.
