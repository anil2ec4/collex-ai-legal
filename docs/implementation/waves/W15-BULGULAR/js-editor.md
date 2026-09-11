# js-editor

Bu bölge (6300-7300) taslak editörünün kalbi: sol bölüm listesi, ortadaki paragraf düzenleyici ve canlı uyarılar, sağdaki kanıt bölmesi, alıntı ekleme penceresi, Bulut AI paragraf penceresi, kaydetme/sürüm/dışa aktarma. Ürünün mantığı sağlam ama dili büyük ölçüde mühendis dili: ekranda "SHA-256", "sunucu", "veritabanı", "oturum", "entailment", "eşik", "skor", "ms", ham 12 haneli özet dizesi ve model kimliği görünüyor; bunların hiçbiri avukatın sözlüğünde yok. İkinci büyük sorun uydurulmuş terimlerin tanımsız kalması: "KAYNAKSIZ", "SENTETİK", "alaka kapısı", "kanıt bağı", "kanıt kümesi" ekranda hiçbir yerde açıklanmıyor; tek açıklama fare üzerine gelince çıkan gizli baloncukta duruyor, yani pratikte hiç okunmuyor. Üçüncüsü, birkaç düğme ne yapacağını söylemiyor ya da yanlış söylüyor: "Araştırmadan kanıt ekle" aslında kanıt eklemiyor, "Sil" onaysız ve geri alınamaz biçimde paragrafı yok ediyor, "KAYNAKSIZ olarak bırak" bağlı dayanakları sessizce siliyor. Teknik doğruluk kaybedilmeden bunların hepsi avukat Türkçesine çevrilebilir: ürünün gerçekten yaptığı şey "alıntının bozulmadığını otomatik denetlemek" ve "dayanağı olmayan cümleyi işaretlemek"tir; bunu anlatmak için tek bir teknik sözcüğe gerek yoktur. Aşağıdaki 32 bulgu önem sırasındadır.

Bulgu: 35

## [P0] tanimsiz-terim — satir 6338

**Mevcut:**
```
k.textContent = "KAYNAKSIZ: " + n;
```

**Neden:** Üst çubuktaki bu sayaç belgenin en önemli göstergesi ama neyi saydığını söylemiyor; "KAYNAKSIZ: 3" avukata hiçbir şey ifade etmez.

**Öneri:**
```
k.textContent = n === 0 ? "Dayanaksız paragraf yok" : "Dayanağı olmayan paragraf: " + n;
```

**Not:** Sıfır hâli de olumlu bir cümleyle söylenmeli; boş damga bilgi vermez.

## [P0] tanimsiz-terim — satir 6386

**Mevcut:**
```
if (d.synthetic === true) { line1.appendChild(chip("SENTETİK kanıt", "abstain")); }
```

**Neden:** "SENTETİK" tanımsız bir damgadır; avukat bunun "bu kanıtlar gerçek mevzuat/karar değil, deneme verisidir" demek olduğunu çıkaramaz. Yanlış anlaşılırsa gerçek dosyada kullanılır.

**Öneri:**
```
if (d.synthetic === true) { line1.appendChild(chip("Deneme verisi — gerçek karar/mevzuat değildir, dosyada kullanmayın", "abstain")); }
```

**Not:** Bu damga kısaltılamaz; kısaltılırsa uyarı işlevini yitirir.

## [P0] jargon — satir 6438

**Mevcut:**
```
ic.appendChild(el("div", "fieldlabel", "Kayıt uyarıları (" + editor.issues.length + ") — sunucu yeniden doğruladı"));
```

**Neden:** "Sunucu" yasak sözcük; ayrıca "kayıt uyarıları" avukata bunların ciddi mi önemsiz mi olduğunu söylemiyor.

**Öneri:**
```
ic.appendChild(el("div", "fieldlabel", "Kaydederken çıkan uyarılar (" + editor.issues.length + ") — her dayanak yeniden denetlendi, aşağıdakiler taslağa yazılmadı"));
```

## [P0] jargon — satir 6490

**Mevcut:**
```
"Bu taslak makine üretimidir; avukat incelemesi zorunludur. Kaydet sonrasında sunucu her atıfı yeniden doğrular; birebir alıntısı bulunmayan atıf yazılmaz."));
```

**Neden:** "Sunucu" avukatın bilmediği bir sözcüktür ve burada gereksizdir; kimin doğruladığı değil, ne olduğu önemlidir.

**Öneri:**
```
"Bu taslağı program üretti; avukat incelemesi zorunludur. Kaydettiğinizde her dayanak yeniden denetlenir: alıntısı metinde birebir bulunmayan dayanak belgeye yazılmaz."));
```

**Not:** Aynı düzeltme 6438, 6890, 7018 ve 7072. satırlar için de geçerli.

## [P0] jargon — satir 6516

**Mevcut:**
```
Makine üretimi, salt okunur — her kayıtta yeniden üretilir; özetler (SHA-256) yalnız burada.
```

**Neden:** SHA-256 ve "özet" bilgisayar terimleridir; "salt okunur" da avukatın günlük dilinde yoktur. Cümle ayrıca bu bölümün ne işe yaradığını hiç söylemiyor.

**Öneri:**
```
Bu bölümü program kendisi yazar, elle değiştirilemez ve her kayıtta yeniden üretilir. İçinde her alıntının denetim kaydı bulunur: alıntının kaynağındaki metinden bir harf bile değişmediği bu kayıtla sonradan denetlenebilir.
```

**Not:** Teknik içerik korunuyor; yalnız "SHA-256/özet" yerine ne işe yaradığı yazılıyor.

## [P0] tanimsiz-terim — satir 6562

**Mevcut:**
```
var badge = defineTerm(el("span", "kaynaksiz", "⚠ KAYNAKSIZ"), "KAYNAKSIZ");
```

**Neden:** "KAYNAKSIZ" uydurulmuş bir damgadır ve ekranda tanımı yoktur; tek açıklama fareyle üzerine gelince çıkan gizli baloncuktadır. Avukat büyük harfli kırmızı bir uyarı görür, ne yapması gerektiğini anlamaz.

**Öneri:**
```
var badge = el("span", "kaynaksiz", "⚠ Dayanağı yok — alıntı ekleyin");
```

**Not:** Damganın kısa tanımı fare baloncuğunda değil, paragrafın altında görünür bir satır olarak da durmalı.

## [P0] ui-kusuru — satir 6620

**Mevcut:**
```
tools.appendChild(ghostBtn("Sil", function () {
```

**Neden:** Paragraf tek tıkla, onay sorulmadan siliniyor ve geri alma yok. Üstelik düğme "Yukarı/Aşağı" düğmelerinin hemen yanında; yanlış tık kaçınılmaz. Uzun bir hukukî değerlendirme paragrafı bir anda yok olabilir.

**Öneri:**
```
Düğme "Paragrafı sil" olmalı ve tıklandığında metnin ilk 60 karakteri gösterilerek onay sorulmalı: "Bu paragrafı silmek istiyor musunuz? Geri alınamaz. — '…'". Düğme diğerlerinden boşlukla ayrılmalı ve en sağda durmalı.
```

## [P0] jargon — satir 6810

**Mevcut:**
```
if (e.quoteSha256) { metaRow(meta, "Alıntı özeti", shortHash(e.quoteSha256)); }
```

**Neden:** Kanıt kartının künyesinde "Alıntı özeti: 3f2a9c1b04d7…" gibi anlamsız bir dizi görünüyor. Avukat bunu okuyunca ne yapacağını bilmez; ekranın ciddiyetini de düşürür.

**Öneri:**
```
if (e.quoteSha256) { metaRow(meta, "Alıntı denetimi", "Bu alıntının kaynağındaki metinle birebir aynı olduğu otomatik denetlenir"); }
```

**Not:** Ham dize istenirse "Teknik ayrıntılar" başlıklı kapalı bir bölüme taşınmalı, künyede durmamalı.

## [P0] jargon — satir 7051

**Mevcut:**
```
toast("Taslak veritabanına YAZILAMADI (v" + (fresh.version || "?") + ") — bu oturumda açık, yeniden başlatınca kaybolur; DOCX indirin.", "bad");
```

**Neden:** "Veritabanı" ve "oturum" avukatın bilmediği sözcükler; üstelik bu, işin kaybedilebileceğini söyleyen en kritik uyarı. Anlaşılmazsa avukat belgesini kaybeder.

**Öneri:**
```
toast("Taslak bu bilgisayara KAYDEDİLEMEDİ (v" + (fresh.version || "?") + "). Metin şu an ekranda duruyor, ama programı kapatırsanız kaybolur. Şimdi \"Word belgesi\" ile bilgisayarınıza indirin.", "bad");
```

**Not:** "DOCX" yerine "Word belgesi" demek gerekir; aşağıda ayrı bulgu var.

## [P0] jargon — satir 7088

**Mevcut:**
```
"Model tek paragraf yazar; her atıf ayrı bir anlamsal doğrulama (entailment) hakemiyle sınanır, %85 altı atıf atılır, hiçbiri kalmazsa paragraf KAYNAKSIZ olur. Sonuç taslağın yeni sürümüne yazılır."));
```

**Neden:** "entailment", "hakem", "%85 eşik" ve "model" bir arada; avukat için tek bir anlaşılır sözcük yok. Üstelik bu, dışarıya veri gönderilen ekranın açıklamasıdır — anlaşılmadan onay verilmemeli.

**Öneri:**
```
"Yapay zekâ tek bir paragraf yazar. Yazdığı her cümle, dayandığı alıntıyla gerçekten örtüşüyor mu diye ayrıca denetlenir; örtüşmeyen dayanaklar paragraftan çıkarılır. Hiçbiri kalmazsa paragraf \"dayanağı yok\" işaretiyle durur ve dayanağını sizin eklemeniz gerekir. Sonuç taslağın yeni sürümüne yazılır."));
```

**Not:** Yüzde eşiği kullanıcıya sayı olarak söylenmemeli; "denetlenir/çıkarılır" doğru ve yeterlidir.

## [P0] jargon — satir 7148

**Mevcut:**
```
st.textContent = (Date.now() - started) + " ms";
```

**Neden:** Yapay zekâ paragrafı yazıldıktan sonra ekranda "4821 ms" yazıyor. Avukat için bu ne bilgi ne de sonuç; ekranın mühendis paneli gibi görünmesine yol açar.

**Öneri:**
```
st.textContent = "Paragraf yazıldı (" + Math.round((Date.now() - started) / 1000) + " sn sürdü)";
```

**Not:** Aynı kalıp bölgenin dışında da tekrarlıyor (7383, 10041, 10103, 10429, 10562, 10688, 11442, 12009, 12610, 12831) — tek bir yardımcı işlevle düzeltilmeli.

## [P0] jargon — satir 7169

**Mevcut:**
```
" Eşik ≥%" + Math.round((r.threshold || 0.85) * 100) + " · model " + (r.model || "?") + " · canlı sınanmadı."));
```

**Neden:** "Eşik", ham model kimliği (claude-…) ve tanımsız "canlı sınanmadı" ifadesi yan yana. Avukat ne karar verebilir ne de neye güvenip güvenmeyeceğini anlar.

**Öneri:**
```
" Program her dayanağı ayrıca denetledi; denetimi geçmeyen dayanaklar paragraftan çıkarıldı. Bu bulut yapay zekâ özelliği gerçek kullanımda hiç sınanmadı — çıkan metni satır satır okuyun."));
```

**Not:** Model kimliği isteniyorsa kapalı bir "Teknik ayrıntılar" bölümüne konmalı.

## [P1] eksik-aciklama — satir 6378

**Mevcut:**
```
var kchip = defineTerm(chip("KAYNAKSIZ: 0", "ok"), "KAYNAKSIZ");
```

**Neden:** Bu ekranın bütün özel terimleri (KAYNAKSIZ, K-n, sürüm, deneysel) yalnızca defineTerm ile gizli fare baloncuğuna konmuş. Baloncuk dokunmatik ekranda hiç çıkmaz, klavyeyle gezen kullanıcıya ulaşmaz ve kimse fareyi rastgele bekletmez — yani tanımlar pratikte yok.

**Öneri:**
```
Editörün üst çubuğunun altına, ilk açılışta açık gelen tek satırlık bir "Bu ekrandaki işaretler ne demek?" bölümü eklenmeli: dayanağı yok, K-1/K-2 numaraları, sürüm ve deneysel etiketleri burada birer cümleyle açıklanmalı; kullanıcı kapatabilmeli.
```

**Not:** Tanımların ekranda görünür olması, terimleri değiştirmekten daha önemlidir.

## [P1] jargon — satir 6399

**Mevcut:**
```
var md = el("a", "dl alt", "Markdown");
```

**Neden:** "Markdown" bir yazılımcı dosya biçimidir; avukat ne olduğunu bilmez, tıklamaz ya da tıklayıp açamadığı bir dosya indirir.

**Öneri:**
```
var md = el("a", "dl alt", "Düz metin (yedek kopya)");
```

**Not:** 6396. satırdaki "DOCX" da "Word belgesi" olmalı; UDF etiketi kalabilir, çünkü UYAP biçimidir ve avukat tanır.

## [P1] ui-kusuru — satir 6470

**Mevcut:**
```
var legend = el("p", "olegend", "● yeşil: KAYNAKSIZ yok · ● kırmızı: KAYNAKSIZ var · ● sarı: karşı içtihat");
```

**Neden:** Hem tanımsız terim kullanıyor hem de bölüm durumu SADECE renkle anlatılıyor: renk körü bir kullanıcı ya da düşük kontrastlı ekranda hiçbir şey ayırt edilemez, noktaların yanında yazı yok.

**Öneri:**
```
var legend = el("p", "olegend", "Bölüm işaretleri — yeşil ●: her paragrafın dayanağı var · kırmızı ●: dayanağı olmayan paragraf var · sarı ●: talebin aksi yönündeki kararlar bölümü");
```

**Not:** Ayrıca 6459. satırdaki noktaya metin karşılığı (aria-label) eklenmeli.

## [P1] jargon — satir 6566

**Mevcut:**
```
head.appendChild(chip("AI paragrafı — anlamsal bağ %" + Math.round((p.binding.score || 0) * 100) + "; metni değiştirirseniz bağ yeniden birebir alıntıyla sınanır", "warn"));
```

**Neden:** "Anlamsal bağ %87" bir avukata hiçbir şey söylemez; üstelik damganın içine sığmayacak kadar uzun bir cümle konmuş, satır taşıyor.

**Öneri:**
```
head.appendChild(chip("Yapay zekânın yazdığı paragraf — metnini değiştirirseniz dayanağı yeniden denetlenir", "warn"));
```

**Not:** Uyum bilgisi gerekiyorsa damgada değil, paragrafın altındaki açıklama satırında sözel olarak verilmeli.

## [P1] ui-kusuru — satir 6602

**Mevcut:**
```
tools.appendChild(ghostBtn("KAYNAKSIZ olarak bırak", function () {
```

**Neden:** Etiket ne olacağını söylemiyor; üstelik tıklayınca paragrafa bağlı bütün dayanaklar sessizce siliniyor. Avukat sadece bir işaret koyduğunu sanır, oysa bağları koparmış olur.

**Öneri:**
```
tools.appendChild(ghostBtn("Dayanaksız bırak (bağlı alıntıları çıkarır)", function () {
```

**Not:** Tıklamadan sonra kısa bir bilgi mesajı da verilmeli: "Bu paragrafın dayanakları çıkarıldı; belgede 'dayanağı yok' olarak işaretlenecek."

## [P1] jargon — satir 6637

**Mevcut:**
```
var field = { evidenceIds: "kanıt atıfları", role: "paragraf rolü", text: "metin", binding: "kanıt bağı", id: "kimlik" }[m[3]];
```

**Neden:** Uyarı listesinde "kimlik" ve "kanıt bağı" gibi karşılıklar görünüyor; ikisi de avukat sözlüğünde yok ve hangi alandan söz edildiğini anlatmıyor.

**Öneri:**
```
var field = { evidenceIds: "bağlı alıntılar", role: "paragrafın türü", text: "paragraf metni", binding: "paragraf-alıntı ilişkisi", id: "paragraf numarası" }[m[3]];
```

## [P1] tanimsiz-terim — satir 6672

**Mevcut:**
```
? "kanıt bağı koptu — alıntı metinle örtüşmüyor (geri alın ya da KAYNAKSIZ bırakın)"
```

**Neden:** "Kanıt bağı" tanımsız; "geri alın" diyor ama ekranda geri alma düğmesi yok — avukata olmayan bir çözüm gösteriliyor.

**Öneri:**
```
? "Bu paragraf artık dayandığı alıntıyla örtüşmüyor. Alıntıyı eski hâline getirin ya da bu paragrafı dayanaksız bırakın; aksi hâlde kaydederken dayanak belgeye yazılmaz."
```

**Not:** "Geri alın" ifadesi ancak gerçek bir geri alma düğmesi eklenirse kullanılabilir.

## [P1] jargon — satir 6694

**Mevcut:**
```
panel.appendChild(el("p", "note-p", "Seçilen kanıtın etiketi ve alıntısı paragrafın sonuna birebir eklenir; kanıt kimliği paragrafa bağlanır. " +
```

**Neden:** "Kimlik" yasak listede; ayrıca cümle avukatın metninin sonuna bir şey ekleneceğini yeterince açık söylemiyor — sürpriz bir metin değişikliğidir.

**Öneri:**
```
panel.appendChild(el("p", "note-p", "Seçtiğiniz kaynağın künyesi ve alıntısı, paragrafın sonuna değiştirilmeden eklenir; paragraf bundan sonra o kaynağa dayanmış sayılır. Eklenen alıntıyı sonradan düzenlerseniz dayanak kopar. " +
```

## [P1] anlasilmaz-cumle — satir 6753

**Mevcut:**
```
? "Alaka kapısını geçen kanıt yok. Aşağıdaki kaynakların hepsi elendi; birini bilerek kullanabilirsiniz."
```

**Neden:** Hem "alaka kapısı" tanımsız hem de "birini bilerek kullanabilirsiniz" ne yapılacağını söylemiyor; "bilerek" sözcüğü suçlayıcı bir ton taşıyor.

**Öneri:**
```
? "Bu paragrafa doğrudan uyan kaynak bulunamadı. Aşağıdaki kaynakları program bu belgeyle ilgisiz buldu; yine de dayanak yapmak isterseniz kartın altındaki kutuyu işaretleyin."
```

## [P1] tanimsiz-terim — satir 6757

**Mevcut:**
```
list.appendChild(el("div", "fieldlabel", "Alaka kapısının elediği kaynaklar (" + pickGated.length + ")"));
```

**Neden:** "Alaka kapısı" uydurulmuş bir mühendis metaforudur; ekranda hiçbir yerde tanımı yoktur. Avukat "kapı"nın ne olduğunu bilmez.

**Öneri:**
```
list.appendChild(el("div", "fieldlabel", "Program tarafından ilgisiz bulunan kaynaklar (" + pickGated.length + ")"));
```

**Not:** Aynı metafor 6753, 6836 ve sağ bölmedeki açıklamalarda tekrarlıyor.

## [P1] eksik-aciklama — satir 6820

**Mevcut:**
```
tog.title = e.direction === "karşıt"
```

**Neden:** Kutu kapalı ve tıklanamaz hâlde duruyor, nedeni yalnızca fare üzerine gelince çıkan gizli baloncukta. Avukat kutunun neden çalışmadığını göremez; ekranın bozuk olduğunu düşünür.

**Öneri:**
```
Neden kartın üzerine görünür bir satır olarak yazılmalı: kilitli kutunun hemen altında "Bu kaynak dayanak yapılamaz: talebin aksi yönünde bir karardır; karşı içtihat bölümünde kalır." ya da "Bu kaynak dayanak yapılamaz: yüklediğiniz bir belgedir; DELİLLER bölümünde Ek olarak kalır."
```

**Not:** Fare baloncuğu yedek olarak kalabilir ama tek anlatım yolu olamaz.

## [P1] ui-kusuru — satir 6858

**Mevcut:**
```
foot.appendChild(ghostBtn("Araştırmadan kanıt ekle", function () { openAddEvidenceModal("run"); }));
```

**Neden:** Düğme "kanıt ekle" diyor ama hiçbir şey eklemiyor: açılan pencere kaynak listesinin sabit olduğunu söyleyip taslağı baştan üretmeye yönlendiriyor. Etiketin vaat ettiği iş yapılmıyor; bu, kullanıcıyı yanıltan bir düğmedir.

**Öneri:**
```
foot.appendChild(ghostBtn("Yeni kaynakla taslağı yeniden üret (araştırmadan)", function () { openAddEvidenceModal("run"); }));
```

**Not:** 6859. satırdaki "Belgeden kanıt ekle" için de aynısı: "Yeni kaynakla taslağı yeniden üret (yüklediğim belgelerden)".

## [P1] jargon — satir 6890

**Mevcut:**
```
"Bir taslağın kanıt kümesi oluşturulurken sabitlenir ve düzenlemeyle genişletilemez; sunucu her atıfı bu küme içinde doğrular. " +
```

**Neden:** "Kanıt kümesi", "sabitlenir", "sunucu" — üç ayrı mühendis ifadesi tek cümlede. Avukat neden kanıt ekleyemediğini anlamıyor.

**Öneri:**
```
"Bir taslağın dayanacağı kaynaklar, taslak üretilirken belirlenir ve sonradan düzenlemeyle genişletilemez; program her dayanağı yalnız bu kaynaklar arasında denetler. Yeni kaynak eklemek için taslağı yeniden üretmeniz gerekir. " +
```

## [P1] jargon — satir 7018

**Mevcut:**
```
e409.appendChild(el("strong", null, "Kaydedilemedi — taslak siz düzenlerken değişti" + (cur ? " (sunucudaki sürüm v" + cur + ", sizinki v" + d.version + ")" : "")));
```

**Neden:** "Sunucudaki sürüm" avukat için anlamsız; iki numaranın karşılaştırılması da ne yapması gerektiğini söylemiyor.

**Öneri:**
```
e409.appendChild(el("strong", null, "Kaydedilemedi — bu taslak siz üzerinde çalışırken başka bir yerden değiştirildi" + (cur ? " (kayıtlı olan v" + cur + ", sizin çalıştığınız v" + d.version + ")" : "")));
```

## [P1] jargon — satir 7072

**Mevcut:**
```
panel.appendChild(el("p", "note-p", "Her Kaydet yeni bir sürüm üretir. Editörde en son sürüm (v" + latest.version + ") açıktır; sunucu yalnız en son sürümün metnini döndürdüğü için eski sürümler burada künyeleriyle listelenir."));
```

**Neden:** "Sunucu … döndürdüğü için" mühendis anlatımıdır; avukat açısından önemli olan tek şey "eski sürümlerin metnine buradan bakılamaz" bilgisidir ve o da açıkça söylenmiyor.

**Öneri:**
```
panel.appendChild(el("p", "note-p", "Her Kaydet işlemi yeni bir sürüm oluşturur ve eski sürümler silinmez. Ekranda açık olan en son sürümdür (v" + latest.version + "). Eski sürümlerin metni bu pencerede gösterilemez; aşağıda yalnız tarihleri ve künyeleri listelenir."));
```

## [P1] eksik-aciklama — satir 7114

**Mevcut:**
```
evWrap.appendChild(el("label", "lab", "Kanıtlar (en fazla 12)"));
```

**Neden:** 12'den fazla kutu işaretlenirse program sessizce ilk 12'sini alıyor; avukat hangilerinin gönderilmediğini hiç öğrenmiyor. Ayrıca bu kutuları işaretlemenin ne anlama geldiği yazmıyor.

**Öneri:**
```
evWrap.appendChild(el("label", "lab", "Yapay zekânın kullanacağı kaynaklar (en çok 12 tanesini seçin) — seçtiklerinizin metni Anthropic'e gönderilir"));
```

**Not:** 12'den fazla seçilirse gönderme engellenmeli ya da hangi kaynakların gönderilmediği açıkça söylenmeli; sessizce kesmek kabul edilemez.

## [P1] jargon — satir 7174

**Mevcut:**
```
if (rows.length) { var t = el("div", "scroll"); table(t, ["Kanıt", "Skor", "Sonuç", "Gerekçe"], rows); c.appendChild(t); }
```

**Neden:** "Skor" sütununda %87 gibi sayılar var; avukat bu sayının neye göre verildiğini bilmediği için karar veremez, sayıya gereğinden fazla güvenir.

**Öneri:**
```
if (rows.length) { var t = el("div", "scroll"); table(t, ["Kaynak", "Uyum", "Karar", "Açıklama"], rows); c.appendChild(t); }
```

**Not:** "Uyum" sütununda sayı yerine "yüksek / düşük" gibi sözel bir karşılık göstermek daha dürüst olur; sayı bir doğruluk ölçüsü değildir.

## [P2] eksik-aciklama — satir 6418

**Mevcut:**
```
var noteIn = textInput("", "Kayıt notu (isteğe bağlı) — uyarılara yazılır");
```

**Neden:** "Uyarılara yazılır" ne demek belirsiz; avukat notun nereye gideceğini, sonradan kimin göreceğini bilmiyor, bu yüzden alanı hiç kullanmıyor.

**Öneri:**
```
var noteIn = textInput("", "Bu kayıt için not (isteğe bağlı) — Sürümler listesinde bu sürümün yanında görünür");
```

**Not:** Not gerçekten sürüm listesinde görünmüyorsa metin, gerçekte nereye yazıldığını söylemeli.

## [P2] ui-kusuru — satir 6599

**Mevcut:**
```
var tools = el("div", "ptools");
```

**Neden:** Her paragrafın altına altı düğme yan yana diziliyor (Alıntı ekle · KAYNAKSIZ olarak bırak · Bu paragrafı yaz (Bulut AI) · Yukarı · Aşağı · Sil). Hiyerarşi yok: en sık kullanılan işle en tehlikeli iş aynı görünümde, dar ekranda alt alta yığılıyor ve paragraf metni kayboluyor.

**Öneri:**
```
Düğmeler ikiye ayrılmalı: solda içerik işleri (Alıntı ekle · Dayanaksız bırak · Yapay zekâya yazdır), sağda ve araya belirgin boşluk konarak düzen işleri (Yukarı · Aşağı · Paragrafı sil). Düzen işleri görsel olarak daha silik (ikincil) çizilmeli; "Paragrafı sil" tek başına en sağda durmalı.
```

## [P2] ton — satir 6614

**Mevcut:**
```
aiB.title = "Bu istek için talimat, seçili kanıtlar ve bu paragraf Anthropic'e gönderilir";
```

**Neden:** Ülke dışına veri gönderildiği bilgisi yalnızca gizli fare baloncuğunda duruyor. Bu, KVKK açısından avukatın görmesi gereken bir bilgidir ve görünmez bir yerde olamaz.

**Öneri:**
```
Düğmenin etiketi ne yaptığını söylemeli — "Bu paragrafı Bulut AI'ya yazdır (metin dışarı gönderilir)" — ayrıntı ise açılan pencerede zaten yazılı olduğu için baloncuk yedek kalabilir.
```

**Not:** "Bulut AI" adı proje kuralı gereği değiştirilemez; değişen tek şey açıklamanın görünür olmasıdır.

## [P2] ton — satir 6767

**Mevcut:**
```
var dir = e.direction || "yön belirtmez";
```

**Neden:** Kanıt kartında "Yönü: karşıt" yazıyor; bu bir veri alanının değerini okutuyor, kararın hukukî anlamını değil. Avukat dilinde bu "talebin aksi yönünde" demektir.

**Öneri:**
```
var dirTR = e.direction === "karşıt" ? "Talebin aksi yönünde" : e.direction === "destekleyen" ? "Talebi destekler" : "Yönü belirsiz";
```

**Not:** 6768. satırdaki chip çağrısı da "Yönü: " öneki olmadan bu metni kullanmalı.

## [P2] eksik-aciklama — satir 6777

**Mevcut:**
```
if (!uni.length) { emptyLine(right, "Bu taslağa kanıt bağlanmadı — her hukukî paragraf KAYNAKSIZ kalır."); }
```

**Neden:** Boş durum sorunu bildiriyor ama çözümü söylemiyor: avukat bu ekranda ne yapacağını bilmiyor.

**Öneri:**
```
if (!uni.length) { emptyLine(right, "Bu taslağa hiç kaynak bağlanmadı; bütün hukukî paragraflar dayanaksız kalacak. Kaynak eklemek için üst çubuktaki “Yeniden oluştur” ile taslağı bir araştırma ya da yüklediğiniz belgelerle yeniden üretin."); }
```

## [P2] eksik-aciklama — satir 6861

**Mevcut:**
```
right.appendChild(el("p", "olegend", "Kanıt kümesi taslak oluşturulurken sabitlenir; yeni kaynak “Yeniden oluştur” ile eklenir."));
```

**Neden:** "Kanıt kümesi" ve "sabitlenir" mühendis dilidir; ayrıca cümle sağ bölmenin en altında, iki düğmenin ardında duruyor — kullanıcı düğmelere basmadan önce okumuyor.

**Öneri:**
```
right.appendChild(el("p", "olegend", "Bu taslağın dayanacağı kaynaklar taslak üretilirken belirlendi. Listeye yeni kaynak eklemenin tek yolu taslağı “Yeniden oluştur” ile yeniden üretmektir."));
```

**Not:** Bu açıklama düğmelerin ALTINDA değil ÜSTÜNDE durmalı.
