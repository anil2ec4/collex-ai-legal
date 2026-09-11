# js-harc-sozlesme

Bu bölge (harç hesabı, sözleşme kontrol listesi, yedekleme, klasörden toplu yükleme, belge sayfası eylemleri ve karşılama kartı sabitleri) teknik olarak dürüst çalışıyor ama dili ürünün kendi mühendislik dili. En ağır kusur karşılama kartındadır: avukatın gördüğü ilk cümlede "SHA-256 özeti", "tespit" ve "KAYNAKSIZ" geçiyor — kullanıcının birebir şikâyet ettiği kelime burada, açılış ekranında duruyor. Yedekleme bölümü ikinci ağır bölge: "veritabanı dökümü", "MANIFEST dosyası", "belge kimlikleri", "sunucu", "ColleX-Yedekle.cmd" gibi altı ayrı anlaşılmaz terim tek bir paragrafta toplanmış ve avukata ne yapacağını değil, sistemin içeride ne yaptığını anlatıyor. Harç ve sözleşme ekranlarında damgalar (DOĞRULANMADI, bilgi, var/yok/belirsiz) ekranda hiçbir yerde tanımlanmıyor; avukat neyin doğrulanmadığını ancak sayfanın altındaki uyarı listesine inerse öğrenebiliyor, o cümle de "etiketiyle geldi" diyerek mühendis gibi konuşuyor. Sözleşme listesi kurma formu avukattan "liste kimliği" istiyor — bu alan ürünün iç ihtiyacı, avukatın işi değil. Klasörden toplu yüklemede kart "yüklenecek" diyor ama yükleme zaten başlamış oluyor, hangi dava dosyasına yükleneceği ekranda hiç yazmıyor. Ayrıca birkaç kart boş durumda başlıklı ama içi boş çiziliyor (Uyarılar, Gözlemler, "nasıl okumalı") ve ham klasör yolu etiketsiz basılıyor.

Bulgu: 40

## [P0] jargon — satir 12612

**Mevcut:**
```
if (res.status === 404) { showNotYet(out, "POST /v1/fees/compute", "Harç hesabı ucu"); return; }
```

**Neden:** Ekranda "Harç hesabı ucu bu sunucuda henüz açık değil" cümlesi çıkıyor. "Uç" (endpoint) mühendislik terimidir ve Türkçede hiçbir anlama gelmiyor; "sunucu" da ikinci anlaşılmaz kelime. Avukat cümlenin öznesini bile çıkaramaz.

**Öneri:**
```
if (res.status === 404) { showNotYet(out, "POST /v1/fees/compute", "Harç hesabı"); return; }
```

**Not:** Aynı kusur bu bölgede iki yerde daha: 12723 ("Kontrol listesi ucu") ve 12833 ("Sözleşme inceleme ucu"). Üçünde de " ucu" eki silinmeli; ayrıca notYetCard'ın kendi metnindeki "bu sunucuda" ifadesi "bu kurulumda" olmalı.

## [P0] tanimsiz-terim — satir 12650

**Mevcut:**
```
if (s.verified === "dogrulanmadi") { c2.appendChild(chip("DOĞRULANMADI", "warn")); }
```

**Neden:** Harç tablosunda bir kalemin yanında büyük harfle "DOĞRULANMADI" yazıyor ama NEYİN doğrulanmadığı ekranda yazmıyor. Avukat bunu "bu harç yanlış" ya da "bu harç ödenmemiş" diye okur; oysa kastedilen, tutarın mevzuat metniyle karşılaştırılmamış olmasıdır. Açıklaması sayfanın çok altındaki uyarı listesinde, kartın kendisinde yok.

**Öneri:**
```
if (s.verified === "dogrulanmadi") { c2.appendChild(chip("tarife metni ile karşılaştırılmadı", "warn")); }
```

**Not:** Büyük harf de kaldırılmalı: ekranda BAĞIRAN damga, avukatı bilgilendirmiyor, tedirgin ediyor. Damganın yanına, aynı hücrede, tıklanınca "nasıl doğrularım" cümlesini açan küçük bir bağlantı konmalı (line.nasilDogrulanir zaten var, sadece bu tabloda gösterilmiyor).

## [P0] jargon — satir 12761

**Mevcut:**
```
labelledInput(grid, "cl-id", "Liste kimliği (harf, rakam, tire)", b2TextInput("kira-sozlesmesi", checklistDraft.id));
```

**Neden:** "Kimlik" burada ürünün iç kayıt anahtarıdır; avukatın işi değildir. Avukat "kimlik" deyince TC kimlik numarasını ya da müvekkil kimliğini anlar. Üstelik "harf, rakam, tire" kısıtı neden var olduğu söylenmeden dayatılıyor ve yanlış girilirse (line 12807) "Liste kimliği gerekli." diye yine aynı kelimeyle reddediliyor.

**Öneri:**
```
labelledInput(grid, "cl-id", "Kısa ad (kaydederken kullanılır — boşluk yerine tire koyun)", b2TextInput("kira-sozlesmesi", checklistDraft.id));
```

**Not:** Daha iyisi: bu alan tamamen kaldırılıp "Liste adı"ndan otomatik türetilmeli (Türkçe harfler sadeleştirilerek). Avukata iki isim sordurmak, ürünün kendi kayıt ihtiyacını kullanıcıya yıkmaktır.

## [P0] jargon — satir 12787

**Mevcut:**
```
card.appendChild(el("p", "note-p", "Kayıtlı liste bu sunucuda saklanır ve sonraki incelemelerde seçilebilir."));
```

**Neden:** "Sunucu" kelimesi kullanıcının bilmediğini birebir söylediği kelimelerden. Avukat programı kendi bilgisayarında çalıştırıyor; "sunucu" duyunca verisinin dışarı gittiğini sanabilir — bu ürün için tam ters bir izlenim.

**Öneri:**
```
card.appendChild(el("p", "note-p", "Kaydettiğiniz liste bu bilgisayarda kalır; sonraki sözleşme incelemelerinde listeden seçebilirsiniz."));
```

**Not:** Aynı düzeltme, bölgedeki bütün "bu sunucuda" kalıpları için geçerli (12906 dahil).

## [P0] jargon — satir 12906

**Mevcut:**
```
"Yedekleme bu sunucuda yapılandırılmadı — ColleX-Yedekle.cmd dosyasını kullanın."));
```

**Neden:** Üç ayrı sorun: "sunucu" (avukat kendi bilgisayarını sunucu diye bilmez), "yapılandırılmadı" (mühendis fiili), ve "ColleX-Yedekle.cmd" (uzantılı dosya adı — avukat bunu nerede bulacağını bilmez, üstelik .cmd dosyası Windows'ta çoğu kullanıcıya tehlikeli görünür).

**Öneri:**
```
"Yedekleme bu ekrandan açılmamış. Bilgisayarınızın masaüstünde ya da ColleX klasöründe " +
          "bulunan “ColleX Yedekle” kısayolunu çift tıklayarak yedek alabilirsiniz; ekrandan da " +
          "alınabilmesi için kurulumu yapan kişiye söyleyin."));
```

**Not:** Kısayolun gerçek adı .cmd ise bile ekranda tırnak içinde okunur adıyla anılmalı ve NEREDE olduğu yazılmalı; şu anki cümle avukatı arama yapmaya bırakıyor.

## [P0] jargon — satir 12935

**Mevcut:**
```
body.appendChild(el("p", "note-p",
      "Geri yükleme: yedek klasöründeki MANIFEST dosyası hangi veritabanının ve hangi belgelerin " +
      "kopyalandığını yazar. Geri yüklemek için ColleX'i kapatın, klasörü sistemi kuran kişiye verin; " +
      "veritabanı dökümü ve “<veri klasörü>/uploads (varsayılan: var/uploads)” klasörü birlikte " +
      "geri alınır. Yedek klasörünü elle açıp " +
      "içindeki dosyaları tek tek kopyalamayın — belge kimlikleri veritabanıyla eşleşmelidir."));
```

**Neden:** Tek paragrafta altı anlaşılmaz şey var: MANIFEST, veritabanı, veritabanı dökümü, <veri klasörü>/uploads, var/uploads ve "belge kimlikleri". Avukat bu cümleden ne yapacağını çıkaramaz; sadece "bir şeyi yanlış yaparsam her şey gider" hissi kalır. Üstelik dosya yolu şablonu (<veri klasörü>) ekranda ham haliyle duruyor.

**Öneri:**
```
body.appendChild(el("p", "note-p",
      "Geri yükleme: Bu klasörü açıp içinden tek tek dosya kopyalamayın — belgeler ancak " +
      "kayıt listesiyle birlikte anlam taşır. Kayıp durumunda ColleX'i kapatın ve klasörün " +
      "tamamını, olduğu gibi, kurulumu yapan kişiye verin; hangi dosyaların kopyalandığı " +
      "klasörün içindeki listede yazılıdır."));
```

**Not:** Teknik içerik kaybolmuyor: "tek tek kopyalamayın" yasağı ve "klasörün tamamı" kuralı aynen duruyor, sadece iç isimler (manifest, döküm, uploads) ekrandan kalkıyor.

## [P0] jargon — satir 12955

**Mevcut:**
```
phase: "Veritabanı dökümü ve belge asılları yedek klasörüne kopyalanıyor.",
```

**Neden:** "Veritabanı dökümü" avukatın bilmediği iki teknik kelimenin birleşimidir; "döküm" kelimesi hukukçuda "hesap dökümü" çağrışımı yapar ve yanlış anlaşılır. Bu cümle, dakikalarca süren bir beklemenin tek açıklamasıdır — anlaşılmazsa bekleme de anlamsızlaşır.

**Öneri:**
```
phase: "Dava kayıtlarınız ve yüklediğiniz belgelerin asılları yedek klasörüne kopyalanıyor.",
```

**Not:** Bekleme ekranındaki tek bilgilendirme cümlesi olduğu için burada sadelik pahalıya değil, ucuza mal olur.

## [P0] jargon — satir 13070

**Mevcut:**
```
sourceLabel: (f.name || "Belge") + " — " + have + "/" + total + " bölüm önizlemesi",
```

**Neden:** Denetim ekranının başlığında "3/12 bölüm önizlemesi" yazacak. "Bölüm önizlemesi" tanımsız bir üründür terimi; "3/12" ise avukata neyin eksik olduğunu söylemez.

**Öneri:**
```
sourceLabel: (f.name || "Belge") + " — belgenin " + have + " bölümünden kısa alıntılar (toplam " + total + " bölüm)",
```

**Not:** Aynı etiket denetim raporuna da yazıldığı için burada kısa ve kendi kendini açıklayan olmalı.

## [P0] jargon — satir 13071

**Mevcut:**
```
note: "Denetlenen metin, belgenin BÖLÜM ÖNİZLEMELERİDİR (her bölümün ilk 240 karakteri" +
```

**Neden:** "Bölüm önizlemesi" ve "karakter" ürünün iç kavramlarıdır (chunk/preview); avukat belgesinin neden tamamının değil de bir kısmının incelendiğini bu cümleden anlayamaz. Üstelik BÜYÜK HARFLE yazılmış, cümle beş satır sürüyor ve avukata ne yapması gerektiğini ancak en sonda söylüyor.

**Öneri:**
```
note: "Bu denetim, belgenin TAMAMI üzerinde değil, her bölümünün ilk birkaç satırı üzerinde " +
        "yapıldı" +
```

**Not:** Devamındaki cümleler de sadeleştirilmeli (aşağıdaki ayrı bulgulara bakın). Kritik kural korunmalı: eksik metin yüzünden bir atıf GÖRÜNMEYEBİLİR, ama var olan bir hüküm asla uydurulmaz — bu cümle kalmalı, sadece kısalmalı.

## [P0] anlasilmaz-cumle — satir 13073

**Mevcut:**
```
"). Belgenin ön incelemesi TAM metinde " + known + " atıf saymıştı; aşağıdaki “Atıfları bul” " +
        "bundan az sayarsa fark, önizlemeye girmeyen metindendir. Tam denetim için belgenin " +
        "tam metnini kutuya yapıştırın. Eksik metin atıfı EKSİK bildirir; var olan bir hükmü asla uydurma göstermez."
```

**Neden:** Tek nefeste dört ayrı iddia var, ikisi sayısal karşılaştırma; "önizlemeye girmeyen metinden" ifadesi ürünün iç işleyişini anlatıyor. Avukat bu paragrafı okuyup ne yapması gerektiğini bulamaz — asıl yapılacak iş ("tam metni yapıştırın") üçüncü cümlede gizli.

**Öneri:**
```
"). Tam sonuç için belgenin tam metnini aşağıdaki kutuya yapıştırın. " +
        "Belgenin ilk incelemesinde " + known + " atıf görülmüştü; burada daha az çıkarsa sebebi " +
        "denetlenen metnin kısa olmasıdır. Eksik metin bir atfı gözden kaçırabilir; olmayan bir " +
        "hükmü ise asla var göstermez."
```

**Not:** Yapılacak iş cümlesi başa alındı. "EKSİK bildirir" gibi büyük harfli damga kaldırıldı, iddia aynen korundu.

## [P0] jargon — satir 13109

**Mevcut:**
```
var WELCOME_LEAD_TR = "Belgelerinizi ve mevzuatı tarar, her tespiti belge sürümü ve SHA-256 " +
    "özetiyle bağlar, süreleri hesaplar ve dilekçe taslağı yazar. Kaynağı olmayan cümleyi " +
    "KAYNAKSIZ diye işaretler.";
```

**Neden:** Bu ürünün gördüğü İLK cümledir ve içinde üç anlaşılmaz şey var: "SHA-256 özeti" (avukat için hiçbir anlamı yok, kullanıcının birebir şikâyet ettiği kelime), "tespit" (burada iddia/cümle anlamında kullanılmış ama Türk hukukunda tespit başka şeydir — tespit davası, delil tespiti) ve "KAYNAKSIZ" (ekranda hiçbir yerde tanımlanmayan uydurma damga). Avukat açılış ekranında bunu görüp kapatır.

**Öneri:**
```
var WELCOME_LEAD_TR = "Belgelerinizi ve mevzuatı tarar; yazdığı her cümlenin altına dayandığı " +
    "belgeyi ve o belgedeki tam alıntıyı koyar, alıntının sonradan bozulmadığını kendiliğinden " +
    "denetler. Süreleri hesaplar, dilekçe taslağı yazar. Dayanağı olmayan bir cümle kalırsa " +
    "onu ayrıca işaretler.";
```

**Not:** Teknik doğruluk korunuyor: "alıntının bozulmadığı kendiliğinden denetlenir" cümlesi SHA-256 karşılaştırmasının yaptığı işin aynısını söyler, doğruluk yüzdesi iddia etmez. DİKKAT: console.test.ts bu üç sabitten sözcük sayar (en çok 90 sözcük); önerilen metin sayıyı birkaç sözcük artırır, testteki bütçe birlikte kontrol edilmeli.

## [P1] jargon — satir 12610

**Mevcut:**
```
document.getElementById("harc-timing").textContent = (Date.now() - t0) + " ms";
```

**Neden:** Ekranda etiketsiz bir "482 ms" beliriyor. "ms" avukat için anlamsızdır ve neyin süresi olduğu yazmıyor; hesabın kendisiyle ilgili bir sayı sanılabilir (tutar, madde numarası).

**Öneri:**
```
document.getElementById("harc-timing").textContent = "hesap süresi: " + ((Date.now() - t0) / 1000).toFixed(1).replace(".", ",") + " sn";
```

**Not:** Aynı kusur 12831'de (sozlesme-timing). Bu sayı avukat için bilgi değil; en iyisi tamamen kaldırmak, kalacaksa Türkçe etiketli ve saniye cinsinden olmalı.

## [P1] anlasilmaz-cumle — satir 12643

**Mevcut:**
```
typeof s.amount === "number" ? fmtTL(s.amount) : "tutar girilmeli");
```

**Neden:** Edilgen ve faili belirsiz: kim girecek, nereden bulacak, girmezse ne olacak yazmıyor. Avukat tabloda tutar bekliyor, yerine emir görüyor.

**Öneri:**
```
typeof s.amount === "number" ? fmtTL(s.amount) : "tarifeden siz gireceksiniz");
```

**Not:** Aşağıdaki "Eksik tutarları girin" kartıyla bağı da görünür olmalı: hücre, o karta götüren bir bağlantı olabilir.

## [P1] tanimsiz-terim — satir 12649

**Mevcut:**
```
else { c2.appendChild(chip("bilgi", "mute")); }
```

**Neden:** Harç tablosunun "Durum" sütununda "bilgi" yazan gri bir damga çıkıyor. "Bilgi" bir durum değildir; avukat bu satırın hesaba dahil olup olmadığını anlayamaz.

**Öneri:**
```
else { c2.appendChild(chip("hesaba katılmadı — açıklama satırı", "mute")); }
```

**Not:** Eğer bu satırlar gerçekten hesaba katılıyorsa damga "hesaba katıldı" olmalı; ürünün hangisi olduğunu ekranda söylemesi şart.

## [P1] ui-kusuru — satir 12697

**Mevcut:**
```
wc.appendChild(el("h3", "fname", "Uyarılar"));
```

**Neden:** body.warnings boş ve doğrulanmamış kalem de yoksa ekranda "Uyarılar" başlıklı, içi tamamen boş bir kart kalıyor. Boş kart avukatta "bir şey yüklenmedi mi?" endişesi yaratır; boş durum metni yok.

**Öneri:**
```
var warnItems = (body.warnings || []).slice();
    if ((body.dogrulanmamisKalemler || []).length) { /* mevcut satır */ }
    if (!warnItems.length && !(body.dogrulanmamisKalemler || []).length) {
      wc.appendChild(el("p", "note-p", "Bu hesapta ayrıca uyarı yok."));
    } else { wc.appendChild(ul); }
```

**Not:** Aynı kusur bu bölgede iki yerde daha: 12886-12891 ("Bu incelemeyi nasıl okumalı" kartı, notices boşsa boş liste) ve 12705 (disclaimer boşsa boş <p>). Üçünde de ya boş durum cümlesi ya da kartın hiç çizilmemesi gerekir.

## [P1] ton — satir 12702

**Mevcut:**
```
" kalem DOĞRULANMADI etiketiyle geldi: oran ya da tutar madde metniyle karşılaştırılmadı."));
```

**Neden:** "Etiketiyle geldi" — nereden geldi? Ürün kendi iç veri akışını anlatıyor, avukata değil. Avukat için önemli olan tek şey: bu tutara güvenip güvenemeyeceği ve ne yapması gerektiği; ikisi de cümlede yok.

**Öneri:**
```
" kalemin tutarı yürürlükteki tarife metniyle karşılaştırılmadı. Harç makbuzunu kesmeden önce bu kalemleri tarifeden teyit edin."));
```

**Not:** Uyarının bir eylem cümlesiyle bitmesi şart; şu hâliyle avukat okuyup geçiyor.

## [P1] tanimsiz-terim — satir 12771

**Mevcut:**
```
var l3 = labelledInput(r, "cl-weak-" + i, "Zayıf ifadeler (belirsiz sayılır)", b2TextInput("teminat", it.weakTerms));
```

**Neden:** "Zayıf ifade" ekranda hiçbir yerde tanımlanmayan uydurma bir kavramdır. Parantez içindeki "belirsiz sayılır" de bir şey açıklamıyor: neyin belirsiz sayılacağı, sonucu nasıl etkileyeceği yazmıyor.

**Öneri:**
```
var l3 = labelledInput(r, "cl-weak-" + i, "Şüpheli ifadeler — bunlardan biri geçerse madde “kesin var” değil “şüpheli” işaretlenir", b2TextInput("teminat", it.weakTerms));
```

**Not:** Örnek değer ("teminat") iyi seçilmiş; etiket onu açıklayınca alan kendi kendini anlatır hâle gelir.

## [P1] anlasilmaz-cumle — satir 12779

**Mevcut:**
```
acts.appendChild(ghostBtn("+ Madde ekle", function () {
```

**Neden:** Bu ekranda "madde" iki ayrı anlamda kullanılıyor: burada kontrol listesinin bir satırı, sonuç ekranında (12860) sözleşmenin maddesi ("Madde 5"). Avukat "+ Madde ekle" düğmesini sözleşmeye madde ekleyecek sanabilir.

**Öneri:**
```
acts.appendChild(ghostBtn("+ Kontrol satırı ekle", function () {
```

**Not:** Sonuç ekranındaki "Madde 5" ifadesi doğrudur ve kalmalı; çakışan taraf listenin kendi satırıdır.

## [P1] jargon — satir 12807

**Mevcut:**
```
if (!cl.id) { toast("Liste kimliği gerekli.", "warn"); return; }
```

**Neden:** Hata mesajı, avukatın anlamadığı alan adını ("liste kimliği") tekrar ederek reddediyor ve ne yazması gerektiğini söylemiyor. Reddedilen kullanıcı, ne yapacağını bilmeden ekranda kalıyor.

**Öneri:**
```
if (!cl.id) { toast("Listeye kısa bir ad yazın (örnek: kira-sozlesmesi). Kaydederken bu ad kullanılır.", "warn"); return; }
```

**Not:** 12808'deki mesaj da aynı sorunu taşıyor: "En az bir madde: başlık ve aranacak ifade dolu olmalı." → "En az bir kontrol satırı doldurun: hem başlığı hem de aranacak ifadeyi yazın."

## [P1] tanimsiz-terim — satir 12849

**Mevcut:**
```
head.appendChild(chip((t.VAR || 0) + " var", "ok"));
```

**Neden:** Sözleşme inceleme başlığında "7 var · 2 yok · 1 belirsiz" yazıyor. NEYİN var olduğu yazmıyor. Avukat bunu maddelerin sayısı mı, sorunların sayısı mı diye ayırt edemez; renkli damga (yeşil/kırmızı) da işi ters yönde etkiliyor çünkü "yok" kırmızı ama bazen bir hükmün yokluğu iyi haberdir.

**Öneri:**
```
head.appendChild(chip((t.VAR || 0) + " madde sözleşmede bulundu", "ok"));
```

**Not:** Devamındaki iki damga da aynı şekilde: 12850 → "… madde sözleşmede bulunamadı", 12851 → "… madde şüpheli (benzer ifade var, emin değil)". Kırmızı/yeşil renk kodu ise kaldırılmalı ya da nötr tona çekilmeli — bulunamamış madde her zaman kötü değildir.

## [P1] eksik-aciklama — satir 12876

**Mevcut:**
```
oc.appendChild(el("h3", "fname", "Gözlemler"));
```

**Neden:** "Gözlemler" başlığı altında maddeler sıralanıyor ama bunların ne olduğu, kim tarafından üretildiği, hukukî bir değerlendirme olup olmadığı hiç yazmıyor. Avukat bunu "programın hukukî yorumu" sanabilir — ürünün asla iddia etmediği şey.

**Öneri:**
```
oc.appendChild(el("h3", "fname", "Sözleşmede dikkat çeken noktalar"));
      oc.appendChild(el("p", "note-p", "Aşağıdakiler hukukî değerlendirme değildir; sözleşme metninde geçen ifadelerin altı çizilmiştir. Değerlendirme size aittir."));
```

**Not:** Bu kartta ayrıca kaynağı doğrulanmamış satırlar farklı renkte çiziliyor (aşağıdaki bulgu) ama rengin ne demek olduğunu söyleyen tek bir cümle yok.

## [P1] eksik-aciklama — satir 12878

**Mevcut:**
```
var line = el("div", "obsline" + (x.o.sourced === false ? " unsourced" : ""),
```

**Neden:** Kaynağı doğrulanamayan satırlar görsel olarak farklı çiziliyor ama ekranda bu farkın ne anlama geldiğini söyleyen bir açıklama (lejant) yok. Renk körü ya da aceleci bir okuyucu için bu ayrım tamamen görünmez; görse bile anlamını bilemez.

**Öneri:**
```
var line = el("div", "obsline" + (x.o.sourced === false ? " unsourced" : ""),
          "Madde " + x.clause + " — " + (x.o.text || ""));
        if (x.o.sourced === false) { line.appendChild(chip("sözleşme metninden doğrulanamadı", "warn")); }
```

**Not:** Doğrulanmış satırdaki chip (12880) zaten var; doğrulanmamış olana da görünür bir etiket gerekli — renk tek başına bilgi taşımaz.

## [P1] ui-kusuru — satir 12931

**Mevcut:**
```
if (b && b.path) { body.appendChild(el("div", "backpath", b.path)); }
```

**Neden:** Ekrana etiketsiz, çıplak bir klasör yolu basılıyor ("C:\...\var\yedek\2026-09-03" gibi). Avukat bunun ne olduğunu, tıklanabilir olup olmadığını, oraya nasıl gideceğini bilmiyor. Ne başlık var ne de klasörü açan bir düğme.

**Öneri:**
```
if (b && b.path) {
      body.appendChild(el("div", "fieldlabel", "Yedeğin bulunduğu klasör"));
      body.appendChild(el("div", "backpath", b.path));
      body.appendChild(el("p", "note-p", "Bu yazıyı kopyalayıp Dosya Gezgini'nin adres çubuğuna yapıştırarak klasöre ulaşabilirsiniz."));
    }
```

**Not:** Yolun seçilebilir/kopyalanabilir olduğu da görsel olarak belli olmalı; şu an düz metin gibi duruyor.

## [P1] anlasilmaz-cumle — satir 12933

**Mevcut:**
```
"Bu klasör müvekkil verisi içerir — şifreli bir diske veya BitLocker'lı bir klasöre koyun."));
```

**Neden:** İki sorun: "BitLocker'lı klasör" avukatın bilmediği bir Windows özelliğidir ve cümle onu tanımlamıyor; ayrıca "koyun" diyor ama yedeğin nereye alınacağını avukat bu ekrandan seçemiyor — yapamayacağı bir iş emredilmiş oluyor.

**Öneri:**
```
"Bu klasörde müvekkil belgeleri var. Klasörü herkesin erişebildiği bir yerde (ortak ağ sürücüsü, " +
      "masaüstü, bulut klasörü) tutmayın; şifreyle korunan bir diske alın. Yedeğin yerini " +
      "değiştirmek için kurulumu yapan kişiye söyleyin."));
```

**Not:** KVKK açısından da doğrusu budur: emir değil, sınır ve muhatap gösteren cümle.

## [P1] ui-kusuru — satir 12988

**Mevcut:**
```
accepted.length + " belge yüklenecek" + (skipped.length ? ", " + skipped.length + " dosya atlandı (desteklenmeyen tür)" : "") + "."));
```

**Neden:** Cümle "yüklenecek" diyerek bir onay bekleniyormuş izlenimi veriyor, oysa hemen ardından (13002) yükleme kendiliğinden başlıyor. Avukat 80 belgelik bir klasörü yanlışlıkla seçtiğinde geri dönüşü yok, onay adımı da vazgeçme düğmesi de yok. "Desteklenmeyen tür" ayrıca mühendis dili.

**Öneri:**
```
accepted.length + " belge yükleniyor" + (skipped.length ? ", " + skipped.length + " dosya atlandı (ColleX yalnızca PDF, Word, düz metin ve UDF dosyalarını okuyabiliyor)" : "") + "."));
```

**Not:** Asıl düzeltme metin değil akış: 10'dan fazla belge seçildiğinde "X belgeyi <dava dosyası> dosyasına yükle" onay düğmesi çıkmalı. Şu hâliyle geri alınamaz bir işlem tek tıkla başlıyor.

## [P1] eksik-aciklama — satir 13002

**Mevcut:**
```
uploadFiles(accepted, {
      matterId: activeMatter ? activeMatter.id : null,
```

**Neden:** Toplu yükleme belgeleri sessizce AKTİF dava dosyasına bağlıyor, ama ekranda hangi dosyaya yükleneceği hiçbir yerde yazmıyor. Avukat gün içinde dosya değiştirdiğinde 60 belge yanlış dosyaya girer ve bunu ancak sonra fark eder.

**Öneri:**
```
card.appendChild(el("p", "note-p", activeMatter
      ? ("Bu belgeler “" + activeMatter.title + "” dosyasına eklenecek.")
      : "Şu anda açık bir dava dosyası yok; bu belgeler dosyaya bağlanmadan yüklenecek. İsterseniz önce bir dosya seçin."));
```

**Not:** Bu cümle yükleme başlamadan ÖNCE, kartın en üstünde görünmeli.

## [P1] jargon — satir 13083

**Mevcut:**
```
toast("Metin bölüm önizlemelerinden derlendi (bölüm başına 240 karakter); tam metni yapıştırırsanız inceleme daha isabetli olur.", "warn");
```

**Neden:** Uyarı balonu için hem çok uzun hem de iki teknik terim içeriyor ("bölüm önizlemesi", "karakter"). Balon birkaç saniye durup kaybolur; avukat okuyamadan gider, okusa anlamaz.

**Öneri:**
```
toast("Belgenin tamamı değil, her bölümünden kısa alıntılar getirildi. Tam metni kutuya yapıştırırsanız inceleme daha isabetli olur.", "warn");
```

**Not:** Aynı bilgi ayrıca sözleşme metni kutusunun üstünde kalıcı bir satır olarak da durmalı; balon kaybolduktan sonra ekranda hiçbir iz kalmıyor.

## [P2] ton — satir 12670

**Mevcut:**
```
"Bu tutarlar her yıl Resmî Gazete'de yeniden belirlenir; ColleX bunları uydurmaz. " +
```

**Neden:** "ColleX bunları uydurmaz" savunmacı, mühendis içi bir cümledir — ürünün kendi kendini temize çıkarma refleksidir. Avukat okuduğunda "demek ki bazı yerlerde uyduruyor" diye düşünür; güven artırmaz, azaltır.

**Öneri:**
```
"Bu tutarlar her yıl Resmî Gazete'de yeniden belirlenir. Bilinmeyen bir tutar tahmin edilmez; " +
```

**Not:** Aynı bilgi olumlu ve kurumsal bir dille verilince güven artar.

## [P2] anlasilmaz-cumle — satir 12671

**Mevcut:**
```
"Yürürlükteki tarifeden okuyup buraya girin, hesap sizin girdiğiniz tutarla yenilenir."));
```

**Neden:** "Yürürlükteki tarife" hangi tarife? Harçlar Kanunu'na bağlı tarife mi, baro tarifesi mi, vekâlet ücreti tarifesi mi belirsiz. Avukat hukuk terimini bilir ama hangi belgeye bakacağını bu cümleden çıkaramaz.

**Öneri:**
```
"İlgili tarifeden (Harçlar Kanunu'na bağlı tarife) okuyup buraya girin; hesap girdiğiniz tutarla yeniden yapılır."));
```

**Not:** Her kalemin nasilDogrulanir cümlesi zaten hangi maddeye bakılacağını yazıyor (12686); bu genel cümlenin de aynı düzeyde somut olması gerekir.

## [P2] anlasilmaz-cumle — satir 12728

**Mevcut:**
```
.concat([["__new__", "+ Yeni kontrol listesi kur"]]);
```

**Neden:** "Liste kurmak" Türkçede tuhaf bir eşleşme (kurul kurulur, liste hazırlanır/oluşturulur). Ayrıca bu seçeneğin seçilince ne olacağı (aşağıda bir form açılacağı) yazmıyor.

**Öneri:**
```
.concat([["__new__", "+ Yeni kontrol listesi hazırla"]]);
```

**Not:** Seçildikten sonra açılan kartın başlığı (12759 "Yeni kontrol listesi") de "Yeni kontrol listesi hazırlayın" olmalı — başlık değil, yönerge olmalı.

## [P2] anlasilmaz-cumle — satir 12773

**Mevcut:**
```
var l4 = labelledInput(r, "cl-note-" + i, "Notum", b2TextInput("", it.note));
```

**Neden:** "Notum" tek başına, kimin notu ve nerede görüneceği belirsiz bir etiket. Avukat bu alanın rapora yansıyıp yansımayacağını bilmediği için doldurmaz.

**Öneri:**
```
var l4 = labelledInput(r, "cl-note-" + i, "Kendi notunuz (isteğe bağlı — inceleme sonucunda bu satırın altında görünür)", b2TextInput("", it.note));
```

**Not:** Not gerçekten sonuçta gösteriliyor (12862'de why dizisine ekleniyor); etiket bunu söylemeli.

## [P2] ui-kusuru — satir 12846

**Mevcut:**
```
head.appendChild(el("h3", "fname", (body.documentTitle || "Sözleşme") + " — " + (body.checklistTitle || "")));
```

**Neden:** checklistTitle boş geldiğinde başlık "Kira sözleşmesi — " şeklinde, havada asılı bir tire ile bitiyor. Yarım kalmış bir başlık, ekranın bir yerinin bozuk olduğu izlenimi verir.

**Öneri:**
```
head.appendChild(el("h3", "fname", (body.documentTitle || "Sözleşme") + (body.checklistTitle ? " — " + body.checklistTitle : "")));
```

**Not:** Aynı savunmasızlık 12856'da da var: f.stateLabel boşsa renkli ama içi boş bir damga çiziliyor.

## [P2] ton — satir 12861

**Mevcut:**
```
if (f.matchedTerm) { why.push("eşleşen ifade: " + f.matchedTerm); }
```

**Neden:** "Eşleşme" arama motoru dilidir. Avukat için doğal olan "sözleşmede geçen ifade"dir; ayrıca ifadenin sözleşmeden mi kontrol listesinden mi geldiği şu hâliyle belirsiz.

**Öneri:**
```
if (f.matchedTerm) { why.push("sözleşmede geçen ifade: “" + f.matchedTerm + "”"); }
```

**Not:** Tırnak, alıntının sözleşme metninden geldiğini görsel olarak da belli eder.

## [P2] eksik-aciklama — satir 12921

**Mevcut:**
```
line.appendChild(el("span", "state none", "Henüz hiç yedek alınmadı — verileriniz tek bir diskte."));
```

**Neden:** Doğru ve dürüst bir uyarı ama ne yapılacağını söylemiyor; boş durumda avukatı bir sonraki adıma götüren cümle yok.

**Öneri:**
```
line.appendChild(el("span", "state none", "Henüz hiç yedek alınmadı. Bilgisayarınız bozulursa dosyalarınızın kopyası olmaz — aşağıdaki düğmeyle şimdi bir yedek alın."));
```

**Not:** Yedekleme düğmesinin etiketi de (HTML tarafında, backupgo) neyin olacağını söylemeli: "Şimdi yedek al".

## [P2] ui-kusuru — satir 12926

**Mevcut:**
```
(typeof b.files === "number" ? b.files + " belge · " : "") +
        (typeof b.sizeBytes === "number" ? Math.max(1, Math.round(b.sizeBytes / 1024)) + " KB" : ""));
```

**Neden:** İki sorun: boyut her zaman KB cinsinden yazılıyor, 3 GB'lık bir yedek "3145728 KB" olarak okunamaz hâle geliyor; ayrıca Math.max(1, …) yüzünden bomboş bir yedek bile "1 KB" gösteriyor — küçük ama gerçek olmayan bir sayı.

**Öneri:**
```
(typeof b.files === "number" ? b.files + " belge · " : "") +
        (typeof b.sizeBytes === "number" ? fmtBoyut(b.sizeBytes) : ""));
```

**Not:** fmtBoyut, 1024'ün altını "1 KB'den küçük", MB/GB eşiklerini Türkçe ondalık ayraçla yazan küçük bir yardımcı olmalı. Uydurulmuş asgari 1 KB kaldırılmalı.

## [P2] eksik-aciklama — satir 12928

**Mevcut:**
```
if (b.stale === true) { line.appendChild(chip("7 günden eski", "warn")); }
```

**Neden:** Damga bir gerçeği bildiriyor ama sonucunu ve yapılacak işi söylemiyor. Avukat "7 gün" eşiğinin nereden geldiğini de bilmiyor.

**Öneri:**
```
if (b.stale === true) { line.appendChild(chip("son bir haftadır yedek alınmadı — yenileyin", "warn")); }
```

**Not:** Eşiğin kendisi ürün kararıdır ve ekranda gerekçelendirilmesi gerekmez; ama damga eylem söylemelidir.

## [P2] ui-kusuru — satir 12966

**Mevcut:**
```
toast("Yedek alındı: " + b.path, "ok");
```

**Neden:** Uyarı balonuna uzun bir klasör yolu sığmıyor; kırpılıyor ve birkaç saniye sonra kayboluyor. Avukat yedeğin nereye alındığını balondan öğrenemez.

**Öneri:**
```
toast("Yedek alındı. Klasörün yeri aşağıda yazıyor.", "ok");
```

**Not:** Yol zaten kartta gösteriliyor (12931); balon sadece işin bittiğini söylemeli.

## [P2] anlasilmaz-cumle — satir 13005

**Mevcut:**
```
onDone: function () { toast(accepted.length + " belge işlendi.", "ok"); }
```

**Neden:** "İşlendi" ne demek: yüklendi mi, okundu mu, incelendi mi? Avukat bundan sonra nereye bakacağını da bilmiyor.

**Öneri:**
```
onDone: function () { toast(accepted.length + " belge yüklendi. Belgeler ekranından açabilirsiniz.", "ok"); }
```

**Not:** Bitiş bildirimlerinin bir sonraki adımı göstermesi, ekranlar arası kaybolmayı önler.

## [P2] jargon — satir 13097

**Mevcut:**
```
sourceLabel: "Taslak: " + (editor.draft.title || "") + " (v" + (editor.draft.version || 1) + ") — tam metin"
```

**Neden:** "v3" yazılım sürüm gösterimidir; avukat "3. sürüm" bekler. Ayrıca bu etiket denetim raporuna da yazıldığı için dosyaya giden metinde de "v3" görünür.

**Öneri:**
```
sourceLabel: "Taslak: " + (editor.draft.title || "") + " (" + (editor.draft.version || 1) + ". sürüm) — tam metin"
```

**Not:** Küçük ama dosyaya giden bir metin olduğu için önemli.

## [P2] anlasilmaz-cumle — satir 13204

**Mevcut:**
```
toast("Aktif dosya başka sekmede değişti: " + (activeMatter ? activeMatter.title : "dosyasız çalışma"), "");
```

**Neden:** "Dosyasız çalışma" ekranda hiçbir yerde tanımlanmayan bir durum adıdır; "sekme" de tarayıcı terimidir ama en azından yaygındır. Avukat "dosyasız çalışma" ifadesini bir hata sanabilir.

**Öneri:**
```
toast("Açık dava dosyası başka pencerede değişti: " + (activeMatter ? activeMatter.title : "artık hiçbir dosya seçili değil"), "");
```

**Not:** Bu bildirim yanlış dosyaya yükleme yapmayı önleyen kritik bir uyarı; anlaşılır olması diğerlerinden daha önemli.
