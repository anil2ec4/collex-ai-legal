# js-isler-belge

Bu bolge (9500-10800) urunun en cok kullanilacak dort ekranini tasiyor: adlandirilmis is kartlari, belge sayfasi, atif/kaynak dogrulama ve kayitli arastirmalar. Isin mantigi saglam ve durust - hicbir yerde uydurma sayi yok, kaynagi olmayan satir isaretleniyor - ama ekranda konusulan dil avukatin degil muhendisin dili. Tek bir is karti satirinda bile "korpus", "Unicode konumu", "SHA-256", "hash'li", "uc", "manifesto", "uc kovali", "jeton", "arac cagrisi", "bayt", "parca" gibi sozcukler var; bunlar tanimlanmadan geciyor ve avukat karti okumadan kapatir. Ikinci buyuk sorun adlandirma tutarsizligi: ayni liste ekranda uc ayri adla aniliyor ("Kayitli arastirmalarim" / "Kayitli cevaplar" / "Arastirmalar sekmesi"), ayni metin birimi bir cumlede "parca" bir cumlede "bolum" oluyor. Ucuncusu, devre disi is karti sebebi yazinca kartin ne ise yaradigini soyleyen satiri kaybediyor; avukat kartin neden kapali oldugunu okuyor ama ne oldugunu asla ogrenemiyor. Sure kartindaki "30 usul kurali" ve "her sonuc DOGRULANMADI etiketiyle gelir" ifadeleri urunun kendi verisiyle (41 kural, 16'si dogrulanmis) uyusmuyor; bu iki satir sayi iddiasi tasidigi icin oncelikle duzeltilmeli.

Bulgu: 40

## [P0] jargon — satir 9717

**Mevcut:**
```
kaynağa git — parça 
```

**Neden:** Izgara hücresindeki bu düğme avukata "parça 3f9a2c1b0d…" ve "konum 1204–1480" yazıyor. Parça kimliği bir makine numarası, konum ise karakter sayısı; ikisinin de avukat için hiçbir anlamı yok ve düğmenin ne yapacağını söylemiyor.

**Öneri:**
```
Belgede bu cümlenin geçtiği yeri aç
```

## [P0] jargon — satir 9744

**Mevcut:**
```
["Belge", "Belge kimliği", "Soru", "Durum", "Cevap", "Kaynak parça", "Konum (Unicode)", "Alıntı SHA-256", "Araştırma no"]
```

**Neden:** Avukatın Excel'de açacağı tablonun başlıkları bunlar. "Belge kimliği", "Kaynak parça", "Konum (Unicode)", "Alıntı SHA-256" başlıklarının hiçbiri avukat Türkçesi değil; tabloyu bir müvekkile veya hâkime gösteremez.

**Öneri:**
```
["Belge", "Belge no", "Soru", "Sonuç", "Cevap", "Alındığı bölüm", "Belgedeki yeri", "Alıntı denetim değeri", "Araştırma no"]
```

## [P0] tanimsiz-terim — satir 9842

**Mevcut:**
```
künye listesi · hash'li tam metin kartı
```

**Neden:** "hash'li" hem yabancı hem tanımsız; avukat kartın çıktısının ne olduğunu anlamıyor. Künye ise avukat dilinde vardır, orası doğru.

**Öneri:**
```
künye listesi · alıntısı denetlenebilir tam metin kartı
```

## [P0] jargon — satir 9878

**Mevcut:**
```
Yerel korpusta arar; her tespiti belge sürümü, Unicode konumu ve SHA-256 ile bağlar.
```

**Neden:** Ürünün ana iş kartının tek açıklama satırı bu ve içinde avukatın bilmediği üç kelime var: korpus, Unicode konumu, SHA-256. Ayrıca "tespit" bu ekranda hiç tanımlanmıyor. Avukat bu satırı okuyunca kartın ne yaptığını değil, kendisine yabancı bir şey olduğunu anlar.

**Öneri:**
```
Bu bilgisayardaki kayıtlı mevzuat ve karar metinlerinde arar; verdiği her cümlenin altına alındığı belgeyi, o belgedeki tam yeri ve birebir alıntıyı koyar.
```

## [P0] tanimsiz-terim — satir 9886

**Mevcut:**
```
Bu sunucuda yerel korpus boş.
```

**Neden:** Kart devre dışı kaldığında avukatın gördüğü tek cümle bu. "Sunucu" ve "korpus" kelimelerinin ikisi de anlaşılmaz ve cümle ne yapması gerektiğini söylemiyor.

**Öneri:**
```
Bu bilgisayarda henüz aranacak mevzuat/karar metni yok. Belgeler ekranından belge yükleyin ya da canlı araştırmayı kullanın.
```

## [P0] jargon — satir 10042

**Mevcut:**
```
showNotYet(out, "POST /v1/research", "Derin araştırma ucu")
```

**Neden:** Ekrana "POST /v1/research" ve "uç" kelimesi basılıyor. Bunlar avukata söylenecek şeyler değil; ne olduğunu, ne yapması gerektiğini söylemiyor.

**Öneri:**
```
showNotYet(out, "", "Canlı araştırma bu kurulumda yok — bu bilgisayardaki kayıtlı belgelerle arama yapabilirsiniz.")
```

## [P0] jargon — satir 10147

**Mevcut:**
```
araç çağrısı: 
```

**Neden:** Canlı araştırma sürerken ekranda "araç çağrısı: 7 · belge getirme: 3" yazıyor. "Araç çağrısı" tamamen mühendis dili; avukat için ne olduğu, çokluğunun iyi mi kötü mü olduğu belirsiz.

**Öneri:**
```
sorgulanan kaynak sayısı: 
```

## [P0] jargon — satir 10215

**Mevcut:**
```
Parmak izi (SHA-256)
```

**Neden:** Belge sayfasının ilk künye satırı bu. "Parmak izi" uydurulmuş bir terim, SHA-256 ise tam bir makine sözcüğü; yanında da kısaltılmış bir onaltılık dizi duruyor. Avukat bu satırın neye yaradığını ekrandan öğrenemiyor.

**Öneri:**
```
Belge denetim değeri (Belgenin değişmediğini denetlemeye yarar: belgede tek harf değişse bu değer de değişir. Alıntılarınızın bozulmadığı bu değerle otomatik denetlenir.)
```

## [P0] jargon — satir 10309

**Mevcut:**
```
Belge + korpus
```

**Neden:** Belgeye soru sorarken seçilecek üç kapsamdan biri. "Korpus" tanımsız; avukat üçüncü seçeneğin ne kattığını bilemez ve seçmez.

**Öneri:**
```
Bu belge + bilgisayardaki mevzuat ve kararlar
```

## [P0] jargon — satir 10487

**Mevcut:**
```
 · giriş " + (a.usage.inputTokens || 0) + " / çıkış " + (a.usage.outputTokens || 0) + " jeton
```

**Neden:** "Jeton" (token) avukatın hiç duymadığı bir birim; ekranda ne işe yaradığı, neden gösterildiği hiç açıklanmıyor. Avukat için tamamen gürültü.

**Öneri:**
```
Bu satırı avukat ekranından kaldırın; sayaç gerekiyorsa yalnız "Teknik ayrıntılar" katlanmış bölümünde ve "gönderilen metin uzunluğu / dönen metin uzunluğu" adıyla gösterilsin.
```

## [P0] jargon — satir 10524

**Mevcut:**
```
PDF'in tamamı Anthropic'e gönderilir (≤ 32 MB, ≤ 100 sayfa); dönen metnin ilk satırı “AI OCR — kaynak — GG.AA.YYYY — model” sağlama başlığıdır. 
```

**Neden:** OCR penceresinin göbeğindeki cümle: "≤" matematik işareti, "sağlama başlığı" uydurma terim, "model" tanımsız. Avukat bu cümleden çıkardığı metnin başına neden garip bir satır geleceğini anlamaz.

**Öneri:**
```
Belgenin tamamı buluttaki yapay zekâya gönderilir (en çok 32 MB ve 100 sayfa). Dönen metnin ilk satırında bu metnin bilgisayarınızda değil bulutta okunduğu, hangi belgeden ve hangi tarihte çıkarıldığı yazar; o satırı silmeyin, metnin nereden geldiğinin kaydıdır. 
```

## [P0] jargon — satir 10531

**Mevcut:**
```
Bu istek için Bulut AI onayı — PDF Anthropic'e gönderilir (model 
```

**Neden:** Onay kutusunun etiketi "istek", "Bulut AI", "model" ile dolu; avukat neyi onayladığını değil, hangi teknik terimleri onayladığını okuyor.

**Öneri:**
```
Onaylıyorum: bu belge, metne çevrilmek üzere bir seferliğine internetteki yapay zekâ hizmetine gönderilsin (kullanılan hizmet: 
```

## [P0] jargon — satir 10746

**Mevcut:**
```
Korpusta doğrula
```

**Neden:** Belge sayfasında bulunan her atfın yanındaki düğme. "Korpus" tanımsız ve düğme basınca ne olacağını söylemiyor.

**Öneri:**
```
Bu atfı kayıtlı metinlerde bul
```

## [P1] jargon — satir 9494

**Mevcut:**
```
Izgara CSV olarak panoya kopyalandı.
```

**Neden:** "Izgara" tanımsız (ayrıca büyük İ harfi eksik yazılmış), "CSV" ve "pano" bilgisayar dili. Avukat kopyalananın Excel'e yapıştırılabilir bir tablo olduğunu anlamıyor.

**Öneri:**
```
Tablo kopyalandı — Excel'e yapıştırabilirsiniz.
```

## [P1] tanimsiz-terim — satir 9583

**Mevcut:**
```
kapsanmadı — karşılığı bulunamayan sözcükler: 
```

**Neden:** "Kapsanmadı" tanımsız ve edilgen bir uydurma durum adı; tablo hücresinde tek başına duruyor. Avukat sorunun neden cevapsız kaldığını anlayamıyor.

**Öneri:**
```
bu belgede karşılığı bulunamadı — şu sözcüklerin geçtiği bir yer yok: 
```

## [P1] anlasilmaz-cumle — satir 9647

**Mevcut:**
```
istek başarısız — 
```

**Neden:** "İstek" burada bilgisayarın sunucuya gönderdiği çağrı anlamında; avukat için istek dilekçedeki taleptir. Hücrede "istek başarısız" yazması yanlış anlaşılmaya çok açık.

**Öneri:**
```
bu hücre hesaplanamadı — 
```

## [P1] tanimsiz-terim — satir 9836

**Mevcut:**
```
üç kovalı denetim tablosu · DOCX
```

**Neden:** "Üç kovalı" mühendis tabiri (three-bucket). Avukat üç kovanın ne olduğunu bilmez; oysa anlatılmak istenen şey basit: bulundu / bulunamadı / emin değiliz.

**Öneri:**
```
bulundu · bulunamadı · emin değiliz üçlü tablosu · Word dosyası
```

## [P1] tanimsiz-terim — satir 9866

**Mevcut:**
```
kapsam manifestosu
```

**Neden:** "Manifesto" hukukçu için siyasi bildiri çağrışımı yapar, burada kastedilen ise kapsam listesi. "Kapsam" kelimesi de arayüzde üç ayrı anlamda kullanılıyor.

**Öneri:**
```
hangi kaynakların tarandığını gösteren liste
```

## [P1] tanimsiz-terim — satir 9870

**Mevcut:**
```
Belge × soru ızgarası
```

**Neden:** "Izgara" ekranda hiçbir yerde tanımlanmıyor ve "×" işareti başlıkta okunmuyor. Avukat bunun bir karşılaştırma tablosu olduğunu başlıktan anlayamıyor.

**Öneri:**
```
Aynı soruyu birçok belgeye sor (karşılaştırma tablosu)
```

## [P1] anlasilmaz-cumle — satir 9908

**Mevcut:**
```
30 usul kuralı, adli tatil ve HMK m. 92/2 ile hesaplar; her sonuç DOĞRULANMADI etiketiyle gelir.
```

**Neden:** İki ayrı sayı iddiası taşıyor ve ikisi de ürünün kendi verisiyle uyuşmüyor görünüyor: süre kuralı sayısı 41 ve bunların 16'sı madde metni elde doğrulanmış durumda. "Her sonuç DOĞRULANMADI etiketiyle gelir" cümlesi hem yanlış hem de ürünü olduğundan zayıf gösteriyor. Ayrıca "DOĞRULANMADI etiketi" bu kartta tanımsız.

**Öneri:**
```
Usul sürelerini, adli tatili ve HMK m. 92/2'yi gözeterek hesaplar. Her sonucun yanında hesabın hangi kurala dayandığı ve o kuralın madde metniyle karşılaştırılıp karşılaştırılmadığı yazar; süreyi mutlaka kendiniz de teyit edin.
```

## [P1] tanimsiz-terim — satir 9914

**Mevcut:**
```
13 şablon; dayanağı olmayan her paragraf KAYNAKSIZ işaretlenir, doğrulanamayan atıfta dışa aktarım reddedilir.
```

**Neden:** "KAYNAKSIZ" bu kartta tanımsız geçiyor (tanımı yalnız başka ekranda ipucu olarak asılı), "dışa aktarım" bilgisayar dili. Cümle ayrıca ne kazandığını değil neyi reddettiğini anlatıyor.

**Öneri:**
```
13 hazır dilekçe kalıbı. Altında alıntısı bulunmayan paragrafın başına "dayanağı yok" uyarısı konur; alıntısı belgesiyle uyuşmayan bir taslak Word'e hiç aktarılmaz.
```

## [P1] jargon — satir 9915

**Mevcut:**
```
sürümlü taslak · DOCX / Markdown / UDF (deneysel)
```

**Neden:** "Markdown" avukatın bilmediği bir biçim adı, "sürümlü" burada tanımsız. UDF ve deneysel etiketi doğru, korunmalı ama açıklanmalı.

**Öneri:**
```
her kaydedişte ayrı numara alan taslak · Word · düz metin · UYAP dosyası (deneme aşamasında, UYAP'ta hiç açılmadı)
```

## [P1] ui-kusuru — satir 9942

**Mevcut:**
```
b.appendChild(el("span", "wl", why || card.line));
```

**Neden:** Bir iş kartı devre dışıysa açıklama satırının yerine sebep yazılıyor. Avukat kartın neden kapalı olduğunu okuyor ama o kartın ne işe yaradığını asla öğrenemiyor — kapalı kart hiçbir zaman öğretici olmuyor.

**Öneri:**
```
Açıklama satırı her zaman kalsın, sebep ayrı bir satır olarak altına eklensin: b.appendChild(el("span", "wl", card.line)); if (why) { b.appendChild(el("span", "wblock", "Şu an kullanılamıyor — " + why)); }
```

## [P1] anlasilmaz-cumle — satir 10065

**Mevcut:**
```
beklenmiyor
```

**Neden:** Ekranda tek başına duran bu kelime bir durum mu, bir hata mı, bir emir mi belli değil. Türkçesi de bozuk ("artık beklenmiyor" kastediliyor).

**Öneri:**
```
bekleme bırakıldı
```

## [P1] ui-kusuru — satir 10072

**Mevcut:**
```
Canlı araştırma sunucuda sürebilir: bittiğinde sonucu “Kayıtlı cevaplar” 
```

**Neden:** Aynı liste arayüzde üç ayrı adla anılıyor: iş kartında "Kayıtlı araştırmalarım", burada "Kayıtlı cevaplar", 10096. satırda "Araştırmalar sekmesi". Avukat üç ayrı yer arıyor. Ayrıca "sunucuda" kelimesi tek kullanıcılı bir programda anlamsız.

**Öneri:**
```
Araştırma arka planda sürüyor olabilir: bittiğinde sonucu “Kayıtlı araştırmalarım” 
```

## [P1] anlasilmaz-cumle — satir 10096

**Mevcut:**
```
Canlı araştırma çok uzun sürdü; sonuç Araştırmalar sekmesinde görünebilir.
```

**Neden:** "Araştırmalar sekmesi" diye bir ekran adı yok — liste "Kayıtlı araştırmalarım". Ayrıca "görünebilir" avukatı belirsiz bırakıyor; ne yapması gerektiğini söylemiyor.

**Öneri:**
```
Canlı araştırma beklenenden uzun sürdü. Bekleme burada bitirildi; sonuç geldiğinde “Kayıtlı araştırmalarım” listesinde çıkar, oradan açın.
```

## [P1] jargon — satir 10157

**Mevcut:**
```
Resmî kaynak geçidine bağlanılıyor…
```

**Neden:** "Geçit" (gateway) mühendis terimidir; avukat resmî kaynakla arasında bir "geçit" olduğunu bilmez, bilmesi de gerekmez.

**Öneri:**
```
Resmî kaynaklara bağlanılıyor…
```

## [P1] jargon — satir 10187

**Mevcut:**
```
Bu kimlikle bir belge yok; silinmiş olabilir.
```

**Neden:** "Kimlik" burada belge numarası anlamında kullanılıyor ama avukat için kimlik başka bir şeydir. Cümle ayrıca ne yapacağını söylemiyor.

**Öneri:**
```
Bu belge bulunamadı; silinmiş olabilir. Belgeler ekranından listeye dönüp yeniden seçin.
```

## [P1] jargon — satir 10220

**Mevcut:**
```
metaRow(list, "Metin çıkarıldı",
```

**Neden:** Bu satır avukata "48213 karakter, 62 bölüm · 14 sayfa · taranmış sayfa yok" gibi bir dizi teknik sayı gösteriyor. Karakter ve bölüm sayısının avukat için karşılığı yok; sayfa sayısı ve taranmışlık ise gerçekten işine yarar.

**Öneri:**
```
metaRow(list, "Okunabilirlik", ...) — yalnız sayfa sayısı ile "metin okunabildi" / "bu belge taranmış görüntü, metni çıkarılamadı" ifadesi kalsın; karakter ve bölüm sayıları "Teknik ayrıntılar" katlanmış bölümüne taşınsın.
```

## [P1] jargon — satir 10240

**Mevcut:**
```
Yüklediğiniz belgenin değiştirilmemiş aslı (
```

**Neden:** Cümle "… aslı (4831233 bayt)." diye bitiyor. "Bayt" avukat için ölçü birimi değil ve yedi haneli sayı hiçbir şey söylemiyor.

**Öneri:**
```
Yüklediğiniz belgenin hiç değiştirilmemiş hâlini indirir (yaklaşık 
```

## [P1] anlasilmaz-cumle — satir 10266

**Mevcut:**
```
Bölüm önizlemeleri gösteriliyor. Bir cevap doğrulandıktan sonra kaynak kartındaki “Belgeyi tam metniyle aç” tam metni burada, alıntı işaretli olarak açar.
```

**Neden:** Uzun, şartlı ve ekranda o an görünmeyen bir düğmeye ("kaynak kartındaki…") gönderme yapıyor. Avukat şu an ne gördüğünü değil, gelecekte ne olacağını okuyor.

**Öneri:**
```
Belgenin bölüm bölüm özeti aşağıda. Sorunuza cevap alınca, cevabın altındaki kaynak kutusundan tam metni açabilir ve alıntının belgede tam olarak nerede geçtiğini görebilirsiniz.
```

## [P1] jargon — satir 10278

**Mevcut:**
```
Teknik ayrıntılar (parça kimliği ve Unicode konumu)
```

**Neden:** Katlanmış teknik bölüm doğru bir çözüm, ama etiketin kendisi jargonla yazılmış: "parça kimliği" ve "Unicode konumu" avukatın kutucuğu açmadan önce okuduğu ilk şey.

**Öneri:**
```
Teknik ayrıntılar (bölüm numarası ve metindeki tam yer)
```

## [P1] anlasilmaz-cumle — satir 10469

**Mevcut:**
```
alıntı belgede var — tespit AI metnidir
```

**Neden:** Doğru ve dürüst bir ayrım yapıyor ama iki teknik kısaltmayla: "tespit" tanımsız, "AI metni" ne demek belli değil. Avukat bu çipin uyarı mı güvence mi olduğunu çözemiyor.

**Öneri:**
```
Alıntı belgede birebir var — yorumu yapay zekâ yazdı, siz denetleyin
```

## [P1] ui-kusuru — satir 10496

**Mevcut:**
```
Parça sol bölmede henüz yüklü değil — “Sonraki bölümler” ile ilerleyin.
```

**Neden:** Aynı cümlenin içinde aynı şey iki ayrı adla anılıyor: "parça" ve "bölüm". Avukat "Sonraki bölümler" düğmesinin aradığı "parça"yı getireceğini anlayamaz. Ayrıca program bunu kendisi yapabilecekken avukata elle ilerlemesini söylüyor.

**Öneri:**
```
Bu bölüm henüz açılmadı — “Sonraki bölümler” düğmesiyle ilerleyin. (Daha iyisi: düğmeye basmadan ilgili bölüm otomatik yüklenip vurgulansın.)
```

## [P1] jargon — satir 10618

**Mevcut:**
```
 · konum " + ch.startChar + "–" + ch.endChar + " (Unicode karakter sayımı) · " + ch.chunkId
```

**Neden:** Katlanmış olsa da açıldığında avukatın gördüğü şey "konum 1204–1480 (Unicode karakter sayımı) · 3f9a2c1b…". "Unicode karakter sayımı" ve makine numarası açıklanmadan duruyor.

**Öneri:**
```
 · belgenin başından itibaren " + ch.startChar + ". ile " + ch.endChar + ". harf arası · bölüm no " + ch.chunkId
```

## [P1] eksik-aciklama — satir 10621

**Mevcut:**
```
Bölüm yok — bu belgeden metin çıkarılamamış olabilir.
```

**Neden:** Bu, avukatın en sık karşılaşacağı boş durum (taranmış PDF) ve ekran ne yapması gerektiğini söylemiyor; oysa aynı sayfada "Bulut OCR ile metne çevir" düğmesi var.

**Öneri:**
```
Bu belgeden metin çıkarılamadı; büyük olasılıkla taranmış (fotoğraf hâlinde) bir belge. Yukarıdaki “Taranmış belgeyi metne çevir” düğmesiyle metne çevirebilirsiniz.
```

## [P1] ton — satir 10783

**Mevcut:**
```
Olay zaman çizelgesine eklendi (belgeden sezgisel çıkarım — UYAP'tan doğrulayın).
```

**Neden:** "Sezgisel çıkarım" (heuristic) mühendis dili. Uyarının kendisi doğru ve gerekli, ama avukat bunun ne kadar güvenilir olduğunu bu ifadeden ölçemez.

**Öneri:**
```
Olay zaman çizelgesine eklendi. Bu tarih belge metninden otomatik okundu, kesin değildir — UYAP'tan teyit edin.
```

## [P2] tanimsiz-terim — satir 9899

**Mevcut:**
```
kaynaklı cevap + araştırma izi
```

**Neden:** "Araştırma izi" tanımsız; 10140. satırdaki panel başlığında da aynı terim geçiyor. Avukat ne alacağını bilmiyor.

**Öneri:**
```
kaynaklı cevap + hangi kaynağın hangi sırayla tarandığının dökümü
```

## [P2] anlasilmaz-cumle — satir 9903

**Mevcut:**
```
Canlı araştırma bu sunucuda kapalı — ColleX-Baslat.cmd ile başlatın.
```

**Neden:** Avukat programı zaten çalıştırmış durumda; "başlatın" demek kafa karıştırıyor. Ayrıca "sunucu" ve çıplak dosya adı avukat diline ait değil.

**Öneri:**
```
Canlı araştırma şu an açık değil — programı ColleX-Durdur.cmd ile kapatıp ColleX-Baslat.cmd ile yeniden açtığınızda etkinleşir.
```

## [P2] eksik-aciklama — satir 10323

**Mevcut:**
```
Bulut AI: " + (cloudAiOn() ? "açık — bu istek Anthropic'e gider" : "kapalı")
```

**Neden:** Soru kutusunun altındaki tek satırda üç ayrı bilgi noktalarla dizilmiş; "istek", "Anthropic", "değerlendirme tarihi" aynı satırda. Yoğun ve okunmuyor; en kritik bilgi (metin dışarı çıkıyor mu) diğerlerinin arasında kayboluyor.

**Öneri:**
```
Satırı ikiye ayırın. Üstte kalın: "Bu soru bilgisayarınızdan dışarı çıkmaz." ya da "Dikkat: bu soruda belge metni internetteki yapay zekâ hizmetine gönderilir." Altta ince: "Aktif dosya: … · Değerlendirme tarihi: … (Araştır ekranından değiştirilir)."
```
