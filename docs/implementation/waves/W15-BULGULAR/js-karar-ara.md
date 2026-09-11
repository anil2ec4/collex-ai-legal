# js-karar-ara

Karar ara ekranı doğru bir mantık üzerine kurulmuş ama mühendis diliyle yazılmış. Ekranın omurgasında "kaynak geçidi", "sunucu", "istek", "yoklama", "sorgu", "ms" gibi sözcükler var; avukat "Kaynak geçidi yoklanıyor" cümlesini okuduğunda ne olduğunu anlayamaz, sadece bir arıza sezer. En ağır yer tam metin kartıdır: "Parmak izi (SHA-256)", "karakter (Unicode)" ve "konum 120–430 (Unicode karakter sayımı)" satırları doğrudan kullanıcının bilmediği terimlerdir; oysa anlatılmak istenen şey basittir — alıntının bozulmadığı kendiliğinden denetlenir. İki dürüstlük/kusur noktası ciddi: kaynak seçilmemişken ekran "Sorgulanan kaynaklar: Yargıtay · Danıştay" diye ölçülmemiş bir liste yazıyor, ve "şüpheli talimat kalıbı" uyarısı avukata ne yapması gerektiğini hiç söylemiyor. Arayüz tarafında kayıtlı aramayı silen "×" onay sormadan siliyor, satırın "eşleşen cümle yok" gerekçesi yalnız fare üstüne gelince çıkan ipucunda saklı, "Dosyaya kaydet" dosya seçili değilken de tıklanabilir duruyor. Ekranın kendi disiplini (kaynağın sırasına güvenmeme, künye kanıt değildir, sayı uydurmama) değerlidir; eksik olan, bu doğru disiplinin avukatın dilinde söylenmesidir.

Bulgu: 35

## [P0] jargon — satir 11105

**Mevcut:**
```
showNotYet(gate, "GET /v1/sources/catalog", "Karar arama ucu")
```

**Neden:** Ekranda "GET /v1/sources/catalog" ve "uç" görünür. İkisi de avukatın bilmediği teknik dildir; "uç" ayrıca uydurulmuş bir karşılıktır.

**Öneri:**
```
showNotYet(gate, "GET /v1/sources/catalog", "Karar arama")  — ve notYetCard, adresi ana metinde değil "Teknik ayrıntılar" katlanır bloğunda göstermeli.
```

**Not:** Aynı kalıp ekranın başka yerlerinde de var; "uç" sözcüğü ürün genelinde temizlenmeli.

## [P0] tanimsiz-terim — satir 11142

**Mevcut:**
```
Kaynak geçidi yoklanıyor
```

**Neden:** "Kaynak geçidi" ve "yoklama" uydurulmuş terimlerdir, ekranda hiçbir yerde tanımı yok. Avukat ilk açılışta gördüğü sarı şeritte bunu okuyor ve arızalı bir şey olduğunu sanıyor.

**Öneri:**
```
Resmî kaynaklara ulaşılıp ulaşılamadığı kontrol ediliyor
```

**Not:** "Geçit" sözcüğü ekranın üç ayrı yerinde geçiyor (11142, 11153, 11165, 11181, 11184); hepsi birlikte değiştirilmeli.

## [P0] anlasilmaz-cumle — satir 11143

**Mevcut:**
```
Bu ekranın gerçekten arama yapıp yapamayacağı sunucuya soruluyor…
```

**Neden:** "sunucuya soruluyor" yazılımcı cümlesi; ayrıca "bu ekranın gerçekten arama yapıp yapamayacağı" ifadesi ürünün kendine güvenmediği izlenimi veriyor. Avukat ne yapması gerektiğini öğrenmiyor.

**Öneri:**
```
Birkaç saniye sürer; bittiğinde arama alanları ya açılır ya da nedeni burada yazılır.
```

## [P0] jargon — satir 11165

**Mevcut:**
```
Sunucu resmî kaynak geçidine bağlı değil; bu ekran tek bir künye bile getiremez.
```

**Neden:** Tek cümlede "sunucu" ve "geçit". Kırmızı şeridin en önemli cümlesi ve avukat için okunaksız.

**Öneri:**
```
ColleX bu bilgisayarda resmî kaynaklara bağlanamıyor; bu ekran şu an tek bir karar künyesi bile getiremez.
```

## [P0] eksik-aciklama — satir 11402

**Mevcut:**
```
if (!labels.length) { labels = ["Yargıtay", "Danıştay"]; }
```

**Neden:** Hiç kaynak seçilmemişken ekran "Sorgulanan kaynaklar: Yargıtay · Danıştay" yazıyor. Bu bir ölçüm değil, varsayım: sunucu hangi kaynaklara sorduğunu söylemedi. Avukat sonucun bu iki kaynaktan geldiğini sanır; bu, projenin kendi "uydurulmuş sayı/künye yok" kuralının ihlalidir.

**Öneri:**
```
if (!labels.length) { labels = []; }  — ve ilerleme satırı boş listede şunu yazmalı: "Kaynak seçmediniz; arama ColleX'in varsayılan kaynaklarında yapıldı. Hangi kaynakların cevap verdiği sonuç geldiğinde aşağıda yazılacak."
```

**Not:** Sonuç geldiğinde okSources zaten gerçek listeyi taşıyor; tahmini liste yalnız bekleme sırasında yanıltıyor.

## [P0] jargon — satir 11406

**Mevcut:**
```
labels.length + " kaynak · 1 istek gönderildi, yanıt bekleniyor."
```

**Neden:** "istek gönderildi" yazılımcı ifadesidir; ayrıca gerçekte kaç çağrı gittiği değişkendir, sabit "1" yanıltıcıdır.

**Öneri:**
```
labels.length + " kaynağa soruldu; cevap bekleniyor."
```

## [P0] jargon — satir 11419

**Mevcut:**
```
Resmî kaynak sunucularına istek gönderildi (" + labels.join(" · ") + "); yanıt bekleniyor.
```

**Neden:** "sunucu" ve "istek" iki ayrı yasak terim, üstelik aynı cümlede. Avukat için önemli olan bilgi (bekleme bizde değil, kaynağın kendisinde) bu iki sözcüğün altında kayboluyor.

**Öneri:**
```
Sorular resmî kaynaklara iletildi (" + labels.join(" · ") + "). Cevap bekleniyor.
```

## [P0] anlasilmaz-cumle — satir 11811

**Mevcut:**
```
⚠ Bu özet metinde şüpheli talimat kalıbı var; yalnız görüntüleme amaçlıdır.
```

**Neden:** "talimat kalıbı" tanımsız uydurma bir terimdir (kaynak metne gizlenmiş komut kastediliyor). Avukat ne olduğunu, tehlikenin ne olduğunu ve ne yapması gerektiğini öğrenemiyor. Aynı cümle 11849'da belge kartında da var.

**Öneri:**
```
⚠ Bu metinde, programa iş yaptırmaya çalışan gizli bir yazı var gibi görünüyor. Metni okuyabilirsiniz; ancak içindeki yönergelere uymayın ve bu satırı dayanak yapmadan önce kararın kendisini kaynağından doğrulayın.
```

**Not:** 11849'daki eşi de aynı şekilde düzeltilmeli.

## [P0] jargon — satir 11828

**Mevcut:**
```
Parmak izi (SHA-256)
```

**Neden:** SHA-256 ve "parmak izi" avukatın bilmediği terimlerdir; şikayette birebir örnek olarak verilmiştir. Yanındaki tıklanabilir kısa karakter dizisi de ne işe yaradığını söylemiyor.

**Öneri:**
```
Metin bütünlük kaydı
```

**Not:** Hemen altına açıklama satırı konmalı: "Belgenin ColleX'e ulaştığı andaki hali kaydedildi; alıntıladığınız cümlenin sonradan değişip değişmediği kendiliğinden denetlenir." Kısa dizi "Teknik ayrıntılar" katlanır bloğuna alınmalı. Teknik doğruluk kaybolmaz.

## [P0] jargon — satir 11831

**Mevcut:**
```
metaRow(meta, "Metin uzunluğu", (c.contentCodePoints || 0) + " karakter (Unicode)");
```

**Neden:** "(Unicode)" parantezinin avukata söylediği hiçbir şey yok; sadece ekranı yabancılaştırıyor.

**Öneri:**
```
metaRow(meta, "Belgenin uzunluğu", fmtCount(c.contentCodePoints || 0) + " harf");
```

**Not:** Binlik ayracı zaten dosyada var (fmtCount); 116090 yerine 116.090 okunur.

## [P0] jargon — satir 11862

**Mevcut:**
```
konum " + q.startChar + "–" + q.endChar + " (Unicode karakter sayımı)
```

**Neden:** "Unicode" ve sayısal "konum" avukatın bilmediği iki terimdir; ekranda "konum 1240–1533 (Unicode karakter sayımı)" yazısı hiçbir şey ifade etmez ve alıntının altında en çok göze çarpan satırdır.

**Öneri:**
```
Bu cümle belgenin başından itibaren " + q.startChar + ". harfte başlıyor, " + q.endChar + ". harfte bitiyor.
```

**Not:** Sayılar korunuyor, sadece hangi ölçüyle sayıldığı avukat diline çevriliyor.

## [P1] jargon — satir 11184

**Mevcut:**
```
Yoklama beklenen cevabı vermedi (" + httpStatusTR(res.status) + "). Arama denenebilir, ama sonuç gelmezse sebebi geçit olabilir.
```

**Neden:** "Yoklama" ve "geçit" tanımsız; ayrıca cümle avukatı belirsizlikte bırakıyor — "denenebilir" diyor ama ne zaman vazgeçeceğini söylemiyor.

**Öneri:**
```
Kontrol beklenen cevabı vermedi (" + httpStatusTR(res.status) + "). Aramayı deneyebilirsiniz; sonuç gelmezse sebebi resmî kaynaklara bağlanılamaması olabilir.
```

## [P1] tanimsiz-terim — satir 11255

**Mevcut:**
```
var chamber = b2TextInput("Örn. H3 · 15. CD", prev["kf-chamber"]);
```

**Neden:** "H3" kaynağın iç kodudur; hiçbir avukat daireyi böyle yazmaz ve ekranda ne olduğu açıklanmıyor. Örnek, doğru yazımı öğretmek yerine kafa karıştırıyor.

**Öneri:**
```
var chamber = b2TextInput("Örn. 3. Hukuk Dairesi · 15. Ceza Dairesi", prev["kf-chamber"]);
```

**Not:** Kaynak kısa kodu da kabul ediyorsa bu, alanın altındaki küçük notta söylenmeli.

## [P1] ui-kusuru — satir 11345

**Mevcut:**
```
var d = ghostBtn("×", function () {
```

**Neden:** Kayıtlı arama tek tıkla, onay sorulmadan siliniyor ve geri alınamıyor. Etiket sadece "×"; ne yapacağı ancak fare üstünde durunca anlaşılıyor. Dosyada başka yerlerde onaylı silme (confirmDelete) kalıbı zaten var, burada kullanılmamış.

**Öneri:**
```
Silme düğmesine görünür bir etiket ver ("Sil") ve dosyadaki confirmDelete kalıbını uygula: ilk tık "Silinsin mi? Evet / Vazgeç" sorsun.
```

## [P1] jargon — satir 11391

**Mevcut:**
```
Aranacak ifadeyi yazın — arama boş bir sorguyla gönderilmez.
```

**Neden:** "sorgu" yazılımcı sözcüğü; ayrıca cümlenin ikinci yarısı avukata bir şey öğretmiyor, sistemin iç kuralını anlatıyor.

**Öneri:**
```
Aranacak ifadeyi yazın; boş kutuyla arama yapılamaz.
```

## [P1] jargon — satir 11442

**Mevcut:**
```
document.getElementById("karar-timing").textContent = (Date.now() - t0) + " ms";
```

**Neden:** "4183 ms" avukat için ölçü değildir; saniye konuşulur. Ton olarak da mühendis panosu izlenimi verir.

**Öneri:**
```
document.getElementById("karar-timing").textContent = busySeconds(Date.now() - t0) + " sürdü";
```

**Not:** busySeconds dosyada zaten var ve saniyeyi Türkçe biçimde yazıyor.

## [P1] ton — satir 11472

**Mevcut:**
```
var tech = el("p", "rawcode", "(Teknik: " + err.kind + (err.correlationId ? " · kayıt no " + err.correlationId : "") + ")");
```

**Neden:** err.kind İngilizce BÜYÜK_HARF makine kodudur ve hata kartının ana akışında, katlanmadan gösteriliyor. Projenin kendi kuralı bunu "Teknik ayrıntılar" katlanır bloğuna koymayı gerektiriyor.

**Öneri:**
```
Kodu details/summary içine al: summary "Teknik ayrıntılar", içinde "(" + err.kind + ")" ve varsa kayıt numarası.
```

## [P1] jargon — satir 11491

**Mevcut:**
```
rows.length + " künye · " + calls + " kaynak çağrısı"
```

**Neden:** "kaynak çağrısı" ve devamındaki " ms" (11492) yazılımcı ölçüleridir; avukatın kararına hiçbir katkısı yok.

**Öneri:**
```
rows.length + " künye getirildi"  (çağrı sayısı ve süre "Teknik ayrıntılar" katlanır bloğuna alınmalı)
```

**Not:** 11492'deki " ms" de aynı blokta saniyeye çevrilerek gösterilmeli.

## [P1] jargon — satir 11550

**Mevcut:**
```
Sıralamayı kaynak sunucu belirler; ColleX yalnız ELİNDEKİ sayfayı yeniden sıralar ve süzer.
```

**Neden:** "sunucu" yasak terim; ayrıca üç cümlelik bloğun tamamı (11550-11552) tek nefeste okunuyor ve avukat en önemli uyarıyı (bu ilgililik sıralaması değildir) kaçırıyor.

**Öneri:**
```
Bu listenin sırasını kaynağın kendisi belirledi. ColleX yalnızca elindeki bu sayfayı yeniden sıralayabilir.
```

**Not:** Bloğun kalan iki cümlesi ayrı satırlara alınmalı; en kritik olanı ("Bu bir ilgililik sıralaması değildir") kalın ve ilk sırada olmalı.

## [P1] jargon — satir 11591

**Mevcut:**
```
Kaynak, bu sorgu için kaç kayıt tuttuğunu bildirmedi; bu listenin kaynaktaki kümenin ne kadarı olduğu bilinmiyor.
```

**Neden:** "sorgu" ve "küme" avukat dili değil. Cümlenin verdiği bilgi çok değerli (listenin buzdağının ucu olup olmadığı bilinmiyor) ama bu iki sözcük yüzünden okunmadan geçiliyor.

**Öneri:**
```
Kaynak, bu aramaya toplam kaç kararının uyduğunu bildirmedi. Bu yüzden aşağıdaki listenin kaynaktaki kararların ne kadarı olduğu bilinmiyor.
```

## [P1] jargon — satir 11744

**Mevcut:**
```
Eşleşen cümle sağlanmadı — bu kaynak liste satırında metin döndürmüyor.
```

**Neden:** "döndürmüyor" (return) programcı fiilidir. Ayrıca cümle avukata ne yapacağını söylemiyor; gerekçe ve çözüm ayrı bir ipucu metnine (11745) saklanmış.

**Öneri:**
```
Bu kaynak, arama listesinde karardan cümle vermiyor — yalnız künye gönderiyor. Kararın sorduğunuz ifadeyi nerede geçirdiğini görmek için "Tam metni getir" deyin.
```

**Not:** 11745'teki açıklama ayrı bir gizli ipucu olmaktan çıkıp bu cümlenin içine girmeli.

## [P1] ui-kusuru — satir 11748

**Mevcut:**
```
none.title = KARAR_NO_SNIPPET_WHY_TR;
```

**Neden:** Satırın neden boş olduğunun gerçek açıklaması yalnız fareyle üstüne gelince çıkan ipucunda duruyor. Avukat fareyi bekletmez; dokunmatik ekranda ve klavyeyle hiç görünmez. Ekranın en çok merak edilen sorusu görünmez bir yerde saklı.

**Öneri:**
```
Açıklamayı title yerine satırın altında küçük punto kalıcı bir metin olarak yaz (el("div", "snipwhy", KARAR_NO_SNIPPET_WHY_TR)); 20 satırda tekrarlanmaması için listenin başında bir kez göster.
```

**Not:** Tekrar sorununu çözmek için: aynı gerekçe listede bir kez, sonuç kartının üstünde yazılabilir.

## [P1] ui-kusuru — satir 11806

**Mevcut:**
```
acts.appendChild(ghostBtn("Dosyaya kaydet", function () { saveKunyeToMatter(r); }, "small"));
```

**Neden:** Dosya seçili değilken düğme etkin görünüyor; avukat tıklıyor ve 3 saniyede kaybolan bir uyarı alıyor, hiçbir şey kaydedilmiyor. Ayrıca "Dosyaya kaydet" etiketi belirsiz: bilgisayara dosya kaydedileceği sanılabilir.

**Öneri:**
```
Etiketi "Dava dosyasına not olarak ekle" yap; aktif dosya yokken düğmeyi disabled çiz ve altına "Önce üst çubuktan bir dava dosyası seçin." yaz.
```

## [P1] jargon — satir 11837

**Mevcut:**
```
Bu adres izin listesinde değil; bağlantı tıklanabilir yapılmadı.
```

**Neden:** "izin listesi" tanımsız bir terim; avukat bunun bir güvenlik önlemi mi, arıza mı olduğunu anlamıyor ve adresi ne yapacağını bilmiyor.

**Öneri:**
```
Bu adres ColleX'in tanıdığı resmî kaynaklar arasında değil. Güvenlik için bağlantı tıklanabilir yapılmadı; adresi kopyalayıp tarayıcınıza kendiniz yapıştırabilirsiniz.
```

## [P1] jargon — satir 11854

**Mevcut:**
```
Belge yerel kütüphaneye yazılamadı; kartın kendisi ve alıntıları etkilenmedi.
```

**Neden:** "yerel kütüphane" ve "kart" ekranda tanımsız iki terim. Avukat bir şeyin başarısız olduğunu görüyor ama kaybettiği şeyin ne olduğunu bilmiyor.

**Öneri:**
```
Bu belgenin bir kopyası bilgisayarınıza kaydedilemedi. Ekranda gördüğünüz metin ve alıntılar bundan etkilenmedi; belge kaynağından yeniden getirilebilir.
```

**Not:** 11857'deki "yerel kütüphanede zaten vardı" cümlesi de aynı dille düzeltilmeli.

## [P2] jargon — satir 10986

**Mevcut:**
```
row("Veritabanı", (DB_STATE_TR[h.db] || h.db || "?") + (h.dbName ? " · " + h.dbName : "") +
```

**Neden:** "Veritabanı", altındaki "migrasyon 13/13" ve "eksik:" listesiyle birlikte tam bir mühendis panosu; avukat için hiçbir eylem üretmiyor.

**Öneri:**
```
row("Kayıtlarınız", ...) — durum tek Türkçe cümleyle: "Kayıtlarınız açık ve erişilebilir." ya da "Kayıtlara ulaşılamıyor — ColleX'i kapatıp yeniden başlatın." Sürüm/migrasyon bilgisi "Teknik ayrıntılar" katlanır bloğuna.
```

## [P2] jargon — satir 10991

**Mevcut:**
```
kapalı — bulut anahtarı tanımlı değil (ortam değişkeni: ANTHROPIC_API_KEY)
```

**Neden:** "ortam değişkeni" ve anahtar adı avukatın kendi başına yapamayacağı bir işi tarif ediyor; ne yapacağını söylemiyor.

**Öneri:**
```
kapalı — bulut yapay zekâ (Bulut AI) bu bilgisayarda açılmamış. Açmak için kurulum rehberindeki "Bulut AI'yı açma" adımını izleyin.
```

**Not:** "Bulut AI" adlandırma kuralı korunuyor.

## [P2] jargon — satir 10994

**Mevcut:**
```
row("Korpus", c ? c.publicDocuments + " korpus belgesi
```

**Neden:** "Korpus" şikayette birebir sayılan terimlerden; ayrıca aynı satırda "DENEME KORPUSU (sentetik)" geçiyor ki bu, ürünün en kritik uyarısı (bu metinler gerçek mevzuat değildir) ve tam da anlaşılmayan sözcüklerle yazılmış.

**Öneri:**
```
row("Belge arşivi", c ? c.publicDocuments + " hazır belge · " + c.uploads + " sizin yüklediğiniz belge" + (h.demoCorpus ? " · DİKKAT: bu arşivdeki metinler gerçek mevzuat değil, sınama için yazılmış örneklerdir" : "") : "sayılamadı (kayıt deposuna bağlanılamadı)");
```

**Not:** Bölgemin başındaki sistem durumu satırı; karar ara ekranıyla aynı sözlüğü paylaştığı için birlikte düzeltilmeli.

## [P2] ui-kusuru — satir 11362

**Mevcut:**
```
var name = window.prompt("Bu aramaya bir ad verin:", cpTruncate(params.query, 40));
```

**Neden:** Tarayıcının kendi kutusu ekranın tasarımıyla uyumsuz, bazı tarayıcılarda engellenebiliyor ve ekranın geri kalanındaki kalıcı doğrulama düzeniyle çelişiyor (11376'da bilinçli olarak toast yerine kalıcı hata tercih edilmişken burada tarayıcı kutusuna dönülmüş).

**Öneri:**
```
Kayıtlı aramalar şeridinin yanına küçük bir ad alanı + "Kaydet" düğmesi koy; adı boş bırakılırsa aranan ifadenin kendisini ad yap.
```

## [P2] eksik-aciklama — satir 11506

**Mevcut:**
```
eq.appendChild(el("summary", null, "Aramayı göster"));
```

**Neden:** "Aramayı göster" ne açacağını söylemiyor; avukat zaten ne yazdığını biliyor. Asıl değerli bilgi, ColleX'in ifadeyi değiştirip değiştirmediğidir.

**Öneri:**
```
eq.appendChild(el("summary", null, "Kaynağa tam olarak ne soruldu?"));
```

## [P2] ton — satir 11513

**Mevcut:**
```
Ulaşılabilen kaynaklardan künye gelmedi. Yukarıda adı geçen kaynaklara ulaşılamadığı için sonuç EKSİKTİR.
```

**Neden:** BÜYÜK HARFLE bağırma tonu; ayrıca avukata bundan sonra ne yapacağı söylenmiyor (yeniden dene, kaynağı çıkar, ifadeyi gevşet).

**Öneri:**
```
Ulaşılabilen kaynaklardan hiç künye gelmedi. Yukarıda adı geçen kaynaklara ulaşılamadığı için bu sonuç eksiktir — biraz sonra "Ara"ya yeniden basmayı deneyebilirsiniz.
```

## [P2] ton — satir 11605

**Mevcut:**
```
d.appendChild(el("summary", null, "Kaynak kaynak sayılar"));
```

**Neden:** Türkçesi bozuk ve ne açılacağını söylemiyor.

**Öneri:**
```
d.appendChild(el("summary", null, "Hangi kaynakta kaç kayıt var?"));
```

## [P2] anlasilmaz-cumle — satir 11637

**Mevcut:**
```
p.appendChild(el("b", null, "Bu sayfa: "));
```

**Neden:** "Bu sayfa" üç anlama gelebiliyor: ekran, kaynağın sonuç sayfası, yazdırılan sayfa. Satırın anlatmak istediği şey (getirilen listenin dağılımı) başlıkta kaybolmuş.

**Öneri:**
```
p.appendChild(el("b", null, "Getirilen listenin dağılımı: "));
```

## [P2] jargon — satir 11719

**Mevcut:**
```
box.appendChild(el("b", null, "Ulaşılamayan kaynaklar (" + failed.length + ") — sonuç eksiktir"));
```

**Neden:** Başlık doğru ama altındaki satırlarda sunucunun kendi İngilizce/teknik mesajı (f.message) ve "kayıt no" doğrudan ana akışta yazılıyor.

**Öneri:**
```
Başlık kalsın; her satırda yalnız kaynağın adı ve tek cümlelik Türkçe sebep görünsün, sunucunun kendi mesajı ile kayıt numarası "Teknik ayrıntılar" katlanır bloğuna alınsın.
```

## [P2] ton — satir 11763

**Mevcut:**
```
k.appendChild(el("span", "src", "  " + (r.sourceLabel || r.sourceId || "")));
```

**Neden:** Kaynağın okunur adı yoksa satırın sonunda makine kimliği (örn. bedesten_yargitay) görünüyor; avukat için anlamsız bir kod.

**Öneri:**
```
Kaynak adı yoksa kararSourceName(r.sourceId) ile katalogdaki Türkçe adı kullan; o da yoksa "kaynak adı bildirilmedi" yaz, ham kimliği gösterme.
```
