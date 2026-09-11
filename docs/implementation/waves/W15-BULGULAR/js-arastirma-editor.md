# js-arastirma-editor

Bu bölge, taslak üretiminin kalbi: dayanak (kanıt) kaynağı seçimi, şablon listesi, kayıtlı taslaklar, taslak formu ve editöre giriş. Türkçesi çoğu yerde iyi niyetli ama ekranda avukatın hiçbir yerde tanımını göremediği damgalar dolaşıyor: "KAYNAKSIZ", "TAM / ŞERHLİ / KISMİ / ÇEKİMSER", ham şablon kimlikleri ve "uç" (endpoint) sözcüğü. En ciddi kusur, kanıtsız çalışma seçildiğinde çıkan tek satırlık uyarı: metnin mahkemeye sunulamayacak nitelikte olduğunu söylemesi gerekirken mühendis diliyle "kanıt bağlanmaz" diyor ve avukatın bilmediği bir damgaya atıf yapıyor. Ölçüm/kimlik artıkları da görünür durumda: 12 haneli araştırma numarası kırpılmış olarak, taslak süresi "1843 ms" olarak, taslak türü ise "dilekce-alacak-v1" gibi makine kimliğiyle yazılıyor. Görsel tarafta tek gerçek işleyiş hatası şu: arama kutusuna bir harf yazıldığı ya da tür süzgecine basıldığı anda "Kayıtlı taslaklar" kartı ekrandan siliniyor ve bir daha gelmiyor — avukat üzerinde çalıştığı taslağa dönüş yolunu kaybediyor. Form alanları (taraf, olay, vekil) genel olarak iyi yazılmış; asıl iş, damgaların kendi kendini açıklar hâle getirilmesi ve makine artıklarının ekrandan çıkarılması.

Bulgu: 28

## [P0] jargon — satir 5344

**Mevcut:**
```
? "kullanılacak araştırma no: " + shortHash(lastRunId)
```

**Neden:** Ekrana "kullanılacak araştırma no: 8f31a0c4b7d2…" gibi bir dizi düşüyor. Bu, kesilmiş bir makine kimliğidir; avukata hangi araştırmanın bağlanacağını söylemez, yalnız güven kaybettirir.

**Öneri:**
```
? "Bu taslağa şu araştırma bağlanacak: " + cpTruncate(lastRunQuestion || "son sorduğunuz soru", 60)
```

## [P0] anlasilmaz-cumle — satir 5353

**Mevcut:**
```
 — yüklenen belgeler yalnız DELİLLER'de Ek olarak listelenir ve olay önerisi üretir; hukukî dayanak yapılmaz
```

**Neden:** Tek nefeste üç ayrı kural veriyor, edilgen çatıyla bitiyor ("yapılmaz") ve "olay önerisi üretir" avukat Türkçesi değil. Avukat en önemli sınırı — yüklediği belgenin hukukî dayanak sayılmayacağını — cümlenin sonunda, virgülden sonra görüyor.

**Öneri:**
```
 — Yüklediğiniz belge dilekçede yalnız DELİLLER bölümünde “Ek” olarak gösterilir. Belgeden çıkarılan olaylar size öneri olarak sunulur. Belge, hukukî dayanak olarak kullanılmaz.
```

## [P0] tanimsiz-terim — satir 5356

**Mevcut:**
```
kanıt bağlanmaz; hukukî değerlendirme paragrafları KAYNAKSIZ işaretlenir ve taslak yalnız beyan niteliğindedir
```

**Neden:** Avukat "kanıt bağlanmaz" ifadesini mühendis cümlesi olarak okur, "KAYNAKSIZ" damgasının ne olduğunu ekranda hiçbir yerde göremez ve en kritik bilgiyi — bu metnin bir dayanağı olmadığını — kaçırır. Bu satır, ürünün en riskli seçiminin tek uyarısıdır.

**Öneri:**
```
Bu taslağa hiçbir karar ya da mevzuat metni bağlanmaz. Hukukî değerlendirme paragraflarının yanına “kaynağı yok” damgası konur; metin bir dayanak değil, yalnız sizin beyanınızdır.
```

## [P0] tanimsiz-terim — satir 5376

**Mevcut:**
```
o.textContent = (fmtDateTR(a.createdAt) || "-") + " · " + (st ? st[0] : a.status || "?") + " · " +
```

**Neden:** Kayıtlı araştırma listesinde her satır "03.09.2026 · ŞERHLİ · Yerel · kira bedelinin…" biçiminde. ŞERHLİ / TAM / KISMİ / ÇEKİMSER damgalarının açıklaması bu açılır listede yok; avukat hangi araştırmayı seçeceğine bakarken en belirleyici bilgiyi anlamıyor.

**Öneri:**
```
o.textContent = (fmtDateTR(a.createdAt) || "-") + " · " + (st ? st[3] : a.status || "durumu bilinmiyor") + " · " +   /* st[3] = damganın tam cümlesi: "Tüm tespitler doğrulanmış kaynağa bağlı." gibi */
```

## [P0] jargon — satir 5399

**Mevcut:**
```
showNotYet(target, "GET /v1/draft-templates", "Taslak şablon ucu");
```

**Neden:** Ekranda "Taslak şablon ucu bu sunucuda henüz açık değil" cümlesi çıkıyor. "Uç" (endpoint) ve "sunucu" avukatın sözlüğünde yok; cümle bir arıza mesajı gibi okunuyor ve ne yapılacağını söylemiyor.

**Öneri:**
```
showNotYet(target, "GET /v1/draft-templates", "Dilekçe ve sözleşme şablonları");
```

## [P0] ui-kusuru — satir 5449

**Mevcut:**
```
search.addEventListener("input", function () { tplFilter.q = this.value; renderTemplates(templates); document.getElementById("tplsearch").focus(); });
```

**Neden:** renderTemplates ilk işi olarak kabın içini siliyor (satır 5430) ve "Kayıtlı taslaklar" kartını bir daha eklemiyor. Yani avukat arama kutusuna tek harf yazdığı ya da "Dilekçeler" süzgecine bastığı anda üzerinde çalıştığı kayıtlı taslakların listesi ekrandan kayboluyor ve sayfa yenilenmeden geri gelmiyor. Bu, taslağa dönüş yolunun kaybolması demek.

**Öneri:**
```
renderTemplates çağrılarının ardından kayıtlı taslak kartı yeniden çizilmeli: renderTemplates(templates) satırlarının sonuna renderSavedDrafts() eklenmeli (satır 5449, 5453, 5459); ya da daha sağlamı, "Kayıtlı taslaklar" kartı #templates kabının DIŞINDA, kendi kabında durmalı.
```

## [P0] jargon — satir 5603

**Mevcut:**
```
if (res.status === 404) { emptyLine(box, "Taslak listesi ucu bu sunucuda kapalı."); return; }
```

**Neden:** "Uç" ve "sunucu" birlikte. Üstelik cümle ne olduğunu değil sistemin iç durumunu anlatıyor: avukat kayıtlı taslaklarının kaybolup kaybolmadığını anlayamaz.

**Öneri:**
```
if (res.status === 404) { emptyLine(box, "Kayıtlı taslak listesi bu kurulumda açık değil. Taslaklarınız duruyor; listeyi açtırmak için sistemi kuran kişiye başvurun."); return; }
```

## [P0] jargon — satir 5612

**Mevcut:**
```
sub.appendChild(chip(t.template || t.kind || "?", "mute"));
```

**Neden:** Kayıtlı taslak satırında tür damgası olarak ham şablon kimliği görünüyor ("dilekce-alacak-v1" gibi). Avukat bunun ne olduğunu bilmez, ayrıca soru işareti ("?") yedek metin olarak ekrana düşebiliyor.

**Öneri:**
```
var tplRow = templatesCache.filter(function (x) { return x.id === t.template; })[0];
        sub.appendChild(chip(tplRow ? tplRow.title : (KIND_LABEL[t.kind] || "Belge türü belirtilmemiş"), "mute"));
```

## [P0] tanimsiz-terim — satir 5617

**Mevcut:**
```
sub.appendChild(chip(t.unsupportedCount > 0 ? t.unsupportedCount + " KAYNAKSIZ paragraf" : "KAYNAKSIZ paragraf yok", t.unsupportedCount > 0 ? "bad" : "ok"));
```

**Neden:** Kayıtlı taslak listesinde her satırda kırmızı/yeşil bir damga olarak "3 KAYNAKSIZ paragraf" yazıyor. Avukat bu sözcüğü bilmez; büyük harfle yazılması onu bir hata koduna benzetir, oysa anlatılmak istenen "bu paragrafların altında doğrulanmış bir kaynak yok".

**Öneri:**
```
sub.appendChild(chip(t.unsupportedCount > 0 ? t.unsupportedCount + " paragrafın kaynağı yok" : "Her paragrafın kaynağı var", t.unsupportedCount > 0 ? "bad" : "ok"));
```

## [P0] jargon — satir 6177

**Mevcut:**
```
dtiming.textContent = (Date.now() - started) + " ms";
```

**Neden:** Taslak hazır olduğunda avukatın gördüğü tek geri bildirim "1843 ms". Milisaniye avukatın birimi değil; üstelik işin bittiğini de söylemiyor. Bekleyişin sonunda ekranda ne olduğu yazmalı, ölçüm değil.

**Öneri:**
```
dtiming.textContent = "Taslak hazır.";
```

## [P0] jargon — satir 6179

**Mevcut:**
```
showNotYet(document.getElementById("draftout"), "POST /v1/drafts", "Taslak ucu");
```

**Neden:** Aynı sorun taslak oluşturma anında çıkıyor: "Taslak ucu bu sunucuda henüz açık değil." Avukat tam formu doldurup düğmeye bastıktan sonra bu cümleyi okuyor ve ne yapması gerektiğini anlamıyor.

**Öneri:**
```
showNotYet(document.getElementById("draftout"), "POST /v1/drafts", "Taslak oluşturma");
```

## [P1] anlasilmaz-cumle — satir 5345

**Mevcut:**
```
: "henüz araştırma yok — önce Araştır görünümünde bir soru doğrulayın"
```

**Neden:** "Bir soru doğrulayın" Türkçe olarak yanlış: soru doğrulanmaz, sorulur. Avukat ne yapacağını anlayamıyor. "Görünüm" de ekran adı için zayıf bir sözcük.

**Öneri:**
```
: "Bu oturumda henüz araştırma yapmadınız — önce Araştır ekranından sorunuzu sorun, sonra buraya dönün"
```

## [P1] eksik-aciklama — satir 5349

**Mevcut:**
```
: "aktif dosya seçili değil — kayıtlı araştırmalar dosyaya göre listelenir"
```

**Neden:** Sistemin çalışma kuralını anlatıyor, avukata bir adım vermiyor. Ayrıca "aktif dosya" ifadesi tek başına ekranın neresinden seçileceğini söylemiyor.

**Öneri:**
```
: "Önce üst çubuktan bir dosya seçin — kayıtlı araştırmalar seçtiğiniz dosyaya göre listelenir"
```

## [P1] ui-kusuru — satir 5383

**Mevcut:**
```
none.textContent = "kayıtlı araştırma yok";
```

**Neden:** Bu satır açılır listeye seçilebilir bir seçenek olarak ekleniyor; avukat onu bir araştırma sanıp seçebiliyor ve hiçbir şey olmuyor. Boş durum, seçenek kılığına girmemeli.

**Öneri:**
```
none.textContent = "— bu dosyada kayıtlı araştırma yok —";
        none.disabled = true;
```

## [P1] eksik-aciklama — satir 5406

**Mevcut:**
```
e.appendChild(el("strong", null, "Şablonlar alınamadı"));
```

**Neden:** Başlık sorunu bildiriyor ama avukatın ne yapacağını söylemiyor; altındaki satır da çoğu zaman teknik bir hata metni. Ekran çıkmaz sokak oluyor.

**Öneri:**
```
e.appendChild(el("strong", null, "Şablonlar açılamadı — yeniden deneyin"));   /* altına: "Sorun sürerse ColleX'i kapatıp yeniden başlatın; taslaklarınız kaybolmaz." */
```

## [P1] eksik-aciklama — satir 5434

**Mevcut:**
```
ph.appendChild(el("div", "line", "Şablon tanımlı değil"));
```

**Neden:** Boş durum yalnız durumu bildiriyor, ne yapılacağını söylemiyor. Avukat yanlış bir şey yaptığını mı, kurulumun eksik mi olduğunu bilmiyor.

**Öneri:**
```
ph.appendChild(el("div", "line", "Bu kurulumda hiç dilekçe veya sözleşme şablonu yüklü değil. Sistemi kuran kişiden şablonları eklemesini isteyin."));
```

## [P1] jargon — satir 5610

**Mevcut:**
```
g.appendChild(el("div", null, (t.title || "(başlıksız taslak)") + " — v" + (t.version || 1)));
```

**Neden:** "v3" yazılım sürüm gösterimi. Avukat için anlaşılır karşılığı "3. hâli" ya da "3. sürüm"dür; "v" harfi tek başına hiçbir şey söylemiyor.

**Öneri:**
```
g.appendChild(el("div", null, (t.title || "(başlıksız taslak)") + " — " + (t.version || 1) + ". sürüm"));
```

## [P1] anlasilmaz-cumle — satir 5615

**Mevcut:**
```
sub.appendChild(chip(t.matterId ? "Dosya: " + (mt ? cpTruncate(mt.title, 40) : "…") : "dosyasız (dosyası silinmiş ya da dosyasız açılmış)", t.matterId ? "mute" : "warn"));
```

**Neden:** Küçücük bir damganın içine parantezli iki ihtimal sıkıştırılmış; ayrıca dosya adı henüz yüklenmemişse damga "Dosya: …" diye üç noktayla kalıyor ve avukat hangi dosya olduğunu göremiyor.

**Öneri:**
```
sub.appendChild(chip(t.matterId ? "Dosya: " + (mt ? cpTruncate(mt.title, 40) : "dosya adı yükleniyor") : "Bir dosyaya bağlı değil", t.matterId ? "mute" : "warn"));   /* uzun açıklama damganın title'ında: "Taslak açılırken dosya seçilmemiş ya da bağlı olduğu dosya sonradan silinmiş." */
```

## [P1] anlasilmaz-cumle — satir 5664

**Mevcut:**
```
(activeMatter ? " · Dosya: " + cpTruncate(activeMatter.title, 40) : " · dosyasız");
```

**Neden:** Seçilen şablonun başlığının yanında "· dosyasız" yazıyor. Bu tek sözcük hem bir kusur gibi okunuyor hem de sonucun ne olacağını söylemiyor (taslak yine de üretilir, sadece bir dosyaya bağlanmaz).

**Öneri:**
```
(activeMatter ? " · Dosya: " + cpTruncate(activeMatter.title, 40) : " · Bir dosyaya bağlanmayacak");
```

## [P1] eksik-aciklama — satir 5762

**Mevcut:**
```
auto.textContent = "otomatik — kontrol edin";
```

**Neden:** Damga alanın kendiliğinden dolduğunu söylüyor ama değerin NEREDEN geldiğini söylemiyor (avukat profili mi, dosya kaydı mı). Avukat neyi kontrol edeceğini bilmediği için ya körü körüne güveniyor ya da hepsini siliyor.

**Öneri:**
```
auto.textContent = "kayıtlarınızdan dolduruldu — doğruluğunu kontrol edin";
```

## [P1] jargon — satir 5862

**Mevcut:**
```
var rFree = textInput("f-rol", "Rol — serbest metin");
```

**Neden:** "Serbest metin" form mühendisliği terimi. Avukatın gördüğü kutuda ne yazması gerektiğini söylemiyor.

**Öneri:**
```
var rFree = textInput("f-rol", "Rolü kendiniz yazın (örn. müdahil)");
```

## [P1] anlasilmaz-cumle — satir 5869

**Mevcut:**
```
var kimlik = textInput("f-kimlik", "TCKN (11) / VKN (10)");
```

**Neden:** Parantez içindeki çıplak sayıların neyi anlattığı (hane sayısı) yazmıyor; eğik çizgi de "ikisinden biri" mi "ikisi birden" mi belirsiz bırakıyor. Alan tek kutu olduğu için avukat hangisini yazacağını kestiremiyor.

**Öneri:**
```
var kimlik = textInput("f-kimlik", "TC kimlik no (11 hane) veya vergi no (10 hane)");
```

## [P1] ui-kusuru — satir 6170

**Mevcut:**
```
dtiming.textContent = "taslak oluşturuluyor…";
```

**Neden:** Taslak üretimi uzun sürebilen tek işlemlerden biri; ekranda küçük bir gri satır ve ince bir çizgiden başka bir şey yok. Vazgeçme düğmesi yok, ne kadar süreceğine dair bir söz de yok — avukat sayfayı kapatmaya yöneliyor.

**Öneri:**
```
Uzun işlemler için kullanılan ilerleme kartı burada da çağrılmalı: aşama cümlesi ("Şablon dolduruluyor", "Kaynaklar bağlanıyor"), geçen süre ve gerçekten çalışan bir “Vazgeç” düğmesi. Yüzde gösterilmemeli.
```

## [P2] ton — satir 5347

**Mevcut:**
```
? (savedRunsCache.length ? "aktif dosyadaki kayıtlı araştırmalardan birini seçin" : "aktif dosyada kayıtlı araştırma yok")
```

**Neden:** Bu bölgedeki yardım satırlarının hepsi küçük harfle başlıyor ve özne düşürülmüş kısa notlar hâlinde; ürünün geri kalanında cümleler büyük harfle başlıyor. Avukata not bırakılmış gibi değil, kod yorumu gibi duruyor.

**Öneri:**
```
? (savedRunsCache.length ? "Bu dosyada kayıtlı araştırmalardan birini seçin." : "Bu dosyada kayıtlı araştırma yok.")
```

## [P2] ton — satir 5471

**Mevcut:**
```
emptyLine(target, "Bu süzgeçle şablon yok. Aramayı temizleyin ya da başka bir tür seçin.");
```

**Neden:** "Süzgeç" doğru Türkçe ama ekranda "süzgeç" diye bir öge yok; avukat üstteki arama kutusu ile tür düğmelerini kastettiğini bağlayamayabilir.

**Öneri:**
```
emptyLine(target, "Aramanıza ve seçtiğiniz türe uyan şablon yok. Arama kutusunu boşaltın ya da “Tümü”ne basın.");
```

## [P2] ui-kusuru — satir 5632

**Mevcut:**
```
emptyLine(box, humanError(error));
```

**Neden:** Bağlantı hatası, boş durum satırı biçiminde (soluk gri) yazılıyor; avukat bunu "kayıt yok" sanıp geçiyor, oysa liste alınamadı. Hata ile boşluk aynı görünmemeli.

**Öneri:**
```
errCard(box, "Kayıtlı taslaklar açılamadı", humanError(error));   /* boş durum değil, hata kartı */
```

## [P2] ui-kusuru — satir 5757

**Mevcut:**
```
var lab = el("label", "lab", def.label + (def.required || /isteğe bağlı/.test(def.label) ? "" : " (isteğe bağlı)"));
```

**Neden:** Yalnız isteğe bağlı alanlar işaretleniyor; zorunlu alanların hiçbir görsel işareti yok. Şablon kartında "5 zorunlu alan" yazıyor ama formda bunların hangileri olduğu ancak boş bırakılıp hata alınınca anlaşılıyor.

**Öneri:**
```
Zorunlu alanların etiketine de görünür bir işaret konmalı (örn. etiketin yanına küçük gri "zorunlu" yazısı); böylece avukat formu doldurmadan önce neyi doldurması gerektiğini görür.
```

## [P2] ui-kusuru — satir 5923

**Mevcut:**
```
var b = el("button", "rowdel", "✕");
```

**Neden:** Taraf ve olay satırlarını silen düğme yalnız bir çarpı işareti; fareyle üzerine gelince hiçbir açıklama çıkmıyor (title yok) ve tıklama onay istemeden satırı siliyor. Uzun doldurulmuş bir taraf satırı tek yanlış tıkla gidiyor.

**Öneri:**
```
var b = el("button", "rowdel", "✕");
    b.title = "Bu satırı sil";   /* ayrıca dolu bir satır silinirken tek adımlık geri alma sunulmalı */
```
