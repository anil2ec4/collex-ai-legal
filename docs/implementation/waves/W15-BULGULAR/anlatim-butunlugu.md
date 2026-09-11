# anlatim-butunlugu

Uygulama tek bir dil konuşmuyor: aynı nesne ekrandan ekrana ad değiştiriyor. Yerel arşiv beş ayrı adla anılıyor (yerel korpus / arşiv / yerel kütüphane / yerel belge deposu / yerel veritabanı); bulut özelliği dört adla (Bulut AI / Bulut yapay zekâ / AI / yapay zekâ) — hatta tek bir cümlede ikisi birden geçiyor; aleyhe karar yedi adla (karşıt otorite / karşı içtihat / karşıt içtihat / karşıt karar / talebin aksi yönündeki karar / aleyhe karar / Aleyhe kayıt) anılıyor ve kullanıcı "Karşıt içtihat tara" düğmesine basıp "Karşıt otorite taraması" başlıklı bir ekrana düşüyor. İki kelime düzeyinde de çakışma var: "dosya" hem dava dosyası hem bilgisayar dosyası, "bölüm" hem belge parçası hem dilekçe başlığı, "süre" hem yasal süre hem bekleme, "kimlik" hem TCKN hem iç numara, "kapsam" beş ayrı anlamda; "Soru kapsamı" ibaresi bir ekranda arama alanı seçicisi, başka ekranda yüzdelik ölçü demek. Aynı işi yapan ana düğme üç ayrı ad taşıyor ("Ara ve doğrula", "Sor ve doğrula", "Korpusta doğrula") ve "belge yok" boş durumu üç ayrı cümleyle yazılmış. Buna hitap karışıklığı (Yüklediğim belgeler / yüklediğiniz belge), ürün sesi karışıklığı (biz taradık / ColleX / sistem) ve mühendis sözlüğü (uç, istek, filtre, çip, ızgara, hash, entailment) ekleniyor. Aşağıda önem sırasına dizilmiş bulguların her birinde current mevcut varyant, proposed kanonik karşılıktır; özet kanonik liste bulguların sonunda tekrarlanmıştır.

Bulgu: 33

## [P0] jargon — satir 2969

**Mevcut:**
```
Yerel korpusa ulaşılamadı; veritabanı çalışmıyor olabilir.
```

**Neden:** Bu bilgisayardaki karar/mevzuat arşivi uygulamada BEŞ ayrı adla anılıyor: "yerel korpus" (2927, 4537, 7225, 9878, 9886, 10309, 10746, 10820), "arşiv" (7352, 11990), "yerel kütüphane" (11854, 11857, 12417), "yerel belge deposu" (3048), "yerel veritabanı" (2780, 12412). Avukat bunları beş ayrı yer sanır; üstelik "korpus" ve "veritabanı" sözcüklerinin ikisini de bilmez. Bu tek satırda bile iki farklı ad aynı şeyi anlatıyor.

**Öneri:**
```
Bu bilgisayardaki karar arşivine ulaşılamadı — ColleX-Durdur.cmd, sonra ColleX-Baslat.cmd ile yeniden başlatın.
```

**Not:** KANONİK AD: "karar arşivi" (tam biçim: "bu bilgisayardaki karar arşivi"). korpus / arşiv / kütüphane / belge deposu / veritabanı sözcükleri kullanıcıya görünen hiçbir metinde kalmamalı.

## [P0] jargon — satir 3675

**Mevcut:**
```
hash.appendChild(document.createTextNode("Alıntı parmak izi (SHA-256) "));
```

**Neden:** Alıntının bozulmadığını gösteren aynı denetim uygulamada altı ayrı adla anılıyor: "parmak izi (SHA-256)" (3675, 3677, 7554, 7559), yalın "parmak izi" (4779), "özetler (SHA-256)" (6516), "Özet değeri" (3186), "Alıntı SHA-256" (9744 tablo sütunu), "hash'li" (9842). Avukat SHA-256'yı da hash'i de bilmez; "özet" sözcüğünü ise metin özeti sanır, ki bu ekranda gerçekten metin özetleri de var — doğrudan yanlış anlama üretir.

**Öneri:**
```
hash.appendChild(document.createTextNode("Alıntının değişmezlik damgası "));
```

**Not:** KANONİK AD: "değişmezlik damgası", açıklaması bir kez: "alıntının, belgenin kayıtlı hâlinden hiç değişmediğini otomatik denetlemeye yarayan sayı". SHA-256 / hash / parmak izi / özet değeri kullanıcı metinlerinden çıkarılmalı; teknik denetim isteyen için "Teknik doğrulama ayrıntıları" katlamasında kalabilir.

## [P0] tanimsiz-terim — satir 4064

**Mevcut:**
```
section(out, "Karşıt otorite taraması", "sec-karsit", "Karşıt otorite");
```

**Neden:** Kullanıcı ana ekranda "Karşıt içtihat tara" (9889) kartına basıyor, açılan bölümün başlığı "Karşıt otorite taraması" oluyor. Aynı kavram uygulamada yedi ad taşıyor: karşıt otorite (10 yerde), karşı içtihat (6470, 6821, 7002), karşıt içtihat (3157, 9889), karşıt karar (6305, 6695), talebin aksi yönündeki karar (6512, 6821), aleyhe karar (4126), Aleyhe kayıt (12074 tablo sütunu). "Otorite" ayrıca Türk hukuk dilinde kaynak/içtihat karşılığı olarak kullanılmaz; avukat bunu "makam" sanır.

**Öneri:**
```
section(out, "Aleyhe karar taraması", "sec-karsit", "Aleyhe kararlar");
```

**Not:** KANONİK AD: "aleyhe karar". Kart adı da "Aleyhe karar tara" olmalı ki düğme ile varılan bölüm aynı sözcüğü taşısın; tablo sütunu "Aleyhe kayıt" da "Aleyhe karar" olmalı. "otorite" sözcüğü kullanıcı metinlerinden tamamen çıkarılmalı.

## [P0] anlasilmaz-cumle — satir 7225

**Mevcut:**
```
"Bu konsol yereldir: yerel korpus ve yüklediğiniz belgeler bu bilgisayarda kalır; sayfa " +
```

**Neden:** Sayfanın altındaki bu tek paragraf 70 sözcük, altı cümlecik ve altı jargon taşıyor: konsol, yerel korpus, sunucu, bulut yapay zekâ/Bulut AI (aynı cümlede iki ad), "güvenilmeyen veri", "düz metin". İçinde uygulamanın en önemli gizlilik vaadi var ama avukat cümlenin yarısında bırakır. "Bu konsol yereldir" ifadesi de avukat için bir şey söylemiyor.

**Öneri:**
```
"Bu program yalnız bu bilgisayarda çalışır: karar arşivi ve yüklediğiniz belgeler bu bilgisayardan çıkmaz. İki istisna vardır: (1) Canlı arama, sorunuzdan çıkarılan arama sözcüklerini resmî kaynak sitelerine gönderir. (2) Bulut Yardımcı açıksa, seçtiğiniz belge ve alıntı metni Anthropic'e gider; bunu her istekte ayrıca onaylarsınız. Dışarıdan gelen her metin yalnız okunmak üzere gösterilir. Hiçbir çıktı, siz incelemeden kullanılamaz."
```

**Not:** Uzun bloklar cümlelere bölünmeli ve numaralanmalı. Bu paragraf, kanonik adların (karar arşivi, Bulut Yardımcı, canlı arama) uygulamada ilk kez tanıtıldığı yer olmalı.

## [P0] jargon — satir 7227

**Mevcut:**
```
resmî kaynak sunucularına gönderir; bulut yapay zekâ (Bulut AI; isteğe bağlı, varsayılan kapalı) seçtiğiniz 
```

**Neden:** Tek cümlede aynı özelliğin iki adı yan yana duruyor: "bulut yapay zekâ" ve "Bulut AI". Uygulamanın geri kalanında ayrıca yalın "AI" (AI paragrafı, AI · kaynaklı, AI analizi) ve "yapay zekâ" da geçiyor — dört ad. Avukat bunların ayrı ayrı özellikler mi, aynı şey mi olduğunu çözemez; "AI" kısaltması ile "yapay zekâ" tam adı aynı ekranda karışık kullanılıyor.

**Öneri:**
```
resmî kaynak sunucularına gönderir; Bulut Yardımcı (isteğe bağlı, varsayılan kapalı) seçtiğiniz 
```

**Not:** KANONİK AD: "Bulut Yardımcı". Uygulamanın tamamında "Bulut AI", "Bulut yapay zekâ", yalın "AI" ve "yapay zekâ" bu tek adla değiştirilmelidir (AI paragrafı → Bulut Yardımcı paragrafı; AI · kaynaklı → Bulut Yardımcı · dayanaklı; AI analizi alınamadı → Bulut Yardımcı incelemesi alınamadı; Bulut OCR → Bulut Yardımcı ile metne çevirme).

## [P0] jargon — satir 8242

**Mevcut:**
```
if (res.status === 404) { showNotYet(target, "GET /v1/matters", "Dava dosyası ucu"); return; }
```

**Neden:** "uç" (endpoint) sözcüğü kullanıcıya 16 ayrı yerde gösteriliyor: Dosya ucu (4696), Dosya yükleme ucu (5147), Taslak şablon ucu (5399), Taslak listesi ucu (5603), Süre listesi ucu (8173), Süre kuralı ucu (9020), Derin araştırma ucu (10042), Karar arama ucu (11105), Atıf denetimi ucu (11949, 12011), Duruşma hazırlık ucu (12331), Harç hesabı ucu (12557, 12612), Sözleşme inceleme ucu (12833), dışa aktarım ucu (12115, 12117), silme ucu (4984). Avukat bunu bilmez ve öğrenmesine de gerek yoktur — mesaj "bu ekran henüz açık değil" demeye çalışıyor. Aynı kavram için ayrıca "geçit", "ağ geçidi", "kaynak geçidi" de kullanılıyor.

**Öneri:**
```
if (res.status === 404) { showNotYet(target, "GET /v1/matters", "Dava dosyaları listesi"); return; }
```

**Not:** "uç" sözcüğü kullanıcı metinlerinden tamamen kaldırılmalı; yerine işlevin adı yazılmalı ("Dava dosyaları listesi bu kurulumda henüz açık değil"). Teknik adres (GET /v1/matters) zaten katlanmış teknik satırda duruyor, orada kalsın.

## [P0] anlasilmaz-cumle — satir 9384

**Mevcut:**
```
noticeLine(box, "line", "Soru kapsamı: %" + pct(cov.ratio) + " — soru sözcüklerinin kaynaklarda karşılığı" +
```

**Neden:** "Soru kapsamı" ibaresi uygulamada iki tamamen farklı şeyi anlatıyor: burada bir yüzdelik ölçü, belge sayfasında (10308) ise "Bu belge / Bu dosyadaki tüm belgeler / Belge + korpus" seçicisinin adı. Aynı iki kelime bir yerde ölçü, öbür yerde ayar. Ayrıca "kapsam" sözcüğü uygulamada beş anlamda kullanılıyor: arama alanı (2314 Araştırma kapsamı), yüzdelik ölçü (burası), kanıt kapsamı (4077), taranan kaynak envanteri (2670, 11167), eleme (2923 kapsam dışı, 2952 kapsam filtresi).

**Öneri:**
```
noticeLine(box, "line", "Sorunuzun karşılanma oranı: %" + pct(cov.ratio) + " — sorudaki sözcüklerin kaynaklarda ne kadarına karşılık bulundu" +
```

**Not:** "kapsam" tek anlama indirgenmeli. Öneri: arama alanı seçicisi → "Nerede aransın?"; bu ölçü → "sorunun karşılanma oranı"; kaynak envanteri ekranı → "Taranan kaynaklar"; eleme → "kanıt dışı bırakıldı".

## [P0] tanimsiz-terim — satir 9744

**Mevcut:**
```
var rows = [["Belge", "Belge kimliği", "Soru", "Durum", "Cevap", "Kaynak parça", "Konum (Unicode)", "Alıntı SHA-256", "Araştırma no"]];
```

**Neden:** Belgenin bölünmüş metin birimi kimi ekranda "parça" (9717, 9744, 10278, 10451, 10496, 4969), kimi ekranda "bölüm" (4789, 10222, 10616, 10624, 13070) diye anılıyor; kullanıcı ikisinin ayrı şeyler olduğunu sanır. Üstelik "bölüm" dilekçe taslağında BAŞKA bir anlam taşıyor (6512 "Bu bölümdeki kararlar", 6872 "Olay bölümü", 7002 "KARŞI İÇTİHAT bölümü") — üç yönlü çakışma. "Kimlik" ve "Unicode" de avukat sözlüğünde yok.

**Öneri:**
```
var rows = [["Belge", "Soru", "Durum", "Cevap", "Alıntının geçtiği bölüm", "Alıntının değişmezlik damgası", "Araştırma no"]];
```

**Not:** KANONİK AD: belge metin birimi = "bölüm" (parça sözcüğü tamamen kalkar); dilekçedeki bölümler = "başlık" (Olay başlığı, Aleyhe kararlar başlığı). "Belge kimliği" ve "Konum (Unicode)" gibi sütunlar CSV'de kalabilir ama ekranda "Teknik ayrıntılar" içine alınmalı.

## [P0] tanimsiz-terim — satir 10075

**Mevcut:**
```
acts.appendChild(ghostBtn("Kayıtlı cevaplara git", function () { gotoView("arastir"); loadAnswerHistory(); }, "small"));
```

**Neden:** Kaydedilen aynı nesne üç adla anılıyor: "Kayıtlı cevaplar" (burası, 10072), "Kayıtlı araştırmalarım" (9919 kart adı), "Araştırmalar sekmesi" (10096) ve dosya sayfasında "Bu dosyada kayıtlı araştırma yok" (8735). Kullanıcı "Kayıtlı cevaplara git" düğmesine basıp "Kayıtlı araştırmalarım" başlıklı bir listeye düşünce iki ayrı yer olduğunu sanır. Ayrıca 5345 "henüz araştırma yok", 8747 "kesinleştirilemez" gibi satırlar aynı listeye üçüncü bir dille atıf yapıyor.

**Öneri:**
```
acts.appendChild(ghostBtn("Kayıtlı cevaplarıma git", function () { gotoView("arastir"); loadAnswerHistory(); }, "small"));
```

**Not:** KANONİK AD: kaydedilen sonuç = "cevap"; "Kayıtlı cevaplarım". "araştırma" sözcüğü yalnız fiil/eylem için kalsın ("Bu dosyada araştır"). Kart adı 9919 da "Kayıtlı cevaplarım" olmalı.

## [P0] ui-kusuru — satir 10327

**Mevcut:**
```
var askBtn = el("button", "seal", "Sor ve doğrula");
```

**Neden:** Aynı işi yapan ana düğme üç ayrı ad taşıyor: Araştır ekranında "Ara ve doğrula" (2369), belge sayfasında "Sor ve doğrula" (burası), atıf satırında "Korpusta doğrula" (10746). Kullanıcı bir ekranda öğrendiği düğmeyi öbür ekranda tanıyamıyor; üstelik açıklama metinleri (7218, 9788, 9798) hep "Ara ve doğrula" diyor, yani belge sayfasında yazılan yönerge oradaki düğmenin adıyla uyuşmuyor.

**Öneri:**
```
var askBtn = el("button", "seal", "Ara ve doğrula");
```

**Not:** KANONİK DÜĞME ADI: "Ara ve doğrula". "Korpusta doğrula" da "Arşivde ara ve doğrula" olmalı. Bir işlem = bir ad kuralı bütün ekranlara uygulanmalı.

## [P0] anlasilmaz-cumle — satir 12988

**Mevcut:**
```
accepted.length + " belge yüklenecek" + (skipped.length ? ", " + skipped.length + " dosya atlandı (desteklenmeyen tür)" : "") + "."
```

**Neden:** Tek cümlede "belge" ve "dosya" aynı nesne için kullanılıyor. Oysa uygulamanın her yerinde "dosya" DAVA DOSYASI demek (Dosyalarım, Yeni dosya, aktif dosya, Dosyaya göre süz, Dosyadan çıkar, dosyasız çalışma). Avukat bu cümleyi "bir dava dosyası atlandı" diye okur. Aynı çakışma 2435 ("Belge ara — dosya adı"), 5147 ("Dosya yükleme ucu"), 9234 ("— dosya seçin —", burada dava dosyası), 13001 ("Bu klasörde yüklenebilir belge yok") satırlarında da var.

**Öneri:**
```
accepted.length + " belge yüklenecek" + (skipped.length ? ", " + skipped.length + " belge atlandı (bu tür desteklenmiyor: yalnız PDF, Word, TXT ve UDF yüklenir)" : "") + "."
```

**Not:** KANONİK KURAL: "dosya" YALNIZCA dava dosyası anlamında kullanılır. Bilgisayardaki dosya her zaman "belge"dir; gerektiğinde "PDF/Word dosyası" gibi tür adıyla anılır. "dosya adı" → "belge adı".

## [P1] ton — satir 2347

**Mevcut:**
```
<div class="budgethint" id="attachedhint">Ekli belgeler "Yüklediğim belgeler" kapsamında doğrudan, canlı araştırmada bağlam olarak kullanılır.</div>
```

**Neden:** Aynı ekranda hitap değişiyor: seçici etiketi birinci tekil ("Yüklediğim belgeler", ayrıca "Dosyalarım", "Kayıtlı araştırmalarım", 9070 "kendim gireyim"), aynı ekranın sonuç metinleri ikinci çoğul ("yüklediğiniz belge" — 2772, 2776, 2891, 3949, 4123, 9370, 9378). Kullanıcı iki farklı özneden söz edildiğini sanır. Ayrıca "bağlam" mühendis sözcüğüdür ve cümle belgenin canlı aramada ne işe yaradığını söylemiyor.

**Öneri:**
```
<div class="budgethint" id="attachedhint">Seçtiğiniz belgeler: “Yüklediğim belgeler” aramasında doğrudan cevaba dayanak olur. Canlı aramada ise yalnız kayda geçer, dayanak yapılmaz — canlı aramada alıntılar sadece resmî kaynaklardan alınır.</div>
```

**Not:** HİTAP KURALI: menü/liste adları birinci tekil kalabilir (Dosyalarım, Yüklediğim belgeler) ama açıklama ve sonuç cümleleri her yerde ikinci çoğul olmalı. Bir cümlede ikisi karışmamalı.

## [P1] jargon — satir 2790

**Mevcut:**
```
var DEMO_CORPUS_TEXT = "DENEME KORPUSU (sentetik deneme belgeleri) — bu sunucu sentetik deneme belgeleriyle çalışıyor; hiçbir sonuç gerçek hukukî değerlendirme değildir.";
```

**Neden:** Uygulamanın en kritik uyarısı — "buradaki kararlar gerçek değil" — üç anlaşılmaz sözcükle yazılmış: KORPUS, SENTETİK, sunucu. Aynı uyarı başka yerlerde iki ayrı biçimde de geçiyor: 9344 "yerel korpus (SENTETİK) — örnek metin, gerçek karar değil" ve 6386 "SENTETİK kanıt". Avukat "sentetik" sözcüğünü bilmez; kaçırırsa uydurma bir kararı dilekçeye koyabilir.

**Öneri:**
```
var DEMO_CORPUS_TEXT = "DENEME ARŞİVİ — bu kurulumdaki kararlar gerçek değil, deneme amacıyla üretilmiş örnek metinlerdir. Buradan çıkan hiçbir sonucu dilekçede kullanmayın.";
```

**Not:** KANONİK: "sentetik" ve "korpus" hiç kullanılmasın. Her yerde "deneme arşivi" / "gerçek değil, örnek metin". 6386 "SENTETİK kanıt" → "DENEME dayanağı — gerçek karar değil".

## [P1] tanimsiz-terim — satir 2899

**Mevcut:**
```
yes: "KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır",
```

**Neden:** Cevabın durum damgaları hem uydurma hem tutarsız: KESİNLEŞTİRİLEBİLİR / KESİNLEŞTİRİLEMEZ (2899, 2900, 2896, 8747), TAM / KISMİ (2751, 3018), "kısmen tamamlandı" (2882, 7671), ÇEKİMSER (3998) ve "Çekimser kalındı" (2931). Beş ayrı sözcük ailesi, bir kısmı büyük harf bir kısmı küçük harf, hiçbiri ekranda tanımlanmıyor. "Kesinleştirilebilir" avukata usul hukukundaki kesinleşmeyi çağrıştırır — doğrudan yanlış anlamadır.

**Öneri:**
```
yes: "KULLANIMA HAZIR — her alıntının kaynağı denetlendi; hukukî değerlendirme size aittir",
```

**Not:** KANONİK ÜÇ DAMGA: "KULLANIMA HAZIR" (bütün denetimler geçti) · "DİKKATLE OKUYUN" (en az bir denetim geçmedi — eski KESİNLEŞTİRİLEMEZ/KISMİ) · "CEVAP VERİLMEDİ" (eski ÇEKİMSER). Her damganın yanında tek cümlelik açıklaması ekranda görünür olmalı; damga adları büyük harf kalmalı ama üçten fazla olmamalı.

## [P1] tanimsiz-terim — satir 2921

**Mevcut:**
```
"Arama şeritlerinden biri sorun bildirdi — sonuç eksik olabilir."],
```

**Neden:** "Şerit" iki ayrı anlamda kullanılıyor: burada ve 3639, 3652'de arama yöntemi/kanalı; 7944'te ise ekranın üst kısmındaki düğme dizisi ("yukarıdaki 'Örnek sorular' şeridinden"). İkisi de tanımsız. "Arama şeridi" ifadesi avukata hiçbir şey anlatmaz; hangi sorunun çıktığını ve ne yapması gerektiğini de söylemiyor.

**Öneri:**
```
"Arama yöntemlerinden biri çalışmadı — bulunan kaynaklar eksik olabilir; soruyu farklı sözcüklerle yeniden sorabilirsiniz."],
```

**Not:** KANONİK: arama kanalı = "arama yöntemi"; üstteki düğme dizisi = "Örnek sorular satırı". "şerit" sözcüğü kalkmalı.

## [P1] tanimsiz-terim — satir 2952

**Mevcut:**
```
"Bazı pasajlar kapsam filtresi nedeniyle kanıt kümesine alınmadı."],
```

**Neden:** Eleme işi kimi yerde "filtre" (burası, 7371, 7396), kimi yerde "süzgeç" (5471, 8262, 11261, 11262, 11274, 11598, 11710) diye anılıyor. Aynı cümlede ayrıca "pasaj" ve "kanıt kümesi" var; ikisi de tanımsız ve ikisi de aslında aynı şeye (alıntı ve alıntılar listesi) işaret ediyor. Cümle ayrıca ne yapılması gerektiğini söylemiyor.

**Öneri:**
```
"Bazı alıntılar, sorunuzun konusu dışında kaldığı için dayanak listesine alınmadı — hangileri olduğunu aşağıdaki “Dışarıda bırakılan alıntılar” bölümünde görebilirsiniz."],
```

**Not:** KANONİK: eleme = "süzgeç" (filtre kalkar); metin birimi = "alıntı" (pasaj kalkar); kabul edilenler listesi = "dayanak listesi" (kanıt kümesi/kanıt paketi kalkar).

## [P1] jargon — satir 2987

**Mevcut:**
```
"Belge işleme süresi aşıldı; dosya çok büyük ya da sayfa sayısı çok fazla."],
```

**Neden:** "Süre" uygulamada avukatın bildiği anlamda yasal süredir (Süreler sekmesi, Süre ekle, Süre hesapla, Yaklaşan süreler, gecikmiş süre). Burada ve 3018 ("süre bütçesi"), 3059, 4890/4913 ("geçen süre"), 4651 (" · süre: ") satırlarında ise bekleme anlamında kullanılıyor. Avukat "Belge işleme süresi aşıldı" başlığını görünce bir yasal sürenin kaçtığını sanabilir — bu, üründe yapılabilecek en pahalı yanlış anlamadır. Ayrıca "dosya" burada da bilgisayar dosyası anlamında.

**Öneri:**
```
"Belge işlenemedi: bekleme sınırı doldu. Belge çok büyük ya da sayfa sayısı çok fazla — belgeyi bölüp yeniden yükleyin."],
```

**Not:** KANONİK: "süre" YALNIZCA yasal süre. Bekleme her yerde "bekleme" / "bekleme sınırı"; harcanan zaman "geçen zaman".

## [P1] jargon — satir 3045

**Mevcut:**
```
INVALID_REQUEST: "İstek geçersiz — alanları kontrol edin.",
```

**Neden:** "İstek" burada HTTP isteği anlamında kullanılıyor ve kullanıcıya 15'ten fazla yerde gösteriliyor (3045, 3082, 3088, 3092, 3098, 4291, 9647, 10323, 7124, 7134…). Avukat için "istek" hukukî talep demektir; "İstek geçersiz" cümlesini "talebim reddedildi" diye okur. Aynı kavram ayrıca "sorgu" (7371, 7396) ve "çağrı" (araç çağrısı, kaynak çağrısı) adlarıyla da geçiyor. Üstelik "alanları kontrol edin" hangi alan olduğunu söylemiyor.

**Öneri:**
```
INVALID_REQUEST: "Gönderilen bilgiler eksik ya da hatalı — kırmızı işaretli alanları düzeltip yeniden gönderin.",
```

**Not:** KANONİK: kullanıcıya görünen metinde "istek" yerine ne yapıldığını söyleyen ad ("soru", "yükleme", "gönderim", "işlem") kullanılmalı. "sorgu" ve "çağrı" da aynı şekilde ayıklanmalı.

## [P1] jargon — satir 3690

**Mevcut:**
```
p.appendChild(document.createTextNode("Kaynak URL: "));
```

**Neden:** Aynı bilgi bir ekranda "Kaynak URL" (3690, 3695), başka ekranda "Kaynak adresi" (11836) diye anılıyor. "URL" avukatın bilmediği bir kısaltmadır. Ayrıca 3695'te "izinli alan adı değil", 11837'de "izin listesinde değil" — aynı kural iki farklı deyişle anlatılıyor ve ikisi de kullanıcıya neden bağlantının tıklanamadığını anlaşılır biçimde söylemiyor.

**Öneri:**
```
p.appendChild(document.createTextNode("Kaynağın internet adresi: "));
```

**Not:** KANONİK: "internet adresi" (URL kalkar). Tıklanamama gerekçesi tek cümleyle ve her yerde aynı biçimde: "Bu adres güvenli kaynak listesinde olmadığı için bağlantı tıklanabilir yapılmadı; adresi kopyalayıp tarayıcınıza kendiniz yapıştırabilirsiniz."

## [P1] ui-kusuru — satir 4735

**Mevcut:**
```
ph.appendChild(el("div", "line", "Henüz belge yok — tepsiye bir belge bırakın"));
```

**Neden:** "Belge yok" boş durumu uygulamada üç ayrı cümleyle yazılmış: burada "tepsiye bir belge bırakın", 9539'da "Belgeler ekranına bir PDF/DOCX/TXT bırakın", 9974'te "Belgeler görünümünden yükleyin", 8695'te "'Belge yükle' ile ekleyin". Dördü de aynı işi tarif ediyor ama üç ayrı yer adı (tepsi / ekran / görünüm) ve iki ayrı fiil (bırakın / yükleyin) kullanıyor. "Tepsi" hiçbir yerde tanımlanmıyor; ekranda tepsi diye adlandırılmış görünür bir alan yok.

**Öneri:**
```
ph.appendChild(el("div", "line", "Henüz belge yok — “Belge yükle” düğmesine basın ya da bir PDF/Word dosyasını bu alana sürükleyin"));
```

**Not:** Tek boş-durum kalıbı: "Henüz <şey> yok — <tek düğme adı> ile ekleyin." "tepsi" sözcüğü kaldırılmalı; sürükleme alanı ekranda görünür bir çerçeveyle ve kendi etiketiyle işaretlenmeli.

## [P1] tanimsiz-terim — satir 5353

**Mevcut:**
```
" — yüklenen belgeler yalnız DELİLLER'de Ek olarak listelenir ve olay önerisi üretir; hukukî dayanak yapılmaz"
```

**Neden:** Uygulama aynı kavram ailesi için hem hukukçunun sözcüğünü hem kendi uydurduğu sözcüğü kullanıyor: dilekçedeki bölüm "DELİLLER", ürün terimi ise "kanıt" (kanıt kümesi, kanıt paketi, kanıt bağı, Kanıtlar paneli, kanıt kimliği). Avukat için delil ile kanıt aynı şeydir; ikisinin ayrı ayrı kullanılması iki ayrı liste varmış izlenimi verir. Ayrıca aynı cümlede "dayanak" üçüncü bir ad olarak geçiyor.

**Öneri:**
```
" — yüklediğiniz belgeler dilekçenin DELİLLER başlığında Ek olarak listelenir ve olay önerisi üretir; hukukî sebep olarak gösterilmez"
```

**Not:** KANONİK: ürün terimi "dayanak" olsun (dayanak listesi, dayanak bağı, Dayanaklar paneli). "DELİLLER" yalnız dilekçe başlığının adı olarak kalsın. "kanıt kümesi" / "kanıt paketi" (7431) tamamen kalksın.

## [P1] jargon — satir 7088

**Mevcut:**
```
"Model tek paragraf yazar; her atıf ayrı bir anlamsal doğrulama (entailment) hakemiyle sınanır, %85 altı atıf atılır, hiçbiri kalmazsa paragraf KAYNAKSIZ olur. Sonuç taslağın yeni sürümüne yazılır."));
```

**Neden:** 27 sözcüklük tek cümlede beş anlaşılmaz öge: "Model", "anlamsal doğrulama (entailment)" — İngilizce terim parantez içinde açıklama sanılarak konmuş ama açıklamıyor, "hakem", "%85" (neyin yüzdesi?), "KAYNAKSIZ". Aynı kavram 6566'da üçüncü bir adla geçiyor: "anlamsal bağ %". Avukat bu paragrafa basmadan önce ne olacağını bilemez.

**Öneri:**
```
"Bulut Yardımcı tek bir paragraf yazar. Yazdığı her cümle, seçtiğiniz alıntılarla gerçekten örtüşüyor mu diye ayrıca sınanır; örtüşmeyen atıflar atılır. Hiçbiri kalmazsa paragraf KAYNAKSIZ (dayanağı yok) diye işaretlenir. Sonuç taslağın yeni bir sürümü olarak kaydedilir."));
```

**Not:** "entailment", "model", "hakem" kullanıcı metninden çıkarılmalı; eşik yüzdesi "Teknik ayrıntılar" içine alınmalı. 6566'daki "anlamsal bağ %" de aynı dille yazılmalı: "alıntıyla örtüşme".

## [P1] jargon — satir 7999

**Mevcut:**
```
"Her istek için ayrı onay: çip açıkken gönderilen her soru ‘useCloudAi’ işaretiyle gider; kapattığınız anda hiçbir şey gönderilmez."));
```

**Neden:** Tek cümlede üç anlaşılmaz öge var: "çip" (hiçbir yerde tanımlanmamış arayüz sözcüğü), "istek" (HTTP anlamında), ve İngilizce program etiketi "useCloudAi" — bu, kullanıcıya gösterilmesi gereken bir bilgi değildir. Cümle gizlilik konusunda güven vermeye çalışırken tam tersini yapıyor.

**Öneri:**
```
"Her soru için ayrı onay: Bulut Yardımcı düğmesi açıkken gönderdiğiniz her soru için ayrıca onayınız istenir; düğmeyi kapattığınız anda bu bilgisayardan hiçbir metin çıkmaz."));
```

**Not:** "çip" → "düğme"; program içi etiketler (useCloudAi) kullanıcı metninden çıkarılmalı.

## [P1] tanimsiz-terim — satir 9494

**Mevcut:**
```
wrote.then(function () { toast("Izgara CSV olarak panoya kopyalandı.", "ok"); },
```

**Neden:** "Izgara" uydurulmuş bir ekran adıdır (2387 "Belge × soru ızgarası") ve hiçbir yerde tanımlanmıyor; "CSV" ise avukatın bilmediği bir dosya biçimi kısaltması. Kullanıcı neyin nereye kopyalandığını anlamıyor. Ekranın kendi açıklaması (9685) doğru anlatıyor — "Satır: belge · sütun: soru" — ama ad bunu yansıtmıyor.

**Öneri:**
```
wrote.then(function () { toast("Tablo panoya kopyalandı — Excel'e yapıştırabilirsiniz.", "ok"); },
```

**Not:** KANONİK: ekran adı "Belge × soru ızgarası" → "Çoklu belge karşılaştırma tablosu"; "ızgara" → "tablo"; "CSV indir" → "Excel'de aç (CSV)".

## [P1] tanimsiz-terim — satir 9539

**Mevcut:**
```
? "Henüz belge yok — Belgeler ekranına bir PDF/DOCX/TXT bırakın."
```

**Neden:** Uygulamada aynı yerler dört ayrı sözcükle anılıyor: "görünüm" (Dosyalarım görünümü, Araştır görünümü, Belgeler görünümü — 15 yerde), "ekran" (burası, 3275, 11143, 11165, 11167), "sayfa" (Dosya sayfası, Belge sayfası, 8353, 10992), "sekme" (Araştırmalar sekmesi 10096, Süreler sekmesi 12276, Dosya sekmeleri 8580). "Belgeler ekranına" ve "Belgeler görünümünden" (9974) aynı yeri anlatıyor. Avukat üç ayrı yer arar. Ayrıca "PDF/DOCX/TXT" kısaltma yığını başka yerde "PDF, DOCX, TXT veya UDF" (3054), başka yerde "PDF · DOCX · TXT · UDF" (13001) biçiminde yazılmış.

**Öneri:**
```
? "Henüz belge yok — Belgeler ekranından bir PDF veya Word belgesi yükleyin."
```

**Not:** KANONİK AD: üst menüden gidilen her yer "ekran"dır (Belgeler ekranı, Araştır ekranı). Dosya/belge detayı "sayfa", bir ekranın içindeki bölme "sekme". Dosya biçimi listesi her yerde tek biçimde: "PDF, Word (DOCX), TXT veya UDF".

## [P1] jargon — satir 10187

**Mevcut:**
```
errCard(target, "Belge bulunamadı", "Bu kimlikle bir belge yok; silinmiş olabilir.");
```

**Neden:** "Kimlik" uygulamada iki ayrı anlamda: avukatın bildiği anlam TCKN/VKN (6116 "kimlik numarası 11 (TCKN) veya 10 (VKN) haneli olmalıdır") ve iç numara (burası, 8448, 9744 Belge kimliği, 10278 parça kimliği, 12761 Liste kimliği, 6694 kanıt kimliği, 12939 belge kimlikleri). Avukat "Bu kimlikle bir belge yok" cümlesini müvekkilin kimlik numarasıyla ilgili sanır.

**Öneri:**
```
errCard(target, "Belge bulunamadı", "Bu bağlantıdaki belge artık yok; silinmiş olabilir. Belgeler ekranından listeye bakın.");
```

**Not:** KANONİK: "kimlik" YALNIZCA TCKN/VKN için. İç numaralar kullanıcıya gösterilmemeli; gösterilmesi gerekiyorsa "kayıt no" denmeli ve "Teknik ayrıntılar" içine alınmalı.

## [P1] tanimsiz-terim — satir 10789

**Mevcut:**
```
panelHead(box, "Talepler (otomatik tespit — kontrol edin; karşı tarafın talebi de burada görünebilir)");
```

**Neden:** "Tespit" uygulamanın en merkezî terimidir ve cevaptaki her bir dayanaklı cümleyi anlatır (2751 "Tüm tespitler doğrulanmış kaynağa bağlı", 2929, 2943, 2977, 9414). Burada ise "otomatik tespit" bambaşka bir anlamda — makinenin bulması demek. Aynı sözcük iki ayrı anlamda çalışınca "tespit" kelimesinin ekrandaki anlamı çöküyor. Ayrıca "tespit" hiçbir yerde tanımlanmıyor.

**Öneri:**
```
panelHead(box, "Talepler (belge metninden otomatik çıkarıldı — mutlaka kontrol edin; karşı tarafın talepleri de bu listeye girmiş olabilir)");
```

**Not:** KANONİK: cevaptaki dayanaklı cümle = "tespit" ve ilk göründüğü yerde bir kez tanımlanır ("tespit: kaynağına bağlanmış tek bir cümle"). Makinenin bulma işi her yerde "otomatik çıkarıldı" denerek anlatılmalı.

## [P1] ton — satir 12036

**Mevcut:**
```
(t.UNCERTAIN || 0) + " tanesi ise kapsamımızın dışında kaldığı için belirsizdir.";
```

**Neden:** Ürünün kendinden söz edişi üç ayrı sese bölünmüş: birinci çoğul ("kapsamımızın dışında", 12035 "taradığımız kaynaklarda", 9864 "Neyi tarıyoruz?", 11167 "Neyi tarayabildiğimizi"), üçüncü tekil ürün adıyla (11550 "ColleX yalnız ELİNDEKİ sayfayı", 12670 "ColleX bunları uydurmaz", 7922 "ColleX tahmin etmez") ve edilgen/soyut (12145 "sistem künye uydurmaz", 9853 "bilinmeyen tutar uydurulmaz"). Aynı vaat üç ağızdan üç türlü söyleniyor; avukat kimin konuştuğunu bilemiyor.

**Öneri:**
```
(t.UNCERTAIN || 0) + " tanesi ise ColleX'in taradığı kaynakların dışında kaldığı için belirsiz kaldı.";
```

**Not:** KANONİK SES: ürün kendinden hep "ColleX" diye söz etsin (üçüncü tekil), kullanıcıya hep "siz" desin. "biz/bizim" ve "sistem" özneleri kaldırılmalı; "Neyi tarıyoruz?" başlığı → "ColleX neyi tarıyor?".

## [P1] anlasilmaz-cumle — satir 13071

**Mevcut:**
```
note: "Denetlenen metin, belgenin BÖLÜM ÖNİZLEMELERİDİR (her bölümün ilk 240 karakteri" +
```

**Neden:** Bu not toplamda ~55 sözcüklük tek bir blok (13071–13075) ve içinde büyük harfle bağıran üç öge var: BÖLÜM ÖNİZLEMELERİDİR, TAM, EKSİK. Cümle "240 karakter", "ön inceleme", "önizlemeye girmeyen metin" gibi ölçü ve kavramları üst üste yığıyor; sonunda avukatın ne yapması gerektiği ("tam metni yapıştırın") dördüncü cümlede kalıyor. Ayrıca aynı ekranda hem "bölüm önizlemesi" hem "parça" terimi dolaşıyor.

**Öneri:**
```
note: "Dikkat: burada belgenin tamamı değil, her bölümünün ilk 240 karakteri denetlendi. Tam denetim için belgenin tam metnini kutuya yapıştırın. Eksik metin yüzünden bir atıf gözden kaçabilir; ColleX var olmayan bir hükmü asla var göstermez."
```

**Not:** Kural: bir bilgi kutusunda en çok üç cümle, cümle başına en çok 20 sözcük; yapılacak iş her zaman İKİNCİ cümlede. Büyük harfle vurgu kutu başına en çok bir kez.

## [P2] ui-kusuru — satir 3978

**Mevcut:**
```
var a = el("a", null, "Doğrulama dosyasını indir (JSON — alıntıların bağımsız denetimi için)");
```

**Neden:** İndirme düğmelerinde dosya biçimi kısaltmaları etiketin içine sızmış ve her yerde farklı biçimde: burada "(JSON — …)", 9494/9495'te "CSV indir", 6402 "Markdown dosyası", 6406 "UDF dosyası", 3537 "Düz metin (TXT)", 10237 "Aslını indir". JSON, CSV, Markdown avukatın bilmediği biçimlerdir; düğme ne indirileceğini değil dosya uzantısını söylüyor.

**Öneri:**
```
var a = el("a", null, "Denetim dosyasını indir — başka bir uzmanın alıntıları bağımsızca kontrol etmesi için");
```

**Not:** KANONİK: düğme etiketi ne indirileceğini söylesin; dosya biçimi varsa parantezde ve en sonda dursun ("… (JSON dosyası)"). "Aslını indir" gibi tek anlaşılır etiketler örnek alınmalı.

## [P2] ui-kusuru — satir 4860

**Mevcut:**
```
"İstek tarayıcıdan iptal edildi. Sunucu bu işi kendi içinde tamamlasa bile "
```

**Neden:** Durdurma eylemi dört ayrı sözcükle anlatılıyor: "iptal edildi" (burası), "vazgeçildi" (10069, 11428), "Vazgeç" düğmesi (7354, 10666), "durduruldu" (5113). Kullanıcı bastığı düğmenin adını ("Vazgeç") sonuç mesajında göremiyor. Ayrıca cümle "tarayıcı" ve "sunucu" ile başlayıp kullanıcıya değil sisteme anlatıyor.

**Öneri:**
```
"Beklemekten vazgeçtiniz. İşlem arka planda tamamlansa bile "
```

**Not:** KANONİK: düğme "Vazgeç", sonuç mesajı "Beklemekten vazgeçtiniz". "iptal", "durduruldu", "tarayıcıdan" ifadeleri kaldırılmalı.

## [P2] ui-kusuru — satir 6808

**Mevcut:**
```
if (e.legislationNo) { metaRow(meta, "Mevzuat No", e.legislationNo + (e.article ? " m. " + e.article : "")); }
```

**Neden:** Alan etiketlerinde büyük-küçük harf tutarsız: "Mevzuat No" (büyük N, ayrıca 3616), buna karşılık "Esas / Karar" (3615), "Kanun no" (11282), "karar no" (11669), "kayıt no" (11472), "Araştırma no" (3722, 9744). Aynı tablo içinde bile büyük ve küçük harfli "no" yan yana geliyor; ekran özensiz görünüyor.

**Öneri:**
```
if (e.legislationNo) { metaRow(meta, "Mevzuat no", e.legislationNo + (e.article ? " m. " + e.article : "")); }
```

**Not:** KANONİK: etiketlerde yalnız ilk sözcüğün baş harfi büyük — "Mevzuat no", "Esas no", "Karar no", "Kayıt no", "Araştırma no". Aynı kural bütün tablo başlıkları ve form etiketleri için geçerli olmalı.

## [P2] ui-kusuru — satir 11746

**Mevcut:**
```
"kararın sorduğunuz ifadeyi nerede geçirdiğini görmek için “Tam metni getir” deyin.";
```

**Neden:** Düğme çağırma fiili uygulamada dört ayrı biçimde: "deyin" (burası), "basın" (7218, 9788), "tıklayın" (3187, 8353), sadece edatla "ile" (11533 "“Tam metni getir” ile", 8854, 12276). Bir düğmeye "deyin" demek Türkçede tuhaf durur ve tıklanabilir olduğunu gizler. Aynı düğme iki satır arayla (11533 ve 11746) iki farklı fiille anlatılıyor.

**Öneri:**
```
"kararın sorduğunuz ifadeyi nerede geçirdiğini görmek için “Tam metni getir” düğmesine basın.";
```

**Not:** KANONİK: düğme için her yerde "<Ad> düğmesine basın"; satır/kart için "tıklayın"; sekme için "açın". "deyin" ve yalın "ile" kullanımı kaldırılmalı.
