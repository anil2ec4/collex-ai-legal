# bos-durum-hata

Bu bölge iyi niyetle yazılmış ama yanlış okuyucuya konuşuyor: hata metinlerinin çoğu "sunucu", "uç", "korpus", "veritabanı", "geçit", "araç çağrısı", "JSON", "snippet", "HTTP 404" gibi makine sözcükleriyle dolu ve çözümü ".cmd" uzantılı dosya adlarıyla anlatıyor — avukat masaüstünde kısayola tıklar, dosya adı bilmez. İkinci büyük kusur, her hata cümlesinin sonuna parantez içinde ham makine kodunun eklenmesidir (errMessage): doğru yazılmış Türkçe bir cümle bile "(STORE_UNAVAILABLE)" ile bitince ekran bir arıza günlüğüne dönüyor. Boş durumların yaklaşık yarısı tek kelimelik ve avukata bir sonraki adımı söylemiyor ("Henüz not yok.", "Atıf bulunamadı.", "Açık süre yok.", "Bu dosyada kayıtlı taslak yok."); ekran ölü görünüyor, oysa hemen yanında ilgili düğme duruyor ve cümle o düğmeyi adıyla söyleyebilir. Üçüncü sorun ton: "İstek başarısız", "silinemedi:", "Bu kovada satır yok" başlıkları ne olduğunu değil neyin çöktüğünü anlatıyor. Buna karşılık iyi örnekler de var — "Henüz kayıtlı taslak yok — aşağıdan bir şablon seçin." ve "Bu dosyada kayıtlı araştırma yok. Aktif dosya bu iken Araştır'da sorulan her soru buraya düşer." — bütün boş durumlar bu kalıba çekilmelidir: bir cümle DURUM, bir cümle NE YAPILACAĞI, düğmenin ekrandaki adıyla. Son olarak bildirimlerin 3,6 saniyede kaybolması, en iyi yazılmış hata metninin bile okunmadan silinmesine yol açıyor.

Bulgu: 40

## [P0] jargon — satir 2304

**Mevcut:**
```
Her kart, bu sunucuda bugün çalışan bir uca sabit bir istek gönderir. Çalışmayan bir iş burada kart olarak görünmez.
```

**Neden:** Tek cümlede “sunucu”, “uç”, “istek” var. Bu, Araştır ekranının en üstündeki açıklama satırıdır — avukatın ilk okuduğu cümle mühendis dilindedir.

**Öneri:**
```
Aşağıdaki kartlar bugün gerçekten çalışan işleri gösterir. Bir kartı seçin, ColleX o iş için gereken alanları ekranda açar. Çalışmayan bir iş burada hiç görünmez — böylece boşuna form doldurmazsınız.
```

## [P0] jargon — satir 2317

**Mevcut:**
```
Canlı mod bu sunucuda kapalı — ColleX-Baslat.cmd ile yeniden başlatın; durumu üst çubuktaki “Canlı araştırma” rozetinden görebilirsiniz.
```

**Neden:** “Canlı mod”, “sunucu”, “.cmd” ve “rozet” — dört yabancı kavram tek satırda. “Rozet” arayüz tasarımı terimidir; avukat üst çubukta neye bakacağını bilmez.

**Öneri:**
```
Resmî kaynaklarda arama şu anda kapalı. Masaüstünüzdeki ColleX simgesinden programı kapatıp yeniden açın. Açık mı kapalı mı olduğunu sayfanın en üstündeki “Canlı araştırma” yazısının yanındaki renkten görebilirsiniz.
```

## [P0] jargon — satir 2326

**Mevcut:**
```
Canlı araştırma kapalı — ColleX-Baslat.cmd ile başlatın. Yerel korpus da boş olduğu için şu an yalnız yüklediğiniz belgeler üzerinde soru sorabilirsiniz.
```

**Neden:** Aynı cümlede hem .cmd dosya adı hem “korpus” var. Bu kart tam da avukatın en çaresiz olduğu anda (hiçbir kaynak yokken) çıkıyor ve iki anlaşılmaz sözcükle onu çıkışsız bırakıyor.

**Öneri:**
```
Şu anda resmî kaynaklarda arama yapılamıyor ve ColleX'te hazır mevzuat/karar metni de yok. Bugün soru sorabileceğiniz tek yer kendi belgeleriniz: Belgeler ekranından bir PDF, Word ya da UDF dosyası yükleyin, sonra bu sayfada “Yüklediğim belgeler” kapsamını seçin.
```

## [P0] jargon — satir 2780

**Mevcut:**
```
Yerel veritabanına ulaşılamadı — ColleX-Durdur.cmd ardından ColleX-Baslat.cmd ile yeniden başlatın; sorun sürerse sunucu penceresindeki günlüğü saklayın.
```

**Neden:** Tek cümlede dört anlaşılmaz şey var: "veritabanı", iki ayrı .cmd dosya adı, "sunucu penceresi" ve "günlük" (log). Avukat hangi pencereye bakacağını, neyi nasıl saklayacağını bilemez.

**Öneri:**
```
ColleX kayıtlarınıza şu anda ulaşamıyor — dosyalarınız, belgeleriniz ve süreleriniz açılmıyor. Masaüstünüzdeki ColleX simgesinden programı kapatıp yeniden açın. Sorun geçmezse, ColleX açılırken çıkan siyah pencerenin ekran görüntüsünü alıp saklayın; sorunun nedeni orada yazılıdır.
```

**Not:** Bu metin hem uyarı listesinde hem hata kartında hem sunucu gövdesinde kullanılıyor; tek yerde düzeltmek üç yüzeyi birden düzeltir.

## [P0] jargon — satir 2782

**Mevcut:**
```
Sunucuya ulaşılamadı — ColleX kapalı görünüyor; ColleX-Baslat.cmd ile yeniden başlatın. Bağlantı gelince bu sayfa kendini yeniler.
```

**Neden:** "Sunucu" ve "ColleX-Baslat.cmd" avukat için anlamsızdır. Avukat masaüstünde bir simgeye çift tıklar; uzantılı dosya adı Windows'ta zaten gizlidir, o adı hiçbir yerde göremez. Bu ekranın en sık görülen hatası budur ve tam burada avukat çıkışsız kalıyor.

**Öneri:**
```
ColleX şu anda çalışmıyor. Masaüstünüzdeki ColleX simgesine çift tıklayıp programı yeniden açın. Program açılır açılmaz bu sayfa kendiliğinden geri gelir; yazdıklarınız kaybolmaz.
```

**Not:** Kısayolun ekrandaki adı ne ise cümlede birebir o ad geçmeli; iki yerde iki farklı ad kullanılmamalı.

## [P0] jargon — satir 3092

**Mevcut:**
```
İstek ya da dosya sunucu sınırını aşıyor (JSON ≤ 1 MB, belge ≤ 25 MB).
```

**Neden:** “İstek”, “sunucu”, “JSON” — üçü de anlaşılmaz. Avukat büyük bir PDF yüklerken bu cümleyi görür ve “JSON nedir” diye takılır; oysa işine yarayacak tek bilgi belge boyutudur.

**Öneri:**
```
Belge çok büyük — ColleX en fazla 25 MB'lık belge alır. Belgeyi PDF programında “boyutu küçültülmüş olarak kaydet” ile küçültebilir ya da bölümlere ayırıp parça parça yükleyebilirsiniz.
```

## [P0] jargon — satir 3094

**Mevcut:**
```
Sunucu bu adresten gelen isteği kabul etmiyor; ColleX'i 127.0.0.1 üzerinden açın.
```

**Neden:** “127.0.0.1” bir makine adresidir; avukat için rakam yığınıdır. Cümle ayrıca “bunu nereye yazacağım” sorusunu hiç cevaplamıyor.

**Öneri:**
```
Bu sayfa yanlış bir adresten açılmış. Tarayıcı sekmesini kapatıp ColleX'i yalnızca masaüstündeki ColleX simgesinden açın; simge doğru adresi kendisi açar.
```

## [P0] jargon — satir 3098

**Mevcut:**
```
Sunucu isteği tamamlayamadı — yeniden deneyin, sürerse sunucu penceresindeki günlüğü saklayın.
```

**Neden:** “Sunucu” iki kez, “istek” ve “günlük” (log) birer kez geçiyor. Avukat hangi pencerede hangi günlüğü arayacağını bilmez; “saklayın” da nasıl saklanacağını söylemiyor.

**Öneri:**
```
ColleX bu işi tamamlayamadı. Bir kez daha deneyin. Aynı hata sürerse ColleX açılırken çıkan siyah pencerenin ekran görüntüsünü alıp saklayın — sorunun nedeni orada yazılıdır.
```

## [P0] jargon — satir 3274

**Mevcut:**
```
 sunucuda henüz açık değil. Sistemi başlatan kişiden isteyin; 
```

**Neden:** Ürün tek başına çalışan bir avukatın kendi bilgisayarındadır: “sistemi başlatan kişi” avukatın kendisidir. Cümle var olmayan bir bilgi işlemciye yönlendiriyor ve avukatı çıkışsız bırakıyor; “sunucu” da anlaşılmaz.

**Öneri:**
```
 ColleX sürümünde bu ekran henüz kullanıma açılmadı. Şu an yapabileceğiniz bir şey yok; özellik açıldığında bu ekran kendiliğinden çalışmaya başlar. Bu arada aynı işi 
```

**Not:** Cümle mutlaka bir alternatif ekranın adıyla bitmeli (ör. “…Belgeler ekranından yapabilirsiniz.”); çıkışsız boş durum bırakılmamalı.

## [P0] jargon — satir 3277

**Mevcut:**
```
(Teknik: 
```

**Neden:** Bunun ardından adres yolu ve “→ 404” yazılıyor. Avukat için 404 ve adres yolu ekranı kapattıracak kadar yabancıdır; üstelik hiçbir işe yaramaz, çünkü bunu ileteceği kimse yok.

**Öneri:**
```
Bu satır avukat ekranından tamamen kaldırılmalı; teknik ayrıntı yalnızca Ayarlar › Sistem durumu içindeki katlanmış “Teknik ayrıntılar” bloğunda gösterilmeli.
```

**Not:** Aynı kural sayfadaki tüm “(HTTP 404)”, “(STORE_UNAVAILABLE)” gibi parantez ekleri için geçerlidir.

## [P0] jargon — satir 4649

**Mevcut:**
```
harcanan bütçe — araç çağrısı: 
```

**Neden:** Satırın devamı “belge getirme” ve milisaniye cinsinden süre yazıyor. “Araç çağrısı”, “belge getirme” ve “ms” avukata hiçbir şey anlatmaz; sayılar hiçbir kararı değiştirmez.

**Öneri:**
```
Bu araştırmada yapılanlar — resmî sitelerde arama: … · indirilen tam belge: … · geçen süre: … saniye
```

**Not:** Milisaniye yerine saniye yazılmalı; “ms” bir mühendis birimidir.

## [P0] jargon — satir 4661

**Mevcut:**
```
Araç çağrısı kaydı yok.
```

**Neden:** “Araç çağrısı” (tool call) bir yazılım terimidir; avukat için hiçbir anlamı yoktur. Boş durum ayrıca bunun iyi mi kötü mü bir durum olduğunu da söylemiyor.

**Öneri:**
```
Bu araştırmada hiçbir resmî kaynağa sorgu gönderilmemiş — kayıtlarda tek bir arama adımı bile yok. Cevap yalnızca elinizdeki belgelere dayanıyorsa bu normaldir.
```

## [P0] jargon — satir 4673

**Mevcut:**
```
Tam belge getirilmedi — getirilmeyen metinden alıntı yapılmaz; arama snippet'i kanıt değildir.
```

**Neden:** “snippet” İngilizce bir yazılım terimidir ve ekranda çıplak duruyor. “Tam belge getirilmedi” de edilgen; avukata ne olduğunu ve ne yapacağını söylemiyor.

**Öneri:**
```
Hiçbir kararın tam metni indirilemedi. Arama sonuçlarında görünen kısa tanıtım satırları dayanak sayılmaz — ColleX yalnız indirdiği tam metinden alıntı yapar. Bu yüzden bu cevapta alıntı yok. Soruyu daraltıp yeniden arayın ya da karar elinizde varsa Belgeler'e yükleyin.
```

## [P0] jargon — satir 5603

**Mevcut:**
```
Taslak listesi ucu bu sunucuda kapalı.
```

**Neden:** “Uç” (endpoint) ve “sunucu” avukatın sözlüğünde yoktur. Cümle üstelik ne yapılacağını hiç söylemiyor; avukat boş ekrana bakıp bekliyor.

**Öneri:**
```
Kayıtlı taslaklar bu ColleX sürümünde listelenemiyor. Aşağıdan bir şablon seçip yeni taslak yazabilirsiniz; daha önce indirdiğiniz taslaklar bilgisayarınızdaki Word dosyalarında durmaya devam eder.
```

## [P0] jargon — satir 7733

**Mevcut:**
```
return t.text + (extra ? " — " + extra : "") + (t.raw ? " (" + t.raw + ")" : "");
```

**Neden:** Bu tek satır, ekrandaki HER hata mesajının sonuna ham makine kodunu ekliyor. İyi yazılmış Türkçe bir cümle bile "… (STORE_UNAVAILABLE)" ya da "… (HTTP 500)" ile bitiyor; avukat cümlenin doğru bölümünü değil sondaki kodu görüyor ve ekranı bir arıza günlüğü sanıyor.

**Öneri:**
```
Ham kod ana mesajdan çıkarılmalı: hata kutusu yalnız Türkçe cümleyi göstermeli, ham kod aynı kutunun içindeki KAPALI “Teknik ayrıntılar” bloğunda durmalı. Ayrıca `extra` içindeki alan yolu (ör. “ekBilgiler.karar”) FIELD_LABEL_TR sözlüğünden insan adına (“istinafa konu karar künyesi”) çevrilmeli.
```

**Not:** Tek düzeltmeyle sayfadaki onlarca hata metni aynı anda temizlenir; bu bölgedeki en yüksek getirili değişiklik budur.

## [P0] ui-kusuru — satir 7773

**Mevcut:**
```
toast.timer = setTimeout(function () { t.hidden = true; }, 3600);
```

**Neden:** Bütün bildirimler 3,6 saniye sonra kendiliğinden kayboluyor ve geri getirilemiyor. “Taslak kaydedilemedi”, “Belge yüklenemedi” gibi kritik hatalar avukat okumaya fırsat bulamadan siliniyor — hata metni ne kadar iyi yazılırsa yazılsın okunmuyor.

**Öneri:**
```
Ton “bad” olan bildirimler kendiliğinden kapanmamalı: kutuda bir kapatma (×) düğmesi bulunmalı ve avukat kapatana kadar ekranda kalmalı. “ok” tonundaki bildirimler 3,6 saniyede kaybolmaya devam edebilir.
```

## [P0] jargon — satir 8550

**Mevcut:**
```
Belge silinemedi — 
```

**Neden:** Bu cümlenin ardına kodda `httpStatusTR(res.status) + " (HTTP " + res.status + ")"` ekleniyor; ekranda avukat “Belge silinemedi — Aradığınız kayıt bu sunucuda yok… (HTTP 404)” görüyor. Hem “sunucu” hem “HTTP 404” ekranda kalıyor.

**Öneri:**
```
Belge silinemedi. Bu belge daha önce başka bir yerden silinmiş olabilir — “Listeyi yenile”ye basıp yeniden bakın. Sorun sürerse ColleX'i kapatıp yeniden açın.
```

**Not:** Aynı kalıp satır 4987 (“Belge silinemedi”) ve 8644 (“Kayıt silinemedi”) için de geçerlidir; üçünde de “(HTTP …)” eki kaldırılmalı.

## [P0] tanimsiz-terim — satir 9886

**Mevcut:**
```
Bu sunucuda yerel korpus boş.
```

**Neden:** “Korpus” avukatın bilmediği bir sözcüktür ve ekranda hiçbir yerde tanımlanmıyor; “sunucu” da öyle. Üstelik bu metin bir kartın DEVRE DIŞI olma gerekçesidir: avukat kartın neden tıklanmadığını okuyor, hiçbir şey anlamadan ne yapacağını da öğrenemiyor.

**Öneri:**
```
ColleX'te henüz hazır mevzuat ve karar metni yok. Bu işi kullanabilmek için önce Belgeler'e kendi belgelerinizi yükleyin ya da soru kutusunda “Canlı kaynaklar” kapsamını seçip resmî sitelerde arayın.
```

**Not:** Aynı metin ikinci bir kartta da (satır 9894) birebir kullanılıyor; ikisi de değişmeli.

## [P0] tanimsiz-terim — satir 11157

**Mevcut:**
```
Kaynak geçidi bağlı
```

**Neden:** “Geçit” (gateway) uydurulmuş bir terimdir ve ekranda hiçbir yerde tanımlanmıyor. Aynı ekranda “Kaynak geçidi yoklanıyor”, “Kaynak geçidinin durumu belirlenemedi” ve “Karar arama bu sunucuda çalışmıyor” olmak üzere dört ayrı durum var; avukat aralarındaki farkı anlayamaz.

**Öneri:**
```
Resmî kaynaklara bağlanılabiliyor
```

**Not:** Diğer üç başlık sırasıyla “Resmî kaynaklara bağlanılıyor…”, “Resmî kaynaklara şu anda bağlanılamıyor” ve “Bağlantı denendi, sonuç belirsiz” olmalı; “geçit” ekrandan tamamen çıkmalı.

## [P0] tanimsiz-terim — satir 12092

**Mevcut:**
```
Bu kovada satır yok — taradığımız kaynaklarda karşılığı bulunamayan atıf çıkmadı.
```

**Neden:** “Kova” (bucket) uydurulmuş bir terimdir. Ayrıca cümle çift olumsuz: “karşılığı bulunamayan atıf çıkmadı” — avukat iki kez okumadan bunun İYİ haber olduğunu anlayamaz. Bir dilekçe denetiminde en çok merak edilen satır budur; tam burada dil bozuluyor.

**Öneri:**
```
Bu başlık altında satır yok: dilekçedeki atıfların hepsinin kaynakta karşılığı bulundu — kayıp atıf çıkmadı.
```

**Not:** Aynı satırdaki genel hâl (“Bu kovada satır yok.”) da “Bu başlık altında atıf yok.” olmalı.

## [P0] jargon — satir 12906

**Mevcut:**
```
Yedekleme bu sunucuda yapılandırılmadı — ColleX-Yedekle.cmd dosyasını kullanın.
```

**Neden:** Yine bir .cmd dosya adı, üstelik tek çözüm olarak sunuluyor. Avukat müvekkil verisinin yedeğini alamayacak ve bunu fark etmeyecek; “yapılandırılmadı” da teknik-soğuk bir kelimedir.

**Öneri:**
```
Otomatik yedekleme bu ColleX kurulumunda açık değil. Yedek almak için masaüstünüzdeki ColleX Yedekleme simgesine çift tıklayın — belgeleriniz ve dosya kayıtlarınız seçtiğiniz klasöre kopyalanır.
```

## [P1] jargon — satir 2778

**Mevcut:**
```
Bulut yapay zekâ süresinde yanıt vermedi (60 sn; OCR 300 sn) — yeniden deneyin.
```

**Neden:** “OCR” bir kısaltmadır ve burada tanımı yoktur; iki ayrı süre sınırının parantezle verilmesi avukata hiçbir karar kazandırmaz, yalnız cümleyi teknikleştirir.

**Öneri:**
```
Bulut yapay zekâ zamanında cevap vermedi. Bir kez daha deneyin. Uzun bir belge üzerinde çalışıyorsanız belgeyi bölüp daha küçük parçalarla deneyin.
```

## [P1] jargon — satir 3070

**Mevcut:**
```
Anthropic anahtarı reddedildi — Ayarlar › Sistem durumu'ndan bulut anahtarını kontrol edin.
```

**Neden:** “Anahtar” burada API anahtarı anlamındadır; avukat bunun ne olduğunu, nereden alındığını, nasıl kontrol edileceğini bilmez. Cümle çıkışsızdır ve ürünün geri kalanının çalışıyor olduğunu söylemez.

**Öneri:**
```
Bulut yapay zekâ bağlantısı kabul edilmedi. Bulut AI'yı kapatıp çalışmaya devam edebilirsiniz — ColleX'in belge okuma, arama ve alıntı doğrulama işleri bulut olmadan da çalışır. Bulutu kullanmak istiyorsanız Ayarlar › Sistem durumu ekranındaki bulut bağlantısı satırına bakın.
```

## [P1] jargon — satir 3085

**Mevcut:**
```
İstek geçersiz — alanları kontrol edin.
```

**Neden:** “İstek geçersiz” bir sunucu cevabıdır, avukat cümlesi değil. “Alanları kontrol edin” hangi alan olduğunu söylemez; ekranda 15 alan varsa avukat hepsini tek tek denemek zorunda kalır.

**Öneri:**
```
Formda eksik ya da hatalı bir alan var. Kırmızı işaretli alanları doldurup yeniden gönderin.
```

## [P1] eksik-aciklama — satir 3090

**Mevcut:**
```
Belge kabul edildi ama işlenemedi — kartın açıklamasını okuyun.
```

**Neden:** “Kartın açıklaması” nerede olduğu belirsiz bir yönlendirmedir; avukat hangi karta bakacağını bilmez. Ayrıca belgenin şimdi listede olup olmadığı söylenmiyor — avukat aynı belgeyi tekrar tekrar yükler.

**Öneri:**
```
Belge alındı ama metni çıkarılamadı; bu hâliyle aramalara girmez. Hemen aşağıdaki kırmızı kutuda nedeni yazıyor — belge taranmış görüntüyse “aranabilir PDF” olarak yeniden kaydedip yükleyin.
```

## [P1] ton — satir 4288

**Mevcut:**
```
İstek başarısız
```

**Neden:** Her hata kartının başlığı bu. “İstek” makine sözcüğü, “başarısız” ise suçlayıcı ve boş: hangi işin düştüğü söylenmiyor.

**Öneri:**
```
Bu işlem tamamlanamadı
```

**Not:** Daha iyisi: çağıran yer başlığı bildirsin (“Arama tamamlanamadı”, “Taslak kaydedilemedi”), böylece avukat hangi işin düştüğünü görsün.

## [P1] ton — satir 4991

**Mevcut:**
```
silinemedi: 
```

**Neden:** Küçük harfle başlayan, iki nokta üst üsteyle biten bir hata parçası; ardına ham hata metni ekleniyor. Neyin silinemediği (hangi belge) yazılmıyor, ne yapılacağı da söylenmiyor.

**Öneri:**
```
Belge silinemedi — 
```

**Not:** Devamına gelen metin de humanError yerine avukat cümlesi olmalı; cümle büyük harfle başlamalı ve belgenin adını taşımalı.

## [P1] anlasilmaz-cumle — satir 6019

**Mevcut:**
```
if (/^required$/i.test(m)) { return "Bu alan zorunludur."; }
```

**Neden:** Yalnızca “required” çevriliyor; sunucudan gelen diğer doğrulama mesajları (ör. “Expected string, received number”, “String must contain at least 2 character(s)”) olduğu gibi İNGİLİZCE ekrana düşüyor. Avukat form hatasında İngilizce cümle görüyor.

**Öneri:**
```
Sözlük genişletilmeli: “at least” → “Bu alan çok kısa.”, “Expected…” → “Bu alana yazılan değer uygun türde değil.”, “invalid date” → “Tarihi GG.AA.YYYY biçiminde girin.” Sözlükte olmayan İngilizce mesaj ekrana hiç yazılmamalı; yerine “Bu alan kabul edilmedi — girdiğiniz değeri gözden geçirin.” gösterilmeli.
```

## [P1] tanimsiz-terim — satir 6777

**Mevcut:**
```
Bu taslağa kanıt bağlanmadı — her hukukî paragraf KAYNAKSIZ kalır.
```

**Neden:** “KAYNAKSIZ” büyük harfle yazılmış, uydurulmuş bir damgadır ve ekranda tanımı yoktur. Avukat bunun taslağı kullanılamaz mı yaptığını, yoksa yalnız bir not mu olduğunu anlayamaz.

**Öneri:**
```
Bu taslağa henüz hiçbir kaynak bağlanmadı: hukukî paragraflar mevzuata ya da karara dayanmadan yazılacak ve dışa aktarırken uyarı alacaksınız. Kaynak bağlamak için önce Araştır'da soru sorun, sonra buradan “Kanıt ekle”yi kullanın.
```

**Not:** Aynı damga satır 7112'de de geçiyor; ikisi de aynı açıklamayı taşımalı.

## [P1] jargon — satir 7051

**Mevcut:**
```
Taslak veritabanına YAZILAMADI (v
```

**Neden:** “Veritabanı” anlaşılmaz, “(v3)” sürüm numarası makine bilgisidir, “bu oturumda açık” ise “oturum” kelimesiyle boşa gidiyor. Oysa bu ekrandaki en kritik uyarılardan biridir: avukatın emeği kaybolabilir.

**Öneri:**
```
Taslak kaydedilemedi — yazdıklarınız yalnızca bu ekranda duruyor. ColleX'i kapatır ya da sayfayı yenilerseniz kaybolur. Kaybetmemek için hemen “DOCX indir” ile Word dosyası olarak bilgisayarınıza kaydedin.
```

## [P1] eksik-aciklama — satir 8775

**Mevcut:**
```
Bu dosyada kayıtlı taslak yok.
```

**Neden:** Aynı sayfanın başka bir yerinde doğru kalıp kullanılmış (“Henüz kayıtlı taslak yok — aşağıdan bir şablon seçin.”); burada ise avukat çıkmaz sokakta bırakılıyor.

**Öneri:**
```
Bu dosyada kayıtlı taslak yok. Taslak görünümüne geçip bir şablon seçin — orada yazdığınız her taslak, aktif dosya bu iken buraya düşer.
```

## [P1] eksik-aciklama — satir 8909

**Mevcut:**
```
Bu dosyada süre kaydı yok.
```

**Neden:** Süre avukatın en kritik verisidir; boş durum hiçbir yönlendirme vermiyor ve sürenin nasıl ekleneceğini öğretmiyor.

**Öneri:**
```
Bu dosyada kayıtlı süre yok. Süre eklemek için üstteki “Süre hesapla”yı kullanın: tebliğ tarihini girin, ColleX kanunî süreyi hesaplayıp bu dosyaya işler.
```

## [P1] eksik-aciklama — satir 8985

**Mevcut:**
```
Henüz not yok.
```

**Neden:** Boş durum ölü: not eklemenin nerede olduğu söylenmiyor, düğmenin adı geçmiyor, notun ne işe yaradığı anlatılmıyor.

**Öneri:**
```
Bu dosyaya henüz not yazılmadı. Aşağıdaki kutuya yazıp “Not ekle”ye basın — notlar bu dosyanın altında tarih sırasıyla durur.
```

## [P1] jargon — satir 9495

**Mevcut:**
```
Panoya kopyalanamadı — “CSV indir” ile kaydedin.
```

**Neden:** “CSV” avukat için anlamsızdır, “pano” da yazılım terimidir. Avukat asıl merak ettiğini öğrenemiyor: bu dosyayı Excel'de açabilir mi?

**Öneri:**
```
Kopyalama yapılamadı. Bunun yerine “Tablo indir (Excel'de açılır)” düğmesine basın — dosya bilgisayarınıza iner ve Excel'de açılır.
```

**Not:** Düğmenin kendi etiketi de “CSV indir” yerine “Tablo indir (Excel'de açılır)” olmalı.

## [P1] jargon — satir 10496

**Mevcut:**
```
Parça sol bölmede henüz yüklü değil — “Sonraki bölümler” ile ilerleyin.
```

**Neden:** “Parça” (chunk) yasaklı listede; “sol bölme” de arayüz terimidir. Avukat neye tıklayacağını ancak deneyerek bulur.

**Öneri:**
```
Bu alıntının geçtiği yer henüz ekrana getirilmedi. Soldaki metinde aşağı inip “Sonraki bölümler”e basın, sonra yeniden deneyin.
```

## [P1] jargon — satir 10621

**Mevcut:**
```
Bölüm yok — bu belgeden metin çıkarılamamış olabilir.
```

**Neden:** “Bölüm” burada belgenin parçalarını (chunk) anlatıyor ama avukat bunu dilekçe bölümü sanar. “Olabilir” belirsiz bırakıyor ve hiçbir çözüm önermiyor.

**Öneri:**
```
Bu belgenin metni okunamadı — muhtemelen taranmış bir görüntü. Belgeyi “aranabilir PDF” olarak yeniden kaydedip yükleyin; Bulut AI açıksa bu sayfadaki “Bulut OCR” ile görüntüyü metne çevirebilirsiniz.
```

## [P1] eksik-aciklama — satir 10860

**Mevcut:**
```
Henüz soru sorulmadı.
```

**Neden:** Belge sayfasındaki soru-cevap listesinin boş durumu. Ne sorulabileceğine dair tek bir örnek yok; avukat boş kutuya ne yazacağını bilemiyor.

**Öneri:**
```
Bu belgeye henüz soru sorulmadı. Yukarıdaki kutuya sorunuzu yazın — örneğin “Tebligat hangi tarihte yapılmış?” ya da “Sözleşmede kararlaştırılan bedel nedir?”. Cevap yalnız bu belgenin metninden ve alıntıyla verilir.
```

## [P1] jargon — satir 10861

**Mevcut:**
```
yerel liste (bu tarayıcı)
```

**Neden:** “Yerel liste” ve “tarayıcı” birleşince avukat için hiçbir anlam çıkmıyor. Üstelik bu bir UYARI olmalı: listenin kalıcı olmadığını söylemesi gerekirken söylemiyor.

**Öneri:**
```
Bu liste yalnız bu bilgisayardaki bu tarayıcıda tutuluyor — başka bir tarayıcıdan girerseniz görünmez, tarayıcı geçmişini silerseniz kaybolur.
```

## [P1] eksik-aciklama — satir 12362

**Mevcut:**
```
Açık süre yok.
```

**Neden:** Duruşma hazırlık özetinde çıkan iki kelimelik satır. İyi haber mi kötü haber mi belirsiz; “süre girilmemiş” ile “süre kalmamış” ayrımı yapılmıyor — bu ayrım avukat için hayatîdir.

**Öneri:**
```
Bu dosyada bekleyen süre görünmüyor. Dikkat: bu, süre olmadığı anlamına gelmez — yalnız ColleX'e girilmiş süre yok demektir. Süre eklemek için “Süre hesapla”yı kullanın.
```

**Not:** Aynı ekrandaki “Bu dosyaya bağlı belge yok.” (12375) ve “Zaman çizelgesinde olay yok.” (12384) da eylem cümlesiyle tamamlanmalı.

## [P2] eksik-aciklama — satir 10750

**Mevcut:**
```
Atıf bulunamadı.
```

**Neden:** Belge sayfasında dört boş durum aynı kusuru paylaşıyor (“Taraf tespit edilmedi.”, “Atıf bulunamadı.”, “Tarih bulunamadı.”, “Talep tespit edilmedi.”): hiçbiri bunun belgenin özelliğinden mi yoksa okuma hatasından mı kaynaklandığını söylemiyor ve hiçbiri bir sonraki adımı vermiyor.

**Öneri:**
```
Bu belgede kanun maddesi ya da karar atıfı bulunamadı. Belge taranmış görüntüyse metni okunamamış olabilir — sayfanın üstündeki “metin okundu mu” satırına bakın. Atıfı kendiniz eklemek isterseniz belgenin metnini seçip “Kanıt olarak ekle”yi kullanın.
```

**Not:** Aynı kalıp 10729, 10787 ve 10800'e de uygulanmalı; ayrıca “tespit” sözcüğü bu ekranda tanımsız bir terimdir ve “bulunamadı” ile değiştirilmelidir.
