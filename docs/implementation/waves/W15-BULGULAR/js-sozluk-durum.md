# js-sozluk-durum

Bu bolge urunun sozlugudur: durum damgalari, uyari/gerekce cevirileri, hata mesajlari ve kaynak kartinin ilk satirlari burada uretilir. Turkcesi genel olarak duzgun ve kod yorumlarinda kullaniciyi koruma niyeti acikca goruluyor; ancak sozlugun OMURGASI avukatin bilmedigi ya da hicbir yerde tanimlanmayan kelimelerden kuruluyor: KESINLESTIRILEBILIR/KESINLESTIRILEMEZ, CEKIMSER, SERHLI, TAM/KISMI, korpus, pasaj, tespit, kanit kumesi, serit, esik, butce, taslakci, ag gecidi, metin katmani, dizin, JSON, OCR, 127.0.0.1. Bu kelimeler ekranin en ustunde, en buyuk punto ile ve hicbir aciklama olmadan duruyor. Ikinci ciddi sorun ham makine dizelerinin dogrudan avukatin onune cikmasi: reddedilen atif satirinda "ev-9f2a... (NOT_IN_EVIDENCE)", iliski satirinda pasaj kimligi ve cozumleyici surumu, kopyalama dugmesinde 12 karakterlik anlamsiz bir "ozet degeri". Ucuncusu, "zaman asimina ugradi" gibi ifadeler hukukta BASKA bir sey demek oldugu icin avukati dogrudan yanlis yonlendiriyor. Dorduncusu, hazir ornek soru dugmeleri sentetik deneme belgelerindeki uydurma ceza araliklarini ("1-5 yil", "3-7 yil") gercek kanun bilgisiymis gibi etikete yaziyor. Teknik dogruluk kaybedilmeden bu metinlerin tamami avukat Turkcesine cevrilebilir; olculmemis hicbir sayi eklemeye de gerek yoktur.

Bulgu: 40

## [P0] tanimsiz-terim — satir 2751

**Mevcut:**
```
COMPLETE: ["TAM", "ok", "✓", "Tüm tespitler doğrulanmış kaynağa bağlı."]
```

**Neden:** "TAM" tek başına bir doğruluk iddiası gibi okunur; oysa ürün doğruluk iddia etmiyor, yalnızca her cümlenin bir kaynağa bağlandığını söylüyor. "Tespit" tanımsız.

**Öneri:**
```
COMPLETE: ["KAYNAKLI", "ok", "✓", "Cevaptaki her cümle bir kaynağa bağlandı ve alıntılar bozulmadan doğrulandı; hukukî değerlendirme size aittir."]
```

## [P0] tanimsiz-terim — satir 2752

**Mevcut:**
```
QUALIFIED: ["ŞERHLİ", "warn", "§", "Tespitler kaynaklı; çekince veya çelişen otorite var."]
```

**Neden:** "ŞERHLİ" hukukta tapu şerhi / karara şerh anlamına gelir; burada kastedilen bambaşka bir şeydir. "Tespit" de bu üründe uydurulmuş bir karşılıktır ve ekranda tanımı yoktur.

**Öneri:**
```
QUALIFIED: ["ÇEKİNCELİ", "warn", "§", "Her cümlenin kaynağı var, ancak aksi yönde karar veya çekince de bulundu — kararı okumadan dayanak yapmayın."]
```

## [P0] tanimsiz-terim — satir 2753

**Mevcut:**
```
PARTIAL: ["KISMİ", "bad", "!", "Bazı tespitler doğrulanamadı; cevap kesinleştirilemez."]
```

**Neden:** "KISMİ" neyin kısmi olduğunu söylemiyor (kaynak mı, cevap mı, süre mi). Açıklama tanımsız terime ("tespit", "kesinleştirilemez") yine tanımsız terimle gönderme yapıyor.

**Öneri:**
```
PARTIAL: ["EKSİK CEVAP", "bad", "!", "Cevabın bir bölümü kaynağa bağlanamadı — bu hâliyle dilekçeye koymayın."]
```

## [P0] tanimsiz-terim — satir 2754

**Mevcut:**
```
ABSTAIN: ["ÇEKİMSER", "abstain", "—", "Yeterli doğrulanabilir kaynak yok."]
```

**Neden:** "ÇEKİMSER" hukukta oy için kullanılır; bir cevabın çekimser kalması avukat için anlamsızdır. Açıklama da "doğrulanabilir kaynak" diyerek yine ürün jargonu kullanıyor ve ne yapılacağını söylemiyor.

**Öneri:**
```
ABSTAIN: ["CEVAP VERİLMEDİ", "abstain", "—", "Bu soruya dayanak olacak kaynak bulunamadı; ColleX bilerek cevap üretmedi."]
```

## [P0] jargon — satir 2780

**Mevcut:**
```
var STORE_UNAVAILABLE_TEXT = "Yerel veritabanına ulaşılamadı — ColleX-Durdur.cmd ardından ColleX-Baslat.cmd ile yeniden başlatın; sorun sürerse sunucu penceresindeki günlüğü saklayın.";
```

**Neden:** "Veritabanı", "sunucu penceresi" ve "günlük" üçü de listedeki bilinmeyen kelimeler; avukat "günlük"ü ajanda sanabilir. Çözüm adımı doğru ama son cümle uygulanamaz.

**Öneri:**
```
var STORE_UNAVAILABLE_TEXT = "Belge arşivine ulaşılamadı — ColleX-Durdur.cmd, ardından ColleX-Baslat.cmd ile programı yeniden başlatın. Sorun sürerse siyah ColleX penceresindeki son satırların ekran görüntüsünü alın.";
```

## [P0] jargon — satir 2790

**Mevcut:**
```
var DEMO_CORPUS_TEXT = "DENEME KORPUSU (sentetik deneme belgeleri) — bu sunucu sentetik deneme belgeleriyle çalışıyor; hiçbir sonuç gerçek hukukî değerlendirme değildir.";
```

**Neden:** Ekranın en kritik uyarısı üç bilinmeyen kelimeyle açılıyor: KORPUS, sentetik, sunucu. Uyarının işlevi avukatı durdurmaktır; anlamadığı bir damga onu durdurmaz. "Sentetik deneme belgeleriyle çalışıyor" ayrıca aynı cümlede iki kez tekrarlanıyor.

**Öneri:**
```
var DEMO_CORPUS_TEXT = "DENEME BELGELERİ — bu kurulumda gerçek mevzuat ve içtihat değil, sınama için yazılmış SAHTE belgeler var. Buradaki hiçbir sonucu bir dosyada kullanmayın.";
```

## [P0] tanimsiz-terim — satir 2896

**Mevcut:**
```
"Bu cevap KESİNLEŞTİRİLEMEZ: aşağıdaki gerekçeleri okumadan kullanmayın.";
```

**Neden:** Uyarılar kartının giriş cümlesi tanımı olmayan bir damgayla açılıyor. Avukatın burada okuması gereken tek şey "bu cevabı olduğu gibi dilekçeye koyma" uyarısıdır.

**Öneri:**
```
"Bu cevabı olduğu gibi kullanmayın: aşağıdaki gerekçeleri okuyun ve kaynakları kendiniz açın.";
```

## [P0] tanimsiz-terim — satir 2899

**Mevcut:**
```
yes: "KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı; nihai hukukî değerlendirme avukatındır",
```

**Neden:** "KESİNLEŞTİRİLEBİLİR" ekranın en görünür damgasıdır ve hiçbir yerde tanımı yoktur. Avukat "kesinleşme"yi kararın kesinleşmesi olarak bilir; burada kastedilen cevabın makine kontrollerinden geçmesidir. "Teknik kontroller" de mühendis dilidir ve neyin kontrol edildiğini söylemez.

**Öneri:**
```
yes: "KULLANIMA HAZIR — her alıntının kaynağı bulundu ve alıntı metni bozulmadan doğrulandı; hukukî değerlendirme size aittir",
```

## [P0] tanimsiz-terim — satir 2900

**Mevcut:**
```
no: "KESİNLEŞTİRİLEMEZ — en az bir doğrulama başarısız; gerekçeleri okumadan kullanmayın"
```

**Neden:** Aynı tanımsız damganın olumsuzu. "En az bir doğrulama başarısız" cümlesi HANGİ doğrulamanın neden başarısız olduğunu söylemiyor; avukat ne yapması gerektiğini öğrenemiyor.

**Öneri:**
```
no: "OLDUĞU GİBİ KULLANMAYIN — en az bir alıntı kaynağıyla eşleşmedi; aşağıdaki gerekçeleri okuyup kaynakları kendiniz açın"
```

## [P0] jargon — satir 2927

**Mevcut:**
```
"Korpusta bu soruya dayanak olabilecek doğrulanabilir pasaj bulunamadı."
```

**Neden:** "Korpus" ve "pasaj" kullanıcının açıkça bilmediğini söylediği kelimeler. Cümle ayrıca avukatın bundan sonra ne yapması gerektiğini de söylemiyor.

**Öneri:**
```
"Elinizdeki belge ve mevzuat arşivinde bu soruya dayanak olacak bir bölüm bulunamadı — soruyu daraltmayı ya da ilgili belgeyi yüklemeyi deneyin."
```

## [P0] jargon — satir 2939

**Mevcut:**
```
"Taslakçı, kanıt kümesinde olmayan bir kaynağa atıf istedi; atıf reddedildi."
```

**Neden:** "Taslakçı" ve "kanıt kümesi" ekranda tanımı olmayan uydurma terimler; cümle edilgen ve avukata sonucun ne olduğunu söylemiyor.

**Öneri:**
```
"Cevabı yazan bölüm, elimizdeki kaynaklar arasında olmayan bir karara atıf yapmak istedi; bu atıf cevaba alınmadı."
```

## [P0] jargon — satir 2960

**Mevcut:**
```
"Araştırma bütçesi (araç çağrısı / süre) tükendi; tarama erken bitirildi."
```

**Neden:** "Bütçe" avukat için para demektir ve burada para kastedilmiyor; "araç çağrısı" tamamen mühendislik terimidir. Cümle ayrıca avukatın neyi kaybettiğini ve ne yapacağını söylemiyor.

**Öneri:**
```
"Arama için ayrılan süre doldu; bazı kaynaklar taranamadan durduruldu — sonuç eksik olabilir, soruyu daraltıp yeniden çalıştırın."
```

## [P0] anlasilmaz-cumle — satir 2962

**Mevcut:**
```
"$1 kaynak çağrısı zaman aşımına uğradı; sonuç eksik olabilir."
```

**Neden:** "Zaman aşımı" bir avukat için mutlaka TBK/TCK anlamındaki zamanaşımıdır; burada kastedilen ise kaynağın geç cevap vermesidir. Yanlış anlaşılmaya en açık cümle. "Kaynak çağrısı" da makine dilidir.

**Öneri:**
```
"$1 kaynak süresinde cevap vermedi; sonuç eksik olabilir — biraz sonra yeniden deneyin."
```

## [P0] anlasilmaz-cumle — satir 2964

**Mevcut:**
```
"Kaynak sunucu zamanında cevap vermedi; bazı çağrılar zaman aşımına uğradı."
```

**Neden:** Aynı hukukî yanlış anlama ("zaman aşımı") ile birlikte "sunucu" ve "çağrı"; cümle ayrıca aynı şeyi iki kez söylüyor.

**Öneri:**
```
"Resmî kaynak süresinde cevap vermedi; bazı kaynaklar taranamadı — sonuç eksik olabilir."
```

## [P0] jargon — satir 2967

**Mevcut:**
```
"$1 sayfada metin katmanı yok — taranmış olabilir; bu sayfalar dizine alınmadı."
```

**Neden:** "Metin katmanı" ve "dizine alınmadı" avukatın bilmediği kavramlar. Anlatılmak istenen çok basit: o sayfalar fotoğraf olduğu için içindeki yazı okunamadı ve aramaya girmedi.

**Öneri:**
```
"$1 sayfa taranmış görüntü olduğu için içindeki yazı okunamadı; bu sayfalar aramaya ve alıntıya girmedi."
```

## [P0] jargon — satir 2969

**Mevcut:**
```
"Yerel korpusa ulaşılamadı; veritabanı çalışmıyor olabilir."
```

**Neden:** Tek cümlede iki bilinmeyen kelime: "korpus" ve "veritabanı". Ayrıca hiçbir çözüm adımı vermiyor, oysa aynı dosyada (2780) çözüm adımlı bir metin zaten var.

**Öneri:**
```
"Belge arşivine ulaşılamadı — ColleX-Durdur.cmd, ardından ColleX-Baslat.cmd ile programı yeniden başlatın."
```

## [P0] jargon — satir 2975

**Mevcut:**
```
"Bulut yapay zekâ bu sunucuda yapılandırılmamış; kural tabanlı üretimle devam edildi."
```

**Neden:** "Yapılandırılmamış", "sunucu" ve özellikle "kural tabanlı üretim" mühendis dilidir. Avukat cevabın nasıl yazıldığını değil güvenilir olup olmadığını merak eder.

**Öneri:**
```
"Bulut yapay zekâ bu bilgisayarda kapalı — cevap yalnızca bulunan kaynaklardan, yorum eklenmeden derlendi."
```

## [P0] jargon — satir 3013

**Mevcut:**
```
"İstek ya da dosya sunucu sınırını aşıyor (JSON ≤ 1 MB, belge ≤ 25 MB, Bulut OCR ≤ 32 MB / ≤ 100 sayfa)."
```

**Neden:** "JSON", "OCR", "sunucu", "istek" — dört bilinmeyen kelime tek cümlede. Avukatın öğrenmesi gereken tek şey dosya sınırı ve ne yapacağıdır.

**Öneri:**
```
"Dosya çok büyük — yüklenecek belge en çok 25 MB olabilir; bulut yapay zekâ ile okutulacak taranmış belge için sınır 32 MB ve 100 sayfadır. Belgeyi bölüp yeniden deneyin."
```

## [P0] jargon — satir 3046

**Mevcut:**
```
UPSTREAM_UNAVAILABLE: "Canlı araştırma ağ geçidine ulaşılamadı — canlı mod bu sunucuda kapalı olabilir.",
```

**Neden:** "Ağ geçidi" ve "sunucu" bilinmiyor; "canlı mod" da ekranda tanımlı değil. Avukat neye ulaşılamadığını ve ne yapacağını anlamıyor.

**Öneri:**
```
UPSTREAM_UNAVAILABLE: "Resmî kaynaklarda canlı arama şu anda çalışmıyor — bu kurulumda kapalı olabilir. Yerel arşivde arama yapmayı deneyin.",
```

## [P0] jargon — satir 3090

**Mevcut:**
```
421: "Sunucu bu adresten gelen isteği kabul etmiyor; ColleX'i 127.0.0.1 üzerinden açın.",
```

**Neden:** "127.0.0.1" bir avukat için okunaksız bir sayı dizisidir; "sunucu" ve "istek" de bilinmiyor. Verilebilecek tek uygulanabilir talimat masaüstündeki kısayolu kullanmasıdır.

**Öneri:**
```
421: "ColleX yalnız bu bilgisayardan açılabilir. Tarayıcıya adres yazmak yerine masaüstündeki ColleX-Baslat.cmd kısayolunu kullanın.",
```

## [P0] ton — satir 3155

**Mevcut:**
```
["Değişiklik öncesi (1–5 yıl, 2025)", "TCK m. 157 dolandırıcılık suçunun cezası nedir?", "2025-06-01"],
```

**Neden:** Düğme etiketi, sentetik deneme belgelerindeki UYDURMA ceza aralığını (1-5 yıl) gerçek TCK m.157 bilgisi gibi ekrana yazıyor; hemen altındaki 3156. satırda aynısı "3-7 yıl" olarak tekrarlanıyor. Avukat etiketi okur ve cezayı doğru sanır — sentetik veriyi hukukî bilgi gibi sunma yasağının doğrudan ihlali.

**Öneri:**
```
["Örnek: tarihe göre değişen hüküm (deneme belgesi)", "TCK m. 157 dolandırıcılık suçunun cezası nedir?", "2025-06-01"], — 3156 için de: ["Örnek: aynı soru, sonraki tarih (deneme belgesi)", …]
```

## [P0] jargon — satir 3186

**Mevcut:**
```
b.setAttribute("aria-label", "Özet değerini panoya kopyala");
```

**Neden:** "Özet değeri" (hash) kullanıcının açıkça saydığı bilinmeyen terimlerden; ekranda ayrıca 12 karakterlik anlamsız bir dizi düğme olarak duruyor. Avukat ne olduğunu ve niçin kopyalayacağını bilmiyor; açıklamasız durması kusurdur.

**Öneri:**
```
b.setAttribute("aria-label", "Bu alıntının denetim kodunu kopyala"); yanına tek satır açıklama: "Bu kod, alıntının sonradan değiştirilmediğini karşı tarafın da denetleyebilmesi içindir."
```

## [P0] jargon — satir 3514

**Mevcut:**
```
return c.evidenceId + " (" + (c.reason || "?") + ")";
```

**Neden:** Ekrana "Reddedilen atıflar: ev-9f2a1b3c (NOT_IN_EVIDENCE)" gibi bir satır yazılıyor: hem kaynak kimliği hem İngilizce büyük harfli kod, hiçbir Türkçe cümle olmadan. Ürünün kendi kuralına (makine kodu tek başına duramaz) da aykırı.

**Öneri:**
```
return "[" + (numbers[c.evidenceId] || "?") + "] numaralı kaynak — " + observedReasonTR(c.reason, false); ham kod yalnız katlanmış "Teknik ayrıntılar" kabında gösterilmeli.
```

## [P0] jargon — satir 3553

**Mevcut:**
```
" · bağlantı kurulan pasaj: " + rel.viaChunkId +
```

**Neden:** Kaynak kartında avukatın önüne "bağlantı kurulan pasaj: 8f31c0a2-…" diye bir kimlik dizesi çıkıyor. Hem "pasaj" ürün jargonu hem kimlik tamamen makineye ait; avukat için sıfır bilgi, ekranda gürültü.

**Öneri:**
```
Bu parça ekrandan tamamen kaldırılmalı; gerekiyorsa yalnız katlanmış "Teknik ayrıntılar" bölümünde tutulmalı.
```

## [P0] jargon — satir 3555

**Mevcut:**
```
" · çözümleyici: " + rel.resolverVersion + " · güven: " + conf;
```

**Neden:** "Çözümleyici: v3" ve "güven: 0.82" saf mühendis çıktısıdır; 0-1 arası çıplak bir sayı avukata hiçbir şey anlatmaz ve ölçülmemiş bir kesinlik izlenimi verir. İlişki kimliği ve durum kodu (3554) da aynı satırda çıplak duruyor.

**Öneri:**
```
Sürüm, ham güven sayısı, ilişki kimliği ve durum kodu ekrandan kaldırılmalı; yerine tek cümle: "Bu bağlantı otomatik kuruldu — ilgili düzenlemeyi kendiniz açıp doğrulayın."
```

## [P1] jargon — satir 2778

**Mevcut:**
```
var AI_TIMEOUT_TEXT = "Bulut yapay zekâ süresinde yanıt vermedi (60 sn; OCR 300 sn) — yeniden deneyin.";
```

**Neden:** "OCR" bilinmeyen kısaltma; parantez içindeki iki süre avukat için hiçbir işe yaramıyor, yalnız cümleyi ağırlaştırıyor.

**Öneri:**
```
var AI_TIMEOUT_TEXT = "Bulut yapay zekâ süresinde cevap vermedi — yeniden deneyin. Taranmış belge okutuyorsanız işlem daha uzun sürebilir.";
```

## [P1] tanimsiz-terim — satir 2812

**Mevcut:**
```
["coverage", "Kapsam"]
```

**Neden:** "Kapsam" arayüzde en az üç ayrı anlamda kullanılıyor (kaynağın soruyu karşılaması, kapsam dışı bırakılan pasajlar, dosya kapsamı). Aynı kelimenin üç anlamı avukatı yanıltır ve bu ölçütün yüzdesi ekranda tek başına gösteriliyor.

**Öneri:**
```
["coverage", "Soruyu karşılama"]
```

## [P1] tanimsiz-terim — satir 2921

**Mevcut:**
```
"Arama şeritlerinden biri sorun bildirdi — sonuç eksik olabilir."
```

**Neden:** "Şerit" bu üründe uydurulmuş bir terim ve ekranda tanımı yok; avukat neyin sorun bildirdiğini anlamıyor, ne yapacağını da bilmiyor.

**Öneri:**
```
"Arama yöntemlerinden biri çalışmadı — sonuç eksik olabilir, aramayı yineleyin."
```

## [P1] jargon — satir 2929

**Mevcut:**
```
"Kaynak bulundu ancak hiçbir tespit kurulamadı."
```

**Neden:** "Tespit kurulamadı" mühendis dilidir ve ne olduğu belirsizdir; avukat kaynak varken neden cevap olmadığını anlamıyor.

**Öneri:**
```
"Kaynak bulundu ama hiçbiri soruyu doğrudan karşılamadı; cevap yazılmadı — kaynakları aşağıdan kendiniz inceleyebilirsiniz."
```

## [P1] jargon — satir 2941

**Mevcut:**
```
"İç doğrulama bileşenlerinden biri hata bildirdi — cevabı kullanmadan önce bu bölümü okuyun."
```

**Neden:** "İç doğrulama bileşeni" mühendis dilidir; avukat neyin bozulduğunu ve sonucun ne olduğunu anlamıyor.

**Öneri:**
```
"Otomatik kontrollerden biri tamamlanamadı — bu cevabın kaynaklarını kendiniz açıp doğrulamadan kullanmayın."
```

## [P1] jargon — satir 2945

**Mevcut:**
```
"Bir tespitte pasaj desteği eşiğin altında kaldı."
```

**Neden:** Üç jargon tek cümlede: tespit, pasaj, eşik. Cümle edilgen ve avukata hiçbir eylem önermiyor.

**Öneri:**
```
"Bir cümlenin dayandığı kaynak metni o cümleyi yeterince karşılamıyor — kaynağı kendiniz okuyun."
```

## [P1] anlasilmaz-cumle — satir 3018

**Mevcut:**
```
"Cevap süre bütçesini (60 sn) aştı; tespit yazımı ve doğrulama eksik bırakıldı — bulunan pasajlar gösteriliyor, cevap KISMİ."
```

**Neden:** "Süre bütçesi", "tespit yazımı", "pasaj" ve tanımsız "KISMİ" damgası bir arada; cümle uzun ve üç ayrı şey söylüyor. Avukat ne yapacağını öğrenemiyor.

**Öneri:**
```
"Cevap için ayrılan süre doldu; cevap yazılamadan durduruldu. Aşağıda yalnızca bulunan kaynaklar var — soruyu daraltıp yeniden çalıştırın."
```

## [P1] jargon — satir 3020

**Mevcut:**
```
"Bir pasaj çok uzundu; alıntı kısaltıldı — sorunun sözcüklerine en yakın bölüm gösteriliyor, özet ve konumlar bu bölüme aittir."
```

**Neden:** "Pasaj", "özet" (hash anlamında) ve "konumlar" (offset) bilinmeyen kelimeler; son cümle avukat için tamamen anlamsız.

**Öneri:**
```
"Kaynak metin çok uzundu; alıntı kısaltıldı — sorunuza en yakın bölüm gösteriliyor. Tamamını görmek için kaynağı açın."
```

## [P1] anlasilmaz-cumle — satir 3022

**Mevcut:**
```
"Kaynak metinleri 5 MB'ı aştığı için cevap kaydına tam metinler yazılmadı; alıntılar ve özetler kayıtta, dışa aktarma alıntı özetiyle doğrular."
```

**Neden:** "Alıntı özetiyle doğrular" hiçbir şey anlatmıyor; "özet" burada hash karşılığı kullanılmış ama okuyucu bunu 'metin özeti' sanır. Cümle üç bağımsız bilgiyi tek nefeste veriyor.

**Öneri:**
```
"Kaynak metinler çok büyük olduğu için kayda tam metin değil yalnızca alıntılar kaydedildi. Dışa aktarmada alıntıların bozulmadığı yine otomatik denetlenir; tam metin için kaynağı açın."
```

## [P1] ton — satir 3274

**Mevcut:**
```
" sunucuda henüz açık değil. Sistemi başlatan kişiden isteyin; " +
```

**Neden:** Ürün tek kişilik büro için tasarlanmış; "sistemi başlatan kişi" avukatın kendisidir (dosyanın 2779. satırdaki kendi yorumu da böyle diyor). Var olmayan bir yöneticiye başvurmasını söylemek anlamsız ve caydırıcıdır; "sunucu" da jargondur.

**Öneri:**
```
" kurulumda henüz açık değil. Program güncellendiğinde bu ekran kendiliğinden çalışmaya başlar. " +
```

## [P1] ui-kusuru — satir 3279

**Mevcut:**
```
tech.appendChild(document.createTextNode(" → 404)"));
```

**Neden:** Kartın altında "(Teknik: /v1/… → 404)" yazıyor: hem adres hem HTTP kodu, Türkçe cümle olmadan. Ürünün kendi kuralına göre ham kod ancak Türkçe cümleden sonra ve katlanmış kapta durabilir.

**Öneri:**
```
Bu satır varsayılan olarak gizlenmeli; yalnız katlanmış bir "Teknik ayrıntılar" bölümüne alınıp "(Destek için teknik ayrıntı: <adres>, yanıt 404)" biçiminde yazılmalı.
```

## [P1] ui-kusuru — satir 3349

**Mevcut:**
```
box.appendChild(el("div", "val", "%" + value));
```

**Neden:** Beş ayrı ölçüt için çıplak yüzde gösteriliyor ve gerektiğinde "%100" de yazabiliyor. Ürün doğruluk yüzdesi iddia etmiyor; açıklamasız bir %100 tam da bu iddiayı yaratır. Yüzdenin neye göre hesaplandığı hiçbir yerde yazmıyor.

**Öneri:**
```
Yüzde yerine üç kademeli sözel etiket ("güçlü / orta / zayıf") gösterilmeli ve ölçer başlığına "Bunlar kaynak eşleşmesinin gücünü gösterir; cevabın doğruluk oranı DEĞİLDİR." cümlesi eklenmeli.
```

## [P1] jargon — satir 3395

**Mevcut:**
```
return ["strong", "Bu dayanak güçlü: tüm güven boyutları yüksek; alıntı birebir doğrulandı."];
```

**Neden:** "Güven boyutları" ekranda tanımı olmayan bir ürün terimi. Cümle ayrıca neyin güçlü olduğunu (hukukî değer mi, kaynak eşleşmesi mi) söylemiyor; hukukî güç izlenimi vermemeli.

**Öneri:**
```
return ["strong", "Kaynak eşleşmesi güçlü: alıntı belgedeki metinle birebir aynı ve kaynak yürürlükte. Hukukî değerlendirme yine size aittir."];
```

## [P1] anlasilmaz-cumle — satir 3398

**Mevcut:**
```
return ["weak", "Dikkat: “" + minName + "” boyutu zayıf (%" + p +
```

**Neden:** "… boyutu zayıf (%35)" cümlesi tanımsız bir ölçüt adının yanına bağlamı olmayan bir yüzde koyuyor. Avukat %35'in neye göre düşük olduğunu bilemez; çıplak sayı olmayan bir kesinlik izlenimi yaratır.

**Öneri:**
```
return ["weak", "Dikkat: bu dayanakta “" + minName + "” zayıf — kaynağı açıp kendiniz okumadan dayanak yapmayın."];
```

## [P1] tanimsiz-terim — satir 3443

**Mevcut:**
```
if (claim.material) { head.appendChild(chip("Maddî tespit", "mute")); }
```

**Neden:** "Maddî tespit" damgası tanımsız: avukat bunu "maddi tazminat" ya da "maddi vakıa" ile karıştırır; ürünün kastettiği ise sonucu doğrudan taşıyan cümledir. Damganın yanında hiçbir açıklama yok.

**Öneri:**
```
if (claim.material) { var m = chip("Sonucu etkileyen cümle", "mute"); m.title = "Bu cümle cevabın sonucunu doğrudan taşıyor; kaynağını mutlaka okuyun."; head.appendChild(m); }
```
