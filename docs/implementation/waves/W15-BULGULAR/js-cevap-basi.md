# js-cevap-basi

Bu bölge cevabın avukat tarafından okunan yüzeyidir: durum damgası, defter satırları, çekimserlik paneli, kaynak kartları ve alıntı doğrulama satırları. Yapı iskeleti iyi düşünülmüş (uyarı bütçesi, katlanan kartlar, tek sefer yazılan sabit cümleler) ama ekrandaki SÖZCÜKLER hâlâ mühendis sözlüğünden geliyor: SHA-256, Unicode, JSON, "kanonik", "arama şeridi", "citator", "ham kod", ham İngilizce enum'lar (supporting / AFFIRMATIVE / APPLICATION) ve uuid'ler doğrudan ekrana yazılıyor. En ağır kusur, ürünün asıl vaadinin — alıntının bozulmadığının denetlenmesi — yalnızca "Alıntı parmak izi (SHA-256) 3f9a…" satırıyla anlatılması; bu satır avukata hiçbir şey söylemiyor, oysa ürünün en değerli cümlesi burada saklı. İkinci ağır kusur, ürünün merkezî terimlerinin (TESPİT, KESİNLEŞTİRİLEBİLİR, ÇEKİMSER, KAYNAKSIZ) ekranda tanımının olmaması; tek tanım seti TERM_TR yalnız fare üstüne gelince çıkan `title` ipucudur, yani dokunmatikte ve klavyede hiç görünmez. Üçüncüsü, birkaç cümle avukatı yanıltacak kadar geniş konuşuyor ("aleyhe karar bulunamadı" — yalnız bu sunucudaki kaynaklarda aranmışken). Boş durumlar da eksik: tespit üretilmediğinde bölüm hiç çizilmiyor ve avukat neden hiçbir değerlendirme görmediğini öğrenemiyor.

Bulgu: 40

## [P0] tanimsiz-terim — satir 3607

**Mevcut:**
```
box.appendChild(el("div", "quote-label", "Kanonik metinden birebir alıntı"));
```

**Neden:** "Kanonik" ne hukuk ne günlük Türkçe terimidir; ekranda hiçbir yerde tanımı yoktur. Avukat bu satırı okuyup atlar, oysa satır "bu metne dokunulmadı" demek istiyor.

**Öneri:**
```
Belgenin kayıtlı metninden harfi harfine alınmıştır
```

## [P0] jargon — satir 3649

**Mevcut:**
```
metaRow(tech, "Ham sonuç yönü", item.stance + " / " + item.polarity +
```

**Neden:** Bu satır ekrana İngilizce makine değerlerini çıplak yazıyor: "supporting / AFFIRMATIVE (…)". Ürünün kendi kuralı, makine kodunun Türkçe cümleden sonra parantezde durmasıdır; burada Türkçe cümle hiç yok. "Ham" sözcüğü de mühendis dilidir.

**Öneri:**
```
metaRow(tech, "Bu kaynağın hangi yönde olduğu", (STANCE_TR[item.stance] || item.stance) + " — " + (POLARITY_TR[item.polarity] || item.polarity) +
```

**Not:** Ham İngilizce değerler gerekiyorsa cümlenin sonunda parantez içinde kalmalı.

## [P0] jargon — satir 3675

**Mevcut:**
```
hash.appendChild(document.createTextNode("Alıntı parmak izi (SHA-256) "));
```

**Neden:** SHA-256 mühendis terimidir; "parmak izi" de bu üründe uydurulmuş bir karşılıktır ve ekranda tanımı yoktur. Avukat 64 haneli bir kod görüp bunun ne işe yaradığını anlamaz — oysa ürünün en güçlü vaadi tam olarak bu satırda saklıdır.

**Öneri:**
```
Alıntının bozulmadığının denetimi — bu alıntı için üretilen denetim kodu: 
```

**Not:** Kodun kendisi kalsın (kopyalanabilir düğme olarak), ama başındaki cümle NE İŞE YARADIĞINI söylesin. Aynı kabın başına tek cümlelik açıklama eklenmeli: "Bu kodlar, alıntının belgedeki hâliyle aynı kaldığını sonradan da denetlemeye yarar; kod değişmişse metne dokunulmuş demektir."

## [P0] jargon — satir 3680

**Mevcut:**
```
" · Konum " + item.startChar + "–" + item.endChar + " (Unicode karakter sayımı)" +
```

**Neden:** "Unicode", "konum 1240–1875" ve ardından gelen "Belge sürümü <uuid>" avukatın hiçbir işine yaramaz; sayfa/madde değil, karakter sayısıdır. Avukat belgede o yeri bulamaz.

**Öneri:**
```
" · Alıntı, belgenin başından itibaren " + item.startChar + ". ve " + item.endChar + ". harfler arasındaki bölümdür" +
```

**Not:** Sürüm kimliği (uuid) tamamen kaldırılmalı ya da "Belgenin bu sürümü" etiketiyle yalnız kopyalanabilir kod olarak durmalı; çıplak uuid ekranda cümle içinde geçmemeli.

## [P0] tanimsiz-terim — satir 3975

**Mevcut:**
```
lrow("tespit", String((data.claims || []).length));
```

**Neden:** "tespit" bu üründe claim karşılığı uydurulmuş bir terimdir, ekranda tanımı yoktur ve tek başına bir sayının yanında ("tespit 3") ne anlama geldiği hiç anlaşılmaz. Ayrıca bir önceki satırdaki "kaynak" ile birlikte küçük harfle yazılmış; üstteki "Değerlendirme tarihi" büyük harfle — aynı listede iki farklı yazım.

**Öneri:**
```
lrow("Cevabı oluşturan madde sayısı", String((data.claims || []).length));
```

**Not:** Bir üstteki satır da "kaynak" yerine "Dayanak gösterilen kaynak sayısı" olmalı; üç satırın da baş harfi büyük ve aynı biçimde yazılmalı.

## [P0] jargon — satir 3978

**Mevcut:**
```
var a = el("a", null, "Doğrulama dosyasını indir (JSON — alıntıların bağımsız denetimi için)");
```

**Neden:** JSON bir dosya biçimi adıdır ve avukat için anlamsızdır; ayrıca "bağımsız denetim" kimin, nasıl yapacağı söylenmeden bırakılmış. Bağlantı tıklandığında ne olacağını söylemiyor.

**Öneri:**
```
var a = el("a", null, "Denetim dosyasını indir — bu cevaptaki bütün alıntılar, kaynakları ve doğrulama kodlarıyla birlikte tek dosyada (bilirkişi veya karşı taraf denetleyebilsin diye)");
```

**Not:** Etiket uzunsa iki parçaya bölünebilir: bağlantı metni "Denetim dosyasını indir", altına küçük punto açıklama.

## [P0] jargon — satir 4167

**Mevcut:**
```
if (cov.scope) { otl.appendChild(el("li", null, "Kanıt kapsamı niyeti: " + cov.scope.intent)); }
```

**Neden:** Ekrana "Kanıt kapsamı niyeti: APPLICATION" yazıyor. Hem İngilizce bir makine değeri hem de "kapsam" sözcüğünün ürün içindeki üçüncü anlamı. Avukat bu satırdan hiçbir şey çıkaramaz.

**Öneri:**
```
if (cov.scope) { otl.appendChild(el("li", null, "Sorunun türü: " + (INTENT_TR[cov.scope.intent] || cov.scope.intent) + " (" + cov.scope.intent + ")")); }
```

## [P0] tanimsiz-terim — satir 4189

**Mevcut:**
```
"Aşağıdaki kaynakların her birinde alıntı, belgenin kayıtlı sürümünden " +
```

**Neden:** Devamındaki satırda yine "kanonik metinden birebir alınmıştır" geçiyor. Aynı tanımsız sözcük, cevabın en çok okunan bölüm girişinde tekrar ediyor. Ayrıca cümle iki kez aynı şeyi söylüyor ("karakteri karakterine doğrulandı" + "birebir alınmıştır").

**Öneri:**
```
"Aşağıdaki kaynakların her birinde alıntı, belgenin kayıtlı metniyle harf harf karşılaştırıldı ve aynı olduğu görüldü. " +
```

**Not:** Sonraki satırdaki "karakteri karakterine doğrulandı ve kanonik metinden birebir alınmıştır." ifadesi bu tek cümleyle değiştirilmeli.

## [P1] jargon — satir 3639

**Mevcut:**
```
: "metin benzerliği taraması (birden çok arama şeridinin birleşimi)");
```

**Neden:** Yine "arama şeridi". Avukat için anlamlı olan, kaynağın madde numarasıyla mı yoksa kelime benzerliğiyle mi bulunduğudur; parantez içi sadece kafa karıştırıyor.

**Öneri:**
```
: "kelime benzerliğiyle bulundu (birkaç ayrı arama birlikte yapıldı)");
```

**Not:** Bir üstteki dal ("soruda anılan madde numarasıyla birebir eşleşme") iyi yazılmış, korunmalı.

## [P1] jargon — satir 3652

**Mevcut:**
```
metaRow(tech, "Arama şeritleri",
```

**Neden:** "Şerit" (lane) bir mühendislik kavramıdır; ekranda tanımı yoktur. Devamındaki " · sorgu: " satırı da veritabanına gönderilen ham sorgu metnini gösterir, avukatın yazdığı soruyu değil.

**Öneri:**
```
metaRow(tech, "Bu kaynağı hangi aramalar buldu",
```

**Not:** " · sorgu: " yerine " · aranan kelimeler: " kullanılmalı.

## [P1] jargon — satir 3657

**Mevcut:**
```
metaRow(tech, "Atıf zinciri (citator)", relationLine(prov.relation));
```

**Neden:** "citator" İngilizce bir sektör terimidir ve parantez içinde açıklama yapmıyor, tam tersine karartıyor. Ayrıca relationLine() içeriği pasaj kimliği, ilişki kimliği, "çözümleyici sürümü" gibi tamamen makineye ait alanlar yazıyor.

**Öneri:**
```
metaRow(tech, "Bu maddeyi değiştiren / kaldıran düzenleme bağlantısı", relationLine(prov.relation));
```

**Not:** relationLine() çıktısındaki "bağlantı kurulan pasaj", "ilişki", "çözümleyici", "güven" alanları avukata gösterilmemeli; en fazla "hedef: 6098 sayılı Kanun m. 299" kalmalı.

## [P1] jargon — satir 3660

**Mevcut:**
```
metaRow(tech, "Atıf takibi", "bu pasaj, " + prov.citation.citedByChunkId +
```

**Neden:** Cümlenin ortasında uuid biçiminde bir parça kimliği geçiyor: "bu pasaj, 8f3c1a…-… pasajının atıf yaptığı … hükmüdür". Avukat cümlenin yarısını okuyamaz.

**Öneri:**
```
metaRow(tech, "Bu hüküm neden burada", "Yukarıdaki kaynaklardan biri bu hükme atıf yapıyor: " + prov.citation.reference);
```

**Not:** Kimlik yerine, atıf yapan kaynağın numarası ([K-2] gibi) gösterilmeli; numara yoksa satır hiç yazılmamalı.

## [P1] jargon — satir 3664

**Mevcut:**
```
metaRow(tech, "Karşıt otorite bağı",
```

**Neden:** Devamındaki cümle de uuid ve "markers" listesi içeriyor ("… pasajının … sonucuyla çelişiyor (marker1, marker2)"). Hem terim tanımsız hem cümle makine çıktısı.

**Öneri:**
```
metaRow(tech, "Bu kaynak hangi karara aykırı",
```

**Not:** Cümle: "Bu kaynak <olumlu/aksi> sonuca varıyor; yukarıdaki [K-n] numaralı kaynak ise <…> sonucuna varmış. İki karar birbirine aykırıdır." biçiminde, pasaj kimliği olmadan yazılmalı.

## [P1] jargon — satir 3695

**Mevcut:**
```
"Kaynak URL (izinli alan adı değil; bağlantı verilmedi): " + item.sourceUrl));
```

**Neden:** URL ve "izinli alan adı" mühendis terimleridir; ayrıca cümle avukata NE YAPMASI gerektiğini söylemiyor (adresi elle kopyalayabileceğini).

**Öneri:**
```
"Belgenin internet adresi — güvenli adres listesinde olmadığı için tıklanabilir yapılmadı; adresi kopyalayıp tarayıcınıza yapıştırabilirsiniz: " + item.sourceUrl));
```

**Not:** Bir üstteki dalda geçen "Kaynak URL: " de "Belgenin internet adresi: " olmalı (satır 3690).

## [P1] anlasilmaz-cumle — satir 3701

**Mevcut:**
```
msg.push("Bu pasaj talimat biçimli içerik taşıyor (" +
```

**Neden:** Cümlenin devamı "sistem onu talimat olarak İŞLEMEZ" diyor — bu tamamen mühendis bakışıdır. Avukat "talimat biçimli içerik" ile ne kastedildiğini bilmez, parantez içindeki sinyal kodları da İngilizcedir. Ayrıca cümle avukata bir eylem önermiyor.

**Öneri:**
```
msg.push("Bu metnin içinde, bilgisayara emir vermeye çalışır gibi görünen ifadeler var. Metin kanıt olduğu için hiç değiştirilmeden gösteriliyor; ColleX bu ifadeleri emir saymaz. Belgeyi okurken bu kısımlara dikkat edin. (" +
```

**Not:** Parantezdeki sinyal kodları katlanmış teknik kaba taşınmalı.

## [P1] jargon — satir 3706

**Mevcut:**
```
msg.push(flags.invisibleChars + " görünmez/BiDi kontrol karakteri içeriyor.");
```

**Neden:** "BiDi kontrol karakteri" avukat için tamamen anlaşılmazdır ve cümle bunun neden önemli olduğunu söylemiyor.

**Öneri:**
```
msg.push("Metinde gözle görünmeyen " + flags.invisibleChars + " işaret var. Bu işaretler yazının ekranda farklı görünmesine yol açabilir; alıntıyı bir başka yere kopyalarken dikkat edin.");
```

## [P1] jargon — satir 3719

**Mevcut:**
```
"İşlem izi — " + trace.length + " aşama · toplam " + total.toFixed(2) + " ms"));
```

**Neden:** Milisaniye, "aşama" ve altındaki çubuk grafiği tamamen mühendis telemetrisidir. Avukatın cevabında bu bölümün bulunması bile şaşırtıcıdır; hele iki ondalıklı ms değeri.

**Öneri:**
```
"Bu cevap nasıl üretildi — " + trace.length + " adım · toplam " + Math.round(total) + " milisaniye"));
```

**Not:** Aşama adları (satır 3731, stage.name) sunucudan İngilizce geliyor ve olduğu gibi yazılıyor; her adımın Türkçe adı olmalı, yoksa bu bölüm hiç çizilmemeli. Bölüm başlığı da (satır 4270) "İşlem izi" yerine "Bu cevap nasıl üretildi" olmalı.

## [P1] jargon — satir 3739

**Mevcut:**
```
return k + "=" + stage.counts[k];
```

**Neden:** Her adımın altına "hits=12 kept=8" gibi anahtar=değer çiftleri yazılıyor. Bu doğrudan makine çıktısıdır ve avukatın önünde çıplak duruyor.

**Öneri:**
```
Sayaçlar Türkçe adlarıyla ve "=" işareti olmadan yazılmalı: "bulunan 12 · elenen 4 · kalan 8". Türkçe adı bilinmeyen sayaç hiç gösterilmemeli.
```

## [P1] ui-kusuru — satir 3892

**Mevcut:**
```
if (node && TERM_TR[key]) { node.title = TERM_TR[key]; }
```

**Neden:** Ürünün merkezî terimlerinin (aktif dosya, KAYNAKSIZ, K-n, sürüm, deneysel) TEK tanımı burada ve yalnız fareyle üzerine gelinince çıkan ipucu olarak veriliyor. Dokunmatik ekranda, klavyeyle gezinirken ve yazdırılan çıktıda hiç görünmez. Tanımsız terim, tanımı hiç görünmeyen terimle aynıdır.

**Öneri:**
```
Terimin yanına küçük bir “?” düğmesi konulmalı; tıklanınca tanım metni satır altında görünür kutu olarak açılmalı (title ipucu ek olarak kalabilir). Ayrıca cevabın altına, kullanılan terimlerin listelendiği katlanmış bir "Bu ekrandaki terimler ne demek?" bölümü eklenmeli.
```

**Not:** KAYNAKSIZ, K-n, ÇEKİMSER, KESİNLEŞTİRİLEBİLİR ve TESPİT için tanım şart.

## [P1] tanimsiz-terim — satir 3959

**Mevcut:**
```
var finLine = el("div", "fin warnline " + (data.finalizable ? "yes" : "no"));
```

**Neden:** Bu satır ekrana KESİNLEŞTİRİLEBİLİR / KESİNLEŞTİRİLEMEZ damgasını basıyor. İkisi de uydurulmuş terimdir, ekranda tanımı yoktur ve avukat "neyi kesinleştiriyorum?" sorusunun cevabını hiçbir yerde bulamaz. Üstelik CSS'te bu satır all-small-caps ve harf aralığı açılmış olarak çiziliyor (satır 521) — cevabın en kritik cümlesi en zor okunan biçimde.

**Öneri:**
```
Damga metni değiştirilmeli: "KULLANIMA HAZIR — teknik kontroller tamam; hukukî değerlendirme size aittir" / "HENÜZ KULLANMAYIN — en az bir alıntı doğrulanamadı; gerekçeleri okumadan dilekçeye koymayın". CSS'te .verdict .fin için font-variant-caps: all-small-caps ve letter-spacing kaldırılmalı, normal punto ve kalınlıkta yazılmalı.
```

**Not:** Metnin kaynağı FINALIZE_TR (satır 2898) — orada da düzeltilmeli.

## [P1] tanimsiz-terim — satir 3998

**Mevcut:**
```
ab.appendChild(el("h3", null, "ÇEKİMSER — cevap üretilmedi"));
```

**Neden:** "ÇEKİMSER" uydurulmuş bir damgadır; hâkimin çekinmesini çağrıştırır ve burada kastedilen bu değildir. Başlığın kendisi terimi açıklamıyor; açıklama bir alttaki cümlede saklı.

**Öneri:**
```
ab.appendChild(el("h3", null, "Cevap üretilmedi — dayanak bulunamadı"));
```

**Not:** Damga sözcüğü korunacaksa başlık "ÇEKİMSER (cevap üretilmedi): doğrulanamayan bir metin yazmaktansa hiç yazılmadı" biçiminde kendini açıklamalı. Kaynak: STATUS_TR, satır 2753.

## [P1] eksik-aciklama — satir 4033

**Mevcut:**
```
if ((data.claims || []).length) {
```

**Neden:** Hiç madde üretilmemiş ama ÇEKİMSER de olmayan bir cevapta (ör. yalnız yüklenen belgeye dayanan cevap) bu bölüm hiç çizilmiyor. Avukat kaynak kartlarını görüyor ama tek bir değerlendirme cümlesi göremiyor ve neden göremediğini de öğrenemiyor. Boş durum yok.

**Öneri:**
```
else bloğu eklenmeli: "Bu cevapta kaynağa bağlı madde üretilmedi — aşağıda yalnızca bulunan kaynaklar ve alıntıları var. Kaynakların sorunuzu karşılayıp karşılamadığına siz karar verin."
```

**Not:** Aynı boşluk Kaynaklar bölümü için de var (satır 4182): kanıt yoksa bölüm hiç çizilmiyor.

## [P1] tanimsiz-terim — satir 4034

**Mevcut:**
```
section(out, "Tespitler", "sec-tespitler", "Tespitler");
```

**Neden:** "Tespit", bu üründe claim karşılığı kullanılan ve ekranda tanımlanmayan bir terimdir. Avukat "tespit" deyince mahkemenin tespitini ya da delil tespitini anlar; burada kastedilen, ColleX'in kaynağa bağladığı cümlelerdir. Bölüm başlığı bu yanlış anlamayı büyütüyor.

**Öneri:**
```
section(out, "Cevap — kaynağa bağlı maddeler", "sec-tespitler", "Cevap maddeleri");
```

**Not:** Bölüm başlığının hemen altına tek cümlelik açıklama gelmeli: "Her madde, aşağıdaki kaynaklardan en az birine bağlıdır; bağlantı numarası maddenin altında yazılıdır."

## [P1] anlasilmaz-cumle — satir 4077

**Mevcut:**
```
"Kanıt kapsamı: " + (INTENT_TR[cov.scope.intent] || cov.scope.intent) +
```

**Neden:** Ekranda "Kanıt kapsamı: uygulama sorusu — …" çıkıyor. Bir "kapsam"ın değeri neden bir soru türü oluyor, anlaşılmıyor. Ayrıca "kapsam" sözcüğü bu üründe üç ayrı anlamda kullanılıyor (soru kapsamı, dosya kapsamı, kanıt kapsamı).

**Öneri:**
```
"Sorunuz şu türde okundu: " + (INTENT_TR[cov.scope.intent] || cov.scope.intent) +
```

**Not:** "Kapsam" sözcüğü bu satırdan çıkarılmalı; ürünün başka yerlerindeki iki kullanımla karışıyor.

## [P1] jargon — satir 4101

**Mevcut:**
```
cl.appendChild(el("li", null, c.claimId +
```

**Neden:** Çelişen kaynaklar listesinde madde kimliği (claim-7f2a… gibi makine kimliği) satır başında çıkıyor. Avukat bunu yukarıdaki kartlarla eşleştiremez.

**Öneri:**
```
cl.appendChild(el("li", null, "Madde " + (claimNoById[c.claimId] || "") +
```

**Not:** Kartlarda zaten 1, 2, 3 diye sıra numarası var (claimCard'ın index'i); listede o numara kullanılmalı, kimlik hiç yazılmamalı.

## [P1] ton — satir 4126

**Mevcut:**
```
" ayrı arama yapıldı, aleyhe karar bulunamadı."
```

**Neden:** Bu cümle avukata güvence veriyor gibi okunuyor: "aleyhe karar yok". Oysa yalnızca bu bilgisayardaki kaynaklarda ve yapılan sorgularla arandı. Bir avukatın dilekçesini bu cümleye dayandırması hâlinde ürün onu yanıltmış olur.

**Öneri:**
```
" ayrı arama yapıldı; bu aramalarda ve elinizdeki kaynaklarda aleyhe karar çıkmadı. Bu, aleyhe karar olmadığı anlamına gelmez — arama kaynakları ve kelimeleri sınırlıdır."
```

**Not:** Aramaların dökümü zaten hemen altında katlı duruyor; bu cümle onunla tutarlı olur.

## [P1] eksik-aciklama — satir 4127

**Mevcut:**
```
: (cov.note || "Karşıt otorite taraması bu cevapta yürütülmedi.")));
```

**Neden:** Cümle NEDEN yürütülmediğini ve avukatın ne yapması gerektiğini söylemiyor. Karşıt içtihat taraması bu ürünün en değerli işlerinden biri; sessizce "yapılmadı" demek en kötü cevaptır.

**Öneri:**
```
: (cov.note || "Aleyhe karar taraması bu cevapta yapılmadı: soruya doğrudan karşılık gelen bir hüküm bulunamadığı için karşıt arama kurulamadı. Soruyu madde numarası vererek daraltıp yeniden sorarsanız tarama çalışır.")));
```

**Not:** Sunucu bu ayrımı ContraryCoverage.skipped alanıyla veriyor; iki farklı cümle ("kurulamadı" / "gerekmedi") yazılmalı.

## [P1] jargon — satir 4232

**Mevcut:**
```
rl.appendChild(el("li", null, r.title + " — " + r.chunkId + " — " + r.reason));
```

**Neden:** Satırın ortasında uuid, sonunda İngilizce ham gerekçe kodu var. Katlanmış kabın içinde bile olsa avukat açtığında hiçbir şey anlamıyor.

**Öneri:**
```
rl.appendChild(el("li", null, r.title + " — " + observedReasonTR(r.reason, true)));
```

**Not:** chunkId tamamen kaldırılmalı; gerekçe kodları zaten observedReasonTR ile Türkçeleşiyor, o kullanılmalı.

## [P1] ui-kusuru — satir 4253

**Mevcut:**
```
fold.appendChild(el("div", "empty", "Ekranda yer kalmayan notlar:"));
```

**Neden:** Avukat, bir uyarının "ekranda yer kalmadığı için" gizlendiğini okuyor. Bu, ürünün kendi iç bütçesini kullanıcıya itiraf etmesidir ve güveni bozar: "başka ne saklandı?" sorusunu doğurur.

**Öneri:**
```
fold.appendChild(el("div", "empty", "Ayrıntı niteliğindeki diğer notlar:"));
```

**Not:** Aynı kabın başına "Aşağıdaki notların hiçbiri atılmadı; hepsi burada." cümlesi eklenmeli.

## [P1] jargon — satir 4291

**Mevcut:**
```
box.appendChild(el("strong", null, "İstek başarısız"));
```

**Neden:** "İstek" burada HTTP isteği anlamındadır; avukat kendi "talebi"nin reddedildiğini sanabilir. Ayrıca başlık ne olduğunu ve ne yapılacağını söylemiyor.

**Öneri:**
```
box.appendChild(el("strong", null, "Cevap alınamadı"));
```

**Not:** Altındaki mesajın sonuna her zaman bir eylem cümlesi eklenmeli: "Soruyu yeniden gönderin; sorun sürerse ColleX-Durdur.cmd ardından ColleX-Baslat.cmd ile yeniden başlatın."

## [P2] anlasilmaz-cumle — satir 3621

**Mevcut:**
```
metaRow(list, "Yönü", item.direction);
```

**Neden:** Hemen bir üst satırda "Sonuç yönü" var; bunun yanına bir de "Yönü" geliyor ve item.direction sunucudan çoğu zaman İngilizce geliyor. İki benzer etiket yan yana, biri Türkçeleştirilmiş biri değil.

**Öneri:**
```
metaRow(list, "Taslaktaki kullanım yönü", STANCE_TR[item.direction] || item.direction);
```

**Not:** İki satır aynı anda çıkıyorsa biri tamamen kaldırılmalı.

## [P2] ton — satir 3634

**Mevcut:**
```
det.appendChild(el("summary", null, "Teknik doğrulama ayrıntıları"));
```

**Neden:** "Teknik" sözcüğü avukatı baştan dışlıyor: "bu bana göre değil" dedirtir. Oysa içeride avukatı ilgilendiren şeyler de var (kaynağın nasıl bulunduğu, otorite kademesi).

**Öneri:**
```
det.appendChild(el("summary", null, "Bu alıntı nasıl doğrulandı?"));
```

## [P2] jargon — satir 3641

**Mevcut:**
```
metaRow(tech, "Otorite kademesi", item.authority
```

**Neden:** Devamında "(kademe 2)" gibi bir sayı yazılıyor. Kademe numarasının ölçeği (1 en yüksek mi, 5 mi?) hiçbir yerde açıklanmıyor; sayı avukat için anlamsız.

**Öneri:**
```
metaRow(tech, "Kaynağın bağlayıcılık derecesi", item.authority
```

**Not:** Sayı kaldırılmalı, yalnız Türkçe etiket ("Yargıtay HGK kararı — emsal değeri yüksek") kalmalı.

## [P2] eksik-aciklama — satir 3925

**Mevcut:**
```
data.corpusNotice || "(veri kaynağı bilgisi verilmedi)";
```

**Neden:** Boş durum metni avukata hiçbir şey söylemiyor; hangi kaynaklarda arandığını bilmeden cevabın değerini ölçemez.

**Öneri:**
```
data.corpusNotice || "Bu cevabın hangi kaynaklarda arandığı bildirilmedi — Ayarlar › Sistem durumu ekranından kaynakları görebilirsiniz.";
```

## [P2] tanimsiz-terim — satir 3948

**Mevcut:**
```
mid.appendChild(el("div", "word", (data.evidence || []).length + " pasaj bulundu"));
```

**Neden:** "Pasaj" bu üründe chunk karşılığı kullanılıyor ve avukatın günlük sözlüğünde yoktur; belgenin bir bölümü mü, bir cümle mi, bir sayfa mı belli değil.

**Öneri:**
```
mid.appendChild(el("div", "word", (data.evidence || []).length + " bölüm bulundu"));
```

**Not:** "Pasaj" ürünün her yerinde kullanılıyor; tek seferde "belge bölümü" olarak değiştirilmeli ya da ilk geçtiği yerde bir kez tanımlanmalı.

## [P2] ton — satir 3950

**Mevcut:**
```
"belge sorunuzu cevaplıyor mu, kararı siz verin. (Teknik durum: " + st[0] + ")");
```

**Neden:** Cümlenin ilk yarısı iyi; ama sonundaki "(Teknik durum: KISMİ)" damganın kendisini bir kenar notuna indiriyor ve "KISMİ" terimi burada da tanımsız kalıyor. Avukat iki farklı durum ifadesi görüp hangisine bakacağını bilemiyor.

**Öneri:**
```
"belge sorunuzu cevaplıyor mu, kararı siz verin.");
```

**Not:** Damganın teknik adı gerekiyorsa katlanmış Uyarılar kartında bir kez geçmeli, başlıkta değil.

## [P2] anlasilmaz-cumle — satir 4002

**Mevcut:**
```
"gösterilen kaynak kartı: " + (data.evidence || []).length +
```

**Neden:** Devamıyla birlikte "gösterilen kaynak kartı: 0 · üretilen tespit: 0" çıkıyor. Sıfırları saymak avukata bilgi vermez; "kart" ve "tespit" de ürün içi terimlerdir.

**Öneri:**
```
"Bu cevapta gösterilen kaynak yok, oluşturulan madde yok — hiçbir şey gizlenmedi, üretilmedi."
```

**Not:** Sayılar sıfırdan büyükse eski biçim kalabilir; sıfır hâli tek cümleyle anlatılmalı.

## [P2] jargon — satir 4084

**Mevcut:**
```
["Mesele", "Arama türü", "Sorgu", "Durum", "Sonuç", "Yeni pasaj"],
```

**Neden:** "Sorgu" sütunu veritabanına giden ham arama metnini gösteriyor; "Yeni pasaj" sütununun ne saydığı belli değil; "Sonuç" bir sayı ama neyin sayısı yazmıyor.

**Öneri:**
```
["Mesele", "Arama türü", "Aranan kelimeler", "Durum", "Bulunan belge", "İlk kez bulunan"],
```

**Not:** Tablonun üstüne tek cümle: "Aleyhe karar bulmak için yapılan aramaların listesi."

## [P2] anlasilmaz-cumle — satir 4154

**Mevcut:**
```
["Belge", "Tür", "E./K.", "Sonuç yönü", "Kaç aramada", "Gerekçe"],
```

**Neden:** "Kaç aramada" yarım bir başlıktır, Türkçesi bozuk. "Gerekçe" sütunu neyin gerekçesi olduğunu söylemiyor (elenme gerekçesi).

**Öneri:**
```
["Belge", "Tür", "E./K.", "Sonuç yönü", "Kaç aramada çıktı", "Neden kullanılmadı"],
```

## [P2] jargon — satir 4165

**Mevcut:**
```
obsTech.appendChild(el("summary", null, "Teknik ayrıntılar — ham kodlar"));
```

**Neden:** "Ham kod" mühendis dilidir. Avukat bu kabı açmaz; açarsa da içeride ne bulacağını bilmez.

**Öneri:**
```
obsTech.appendChild(el("summary", null, "Ayrıntı: bu belgeler neden kullanılmadı (sistem kayıtlarıyla)"));
```
