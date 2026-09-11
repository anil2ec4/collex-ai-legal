# js-denetim-takvim

Bu bölge üç ekranı çiziyor: Atıf Denetim Raporu (11901-12170), Takvim ve duruşma hazırlığı (12172-12401) ve Kapsam manifestosu (12403-12541). Üç ekranın da mantığı sağlam ve dürüst — künye uydurmuyor, ölçülmemiş alana sıfır yazmıyor, uzun beklemede vazgeçme sunuyor — ama dil büyük ölçüde mühendis dili: "uç", "kova", "araç envanteri", "migrasyon", "veritabanı", "korpus", "geçit", "NOT_YET_WIRED", "ms" gibi sözcükler doğrudan ekrana basılıyor. Kapsam ekranının "Ölçülen sayılar" ve "Araçlar" kartları bugünkü haliyle bir avukatın tek satırını bile anlayamayacağı teknik döküm; bu bölgenin en ağır kusuru orada. İkinci ağır kusur denetim raporundadır: istek başarısız olduğunda ekran "Atıflar bulunamadı" diyor, yani teknik bir arıza avukata "metninde atıf yok" diye okunuyor. Takvim ve duruşma hazırlığı ekranları hesaplanmış süre tarihlerini gösteriyor ama zorunlu süre uyarısını taşımıyor; bu hem ürünün kendi kuralına aykırı hem de avukat için gerçek bir risk. Ayrıca buton etiketleri ("Aç"), açıklaması yalnızca fare ipucunda duran boş hücreler ve boş durumu olmayan kartlar toparlanmalı.

Bulgu: 37

## [P0] jargon — satir 12011

**Mevcut:**
```
if (res.status === 404) { showNotYet(out, "POST /v1/citation-audit", "Atıf denetimi ucu"); return; }
```

**Neden:** Ekranda "Atıf denetimi ucu bu sunucuda henüz açık değil" yazar. "Uç" (endpoint) ve "POST /v1/citation-audit" hiçbir avukatın bilmediği makine dilidir. Aynı kusur 12198 ("Takvim ucu", "GET /v1/matters/deadlines"), 12331 ("Duruşma hazırlık ucu") ve 12427 ("Kapsam ucu") satırlarında tekrar eder.

**Öneri:**
```
Etiketlerden "ucu" sözcüğü çıkarılmalı: "Atıf denetimi", "Takvim", "Duruşma hazırlığı", "Kapsam listesi". Kart metni de "Atıf denetimi bu bilgisayarda henüz açılmadı. ColleX'i kuran kişiden açmasını isteyin; açıldığında bu ekran kendiliğinden çalışır." olmalı; "POST /v1/citation-audit → 404" satırı yalnızca kapalı duran "Teknik ayrıntı" başlığının altında kalmalı.
```

**Not:** Dört çağrı yeri de aynı biçimde düzeltilmeli.

## [P0] anlasilmaz-cumle — satir 12012

**Mevcut:**
```
if (res.status !== 200 || !res.body) { errCard(out, "Denetim yapılamadı", errMessage(res)); return; }
```

**Neden:** Bir satır yukarıdaki eşi (11950) aynı durumda "Atıflar bulunamadı" başlığını basıyor. Sunucu cevap veremediğinde avukat ekranda "Atıflar bulunamadı" okur ve metninde atıf olmadığını sanır. Teknik arıza ile 'atıf yok' sonucu aynı cümleyle anlatılamaz.

**Öneri:**
```
11950. satırdaki başlık "Atıflar bulunamadı" yerine "Metin okunamadı" olmalı ve altına şu cümle gelmeli: "Metindeki atıflar taranamadı; bu, metinde atıf olmadığı anlamına gelmez. Birazdan yeniden deneyin." 12012'deki "Denetim yapılamadı" başlığı doğrudur, altına aynı ayrım eklenmeli: "Denetim tamamlanamadı; hiçbir atıf hakkında sonuç üretilmedi."
```

**Not:** İki hata kartı da aynı ayrımı yapmalı: 'sonuç yok' başka, 'çalışmadı' başkadır.

## [P0] anlasilmaz-cumle — satir 12036

**Mevcut:**
```
(t.UNCERTAIN || 0) + " tanesi ise kapsamımızın dışında kaldığı için belirsizdir.";
```

**Neden:** Cümlenin tamamı (12034-12036) tek nefeste üç sayı veriyor, "kapsam" üründe üç ayrı anlamda kullanılıyor ve avukata NE YAPMASI gerektiğini söylemiyor. Ayrıca "kaynağında bulundu" ifadesi atfın doğru ve yürürlükte olduğu izlenimi veriyor.

**Öneri:**
```
"Bu belgede 12 atıf var. 8 atfın karşılığı taradığımız kaynaklarda bulundu; 2 atıf taradığımız kaynaklarda bulunamadı — bunları elden kontrol edin; 2 atıf ise taramadığımız bir yere ait olduğu için hakkında bir şey söyleyemiyoruz. Bulunmuş olmak, atfın doğru ya da yürürlükte olduğu anlamına gelmez."
```

**Not:** Bulundu/Bulunamadı/Belirsiz üçlüsünün tanımı ekranda bir kez açıkça yazılmalı.

## [P0] jargon — satir 12092

**Mevcut:**
```
? "Bu kovada satır yok — taradığımız kaynaklarda karşılığı bulunamayan atıf çıkmadı."
```

**Neden:** "Kova" (bucket) bir yazılım terimidir; Türkçede de anlamsızdır, avukat raporda kova aramaz. 12093'teki "Bu kovada satır yok." da aynı.

**Öneri:**
```
12092: "Bu başlıkta atıf yok — taradığımız kaynaklarda karşılığı bulunamayan atıf çıkmadı." 12093: "Bu başlıkta atıf yok."
```

## [P0] jargon — satir 12115

**Mevcut:**
```
nb.title = "DOCX raporu yalnız ColleX'te oluşturulmuş bir taslak için üretilebilir; yapıştırılan metin için dışa aktarım ucu yok.";
```

**Neden:** "Dışa aktarım ucu" makine dilidir. Ayrıca bu açıklama yalnızca fare ipucunda duruyor; klavye ve dokunmatik kullanan avukat butonun neden kapalı olduğunu hiç göremez. 12117'deki ipucu aynı terimi tekrar ediyor.

**Öneri:**
```
Butonun altına görünür tek satır yazın: "Word raporu yalnız ColleX'te hazırlanmış taslaklar için üretilebilir. Buraya yapıştırdığınız metin için indirilecek dosya oluşturulmaz; raporu ekrandan okuyun ya da metni önce taslağa dönüştürün." 12117'deki ikinci cümleyi kaldırın.
```

**Not:** Buton etiketi de "Raporu indir (DOCX)" yerine "Raporu Word dosyası olarak indir" olmalı.

## [P0] eksik-aciklama — satir 12197

**Mevcut:**
```
getJson("/v1/matters/deadlines?from=" + w.from + "&until=" + w.until + "&include=computed").then(function (res) {
```

**Neden:** Takvim hesaplanmış süreleri de getirir ve 12281'de tarihleri, 12305'te "3 gün kaldı / GECİKMİŞ" damgalarını gösterir; ancak ekranın hiçbir yerinde zorunlu süre uyarısı yoktur. Avukat bu tarihlere bakıp iş yapar; hesabın bir öneri olduğunu ve asıl sürenin dosyadan doğrulanması gerektiğini ekran söylemiyor.

**Öneri:**
```
Takvim ekranına, ay başlığının hemen altına sabit bir satır koyun: "Buradaki süreler ColleX'in hesabıdır; bağlayıcı değildir. Her süreyi dosyanızdaki tebliğ tarihinden ve ilgili maddeden doğrulayın."
```

**Not:** Ürünün kendi kuralı: hesaplanmış tarih gösteren her kart bu uyarıyı birebir taşır.

## [P0] eksik-aciklama — satir 12361

**Mevcut:**
```
d1.appendChild(el("div", "fieldlabel", "Açık süreler (" + (p.openDeadlines || []).length + ")"));
```

**Neden:** Duruşma hazırlığı kartı açık süreleri tarihleriyle ve "GECİKMİŞ — 4 gün" damgasıyla listeliyor, ama süre uyarısını taşımıyor. Duruşmaya giderken bakılan ekran budur; en çok güvenilecek yerde uyarı yok.

**Öneri:**
```
"Açık süreler" listesinin altına aynı uyarı satırını ekleyin: "Bu süreler ColleX'in hesabıdır; bağlayıcı değildir. Dosyanızdaki tebliğ tarihinden ve ilgili maddeden doğrulayın."
```

## [P0] jargon — satir 12411

**Mevcut:**
```
gecitAracSayisi: "Geçidin bildirdiği araç",
```

**Neden:** "Geçit" (gateway) ve "araç" (tool) yazılım terimleridir; bu satır avukat için hiçbir anlam taşımaz. Aynı sözlükteki 12407-12409 satırları da ("Kayıtlı araç", "Bağlanan araç", "Bağlanmayan araç") aynı sorunu taşır.

**Öneri:**
```
Satırı listeden tamamen çıkarın. 12407-12409 şöyle olmalı: kayitliArac → "Tanımlı kaynak sayısı", baglananArac → "Şu an ulaşılabilen kaynak", baglanmayanArac → "Şu an ulaşılamayan kaynak".
```

## [P0] jargon — satir 12414

**Mevcut:**
```
migrasyonUygulanan: "Uygulanan migrasyon",
```

**Neden:** "Migrasyon" bir veritabanı güncelleme adımıdır; avukatın bilmesi ne mümkün ne gereklidir. 12415 ("Beklenen migrasyon"), 12412 ("Yerel veritabanı") ve 12413 ("Veritabanı adı") de aynı biçimde okunamaz.

**Öneri:**
```
Bu dört satırı kaldırıp yerine tek satır koyun: "Kayıt deponuz güncel mi" → "güncel" ya da "güncelleme gerekiyor — ColleX'i kuran kişiye bildirin". Veritabanı adı ekranda hiç görünmesin.
```

## [P0] jargon — satir 12416

**Mevcut:**
```
yerelKorpus: "Yerel korpus belgesi",
```

**Neden:** "Korpus" kullanıcının açıkça anlamadığını söylediği sözcüklerden biri; "yerel" de burada "kendi bilgisayarınızdaki" demek istiyor ama söylemiyor.

**Öneri:**
```
"Bilgisayarınızda saklanan belge sayısı" yazın. 12417-12418 de sadeleşmeli: yerelKutuphaneAcik → "Kendi kitaplığınız", yerelKutuphaneBelge → "Kitaplığınızdaki belge sayısı".
```

## [P0] tanimsiz-terim — satir 12527

**Mevcut:**
```
det.appendChild(el("summary", null, "Araç envanteri (" + inv.length + " araç)"));
```

**Neden:** "Araç" burada bir yazılım eklentisini anlatıyor; avukat "araç" deyince başka bir şey anlar, "envanter" de bu bağlamda anlamsızdır. Başlık ne göreceğini söylemiyor.

**Öneri:**
```
"Hangi kaynaklara ulaşabiliyoruz (" + inv.length + " kaynak)" yazın ve açıldığında ilk satır olarak şunu koyun: "Aşağıdaki listede ColleX'in bağlanmayı denediği kaynaklar ve her birinin bugünkü durumu vardır."
```

**Not:** Kart başlığı 12537'de sadece "Araçlar"; o da "Kaynak bağlantıları" olmalı.

## [P0] jargon — satir 12531

**Mevcut:**
```
line.appendChild(el("span", "nm", t2.tool));
```

**Neden:** Burada search_bedesten_unified, get_mevzuat_content gibi yazılım fonksiyon adları listelenir. Avukat bu satırların hiçbirini okuyamaz ve neye baktığını anlamaz.

**Öneri:**
```
Makine adı yerine kaynağın Türkçe adını yazın ("Yargıtay kararları", "Mevzuat metinleri", "Rekabet Kurumu kararları"). Türkçe karşılığı olmayan satır listeye hiç girmesin; makine adı yalnızca "Teknik ayrıntı" başlığı altında görünsün.
```

## [P0] jargon — satir 12532

**Mevcut:**
```
line.appendChild(el("span", null, t2.state));
```

**Neden:** Bu alan sunucudan gelen makine kodunu (NOT_YET_WIRED gibi İngilizce büyük harfli değerler) olduğu gibi ekrana basar. Avukat için tamamen okunamaz; üstelik ürünün kendi kuralı "makine kodu tek başına avukatın önünde durmaz" der.

**Öneri:**
```
Kodu Türkçeye çevirerek yazın: NOT_YET_WIRED → "henüz bağlanmadı", diğerleri → "çalışıyor". Tanınmayan bir değer gelirse "durumu bilinmiyor" yazın, kodu değil.
```

**Not:** Aynı kart 12531'de aracın makine adını da basıyor.

## [P1] ui-kusuru — satir 11954

**Mevcut:**
```
card.appendChild(el("h3", "fname", cites.length + " atıf bulundu, denetlensin mi?"));
```

**Neden:** Başlık soru soruyor ama kartın içinde evet/hayır yok; onay düğmesi ("Denetimi çalıştır") kartın dışında ve tarih girilene kadar kapalı. Avukat soruya cevap verecek yeri arar, bulamaz.

**Öneri:**
```
Başlık: "Metinde 12 atıf bulundu". Altına: "Denetimi başlatmak için yukarıya dilekçenin tarihini girin, sonra 'Denetimi çalıştır'a basın." Tarih girilince aynı karta bir "Denetimi çalıştır" düğmesi eklenmeli.
```

## [P1] jargon — satir 11959

**Mevcut:**
```
cites.forEach(function (c) { ul.appendChild(el("li", null, c.raw + (c.count > 1 ? " (" + c.count + "×)" : ""))); });
```

**Neden:** "(3×)" matematik gösterimidir; listede ne anlama geldiği yazmıyor.

**Öneri:**
```
" — metinde 3 kez geçiyor" yazın.
```

## [P1] anlasilmaz-cumle — satir 11961

**Mevcut:**
```
card.appendChild(el("p", "note-p", "Denetim için dilekçenin tarihi zorunludur: her satırın yürürlüğü O TARİHE göre okunur, bugüne göre değil."));
```

**Neden:** "Her satırın yürürlüğü" belirsiz (tablodaki satır mı, kanun maddesi mi). Büyük harfle "O TARİHE" bağırma etkisi yapar; cümle iki kavramı tek nefeste veriyor.

**Öneri:**
```
"Dilekçenizin tarihini girin. Her atfı bugüne göre değil, dilekçenin yazıldığı tarihe göre değerlendiririz; o gün yürürlükte olan metin esas alınır."
```

## [P1] jargon — satir 12009

**Mevcut:**
```
document.getElementById("denetim-timing").textContent = (Date.now() - t0) + " ms";
```

**Neden:** "4312 ms" avukata hiçbir şey söylemez; milisaniye mühendis birimidir.

**Öneri:**
```
Saniyeye çevirip yazın: "4,3 saniyede tamamlandı". Bir saniyenin altındaysa "1 saniyeden kısa sürdü".
```

## [P1] ton — satir 12045

**Mevcut:**
```
head.appendChild(chip("kural tabanlı · yapay zekâ kullanılmadı", "mute"));
```

**Neden:** "Kural tabanlı" mühendis ifadesidir; avukata bir şey anlatmaz. Söylenmek istenen şey doğru ama yanlış dille söylenmiş.

**Öneri:**
```
"yapay zekâ kullanılmadı — metin karşılaştırmasıyla üretildi"
```

## [P1] tanimsiz-terim — satir 12074

**Mevcut:**
```
["Atıf", "Durum", "Künye", "Yürürlük — " + fmtDateTR(body.asOf) + " tarihine göre", "Alıntı", "Aleyhe kayıt", "Eylem"].forEach(function (h) {
```

**Neden:** "Aleyhe kayıt" tanımsız: neyin, kimin aleyhine belli değil. "Eylem" bir hukuk terimi gibi duruyor ama içinde bağlantı ve inceleme durumu var. "Alıntı" sütununun neyi gösterdiği de yazmıyor.

**Öneri:**
```
Başlıklar: "Atıf", "Durum", "Künye", "Yürürlük — <tarih> tarihine göre", "Alıntı aynı mı", "Aksi yönde karar", "Yapılacak". Tablonun üstüne tek satır: "Aksi yönde karar sütunu, aynı konuda ters yönde bulduğumuz kararları gösterir."
```

## [P1] ui-kusuru — satir 12124

**Mevcut:**
```
var ul = el("ul", "audnotices");
```

**Neden:** "Bu raporu nasıl okumalı" kartı tamamen sunucudan gelen notlarla doluyor; not gelmezse başlıklı boş bir kart kalır. Raporun nasıl okunacağı bu ekranın kendi sorumluluğudur.

**Öneri:**
```
Karta her zaman görünen üç sabit satır koyun: "Bulundu: atfın karşılığını taradığımız kaynaklarda gördük — doğru ya da yürürlükte olduğunu söylemiyoruz." / "Bulunamadı: taradığımız kaynaklarda karşılığı yok; atfı elden kontrol edin." / "Belirsiz: bu atıf taramadığımız bir yere ait; hakkında bir şey söyleyemiyoruz." Sunucudan gelen notlar bunların altına eklensin.
```

## [P1] ui-kusuru — satir 12145

**Mevcut:**
```
if (!r.kunye) { ck.title = "Künye çözümlenemedi — sistem künye uydurmaz."; }
```

**Neden:** Künye hücresi boş bırakılıyor (bu doğru bir karar) ama nedeni yalnızca fare ipucunda. Avukat boş hücreyi görüp "ekran bozuk" ya da "böyle bir karar yok" diye okur. "Çözümlenemedi" ve "sistem" de mühendis dili.

**Öneri:**
```
Hücreye soluk renkte görünür bir satır yazın: "künye okunamadı". Tablonun altına tek cümle koyun: "Künyesi okunamayan atıf için hücreyi boş bırakırız; ColleX künye uydurmaz."
```

## [P1] eksik-aciklama — satir 12167

**Mevcut:**
```
: "incelenmedi"));
```

**Neden:** "incelenmedi" ne demektir, kim inceleyecektir, nereden incelenmiş sayılır — hiçbiri yazmıyor ve ekranda inceleme yapılabilecek bir düğme de yok. Avukat kendisinden bir şey beklendiğini anlar ama ne olduğunu bilemez.

**Öneri:**
```
"siz onaylamadınız" yazın ve yanına "Okudum, doğru" düğmesi koyun. Düğme konulamıyorsa satır hiç görünmesin — yapılamayacak bir eksiklik bildirmek avukatı boşuna telaşlandırır.
```

## [P1] anlasilmaz-cumle — satir 12263

**Mevcut:**
```
[["hearing", "Duruşma / keşif"], ["late", "Gecikmiş süre"], ["soon", "7 gün ve altı"], ["plain", "Diğer süreler"]].forEach(function (p) {
```

**Neden:** "7 gün ve altı" bir cümle değil, neyin 7 günü olduğu yazmıyor. "Diğer süreler" de neyi kapsadığını söylemiyor.

**Öneri:**
```
"Duruşma ve keşif", "Süresi geçmiş", "7 gün içinde doluyor", "Daha ileri tarihli süreler".
```

## [P1] ui-kusuru — satir 12307

**Mevcut:**
```
row.appendChild(ghostBtn(it.type === "hearing" ? "Duruşma hazırlığı" : "Aç", function () { showTakvimDetail(it); }, "small"));
```

**Neden:** "Aç" düğmesi ne açacağını söylemiyor; avukat dosyanın açılacağını sanır, oysa aynı sayfada küçük bir ayrıntı kartı açılıyor. Buton etiketi ne olacağını söylemeli.

**Öneri:**
```
"Süreyi göster" yazın; duruşmalarda "Duruşma hazırlığını göster".
```

## [P1] tanimsiz-terim — satir 12405

**Mevcut:**
```
var MANIFEST_STATE_TR = { acik: ["Açık", "ok"], kapali: ["Kapalı", "mute"], bilinmiyor: ["Bilinmiyor", "mute"] };
```

**Neden:** Bir kaynak için "Açık" / "Kapalı" ne demektir belli değil: kaynak herkese açık mı, biz mi ulaşabiliyoruz, ücretli mi? Ayrıca "Kapalı" ve "Bilinmiyor" aynı sönük renkte; oysa ikisi farklı şeylerdir.

**Öneri:**
```
"Ulaşabiliyoruz" / "Ulaşamıyoruz" / "Denenmedi" yazın ve üçünü ayrı renklerle gösterin. Sütun başlığının altına: "Bu sütun, ColleX'in o kaynağa bugün bağlanıp bağlanamadığını gösterir."
```

## [P1] anlasilmaz-cumle — satir 12453

**Mevcut:**
```
sn.appendChild(el("b", null, "Bütün kaynaklar için geçerli"));
```

**Neden:** Kalın yazılan bu ibare tek başına bir cümle değil; altındaki notun ne olduğunu ve neden hepsi için geçerli olduğunu söylemiyor. Avukat bunun bir uyarı mı açıklama mı olduğunu anlayamaz.

**Öneri:**
```
"Aşağıdaki kaynakların hepsi için aynı durum geçerli:" yazın; notun kendisi hemen ardından gelsin.
```

## [P1] eksik-aciklama — satir 12475

**Mevcut:**
```
tr.appendChild(el("td", null, s.sonErisim ? fmtDateTimeTR(s.sonErisim) : "ölçülmedi"));
```

**Neden:** "Son erişim" ve "ölçülmedi" mühendis dilidir; avukat bu tarihin ne anlama geldiğini (o kaynağa en son ne zaman bakıldığını mı, kaynağın en son ne zaman güncellendiğini mi) çıkaramaz.

**Öneri:**
```
Sütun başlığı "En son ne zaman bağlandık", boş değer "hiç denenmedi" olmalı.
```

## [P1] ui-kusuru — satir 12489

**Mevcut:**
```
(m.bilinenBosluklar || []).forEach(function (g) {
```

**Neden:** Liste boş gelirse "Bilinen boşluklar" başlıklı bomboş bir kart kalır; avukat kartın yüklenmediğini sanar. Başlık da belirsiz: neyin boşluğu?

**Öneri:**
```
Başlığı "Nerelere bakamıyoruz" yapın. Liste boşsa şunu yazın: "Bugün bilinen bir eksik yok. Bu, her kaynağa ulaşabildiğimiz anlamına gelmez; yukarıdaki listede ulaşılamayan kaynakları görün."
```

**Not:** Aynı boş-durum eksikliği "Bu raporu nasıl okumalı" listesinde de var.

## [P1] tanimsiz-terim — satir 12498

**Mevcut:**
```
nc.appendChild(el("h3", "fname", "Ölçülen sayılar"));
```

**Neden:** Başlık neyin sayısı olduğunu söylemiyor; altındaki satırlar da teknik. Avukat bu kartın kendisine ne söylediğini anlamaz.

**Öneri:**
```
"ColleX'in elindeki kaynaklar, sayılarla" yazın ve tek satırlık amaç cümlesi ekleyin: "Bir soruya cevap ararken hangi kaynaklara bakabildiğimizi buradan görebilirsiniz."
```

## [P1] ton — satir 12499

**Mevcut:**
```
nc.appendChild(el("p", "note-p", "Ölçülmemiş her alan “ölçülmedi” der; sıfır yazılmaz."));
```

**Neden:** Bu cümle ürünün iç kuralını anlatıyor, avukatın işini değil. "Alan", "ölçülmemiş" ve "sıfır yazılmaz" mühendis dili.

**Öneri:**
```
"Bilmediğimiz bir sayıyı tahmin etmeyiz: ölçemediğimiz satırlarda 'bilinmiyor' yazar, sıfır değil."
```

## [P2] eksik-aciklama — satir 12273

**Mevcut:**
```
count.textContent = items.length ? items.length + " kayıt" : "kayıt yok";
```

**Neden:** "Kayıt" neyin kaydı belli değil; kart başlığı da "Bu penceredeki kayıtlar" diyor ("pencere" burada seçili ay demek isteniyor ama öyle okunmuyor). Ayrıca boş ay uyarı renginde gösteriliyor; boş bir ay sorun değildir.

**Öneri:**
```
"12 süre ve duruşma" / "bu ayda kayıt yok" yazın, boş ayda uyarı rengi kullanmayın. Kart başlığı: "Bu aydaki süreler ve duruşmalar".
```

## [P2] eksik-aciklama — satir 12303

**Mevcut:**
```
left === null ? "tarih yok" : left < 0 ? "geçti" : left === 0 ? "BUGÜN" : left + " gün kaldı"));
```

**Neden:** Bir duruşma için "geçti" damgası, duruşmanın yapılıp yapılmadığını söylemiyor; ertelenmiş bir duruşma da aynı damgayı alır. "tarih yok" da avukata ne yapacağını söylemiyor.

**Öneri:**
```
Geçmiş duruşmalarda kaydın durumunu yazın: "yapıldı" / "ertelendi" / "sonucu girilmedi". Tarihi olmayan kayıt için "duruşma tarihi girilmemiş" yazın.
```

**Not:** HEARING_STATUS_TR (12220) zaten var; bu satırda kullanılmıyor.

## [P2] eksik-aciklama — satir 12353

**Mevcut:**
```
metaRow(meta, "Kalan", typeof h.daysLeft === "number"
```

**Neden:** "Kalan" tek başına neyin kaldığını söylemiyor; değer yoksa yalnız bir tire kalıyor ve avukat tarihin girilmediğini mi hesabın yapılamadığını mı anlayamıyor.

**Öneri:**
```
Etiket "Duruşmaya kalan süre" olsun; değer yoksa "-" yerine "duruşma tarihi kayıtlı değil" yazın.
```

**Not:** Aynı ekranda "Mahkeme" (12351) ve "Salon" (12352) için de "-" yerine "kayıtlı değil" yazılmalı.

## [P2] eksik-aciklama — satir 12376

**Mevcut:**
```
(p.recentFiles || []).slice(0, 3).forEach(function (f) {
```

**Neden:** Dosyada beş belge varsa üçü sessizce gösterilir; "Son belgeler" başlığı bunun bir seçki olduğunu söylemez. Avukat dosyada yalnız üç belge olduğunu sanabilir.

**Öneri:**
```
Başlığı "En son eklenen 3 belge" yapın ve listenin altına "Dosyadaki bütün belgeler" bağlantısı koyun.
```

## [P2] anlasilmaz-cumle — satir 12384

**Mevcut:**
```
if (!(p.chronology || []).length) { emptyLine(d3, "Zaman çizelgesinde olay yok."); }
```

**Neden:** Başlık "Dosya kronolojisi", boş durum "zaman çizelgesi" diyor: aynı şey iki farklı adla anılıyor. Ayrıca ne yapması gerektiğini söylemiyor.

**Öneri:**
```
"Bu dosyada kayıtlı bir olay yok. Dosya sayfasından tebligat, duruşma ya da dilekçe tarihi ekleyerek kronolojiyi oluşturabilirsiniz."
```

## [P2] jargon — satir 12396

**Mevcut:**
```
var ics = el("a", "dl", "Bu dosyanın takvimi (.ics)");
```

**Neden:** ".ics" bir dosya uzantısıdır; avukat ne olduğunu ve tıklayınca ne olacağını bilmez.

**Öneri:**
```
"Bu dosyanın duruşma ve sürelerini takvimime aktar" yazın; altına küçük satır: "Outlook ya da Google Takvim'de açılır. Sonradan eklenen süreler için yeniden aktarın."
```

## [P2] ui-kusuru — satir 12512

**Mevcut:**
```
else if (typeof v === "string" && v) { text = DB_STATE_TR[v] || v; none = false; }
```

**Neden:** Tanınmayan bir değer gelirse makine kodu (ör. "degraded") olduğu gibi ekrana basılır. Aynı kusur 12468'de kaynak ailesi için de var: karşılığı yoksa ham kod yazılıyor.

**Öneri:**
```
Tanınmayan değerde "bilinmiyor" yazın; ham kod yalnızca kapalı "Teknik ayrıntı" bölümünde görünsün.
```
