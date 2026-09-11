# sunucu-metinleri

Sunucu tarafındaki Türkçe metinler iki ayrı dille yazılmış: bir yanda gerçekten iyi, avukat diliyle kurulmuş cümleler (süre hesabı gerekçeleri, harç kalemleri, atıf denetim raporunun dürüstlük notları), diğer yanda doğrudan mühendis defterinden ekrana ve DOCX belgesine düşen satırlar. En ağır sorun, cevabın en çok okunan yeri olan "Kaynaklar" kartında: her kaynağın altında "alıntı SHA-256 …, belge SHA-256 …, konum 1240–1533 (Unicode karakter sayımı — code point)" yazıyor; bu satır avukata hiçbir şey söylemiyor ve ürünün en değerli özelliğini (alıntının bozulmadığının otomatik denetlenmesi) anlaşılmaz kılıyor. İkinci sorun "korpus" sözcüğü: hata mesajlarından kapsam sayfasına, taslak uyarılarından atıf denetimine kadar en az on iki ayrı kullanıcı metninde geçiyor ve hiçbirinde tanımı yok. Üçüncüsü, uydurulmuş damgalar (TAM/ŞERHLİ/KISMİ/ÇEKİMSER, KESİNLEŞTİRİLEBİLİR, KAYNAKSIZ, "tespit", "pasaj", "SENTETİK") ekranda kendilerini açıklamadan geçiyor. Dördüncüsü, teknik arıza mesajları avukata çözemeyeceği komutlar veriyor: ".venv/Scripts/python.exe -m intake.cli --dsn <dsn> --ensure-db çalıştırın", "POST /v1/answer kullanın", "gövdede useCloudAi:true gönderin". İçerik doğruluğu genelde iyi ve abartı iddiası yok — sorun tamamen dildedir; aşağıdaki kalemlerin çoğu tek satırlık metin değişimiyle çözülür.

Bulgu: 40

## [P0] jargon — satir 33

**Mevcut:**
```
Yerel korpusa ulaşılamadı; veritabanı çalışmıyor olabilir.
```

**Neden:** retrieval/corpusErrors.ts. Bu, veritabanı kapalıyken avukatın gördüğü TEK cümle. "Korpus" ve "veritabanı" iki bilinmeyen sözcük; üstelik avukata ne yapması gerektiğini söylemiyor.

**Öneri:**
```
Bilgisayarınızdaki hukuk arşivi açılamadı, bu yüzden arama yapılamadı. ColleX-Baslat.cmd dosyasını çalıştırıp yeniden deneyin.
```

## [P0] jargon — satir 45

**Mevcut:**
```
SENTETİK VERİ — Bu taslağa bağlanan kaynaklar sentetik test korpusundandır; gerçek Türk mevzuatı veya mahkeme kararı değildir.
```

**Neden:** drafting/markdown.ts. Bu satır üretilen DİLEKÇENİN İLK SATIRLARINDA yer alır. "Sentetik" ve "korpus" iki bilinmeyen sözcük; oysa söylenen şey hayatî ve çok basit: bu kaynaklar sahte, dilekçeye konmaz.

**Öneri:**
```
UYARI — DENEME VERİSİ: Bu taslaktaki kaynaklar gerçek değildir; ColleX'in denemesi için üretilmiş örnek metinlerdir. Gerçek bir Türk kanunu veya mahkeme kararı değildir, dilekçeye konulamaz.
```

## [P0] tanimsiz-terim — satir 66

**Mevcut:**
```
COMPLETE: { label: "TAM", detail: "tüm tespitler kaynak doğrulamalı" },
  QUALIFIED: { label: "ŞERHLİ", detail: "tespitler kaynaklı, ancak çekince/çelişki var" },
  PARTIAL: { label: "KISMİ", detail: "bazı tespitler doğrulanamadı" },
  ABSTAIN: {
    label: "ÇEKİMSER",
    detail: "cevaptan kaçınıldı — yeterli doğrulanabilir kaynak yok",
  },
```

**Neden:** answer/renderer.ts. Dört uydurulmuş damga. "ŞERHLİ" hukukta şerh düşülmüş kararı çağrıştırır, burada başka anlamda. "ÇEKİMSER" oy için kullanılan bir sözcük. "Tespit" burada teknik anlamda kullanılıyor, hukuktaki tespit davası/tespit tutanağı ile karışıyor. Hiçbirinin ekranda tanımı yok.

**Öneri:**
```
COMPLETE: { label: "KAYNAKLI", detail: "cevaptaki her cümlenin dayandığı karar veya madde gösterildi" },
  QUALIFIED: { label: "ÇEKİNCELİ", detail: "cümleler kaynaklı, ancak aksi yönde karar da var — ikisi de aşağıda" },
  PARTIAL: { label: "EKSİK", detail: "bazı cümlelerin dayanağı bulunamadı; o cümleler işaretlendi" },
  ABSTAIN: {
    label: "CEVAP YOK",
    detail: "bu soruya dayanak gösterilebilecek karar veya madde bulunamadı; uydurmamak için cevap verilmedi",
  },
```

## [P0] jargon — satir 83

**Mevcut:**
```
Mahkeme kararları yerel korpusta tam değildir: bulunmaması kararın olmadığı anlamına GELMEZ. Künyeyi kaynağından teyit edin.
```

**Neden:** contracts/corpusResolver.ts. Atıf Denetim Raporunun her "belirsiz" satırında görünür. Söylenen şey doğru ve önemli ama "yerel korpus" yüzünden anlaşılmıyor.

**Öneri:**
```
Bilgisayarınızdaki arşivde tüm mahkeme kararları yoktur: bu kararın burada bulunmaması, böyle bir kararın olmadığı anlamına GELMEZ. Künyeyi kararın kendisinden teyit edin.
```

## [P0] jargon — satir 88

**Mevcut:**
```
Yerel korpusa ulaşılamadı; atıf denetlenemedi. Bu, atıfın bulunmadığı anlamına GELMEZ.
```

**Neden:** contracts/corpusResolver.ts. Aynı "korpus" sorunu; ayrıca avukata ne yapacağını söylemiyor.

**Öneri:**
```
Bilgisayarınızdaki arşiv açılamadığı için bu atıf denetlenemedi. Bu, atfın hatalı olduğu anlamına GELMEZ. ColleX-Baslat.cmd ile arşivi açıp raporu yeniden alın.
```

## [P0] tanimsiz-terim — satir 105

**Mevcut:**
```
KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır.
```

**Neden:** answer/renderer.ts. "Kesinleştirme" hukukta kararın kesinleşmesidir; burada bambaşka bir anlamda (makine kontrolleri geçti) kullanılıyor. Avukat bunu "karar kesinleşti" diye okur. "Teknik kontroller" de ne yapıldığını söylemiyor.

**Öneri:**
```
KULLANIMA HAZIR — Her alıntının kaynağında birebir yer aldığı denetlendi ve denetimden geçti. Hukukî değerlendirme size aittir.
```

## [P0] tanimsiz-terim — satir 106

**Mevcut:**
```
KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan kullanmayın.
```

**Neden:** answer/renderer.ts. Aynı uydurulmuş terim. Ayrıca "gerekçeleri" nerede olduğunu söylemiyor; avukat nereye bakacağını bilemez.

**Öneri:**
```
KULLANMADAN ÖNCE KONTROL EDİN — En az bir alıntı denetimden geçemedi. Aşağıdaki "Neden" listesini okumadan bu metni dilekçenize almayın.
```

## [P0] jargon — satir 127

**Mevcut:**
```
SENTETİK TEST VERİSİ — bu cevabın dayandığı korpus gerçek Türk mevzuatı veya içtihadı değildir; yerel test amaçlı üretilmiş sentetik metinlerden oluşur. Hukukî işlem için kullanılamaz.
```

**Neden:** pipeline/answerPipeline.ts. Her cevabın tepesinde uyarı kutusu olarak çıkar. "Sentetik", "korpus", "yerel test amaçlı" — avukat bunu okuyup anlamazsa uyarıyı ciddiye almaz, bu da ürünün en tehlikeli kusurudur.

**Öneri:**
```
UYARI — DENEME VERİSİ: Bu cevabın dayandığı metinler gerçek değildir; ColleX'in denemesi için üretilmiş örneklerdir. Gerçek kanun veya mahkeme kararı değildir. Hiçbir işte kullanmayın.
```

## [P0] jargon — satir 131

**Mevcut:**
```
Bu soruya mevcut korpusta doğrulanabilir kaynak bulunamadı. Doğrulanamayan içerik üretmek yerine cevap vermekten kaçınıyoruz; aşağıdaki makine gerekçeleri hangi kontrolün başarısız olduğunu gösterir.
```

**Neden:** answer/renderer.ts. Cevap alamayan avukatın gördüğü ana metin. "Korpus", "doğrulanabilir kaynak" ve "makine gerekçeleri" üç anlaşılmaz öbek; ayrıca avukata bundan sonra ne yapacağını söylemiyor.

**Öneri:**
```
Bu soruya dayanak gösterebileceğimiz bir karar veya kanun maddesi bulunamadı. Kaynağı olmayan bir cevabı uydurmamak için cevap vermiyoruz. Aşağıda hangi aramanın neden sonuç vermediği yazıyor; soruyu daha dar sorabilir veya elinizdeki belgeyi yükleyip yeniden sorabilirsiniz.
```

## [P0] eksik-aciklama — satir 141

**Mevcut:**
```
return `Soru kapsamı: ${pct(coverage.ratio)} — soru sözcüklerinin kaynaklarda karşılığı`;
```

**Neden:** answer/renderer.ts. "Soru kapsamı %48" satırı hem cevabın içinde hem konsolda çıkıyor. Avukat %48'in iyi mi kötü mü olduğunu, ne yapması gerektiğini anlayamaz. "Kapsam" sözcüğü ürünün üç ayrı yerinde üç ayrı anlamda kullanılıyor.

**Öneri:**
```
return `Sorunuzun ne kadarı kaynaklarda karşılık buldu: ${pct(coverage.ratio)} — düşükse soruyu daha dar sorun veya ilgili maddeyi/karar numarasını yazın`;
```

## [P0] jargon — satir 161

**Mevcut:**
```
NO_EVIDENCE: "Korpusta bu soruya ilişkin doğrulanabilir pasaj bulunamadı",
```

**Neden:** answer/renderer.ts. "Korpus" ve "pasaj" birlikte. "Pasaj" bu dosyada en az sekiz kullanıcı metninde geçiyor ve hiçbirinde açıklanmıyor.

**Öneri:**
```
NO_EVIDENCE: "Bu soruya dayanak olabilecek bir karar veya kanun metni bulunamadı",
```

## [P0] jargon — satir 161

**Mevcut:**
```
   - Kanıt kimliği: ${entry.evidenceId}`,
        `   - Alıntı SHA-256: ${entry.quoteSha256}`,
        `   - Belge içerik SHA-256: ${entry.contentSha256}`,
```

**Neden:** drafting/markdown.ts. Dilekçenin "DAYANAK KAYNAKLARI" ekinde her kaynağın altına 64 karakterlik iki onaltılık dizi ve bir UUID basılıyor. Avukat bu üç satırın ne işe yaradığını bilemez; belgeyi karşı tarafa verirken ne olduğunu açıklayamaz.

**Öneri:**
```
   - Kayıt no: ${entry.evidenceId}`,
        `   - Alıntı denetim kodu: ${entry.quoteSha256.slice(0, 16)}…`,
        `   - Belge denetim kodu: ${entry.contentSha256.slice(0, 16)}…`,
        `   - Bu kodlar, alıntının ve kaynak belgenin sonradan değiştirilmediğinin denetlenmesini sağlar.`,
```

## [P0] anlasilmaz-cumle — satir 177

**Mevcut:**
```
ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM:
    "Tespit birden çok pasaja dayanıyor ama hangi pasajın hangi kısmı taşıdığı belirtilmemiş; ölçüm en yüksek tek pasaj üzerinden yapıldı",
```

**Neden:** answer/renderer.ts. Cümle hem "tespit" ve "pasaj" jargonunu taşıyor hem de "hangi pasajın hangi kısmı taşıdığı" ifadesi Türkçe olarak anlaşılmıyor (neyin hangi kısmı, neyi taşıyor?). "Ölçüm en yüksek tek pasaj üzerinden yapıldı" avukata hiçbir sonuç bildirmiyor.

**Öneri:**
```
ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM:
    "Bu cümle birden çok kaynağa dayandırıldı, ancak hangi kaynağın cümlenin hangi bölümünü desteklediği ayrılamadı. Bu yüzden destek gücü, kaynaklardan yalnız en güçlüsüne göre hesaplandı — kaynakları tek tek açıp okuyun",
```

## [P0] jargon — satir 248

**Mevcut:**
```
- Doğrulama: alıntı SHA-256 ${ref.quoteSha256.slice(0, 12)}…, belge SHA-256 ${ref.contentSha256.slice(0, 12)}…, konum ${ref.locator.startChar}–${ref.locator.endChar} (Unicode karakter sayımı — code point)
```

**Neden:** answer/renderer.ts. Bu satır her kaynak kartının altında görünür — cevabın en çok okunan yeri. "SHA-256", "Unicode", "code point" ve sayısal "konum" avukatın hiçbirini bilmediği dört terim yan yana. Ürünün en değerli özelliği (alıntının değiştirilmediğinin otomatik denetlenmesi) burada anlatılıyor ama anlaşılmıyor.

**Öneri:**
```
- Alıntı denetimi: Bu alıntı, kaynak belgenin ${ref.locator.startChar}. ile ${ref.locator.endChar}. harfleri arasından olduğu gibi alındı. Alıntının ve belgenin değiştirilmediği otomatik olarak denetlenir; denetim kayıtları "Doğrulama dosyası"ndadır.
```

## [P0] jargon — satir 288

**Mevcut:**
```
- Kaynak isabeti: ${pct(c.retrieval)}`,
    `- Pasaj desteği: ${pct(c.entailment)}`,
    `- Otorite: ${pct(c.authority)}`,
```

**Neden:** answer/renderer.ts. Her cevapta beş satır yüzde basılıyor: "Kaynak isabeti %72", "Pasaj desteği %61", "Otorite %90". Hiçbirinin ne ölçtüğü, neyin iyi neyin kötü olduğu ekranda yazmıyor. Avukat bu sayılara bakıp karar veremez; sayının kendisi bir açıklama olmadan bilgi değil gürültüdür.

**Öneri:**
```
- Kaynağın soruya uygunluğu: ${pct(c.retrieval)}`,
    `- Kaynağın bu cümleyi ne kadar desteklediği: ${pct(c.entailment)}`,
    `- Kaynağın bağlayıcılık ağırlığı (Yargıtay/Danıştay en yüksek): ${pct(c.authority)}`,
```

## [P0] tanimsiz-terim — satir 316

**Mevcut:**
```
Bu tespit doğrulama kontrollerinden geçemedi ve KAYNAKSIZ kabul edilir; karara dayanak yapılmamalıdır.
```

**Neden:** answer/renderer.ts. "Tespit", "doğrulama kontrolleri" ve tanımsız damga "KAYNAKSIZ" bir arada. Ayrıca "karara dayanak yapılmamalıdır" edilgen ve muğlak — kimin kararı?

**Öneri:**
```
Bu cümlenin dayandığı kaynak denetimden geçemedi: alıntı, gösterilen kaynakta bulunamadı. Cümleyi dilekçenize almayın; kaynağını kendiniz bulup doğrulayın.
```

## [P0] jargon — satir 394

**Mevcut:**
```
Yerel veritabanına ulaşılamadı — PostgreSQL 127.0.0.1:55432 çalışmıyor olabilir; kayıt ve dosya işlemleri kapalı.
```

**Neden:** store/health.ts. "PostgreSQL", "127.0.0.1:55432" — avukat için tamamen okunamaz. Üstelik en sık görülecek arıza mesajı bu.

**Öneri:**
```
Hukuk arşivi kapalı — kayıt tutma ve belge yükleme şu an çalışmıyor. Masaüstündeki ColleX-Baslat.cmd dosyasını çalıştırın; birkaç saniye sonra bu uyarı kaybolur.
```

## [P0] jargon — satir 400

**Mevcut:**
```
Veritabanı${name} var ama şema yok — .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --ensure-db çalıştırın.
```

**Neden:** store/health.ts. Sistem durumu ekranında ve açılışta görünür. Avukata terminal komutu veriliyor; "şema", "dsn", "intake.cli" hiçbiri anlaşılmaz ve avukat bu komutu nereye yazacağını bilmez.

**Öneri:**
```
Hukuk arşivi henüz kurulmamış. Masaüstündeki ColleX-Kur.cmd dosyasını bir kez çalıştırın; kurulum bittiğinde bu uyarı kaybolur. Sorun sürerse ColleX'i kuran kişiye bu satırı iletin.
```

## [P0] jargon — satir 756

**Mevcut:**
```
Bu sunucuda upstream sağlayıcı geçidi yapılandırılmamış; yerel korpus için POST /v1/answer kullanın.
```

**Neden:** api/server.ts. "Upstream sağlayıcı geçidi" ve "POST /v1/answer" — ikincisi bir programcı talimatı; avukatın ekranında bunu yapabileceği hiçbir yer yok.

**Öneri:**
```
Resmî kaynaklara canlı bağlantı şu an kapalı. Bilgisayarınızdaki arşivde arama yapmak için soruyu "Araştırma" ekranından sorun.
```

## [P0] jargon — satir 824

**Mevcut:**
```
Cevap boru hattı bu sunucuda yapılandırılmamış (yerel hukuk korpusu veritabanı gerekli).
```

**Neden:** api/server.ts. "Boru hattı" (pipeline), "sunucu", "korpus", "veritabanı" — dört terim tek cümlede. Avukat soru sorduğunda bu cevabı alabilir ve hiçbir şey anlamaz.

**Öneri:**
```
Araştırma özelliği şu an çalışmıyor: bilgisayarınızdaki hukuk arşivi açık değil. Masaüstündeki ColleX-Baslat.cmd dosyasını çalıştırıp sorunuzu yeniden sorun.
```

## [P1] jargon — satir 20

**Mevcut:**
```
Cevap veritabanına yazılamadı; bu oturumda görünür ama yeniden başlatınca kaybolur. Veritabanını (ColleX-Baslat.cmd) kontrol edin veya doğrulama dosyasını (JSON) indirin.
```

**Neden:** store/persistNotice.ts. "Veritabanı", "oturum", "JSON" üç jargon. Ayrıca en önemli bilgi — kaydın kaybolacağı — cümlenin ortasında kalıyor.

**Öneri:**
```
DİKKAT: Bu cevap kaydedilemedi. Şu an ekranda duruyor, ancak ColleX'i kapatınca kaybolur. Kaybetmemek için ya masaüstündeki ColleX-Baslat.cmd ile arşivi açıp yeniden kaydedin, ya da şimdi "Doğrulama dosyasını indir" düğmesine basıp bilgisayarınıza kaydedin.
```

## [P1] jargon — satir 114

**Mevcut:**
```
`- Taslak kimliği: ${draft.draftId}`,
```

**Neden:** drafting/markdown.ts. Dışa aktarılan dilekçenin başına 36 karakterlik bir UUID basılıyor. "Kimlik" sözcüğü avukat için TC kimliği/vergi kimliği demektir; burada anlamsız bir harf yığınına işaret ediyor.

**Öneri:**
```
`- Taslak kayıt no: ${draft.draftId.slice(0, 8)}`
```

## [P1] jargon — satir 134

**Mevcut:**
```
Bulut yapay zekâ için istek başına onay gerekir: gövdede useCloudAi:true gönderin (seçilen belge/kanıt metni Anthropic sunucularına gönderilir).
```

**Neden:** ai/routes.ts. "Gövdede useCloudAi:true gönderin" avukatın ekranda yapamayacağı bir programcı talimatı. "Bulut yapay zekâ" da tanımsız — avukat verisinin nereye gittiğini bu cümleden anlayamaz.

**Öneri:**
```
Bu işlem için belgenizin metni bu bilgisayardan çıkıp Anthropic firmasının sunucularına gönderilir. Her seferinde ayrı onay gerekir: ekrandaki "Bilgisayar dışına göndermeyi onaylıyorum" kutusunu işaretleyip yeniden deneyin.
```

## [P1] jargon — satir 137

**Mevcut:**
```
Aşağıda listelenen pasajlar sorunuzla yalnız kelime düzeyinde benziyor; dayanak değildir.
```

**Neden:** answer/renderer.ts. "Pasaj" tanımsız; "kelime düzeyinde benzerlik" mühendis ifadesi. Cümle doğru bir şey söylüyor ama avukatın diline çevrilmemiş.

**Öneri:**
```
Aşağıdaki metinler sorunuzla yalnızca aynı kelimeleri paylaşıyor; konuyla ilgili oldukları doğrulanamadı. Dayanak olarak kullanılamazlar.
```

## [P1] jargon — satir 151

**Mevcut:**
```
Cevap süre bütçesini aştı; tespit yazımı ve doğrulama eksik bırakıldı — bulunan pasajlar gösteriliyor, cevap KISMİ.
```

**Neden:** pipeline/answerPipeline.ts. "Süre bütçesi", "tespit yazımı", "pasaj" ve tanımsız "KISMİ" damgası. Ne kadar süre, ne yapmalı — hiçbiri yok.

**Öneri:**
```
Bu soru ayrılan süreye (1 dakika) sığmadı; cevap cümleleri yazılamadan durduruldu. Aşağıda yalnız bulunan kaynaklar var. Soruyu daha dar sorarsanız tam cevap alabilirsiniz.
```

## [P1] jargon — satir 151

**Mevcut:**
```
Bu bölüm belge gövdesine ait değildir; gövdedeki 'Dayanak [K-n]' atıflarının doğrulama bilgilerini özetler. Tam alıntılar ve tam SHA-256 özetleri DAYANAK KAYNAKLARI ekindedir.
```

**Neden:** drafting/appendix.ts. Bu paragraf üretilen dilekçenin içine giriyor. "SHA-256 özetleri" avukatın mahkemeye giden bir belgede açıklayamayacağı bir ifade.

**Öneri:**
```
Bu bölüm dilekçe metninin parçası değildir; gövdedeki 'Dayanak [K-n]' atıflarının denetim bilgilerini özetler. Alıntıların tam metni ve denetim kayıtları DAYANAK KAYNAKLARI ekindedir.
```

## [P1] ui-kusuru — satir 157

**Mevcut:**
```
   - Kaynak: ${entry.source === "UPLOAD" ? "yüklenen belge" : entry.source}`,
```

**Neden:** drafting/markdown.ts. Yalnız UPLOAD Türkçeleştirilmiş; diğer değerler (CORPUS, LIVE, ANSWER gibi) ham İngilizce kod olarak dilekçe ekine basılıyor. Avukat "Kaynak: CORPUS" satırını görecek.

**Öneri:**
```
Her değer için Türkçe karşılık tanımlayın ve ham kodun basılmasını engelleyin: UPLOAD → "sizin yüklediğiniz belge", CORPUS → "bilgisayarınızdaki arşiv", LIVE → "resmî kaynaktan canlı getirildi"; tanımsız bir değer gelirse "kaynak türü belirtilmemiş" yazılsın.
```

## [P1] jargon — satir 161

**Mevcut:**
```
 — SHA-256 (ilk 8): ${shortHash8(entry.quoteSha256)}
```

**Neden:** drafting/appendix.ts. Dilekçenin doğrulama ekinde her kaynağın yanında "SHA-256 (ilk 8): a3f19b2c" yazıyor. Avukat bu sekiz karakterin ne olduğunu bilemez.

**Öneri:**
```
 — Denetim kodu: ${shortHash8(entry.quoteSha256)}
```

## [P1] jargon — satir 168

**Mevcut:**
```
Ek-${index + 1} — ${inlineText(upload.fileName)} — yüklenen belge, ${upload.chunkCount} parça
```

**Neden:** drafting/appendix.ts. "Parça" (chunk) yazılım terimi. Avukat "3 parça" ifadesini belgenin fiziken bölündüğü sanır; bu bilgi ona hiçbir şey de kazandırmıyor.

**Öneri:**
```
Ek-${index + 1} — ${inlineText(upload.fileName)} — sizin yüklediğiniz belge
```

## [P1] jargon — satir 170

**Mevcut:**
```
RETRIEVAL_DEGRADED: "Korpus tam olarak taranamadı",
```

**Neden:** answer/renderer.ts. "Korpus" yine; ayrıca sonucun avukat için ne demek olduğunu (cevap eksik olabilir) söylemiyor.

**Öneri:**
```
RETRIEVAL_DEGRADED: "Arşivin bir bölümü taranamadı; cevap eksik olabilir, aramayı tekrarlayın",
```

## [P1] ton — satir 172

**Mevcut:**
```
DRAFTER_DEGRADED: "Tespit üreticisi hata verdi",
```

**Neden:** answer/renderer.ts. Saf mühendis dili: "tespit üreticisi" diye bir şey avukatın dünyasında yok, "hata verdi" de ne olduğunu söylemiyor.

**Öneri:**
```
DRAFTER_DEGRADED: "Cevap cümleleri yazılırken bir arıza oldu; aşağıda yalnız bulunan kaynaklar gösteriliyor",
```

## [P1] jargon — satir 226

**Mevcut:**
```
CANLI ARAŞTIRMA — bu cevaptaki alıntılar, çalışma anında resmî kaynaklardan (Bedesten/UYAP ve ilgili kurum servisleri) çekilen TAM BELGE metinlerinden alınmış ve SHA-256 ile mühürlenmiştir; arama özeti asla kanıt olarak kullanılmaz. Sonuçlar resmî kaynak sunucularının erişilebilirliğine bağlıdır ve eksik olabilir; hukukî işlem öncesi avukat incelemesi gereklidir.
```

**Neden:** research/researchService.ts. Canlı araştırmanın tepe uyarısı. "SHA-256 ile mühürlenmiştir", "kurum servisleri", "sunucuların erişilebilirliği" — üç jargon; ayrıca cümle çok uzun ve tek nefeste okunmuyor.

**Öneri:**
```
CANLI ARAŞTIRMA — Bu cevaptaki alıntılar, siz sorduğunuz anda resmî kaynaklardan (UYAP/Bedesten ve ilgili kurumlar) indirilen belgelerin TAM METNİNDEN alınmıştır. Arama sonucu özetleri kaynak sayılmaz; yalnız tam metin kullanılır. Her alıntının indirildiği hâlinden değiştirilmediği otomatik denetlenir. Resmî kaynaklar geçici olarak kapalı olabilir; bu durumda sonuç eksik gelir. Kullanmadan önce kararları kendiniz okuyun.
```

## [P1] ton — satir 308

**Mevcut:**
```
rationale: "Entailment portu hata verdi; iddia desteklenmemiş sayıldı.",
```

**Neden:** pipeline/answerPipeline.ts. "Entailment portu" tamamen yazılım terimi ve doğrudan cevaba düşer. "İddia" da burada teknik anlamda kullanılıyor.

**Öneri:**
```
rationale: "Kaynağın bu cümleyi destekleyip desteklemediği denetlenemedi (arıza); güvenli tarafta kalmak için cümle desteksiz sayıldı.",
```

## [P1] jargon — satir 338

**Mevcut:**
```
`Süre kuralı bulunamadı: '${(input.ruleId as string).slice(0, 60)}'. GET /v1/deadlines/rules ile geçerli kural kimliklerini listeleyin.`,
```

**Neden:** deadlines/calc.ts. Süre hesabı ekranındaki hata mesajı avukata "GET /v1/deadlines/rules" çalıştırmasını söylüyor. Avukatın bunu yapabileceği hiçbir yer yok.

**Öneri:**
```
`Bu süre kuralı listede yok: '${(input.ruleId as string).slice(0, 60)}'. Süre hesabı ekranındaki kural listesinden bir kural seçin, ya da "Özel süre" seçeneğiyle gün/hafta/ay sayısını kendiniz girin.`,
```

## [P1] jargon — satir 1726

**Mevcut:**
```
> Bu cevap yalnız yüklediğiniz ${count} belge
```

**Neden:** pipeline/answerPipeline.ts. Kutu başlığı "> **KAPSAM**" — "kapsam" bu üründe hem soru kapsamı, hem kaynak kapsamı, hem dosya kapsamı demek. Üç ayrı anlam, tek sözcük. Avukat hangi kapsam olduğunu ayırt edemez.

**Öneri:**
```
> **BU CEVAP NEREDE ARANDI**
> Bu cevap yalnız yüklediğiniz ${count} belge
```

## [P1] jargon — satir 1765

**Mevcut:**
```
| Mesele | Şerit | Sorgu | Durum | Sonuç |
```

**Neden:** pipeline/answerPipeline.ts. "Şerit" (lane) tablo başlığı olarak geçiyor; hiçbir Türkçe karşılığı yok, uydurulmuş. "Sorgu" da teknik.

**Öneri:**
```
| Konu | Nerede arandı | Aranan kelimeler | Durum | Bulunan |
```

## [P1] jargon — satir 1777

**Mevcut:**
```
### Kanıt kümesine alınmayan pasajlar
```

**Neden:** pipeline/answerPipeline.ts. "Kanıt kümesi" ve "pasaj" — bir başlıkta iki jargon. Başlık, avukata bu bölümün neden burada olduğunu söylemiyor.

**Öneri:**
```
### Bulunan ama dayanak olarak kullanılmayan metinler
```

## [P1] anlasilmaz-cumle — satir 1779

**Mevcut:**
```
Aşağıdaki pasajlar taramada bulundu ancak bu sorunun kanıt kümesine alınmadı. Alıntı gösterilmez: doğrulama sürecinden geçmemiş metin, kanıt gibi sunulamaz.
```

**Neden:** pipeline/answerPipeline.ts. Edilgen yığını ("alınmadı", "gösterilmez", "sunulamaz") ve üç jargon. Doğru ilkeyi anlatıyor ama avukat okuduğunda ne yapması gerektiğini bilmiyor.

**Öneri:**
```
Bu metinler aramada çıktı, ancak cevaba dayanak yapılmadı. Metinlerini burada göstermiyoruz: denetimden geçmemiş bir metni kaynak gibi sunmak yanıltıcı olur. İlginizi çeken bir satır varsa "Kaynak Ara" ekranından açıp kendiniz okuyabilirsiniz.
```

## [P2] jargon — satir 183

**Mevcut:**
```
DOGRULANDI: "alıntı hash ile doğrulandı",
```

**Neden:** contracts/citationAudit.ts. Atıf Denetim Raporunun en olumlu satırı ve tam ortasında "hash" var. Ürünün en güçlü özelliği bu tek kelime yüzünden anlaşılmıyor.

**Öneri:**
```
DOGRULANDI: "alıntı kaynağında birebir bulundu",
```

## [P2] jargon — satir 194

**Mevcut:**
```
Bu sayfadaki sayıların tamamı bu makinede ölçülmüştür: kayıtlı araç sayısı araç kayıt defterinden, veri tabanı ve korpus sayıları /v1/health'ten gelir. Ölçülmemiş hiçbir alana sayı yazılmaz; ölçülmeyen alan “ölçülmedi” der. Korpus büyüklüğü ve doğruluk oranı yayımlanmaz.
```

**Neden:** sources/manifest.ts. Kapsam sayfasının dürüstlük notu — iyi niyetli ama "araç kayıt defteri", "veri tabanı", "korpus", "/v1/health" ile okunamaz hâle gelmiş. Bir avukata "/v1/health" diye bir yer gösterilemez.

**Öneri:**
```
Bu sayfadaki bütün sayılar bu bilgisayarda ölçülmüştür; hiçbiri tahmin değildir. Ölçülemeyen yerlere sayı yazmıyoruz, "ölçülmedi" yazıyoruz. Arşivde kaç karar olduğu ve "doğruluk oranı" gibi sayılar hiç yayımlanmaz: bunları dürüstçe ölçemeyiz.
```
