# js-cevap-detay

Bu bölge (kapsam seçimi, dosya seçici, ilerleme kartı ve "Vazgeç", belge listesi ve künye satırları) teknik olarak çok iyi düşünülmüş ama ekrandaki dili mühendis yazmış: avukatın hiç bilmediği "korpus", "sha256 / parmak izi", "uç", "snippet", "ağ geçidi", "araç çağrısı", "dizine alma", "parça / bölüm" sözcükleri kart başlıklarında, künye satırlarında ve hata mesajlarında doğrudan görünüyor. "Kapsam" sözcüğü tek ekranda üç ayrı anlamda (araştırma alanı, ekli belge davranışı, dava dosyası) kullanılıyor ve hiçbir yerde tanımlanmıyor. Belge kartı, avukatın işine yaramayan üç teknik satırı (12 haneli harf-rakam dizisi, karakter sayısı, bölüm sayısı) en üste koyup asıl bilgiyi (bu belge hangi dava dosyasına bağlı, ne işe yarar) hiç söylemiyor. "Araştırma izi" kartı baştan sona mühendis tablosu; avukat bu kartı ilk gördüğünde ekranı kapatır. İlerleme kartı ve "Vazgeç" mantığı doğru kurulmuş ama cümleleri "istek/sunucu/tarayıcı" dilinde. Belge kartındaki altı düğme aynı ağırlıkta yan yana duruyor; "Belgeye sor" ile "Bu dosyayla araştır" arasındaki fark ekrandan anlaşılmıyor ve "dosya" sözcüğü hem yüklenen belge hem dava dosyası için kullanıldığı için düğme etiketleri birbiriyle çelişiyor.

Bulgu: 38

## [P0] jargon — satir 4537

**Mevcut:**
```
Soru yalnız bu belgelerin metniyle cevaplanır; “korpusla birlikte” işaretliyse yerel korpus da taranır.
```

**Neden:** "Korpus" kelimesi bir cümlede iki kez geçiyor. Avukat bu kelimeyi hiç duymamıştır ve ekranda tanımı yoktur. Cümle ayrıca ancak aşağı bakınca görülen bir kutuya kendi adıyla atıf yapıyor.

**Öneri:**
```
Sorunuz yalnız seçtiğiniz belgelerin içinden cevaplanır. Aşağıdaki “bilgisayarımdaki arşiv de taransın” kutusunu işaretlerseniz, bu bilgisayarda kayıtlı karar ve mevzuat arşivi de taranır.
```

**Not:** Aynı düzeltme HTML gövdesindeki kutu etiketinde de gerekli (satır 2332: “korpusla birlikte — yerel korpus da taransın”).

## [P0] jargon — satir 4583

**Mevcut:**
```
c.appendChild(el("span", null, f.name + " · " + shortHash(f.fileId)));
```

**Neden:** Ekli belge etiketinde belgenin adının yanında "7c1a9f30b2e4…" gibi 12 haneli bir dizi görünüyor. Avukat bunun ne olduğunu bilmez, bir şeye dokunmaktan çekinir. Belgenin adı zaten ayırt edicidir.

**Öneri:**
```
c.appendChild(el("span", null, f.name));
```

**Not:** Aynı adda iki belge varsa ayırt edici olarak yükleme tarihi yazılmalı, kimlik dizisi değil.

## [P0] jargon — satir 4637

**Mevcut:**
```
healthLine.appendChild(document.createTextNode("Resmî kaynak ağ geçidinin durumu: "));
```

**Neden:** "Ağ geçidi" (gateway) mühendislik terimi. Yanındaki damga da "sağlıklı / sorunlu" diyor; avukat neyin sağlıklı olduğunu ve bunun cevabına etkisini anlamaz.

**Öneri:**
```
healthLine.appendChild(document.createTextNode("Resmî kaynaklara bağlantı: "));
```

**Not:** Damga metinleri de değişmeli (satır 4638): "sağlıklı" → "kuruldu", "sorunlu" → "kurulamadı — sonuçlar eksik olabilir".

## [P0] jargon — satir 4649

**Mevcut:**
```
"harcanan bütçe — araç çağrısı: " + (spent.toolCalls === undefined ? "-" : spent.toolCalls) +
```

**Neden:** "Bütçe", "araç çağrısı" ve satırın sonundaki "ms" birlikte avukat için hiçbir anlamı olmayan bir sayaç oluşturuyor. Avukat "bütçe" deyince para anlar; burada kastedilen sorgu sayısı.

**Öneri:**
```
"Bu araştırmada " + (spent.toolCalls === undefined ? "-" : spent.toolCalls) + " arama yapıldı · " + (spent.fetches === undefined ? "-" : spent.fetches) + " belgenin tam metni indirildi · toplam " + (spent.wallTimeMs === undefined ? "-" : busySeconds(spent.wallTimeMs)) + " sürdü."
```

**Not:** Sayıların kaynağı aynı; yalnız dil ve birim (ms → saniye) değişiyor. busySeconds bu dosyada zaten var (satır 4863).

## [P0] jargon — satir 4654

**Mevcut:**
```
table(box, ["Yetenek", "Araç", "Durum", "Süre", "Sonuç"],
```

**Neden:** "Yetenek" ve "Araç" yazılımın iç kavramları; ekranda tanımları yok. Tablo hangi mahkeme/kurum arşivinde ne arandığını değil, hangi yazılım fonksiyonunun çağrıldığını gösteriyor.

**Öneri:**
```
table(box, ["Nerede arandı", "Ne arandı", "Sonuç", "Süre"],
```

**Not:** Sonuç sütununda "✓/✗" yerine "12 karar bulundu" / "ulaşılamadı" yazılmalı (satır 4656); ✓ tek başına neyin başarılı olduğunu söylemiyor.

## [P0] jargon — satir 4667

**Mevcut:**
```
table(box, ["Belge", "Kaynak", "Harici no", "sha256"],
```

**Neden:** Tablo sütun başlığı olarak küçük harfle "sha256" yazıyor — ekrandaki en anlaşılmaz kelime. "Harici no" da uydurulmuş bir terim: avukat bunun esas/karar numarası mı, sistem numarası mı olduğunu bilemez.

**Öneri:**
```
table(box, ["Belge", "Geldiği kurum", "Kurumdaki numarası", "Metnin değişmediği denetlendi"],
```

**Not:** Son sütunun hücrelerinde ham değer yerine "evet" yazılmalı; ham değer satırın ipucu metninde kalabilir.

## [P0] jargon — satir 4673

**Mevcut:**
```
"Tam belge getirilmedi — getirilmeyen metinden alıntı yapılmaz; arama snippet'i kanıt değildir."));
```

**Neden:** "Snippet" İngilizce bir yazılım terimi; Türkçe karşılığı verilmemiş. Cümlenin anlattığı şey ürünün en güçlü yanı (arama sonucundaki kırpık satır dayanak sayılmaz) ama avukat bunu okuyamıyor.

**Öneri:**
```
"Hiçbir kararın tam metni getirilemedi. ColleX yalnız tam metnini indirdiği belgelerden alıntı yapar; arama sonucunda görünen kırpık satırlar dayanak olarak kullanılmaz."));
```

## [P0] jargon — satir 4696

**Mevcut:**
```
if (res.status === 404) { fileStatus(""); showNotYet(list, "GET /v1/files", "Dosya ucu"); return null; }
```

**Neden:** Ekrana "Dosya ucu bu sunucuda henüz açık değil." cümlesi çıkıyor. "Uç" (endpoint) ve "sunucu" avukatın bilmediği kelimeler; "Dosya ucu" Türkçede hiçbir anlama gelmiyor.

**Öneri:**
```
if (res.status === 404) { fileStatus(""); showNotYet(list, "GET /v1/files", "Belge listesi"); return null; }
```

**Not:** notYetCard gövdesindeki "sunucuda" da "bu bilgisayardaki ColleX'te" olmalı (satır 3274).

## [P0] jargon — satir 4750

**Mevcut:**
```
" dizine alınmadı (sayfa " + pages.emptyPages.slice(0, 15).join(", ") +
```

**Neden:** "Dizine alma" (index) yazılım terimi. Avukatın öğrenmesi gereken tek şey şu: o sayfalar aramada çıkmaz ve o sayfalardan alıntı yapılamaz — cümle bunu söylemiyor, teknik iç işleyişi söylüyor.

**Öneri:**
```
" aramada çıkmaz ve bu sayfalardan alıntı yapılamaz (sayfa " + pages.emptyPages.slice(0, 15).join(", ") +
```

**Not:** Cümlenin başı (satır 4748) da sadeleştirilmeli: "12 sayfanın 3 tanesi taranmış görüntü; içinde seçilebilir yazı yok."

## [P0] jargon — satir 4785

**Mevcut:**
```
metaRow(list, "Parmak izi (SHA-256)", shortHash(f.sha256));
```

**Neden:** Belge künyesinin ilk satırı "Parmak izi (SHA-256)" ve yanında "a3f9c1e02b74…" gibi bir harf-rakam dizisi. Avukat ne SHA-256'yı ne de o diziyi bilir; ilk bakışta ekranın kendisi için yazılmadığını düşünür. Üstelik bu satır künyenin EN ÜSTÜNDE duruyor.

**Öneri:**
```
metaRow(list, "Değişmezlik denetimi", "Bu belgenin içeriği yüklendiği andaki hâliyle kilitlendi; alıntılarınız her seferinde bu asıl metinle karşılaştırılır.");
```

**Not:** Teknik doğruluk korunuyor: ürün alıntının bozulmadığını hâlâ matematiksel olarak doğruluyor, sadece bunu isimlendirmiyor. Ham değer istenirse künyenin altındaki katlanmış "Teknik ayrıntılar" bölümüne alınmalı.

## [P0] jargon — satir 4789

**Mevcut:**
```
(f.chunkCount === undefined ? "-" : f.chunkCount + " bölüm"));
```

**Neden:** "Bölüm" burada chunk karşılığı. Avukat "bölüm" deyince dilekçenin bölümlerini anlar; "37 bölüm" görünce belgesinin 37 kısma ayrıldığını sanır. Bu sayının avukat için hiçbir kullanımı yok; yanındaki "karakter" sayısının da yok.

**Öneri:**
```
Bu künye satırı kaldırılmalı; yerine avukatın işine yarayan tek cümle konmalı: metaRow(list, "Aranabilirlik", "Belgenin yazısı çıkarıldı; artık bu belgeye soru sorabilir ve içinden alıntı yapabilirsiniz.");
```

**Not:** Sayfa sayısı zaten kartın üstündeki damgada var.

## [P0] jargon — satir 4969

**Mevcut:**
```
conf.appendChild(el("span", null, "Silinsin mi? Belge, sürümleri ve parçaları kalıcı olarak kaldırılır."));
```

**Neden:** "Parçaları" burada yazılımın metni böldüğü chunk'ları anlatıyor; avukat "parça" deyince belgenin ekini ya da sayfasını anlar ve neyin silineceğinden emin olamaz. Geri alınamaz bir işlemde belirsizlik en tehlikelisidir.

**Öneri:**
```
conf.appendChild(el("span", null, "Bu belge ve ondan üretilen her şey (aranabilir metni, önceki sürümleri) geri alınamaz biçimde silinsin mi? Bu belgeye dayanan eski cevaplarınızdaki alıntılar bir daha doğrulanamaz."));
```

## [P0] jargon — satir 4984

**Mevcut:**
```
fileStatus("silme ucu henüz bağlanmadı (404)");
```

**Neden:** Tek satırda iki anlaşılmaz şey: "uç" ve çıplak "404". Avukat belgenin silinip silinmediğini bile anlayamaz. Projenin kendi kuralı da çıplak HTTP kodunu yasaklıyor.

**Öneri:**
```
fileStatus("Silme özelliği bu kurulumda açık değil — belge silinmedi. ColleX'i kuran kişiden açmasını isteyin.");
```

## [P0] jargon — satir 5011

**Mevcut:**
```
"Yerel sistem görüntüden metin çıkarmaz — belgeyi “aranabilir PDF” " +
```

**Neden:** "Yerel sistem" mühendis dili; devam cümlesindeki "Bulut OCR" ise ekranda hiç tanımlanmamış (OCR avukatın bilmediği bir kısaltma). Avukat elindeki taranmış PDF ile ne yapacağını çözemiyor.

**Öneri:**
```
"ColleX bu bilgisayarda görüntüdeki yazıyı metne çeviremez. İki yol var: (1) belgeyi tarayıcınızda “aranabilir PDF” olarak yeniden kaydedip yükleyin; (2) Bulut AI açıksa, sayfa görüntüsündeki yazıyı metne çevirmesi için belgeyi Bulut AI'ya gönderin — bu durumda belge Anthropic'e iletilir."
```

**Not:** Proje kuralı gereği kısa etiket "Bulut AI" korunmalı. Satır 5036'daki düğme de "Bulut OCR ile metne çevir" → "Bulut AI ile sayfadaki yazıyı metne çevir" olmalı.

## [P0] jargon — satir 5147

**Mevcut:**
```
showNotYet(document.getElementById("filelist"), "POST /v1/files", "Dosya yükleme ucu");
```

**Neden:** Aynı kusur belge yüklerken çıkıyor: "Dosya yükleme ucu bu sunucuda henüz açık değil." Avukat belgesini yükleyemediğini anlar ama ne yapması gerektiğini anlamaz.

**Öneri:**
```
showNotYet(document.getElementById("filelist"), "POST /v1/files", "Belge yükleme");
```

## [P0] jargon — satir 5167

**Mevcut:**
```
? " zaten yüklüydü" : " yüklendi") + " · parmak izi " + shortHash(body.sha256) +
```

**Neden:** Yükleme sırasındaki durum satırında her belgenin yanında "parmak izi 3fa2c9…" yazıyor. "Parmak izi" ekranda hiç tanımlanmamış, yanındaki dizi okunamaz. Avukatın o an bilmek istediği tek şey "yüklendi mi?".

**Öneri:**
```
? " zaten yüklüydü — aynı belge daha önce eklenmişti" : " yüklendi") +
```

**Not:** Ham değer teknik ayrıntılara taşınmalı; durum satırında yeri yok.

## [P1] anlasilmaz-cumle — satir 4413

**Mevcut:**
```
!window.confirm("Taslakta kaydedilmemiş değişiklikler var. Kaydetmeden ayrılmak istiyor musunuz?")) {
```

**Neden:** Tarayıcının kendi penceresinde düğmeler "Tamam" ve "İptal" yazar. Bu soruda "Tamam"a basmanın yazılanı kaybetmek olduğu belli değil; avukat yanlış düğmeye basıp dilekçesini kaybedebilir.

**Öneri:**
```
Uygulamanın kendi onay kartı kullanılmalı ve düğmeler ne yapacağını söylemeli: "Taslağınızda kaydedilmemiş değişiklikler var. Şimdi ayrılırsanız bu değişiklikler kaybolur." — düğmeler "Taslakta kal" (varsayılan) ve "Kaydetmeden ayrıl".
```

**Not:** Bu dosyada onay kartı deseni zaten var (confirmDelete, satır 4966).

## [P1] anlasilmaz-cumle — satir 4539

**Mevcut:**
```
"Ekli belgeler canlı araştırmada bağlam olarak kayda geçer; alıntılar yalnız getirilen resmî belgelerden doğrulanır."
```

**Neden:** "Bağlam olarak kayda geçer" ne yapıldığını söylemiyor: belge okunuyor mu, dışarı gönderiliyor mu, yalnız not mu düşülüyor? Bu bir gizlilik sorusudur ve avukat cevabını bu cümleden alamıyor.

**Öneri:**
```
"Eklediğiniz belgeler kayda geçer ve sorunuzun arka planı olarak kullanılır; ancak dilekçenize yazılabilecek alıntılar yalnız resmî kaynaklardan indirilen kararların tam metninden çıkar."
```

## [P1] tanimsiz-terim — satir 4540

**Mevcut:**
```
"Ekli belgeler bu kapsamda kullanılmaz — “Yüklediğim belgeler” kapsamını seçin.";
```

**Neden:** "Kapsam" bu ekranda üç ayrı anlamda kullanılıyor (aramanın nerede yapılacağı, ekli belgelerin nasıl kullanılacağı, dava dosyası) ve hiçbirinin tanımı ekranda yok. Cümle ne yapılması gerektiğini de bulanık söylüyor.

**Öneri:**
```
"Şu an bilgisayarınızdaki arşivde arama yapılıyor; aşağıya eklediğiniz belgeler bu aramaya katılmaz. Belgelerinizin içinden cevap almak için yukarıdan “Yüklediğim belgeler”i seçin.";
```

**Not:** HTML'deki alan başlığı "Kapsam" da (satır 2313) "Nerede aransın?" olmalı.

## [P1] tanimsiz-terim — satir 4614

**Mevcut:**
```
toast((name || fileId) + " araştırma kapsamına eklendi.");
```

**Neden:** Aynı tanımsız "kapsam" bildirimde de geçiyor. Daha kötüsü: bu işlem arka planda aramanın nerede yapılacağını sessizce değiştiriyor (satır 4611) ve bildirim bunu söylemiyor; avukat sonraki sorusunun neden arşivde aranmadığını anlayamaz.

**Öneri:**
```
toast((name || fileId) + " eklendi. Bundan sonraki sorularınız yalnız yüklediğiniz belgelerin içinden cevaplanacak.");
```

## [P1] eksik-aciklama — satir 4631

**Mevcut:**
```
section(out, "Araştırma izi");
```

**Neden:** Kart bir başlıkla açılıyor ama ne olduğunu ve avukatın neden bakması gerektiğini söylemiyor; hemen altında mühendislik tabloları geliyor. "İz" kelimesi de ekranda tanımsız.

**Öneri:**
```
section(out, "Bu cevap nasıl bulundu"); ve kartın ilk satırı olarak: box.appendChild(el("p", "note-p", "Aşağıda, cevap hazırlanırken hangi resmî kaynaklarda arama yapıldığı ve hangi kararların tam metninin indirildiği yazıyor. Dayanağınızı karşı tarafa ya da hâkime göstermeniz gerekirse buradan gösterebilirsiniz."));
```

## [P1] eksik-aciklama — satir 4661

**Mevcut:**
```
box.appendChild(el("p", "empty", "Araç çağrısı kaydı yok."));
```

**Neden:** Hem "araç çağrısı" jargonu var hem de cümle iki farklı durumu ayırmıyor: hiç arama yapılmadı mı, yoksa yapıldı da kaydı mı tutulmadı? Bu ayrım ürünün kendi ilkesidir ("bulamadı" ile "hiç çalışmadı" aynı şey değildir).

**Öneri:**
```
box.appendChild(el("p", "empty", "Bu araştırmada hiçbir resmî kaynakta arama yapılmamış. Cevap yalnız elinizdeki belgelerden ya da bu bilgisayardaki arşivden çıkmıştır."));
```

## [P1] ui-kusuru — satir 4735

**Mevcut:**
```
ph.appendChild(el("div", "line", "Henüz belge yok — tepsiye bir belge bırakın"));
```

**Neden:** Ekranda "tepsi" diye adlandırılmış bir alan yok; hemen yukarıdaki alan "Belge bırakın veya seçin" diyor. Avukat "tepsi"nin neresi olduğunu arar. Boş durum ayrıca yükledikten sonra ne olacağını hiç söylemiyor.

**Öneri:**
```
ph.appendChild(el("div", "line", "Henüz belge yüklemediniz")); ph.appendChild(el("div", "sub", "Yukarıdaki alana bir belge bırakın ya da tıklayıp seçin. Yüklediğiniz belgenin yazısı çıkarılır; sonra o belgeye soru sorabilir, içinden alıntı yapabilirsiniz."));
```

## [P1] ui-kusuru — satir 4775

**Mevcut:**
```
head.appendChild(chip("taranmış sayfa uyarısı", "bad"));
```

**Neden:** Kırmızı damga bir uyarının VARLIĞINI söylüyor, uyarının kendisini değil; avukat kırmızıyı görüp ne olduğunu öğrenmek için aşağı bakmak zorunda kalıyor ve damga tıklanabilir de değil.

**Öneri:**
```
head.appendChild(chip(pages.emptyPages.length + " sayfa okunamadı", "bad"));
```

**Not:** Ayrıntı cümlesi zaten hemen altında (satır 4782); damga onu tekrar etmek yerine sayıyı vermeli.

## [P1] tanimsiz-terim — satir 4779

**Mevcut:**
```
box.appendChild(el("p", "note-p", up.message + " — aynı içerik (parmak izi) daha önce yüklenmişti; yeni kopya oluşturulmadı."));
```

**Neden:** "(parmak izi)" parantezi hiçbir şey açıklamıyor, tanımsız bir terimi cümlenin ortasına bırakıyor. Avukat "aynı içerik"i zaten anlıyor; parantez yalnız kafa karıştırıyor.

**Öneri:**
```
box.appendChild(el("p", "note-p", up.message + " — bu belgenin birebir aynısı daha önce yüklenmiş; ikinci bir kopya oluşturulmadı, mevcut kayıt kullanılacak."));
```

## [P1] ui-kusuru — satir 4794

**Mevcut:**
```
btns.appendChild(ghostBtn("Belgeye sor", function () { gotoDocument(f.fileId, { focusAsk: true }); }, "primary"));
```

**Neden:** Her belge kartında altı düğme eşit ağırlıkta yan yana (Belgeye sor · Tam metni aç · Bu dosyayla araştır · Taslakta kullan · Dosyaya ekle · Sil). "Belgeye sor" ile "Bu dosyayla araştır" arasındaki fark ekrandan anlaşılmıyor; "Dosyaya ekle"deki "dosya" dava dosyası, "Bu dosyayla araştır"daki "dosya" ise yüklenen belge — aynı kelime iki ayrı şey.

**Öneri:**
```
Düğmeler ikiye ayrılmalı: birincil satırda "Bu belgeye soru sor" ve "Tam metnini aç"; ikincil (soluk) satırda "Sorularımda bu belgeyi kullan", "Dilekçe yazarken kullan", "Dava dosyasına bağla", "Sil". Yüklenen belge için hiçbir etikette "dosya" kelimesi kullanılmamalı.
```

**Not:** Satır 4796, 4797 ve 4804'teki etiketler bu adlandırmayla birlikte değişmeli.

## [P1] anlasilmaz-cumle — satir 4860

**Mevcut:**
```
"İstek tarayıcıdan iptal edildi. Sunucu bu işi kendi içinde tamamlasa bile "
```

**Neden:** İki cümlede üç mühendislik kavramı: "istek", "tarayıcı", "sunucu". Anlatılmak istenen şey dürüst ve doğru (iş arkada bitmiş olabilir ama sonuç gösterilmeyecek) ama bu hâliyle avukatın anlayacağı bir metin değil.

**Öneri:**
```
"Beklemeyi siz durdurdunuz. ColleX arka planda işi bitirmiş olsa bile sonuç ekrana yazılmayacak; sonucu görmek isterseniz yeniden sormanız gerekir."
```

**Not:** BUSY_ABORT_NOTE_TR sabiti; "Vazgeçildi" kartında gösteriliyor (satır 4956).

## [P1] jargon — satir 4888

**Mevcut:**
```
var phaseLine = el("p", "busyphase", opts.phase || "İstek gönderildi; cevap bekleniyor.");
```

**Neden:** "İstek" burada yazılım anlamında (request); avukat "istek" deyince talebi anlar. Cümle ayrıca neyin beklendiğini söylemiyor.

**Öneri:**
```
var phaseLine = el("p", "busyphase", opts.phase || "Sorunuz gönderildi; cevap hazırlanıyor.");
```

## [P1] jargon — satir 4940

**Mevcut:**
```
toast(label + " hazırlanıyor — dosyayı sunucu üretir ve tarayıcınızın " +
```

**Neden:** "Sunucu" ve "tarayıcı" avukatın bilmediği kelimeler. Cümle ayrıca en önemli bilgiyi — dosyanın nereye ineceğini — en sona bırakıyor.

**Öneri:**
```
toast(label + " hazırlanıyor. Hazır olunca bilgisayarınızın “İndirilenler” klasörüne düşecek; bu ekranda ilerleme gösterilemez.", "warn");
```

## [P1] anlasilmaz-cumle — satir 4956

**Mevcut:**
```
"Bekleme " + busySeconds(ms) + " sonra durduruldu. " + BUSY_ABORT_NOTE_TR));
```

**Neden:** Türkçesi bozuk: "Bekleme 4,2 sn sonra durduruldu" devrik ve edilgen; kimin durdurduğu belli değil (durduran avukatın kendisi). "sn" kısaltması da resmî bir ekranda çirkin duruyor.

**Öneri:**
```
"Yaklaşık " + busySeconds(ms) + " bekledikten sonra vazgeçtiniz. " + BUSY_ABORT_NOTE_TR));
```

**Not:** busySeconds içindeki "sn" (satır 4864) "saniye" olarak açılmalı; ekranda yer sorunu yok.

## [P1] ui-kusuru — satir 5030

**Mevcut:**
```
box.appendChild(el("p", "rawcode", "(" +
```

**Neden:** Yükleme hatası kartının altına her seferinde ham makine kodu basılıyor: "(EXTRACTION_FAILED: pdf text layer empty)". İngilizce büyük harfli kod ve İngilizce hata metni doğrudan avukatın gözünün önünde; katlanmış bir "Teknik ayrıntılar" bölümü yok.

**Öneri:**
```
Bu satır katlanabilir bir bölümün içine alınmalı: var tech = el("details", "mini"); tech.appendChild(el("summary", null, "Teknik ayrıntı — ColleX'i kuran kişi için")); tech.appendChild(el("p", "rawcode", …)); box.appendChild(tech);
```

**Not:** Kartın Türkçe cümlesi (intakeErrTR) zaten yeterli; kod ancak istendiğinde görünmeli.

## [P1] jargon — satir 5096

**Mevcut:**
```
"belge sunucuda tek seferde işlenir.",
```

**Neden:** "Sunucu" jargonu bir yana, cümle avukata hiçbir şey söylemiyor: ne kadar bekleyeceğini ve ne yapabileceğini öğrenmiyor.

**Öneri:**
```
"Belge tek parça hâlinde işlenir; bu ekranı kapatmayın. Çok uzarsa “Vazgeç” deyip daha küçük bir belgeyle deneyebilirsiniz.",
```

**Not:** Cümlenin başı (satır 5095) da "Çok sayfalı bir PDF'in yazısı çıkarılırken bekleme birkaç dakikayı bulabilir." olmalı.

## [P1] ton — satir 5111

**Mevcut:**
```
var bound = matterId ? " ve dosyaya bağlandı" : " (dosyasız — hiçbir dosyaya bağlanmadı)";
```

**Neden:** "Dosyasız" bir kusur gibi okunuyor ve "dosya" kelimesinin çift anlamı yüzünden (yüklenen şeyin adı da dosya) kafa karıştırıyor. Bunun bir sorun mu, normal mi olduğu da söylenmiyor.

**Öneri:**
```
var bound = matterId ? " ve açık olan dava dosyanıza bağlandı" : " — henüz bir dava dosyasına bağlanmadı; istediğiniz zaman belgenin kartından bağlayabilirsiniz";
```

## [P2] ton — satir 4693

**Mevcut:**
```
fileStatus("belge listesi alınıyor…");
```

**Neden:** Küçük harfle başlayan, edilgen bir sistem notu. Bu bölgedeki diğer durum satırları da aynı tonda ("belge silindi", satır 4978; "liste alınamadı", satır 4712) — hepsi mühendis günlüğü gibi okunuyor.

**Öneri:**
```
fileStatus("Belgeleriniz yükleniyor…");
```

**Not:** Satır 4978 → "Belge silindi."; satır 4712 → "Belge listesi getirilemedi — …".

## [P2] ui-kusuru — satir 4772

**Mevcut:**
```
(typeof pages.pagesWithText === "number" && pages.pagesWithText !== pages.pageCount ? " · " + pages.pagesWithText + " metinli" : ""), "mute"));
```

**Neden:** "12 sayfa · 9 metinli" damgası kısaltılmış bir mühendis notu gibi okunuyor; "metinli" Türkçede tek başına kullanılmaz ve bu sayının avukat için anlamı söylenmiyor.

**Öneri:**
```
(typeof pages.pagesWithText === "number" && pages.pagesWithText !== pages.pageCount ? " · " + pages.pagesWithText + " sayfası okunabildi" : ""), "mute"));
```

## [P2] ton — satir 4886

**Mevcut:**
```
head.appendChild(chip("sürüyor", "warn"));
```

**Neden:** Sarı "sürüyor" damgası uyarı rengiyle çiziliyor; devam eden normal bir işlem uyarı değildir. Avukat sarıyı görünce bir sorun olduğunu sanır.

**Öneri:**
```
head.appendChild(chip("devam ediyor", "mute"));
```

**Not:** Renk sınıfını uyarıdan nötre almak yeterli; gerçek hata durumları zaten ayrı çiziliyor.

## [P2] ton — satir 4890

**Mevcut:**
```
var timeLine = el("p", "busytime", "geçen süre: " + busySeconds(0));
```

**Neden:** Etiket küçük harfle başlıyor ve bir sistem sayaçı gibi duruyor. Hukukçuya gösterilen bir ekranda cümleler büyük harfle başlar.

**Öneri:**
```
var timeLine = el("p", "busytime", "Geçen süre: " + busySeconds(0));
```

**Not:** Aynı düzeltme satır 4913'teki güncelleme satırında da yapılmalı.

## [P2] eksik-aciklama — satir 4954

**Mevcut:**
```
box.appendChild(el("h3", "fname", "Vazgeçildi"));
```

**Neden:** Başlık edilgen ve kimin vazgeçtiğini söylemiyor. Kart ayrıca avukata şimdi ne yapacağını söylemiyor; "Yeniden dene" düğmesi yalnız çağıran verirse çıkıyor.

**Öneri:**
```
box.appendChild(el("h3", "fname", "Beklemekten vazgeçtiniz"));
```

**Not:** opts.onRetry verilmediğinde de kart en azından "Aynı soruyu yeniden sorabilirsiniz." cümlesini göstermeli (satır 4958).
