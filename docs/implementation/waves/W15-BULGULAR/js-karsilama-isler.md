# js-karsilama-isler

Bu bölge ürünün günlük çalışma iskeletini çiziyor: karşılama kartı, Dosyalarım tablosu, dosya sayfası sekmeleri (belgeler, araştırmalar, taslaklar, zaman çizelgesi, süreler, notlar), süre hesap penceresi, cevap üst bilgisi (künye) ve belge×soru ızgarası. Türkçesi genel olarak diğer bölgelerden iyi; çok sayıda uyarı gerçekten avukat diliyle yazılmış (süre feragatnamesi, tebligat doğrulama uyarıları, mükerrer dosya uyarısı gibi). Ama üç ciddi sorun var. Birincisi, avukatın ilk gördüğü karşılama kartı doğrudan "SHA-256" ve "veritabanı" diyor; ürünün en kritik ilk izlenimi mühendis diliyle açılıyor. İkincisi, "korpus", "SENTETİK", "kesinleştirilemez", "pasaj", "tespit", "kapsam", "kimlik" gibi tanımsız terimler cevap künyesinde, araştırma listesinde ve ızgarada tanımsız olarak dolaşıyor; tek cümlelik tanımlar sadece fare üstüne gelince çıkan `title` ipucunda saklı, yani dokunmatik ekranda ve klavyeyle hiç görünmüyor. Üçüncüsü, dosya silme hatasında ekran "Belge silinemedi" diyor — silinmeye çalışılan şey dosyanın kendisi; bu doğrudan yanlış bilgi. Ayrıca "Süre başlat" gibi ne yapacağını söylemeyen düğmeler, sessizce kırpılan altı soruluk ızgara sınırı ve tarihsiz "alınma 14:22" gibi eksik bilgi kusurları var.

Bulgu: 40

## [P0] jargon — satir 8157

**Mevcut:**
```
"Sistem: veritabanı " + (DB_STATE_TR[h.db] || h.db || "?") +
```

**Neden:** Karşılama kartının son satırı. "Veritabanı" ve "Bulut AI" avukat sözlüğünde yok; üstelik bu bilgi ilk açılışta avukatın yapabileceği hiçbir şeye yaramıyor — sadece anlamadığı üç kavramla karşılaşıyor. "?" yedeği ise büsbütün anlamsız.

**Öneri:**
```
"Program çalışmaya hazır: kayıtlarınız bu bilgisayarda tutuluyor." (ayrıntılı durum satırı yalnız Ayarlar ekranında kalsın)
```

## [P0] anlasilmaz-cumle — satir 8550

**Mevcut:**
```
"Belge silinemedi — " + httpStatusTR(res.status) + " (HTTP " + res.status + ")"
```

**Neden:** Bu satır DAVA DOSYASININ silinmesi başarısız olduğunda çalışıyor, ama ekranda "Belge silinemedi" yazıyor. Avukat dosyayı silmeye çalışmışken kendisine belgeden söz ediliyor: hangi işlemin başarısız olduğunu bilemez, dosyanın silinip silinmediğini anlamaz. Ayrıca sonda parantez içinde makine kodu (HTTP 500) duruyor.

**Öneri:**
```
"Dosya silinemedi — " + httpStatusTR(res.status) + ". Dosya ve içindeki kayıtlar duruyor; birazdan yeniden deneyin."
```

## [P0] jargon — satir 8745

**Mevcut:**
```
        sub.appendChild(chip(answerModeLabel(a), "mute"));
```

**Neden:** Dosya sayfasının "Araştırmalar" listesinde her satıra çizilen çip; ürettiği metin "Belge + korpus" oluyor. "Korpus" tanımsız; "Belge" de tek başına neyin kastedildiğini (avukatın yüklediği belgeler) söylemiyor.

**Öneri:**
```
        sub.appendChild(chip(a.fileScope && Array.isArray(a.fileScope.fileIds) ? (a.fileScope.includeCorpus ? "yüklediğiniz belgeler + arşiv" : "yalnız yüklediğiniz belgeler") : "bu bilgisayardaki arşiv", "mute"));
```

## [P0] tanimsiz-terim — satir 8747

**Mevcut:**
```
          (a.finalizable === false ? " · kesinleştirilemez" : "")));
```

**Neden:** "Kesinleştirilemez" uydurulmuş bir damgadır; ekranda tanımı yoktur. Avukat bunu "karar kesinleşmemiş" sanabilir — hukukta bu sözcüğün çok güçlü ve bambaşka bir anlamı var. Kastedilen ise "bu cevabın dayanakları dilekçeye konulacak olgunlukta değil".

**Öneri:**
```
          (a.finalizable === false ? " · dilekçeye hazır değil" : "")));
```

## [P0] jargon — satir 8827

**Mevcut:**
```
      label: "belgeden sezgisel çıkarım — UYAP'tan doğrulayın" + (tail && tail !== "analiz" ? " (bölüm " + tail + ")" : ""),
```

**Neden:** Zaman çizelgesindeki her otomatik olayın etiketi. "Sezgisel çıkarım" mühendis dilidir; "(bölüm a1f3c…)" ise doğrudan makine kimliğidir ve avukat için tam bir gürültüdür. Uyarının aslı doğru ve önemli: bu tarih programın tahminidir.

**Öneri:**
```
      label: "bu tarihi program belgeden okudu — kesin değildir, UYAP'tan / tebliğ mazbatasından doğrulayın",
```

## [P0] jargon — satir 9020

**Mevcut:**
```
"Süre kuralı ucu bu sunucuda henüz açık değil (GET /v1/deadlines/rules → 404)."
```

**Neden:** Tek cümlede dört anlaşılmaz şey: "uç", "sunucu", "GET /v1/deadlines/rules" ve "404". Avukat süre hesaplamak isterken bu cümleyi görüyor ve ne yapacağını bilemiyor.

**Öneri:**
```
"Süre hesaplama şu anda kullanılamıyor. Programı kapatıp ColleX-Baslat ile yeniden açın; sorun sürerse kurulumu yapan kişiye bildirin."
```

## [P0] tanimsiz-terim — satir 9344

**Mevcut:**
```
? "yerel korpus (SENTETİK) — örnek metin, gerçek karar değil"
```

**Neden:** "Korpus" ve "SENTETİK" iki ayrı tanımsız sözcük. Arkasındaki açıklama doğru ama iki bilinmeyen sözcüğün ardına düşmüş; avukat cümlenin başında takılır. Oysa burada söylenen şey hayatî: bu metin gerçek bir karar değil.

**Öneri:**
```
? "ÖRNEK METİN — gerçek mahkeme kararı değildir, dilekçede kullanılamaz"
```

## [P0] jargon — satir 9346

**Mevcut:**
```
: "yerel korpus", "mute");
```

**Neden:** Her cevabın her kaynak satırında görünen çip. "Korpus" hiçbir avukatın bilmediği bir sözcük ve ekranda hiçbir yerde tanımı yok. Avukat kaynağın nereden geldiğini — kendi bilgisayarındaki karar arşivinden mi, kendi yüklediği belgeden mi — anlayamaz.

**Öneri:**
```
: "bu bilgisayardaki karar/mevzuat arşivi", "mute");
```

## [P0] jargon — satir 9370

**Mevcut:**
```
      noticeLine(box, "line", "Kapsam — yalnız yüklediğiniz " + fs.fileIds.length + " belge" +
```

**Neden:** Cevabın üstündeki künyenin ilk satırı. "Kapsam" bu arayüzde üç ayrı anlamda kullanılıyor (arama kapsamı, soru kapsamı, ekran adı) ve avukat hangisi olduğunu bilemez; devamında (9371) "yerel korpusla birlikte tarandı" diyerek yine tanımsız "korpus" geliyor.

**Öneri:**
```
      noticeLine(box, "line", "Nerede arandı: yalnız yüklediğiniz " + fs.fileIds.length + " belgede" +
```

## [P0] jargon — satir 9494

**Mevcut:**
```
        wrote.then(function () { toast("Izgara CSV olarak panoya kopyalandı.", "ok"); },
```

**Neden:** "CSV" avukatın bilmediği bir dosya biçimi adı, "Izgara" ise bu ürüne özgü uydurulmuş bir ekran adı. Aynı sorun 9495-9496'daki hata mesajında da var ("Panoya kopyalanamadı — "CSV indir" ile kaydedin."). Avukat panoya ne kopyalandığını ve nereye yapıştıracağını anlamaz.

**Öneri:**
```
        wrote.then(function () { toast("Tablo panoya kopyalandı — Excel'e ya da Word'e yapıştırabilirsiniz.", "ok"); },
```

## [P0] jargon — satir 13109

**Mevcut:**
```
"Belgelerinizi ve mevzuatı tarar, her tespiti belge sürümü ve SHA-256 " +
```

**Neden:** Bu, ürünü ilk kez açan avukatın gördüğü İLK paragraf. "SHA-256" ve "özet" hiçbir avukatın bilmediği sözcükler; "tespit" ise burada uydurulmuş bir terim (claim karşılığı) ve tanımı hiçbir yerde yok. İlk ekranda üç anlaşılmaz sözcük görmek programı kapattırır.

**Öneri:**
```
"Belgelerinizi ve mevzuatı tarar; yazdığı her cümlenin altına alıntının hangi belgenin hangi satırından geldiğini yazar ve alıntının sonradan bozulmadığını kendiliğinden denetler. Süreleri hesaplar, dilekçe taslağı yazar. Dayanağı olmayan cümleyi ayrıca işaretler."
```

## [P1] jargon — satir 8242

**Mevcut:**
```
      if (res.status === 404) { showNotYet(target, "GET /v1/matters", "Dava dosyası ucu"); return; }
```

**Neden:** Ekranda "Dava dosyası ucu bu sunucuda henüz açık değil" cümlesi çıkıyor. "Uç" (endpoint) ve "sunucu" avukat sözcüğü değil; ayrıca kartın sonunda "(Teknik: GET /v1/matters → 404)" görünüyor.

**Öneri:**
```
      if (res.status === 404) { showNotYet(target, "GET /v1/matters", "Dava dosyası listesi"); return; }
```

## [P1] anlasilmaz-cumle — satir 8393

**Mevcut:**
```
          "Bu başlıkla açık bir dosyanız zaten var (" + dup.why + "): “" + dup.m.title + "”. " +
```

**Neden:** Cümle her zaman "Bu başlıkla" diyor, oysa eşleşme sebebi çoğu zaman esas numarası (dup.why = "aynı esas numarası"). O zaman avukat "Bu başlıkla ... zaten var (aynı esas numarası)" gibi kendi kendisiyle çelişen bir cümle okuyor ve neyin çakıştığını anlamıyor.

**Öneri:**
```
          "Aynı " + (dup.why === "aynı esas numarası" ? "esas numarasıyla" : "başlıkla") + " açık bir dosyanız zaten var: “" + dup.m.title + "”. " +
```

## [P1] jargon — satir 8448

**Mevcut:**
```
        errCard(target, "Dosya bulunamadı", "Bu kimlikle bir dava dosyası yok; silinmiş olabilir.");
```

**Neden:** "Kimlik" burada makine kimliği (UUID) anlamında kullanılıyor; avukat "kimlik" deyince müvekkilin kimliğini anlar. Cümle ayrıca ne yapılacağını söylemiyor.

**Öneri:**
```
        errCard(target, "Dosya bulunamadı", "Bu bağlantının işaret ettiği dava dosyası artık yok — silinmiş olabilir. Dosyalarım listesinden devam edin.");
```

## [P1] ui-kusuru — satir 8492

**Mevcut:**
```
    if (activeMatter && activeMatter.id === m.id) { chips.appendChild(defineTerm(chip("aktif dosya", "ok"), "aktif dosya")); }
```

**Neden:** Ürünün merkezî terimlerinin tek cümlelik tanımları yalnızca `title` ipucu olarak asılıyor (defineTerm, 3891). Bu ipucu dokunmatik ekranda hiç çıkmaz, klavyeyle erişilemez ve çipin üstünde tanım olduğuna dair GÖRÜNÜR bir işaret yoktur — yani tanımlar pratikte yok hükmündedir.

**Öneri:**
```
Terimin yanına küçük, tıklanabilir bir “?” işareti konmalı; tıklanınca tanım cümlesi çipin altında açık metin olarak görünmeli (fare ipucuna bel bağlanmamalı). Aynısı KAYNAKSIZ, K-n, sürüm ve deneysel terimleri için de geçerli.
```

## [P1] anlasilmaz-cumle — satir 8547

**Mevcut:**
```
      conf.appendChild(el("span", null, "Dosya, notları, süreleri ve bağları silinsin mi? Belgelerin kendisi ve cevaplar silinmez; bu dosyaya bağlı taslaklar silinmez ama dosyasız kalır (Taslak › Kayıtlı taslaklar'dan açılır)."));
```

**Neden:** Geri alınamaz bir silme onayı, üç ayrı istisnayı noktalı virgüllerle ve parantezle tek nefeste anlatıyor. "Bağları" tanımsız (hangi bağlar?). Avukat neyin gideceğini, neyin kalacağını tek okumada çıkaramaz — ve bu ekranda yanlış anlamanın bedeli veri kaybıdır.

**Öneri:**
```
      conf.appendChild(el("span", null, "Bu dava dosyası silinecek. SİLİNECEK: dosyanın künyesi, notları, süreleri, duruşmaları ve belgelerle kurduğu bağlantılar. SİLİNMEYECEK: belgelerin kendisi, araştırma cevapları ve taslaklar — taslaklar dosyasız kalır, Taslak ekranındaki “Kayıtlı taslaklar” listesinden yine açılır. Silinsin mi?"));
```

## [P1] ui-kusuru — satir 8782

**Mevcut:**
```
        sub.appendChild(chip(t.template || t.kind || "?", "mute"));
```

**Neden:** Taslak listesinde şablonun MAKİNE adı çip olarak yazılıyor (ör. "dilekce-cevap"), bilinmiyorsa da "?" görünüyor. Avukat ne tür bir taslağa baktığını anlayamıyor; "?" ise hiçbir şey söylemiyor.

**Öneri:**
```
Şablonun Türkçe adı yazılmalı (mevcut şablon listesindeki başlık); ad bilinmiyorsa çip hiç çizilmemeli — "?" yerine boşluk daha dürüst: sub.appendChild(chip(TEMPLATE_TR[t.template] || t.template || "", "mute"));
```

## [P1] tanimsiz-terim — satir 8786

**Mevcut:**
```
        sub.appendChild(chip(t.unsupportedCount > 0 ? t.unsupportedCount + " KAYNAKSIZ paragraf" : "KAYNAKSIZ paragraf yok",
```

**Neden:** "KAYNAKSIZ" bu ürüne özgü büyük harfli bir damga; burada hiçbir açıklaması yok (tanım yalnız fareyle üstüne gelinen bir ipucunda, o da bu satırda bağlanmamış). Avukat kendi taslağında "3 KAYNAKSIZ paragraf" görüp bunun bir hata mı yoksa bir uyarı mı olduğunu bilemez.

**Öneri:**
```
        sub.appendChild(chip(t.unsupportedCount > 0 ? t.unsupportedCount + " paragrafın dayanağı yok" : "her paragrafın dayanağı var",
```

## [P1] jargon — satir 8823

**Mevcut:**
```
    if (s === "ai") { return { label: "AI · kaynaklı", tone: "warn", fileId: null }; }
```

**Neden:** "AI" tek başına kısaltma; "kaynaklı" ise tek başına ne demek olduğu belirsiz (kaynağı var mı, kaynaktan mı üretildi?). Ayrıca ürünün kendi adlandırma kuralı bu etiketin "Bulut AI" olmasını istiyor.

**Öneri:**
```
    if (s === "ai") { return { label: "Bulut AI yazdı — kaynağa bağlı", tone: "warn", fileId: null }; }
```

## [P1] ui-kusuru — satir 8875

**Mevcut:**
```
      acts.appendChild(ghostBtn("Süre başlat", function () { openDeadlineModal({ matterId: d.matter.id, startDate: p.date }); }, "small"));
```

**Neden:** "Süre başlat" düğmesi ne olacağını söylemiyor: bir sayaç mı başlıyor, kayıt mı yapılıyor? Gerçekte yalnızca süre hesap penceresini bu olayın tarihiyle açıyor. Avukat geri alınamaz bir şey yaptığını sanabilir.

**Öneri:**
```
      acts.appendChild(ghostBtn("Bu tarihten süre hesapla", function () { openDeadlineModal({ matterId: d.matter.id, startDate: p.date }); }, "small"));
```

## [P1] ui-kusuru — satir 9061

**Mevcut:**
```
      o.textContent = r.title + " — " + (r.periodLabel || "") + (r.computable === false ? " (hesaplanamaz — nota bakın)" : "");
```

**Neden:** "Nota bakın" deniyor ama not, listenin altındaki katlanmış "Hesaplanamayan süreler ve notları" kutusunun içinde; üstelik satır `disabled` olduğu için avukat üstüne tıklayıp sebebi öğrenemiyor bile. Yönlendirme boşa çıkıyor.

**Öneri:**
```
      o.textContent = r.title + " — " + (r.periodLabel || "") + (r.computable === false ? " (bu süre otomatik hesaplanamaz; sebebi aşağıda “Hesaplanamayan süreler” başlığında yazılı)" : ""); — ayrıca o katlanmış kutu, listede hesaplanamaz bir kural varsa AÇIK gelmeli.
```

## [P1] ui-kusuru — satir 9107

**Mevcut:**
```
    atLab.appendChild(el("span", null, "Adli tatil (20 Temmuz–31 Ağustos) uzatmasını uygula — HMK m.104 / İYUK m.8/3 (ara verme: HMK m.102 / İYUK m.61)"));
```

**Neden:** Tek bir onay kutusunun etiketine dört madde numarası sığdırılmış. Avukat maddeleri bilir ama bu etiket okunacak bir cümle değil, bir dipnot yığını; kutuyu işaretlemenin sonucunu (sürenin uzayacağını) söylemiyor.

**Öneri:**
```
    atLab.appendChild(el("span", null, "Adli tatil uzatmasını uygula — son gün 20 Temmuz–31 Ağustos aralığına düşerse süre uzar")); ve madde dayanakları (HMK m.104 / İYUK m.8/3; ara verme HMK m.102 / İYUK m.61) kutunun ALTINDA küçük punto bir "Dayanak" satırına alınmalı.
```

## [P1] eksik-aciklama — satir 9350

**Mevcut:**
```
      return chip(ORIGIN_TR.live + (at ? " · alınma " + fmtDateTimeTR(at).slice(-5) : ""), "ok");
```

**Neden:** `.slice(-5)` tarih-saatin yalnız SON BEŞ karakterini, yani saati bırakıyor. Üç ay önce çekilmiş bir resmî kaynak ekranda "canlı resmî kaynak · alınma 14:22" görünüyor. Avukat kaynağın bugün mü yoksa aylar önce mi alındığını göremiyor — güncellik değerlendirmesi için hayatî bir eksik.

**Öneri:**
```
      return chip(ORIGIN_TR.live + (at ? " · " + fmtDateTR(at) + " tarihinde alındı" : ""), "ok");
```

## [P1] anlasilmaz-cumle — satir 9384

**Mevcut:**
```
      noticeLine(box, "line", "Soru kapsamı: %" + pct(cov.ratio) + " — soru sözcüklerinin kaynaklarda karşılığı" +
```

**Neden:** Cevabın en üstünde çıkan bu satır bir yüzde veriyor ama avukat bu sayının neyi ölçtüğünü, iyi mi kötü mü olduğunu, buna göre ne yapması gerektiğini bilemiyor. Devamı da cümle değil, yarım bir tamlama ("soru sözcüklerinin kaynaklarda karşılığı").

**Öneri:**
```
      noticeLine(box, "line", "Sorunuzdaki sözcüklerin %" + pct(cov.ratio) + "'i elinizdeki kaynaklarda karşılık buldu. Oran düşükse cevap sorunuzun tamamını karşılamıyor demektir; kaynak ekleyin ya da soruyu daraltın." +
```

## [P1] jargon — satir 9385

**Mevcut:**
```
        (cov.gate === "bypassed-by-reference" ? " · atıf yapılan hüküm doğrudan alındı; öteki pasajlar tek tek soru sözcükleriyle sınandı" : ""));
```

**Neden:** "Pasaj" ve "sınandı" mühendis sözcükleridir; cümle ayrıca avukata hiçbir iş çıkarmıyor — ne yapması gerektiğini söylemiyor, sadece programın içini anlatıyor.

**Öneri:**
```
        (cov.gate === "bypassed-by-reference" ? " Sorunuzda açıkça andığınız madde metni doğrudan getirildi; diğer alıntılar ayrıca sorunuzla karşılaştırıldı." : ""));
```

## [P1] jargon — satir 9403

**Mevcut:**
```
      } else if (data.status !== "ABSTAIN" && typeof cov.setAside === "number" && cov.setAside > 0) {
        noticeLine(box, "line setaside", cov.setAside + " pasaj sorunuzla yalnız kelime düzeyinde benzediği için dayanak sayılmadı (aşağıda kimliğiyle listelenir, alıntılanmaz).");
```

**Neden:** "Pasaj" ve "kimliğiyle" (makine kimliği) avukat sözcüğü değil. Avukat "kimliğiyle listelenir" deyince aşağıda ne göreceğini kestiremez.

**Öneri:**
```
        noticeLine(box, "line setaside", cov.setAside + " alıntı sorunuzla yalnız kelime benzerliği taşıdığı için dayanak sayılmadı. Aşağıda hangi belgeden geldikleri yazılı, ama metinleri gösterilmiyor.");
```

## [P1] jargon — satir 9413

**Mevcut:**
```
      noticeLine(box, "line", "Üretim: " + data.aiUsed.label +
```

**Neden:** "Üretim:" fabrika dilidir; devamındaki (9414) "her tespit kanıt kimliğiyle sınırlı; her atıf yerel doğrulamadan geçti" cümlesinde "tespit", "kanıt kimliği" ve "yerel doğrulama" üç ayrı tanımsız terimdir. Söylenmek istenen şey ise avukat için çok değerli: metni ne yazdı ve alıntılar denetlendi mi.

**Öneri:**
```
      noticeLine(box, "line", "Bu cevabı yazan: " + data.aiUsed.label + (data.aiUsed.drafter ? " — her cümle yalnızca aşağıdaki alıntılara dayanır; alıntıların belgedeki metinle birebir aynı olduğu denetlendi." : ""));
```

## [P1] ui-kusuru — satir 9561

**Mevcut:**
```
      .slice(0, GRID_MAX_QUESTIONS);
```

**Neden:** Avukat ızgara kutusuna sekiz soru yazarsa son ikisi hiçbir uyarı olmadan atılıyor; tabloda o sütunlar hiç çıkmıyor ve avukat sorduğunu sandığı soruların cevapsız kaldığını fark etmiyor. Ekranda "en çok 6 soru" diye bir bilgi de yok.

**Öneri:**
```
Kutunun üstüne sabit bir satır konmalı: "Her satıra bir soru yazın — en çok 6 soru." Fazla satır varsa kırpmadan önce uyarı çıkmalı: toast("En çok 6 soru sorulabilir; ilk 6 satır kullanıldı, sonrakiler tabloya alınmadı.", "bad").
```

## [P1] tanimsiz-terim — satir 9580

**Mevcut:**
```
      var why = "kapsanmadı";
```

**Neden:** Izgaranın boş hücrelerinde tek başına "kapsanmadı" yazıyor (9583'te sözcük listesiyle birlikte). "Kapsanmadı" avukat Türkçesi değil ve iki farklı şeyi karıştırıyor: belgede cevap yok mu, yoksa program bakamadı mı?

**Öneri:**
```
      var why = "Bu belgede sorunun cevabı bulunamadı"; ve 9583: why = "Bu belgede sorunun cevabı bulunamadı — belgede karşılığı olmayan sözcükler: " + cov.missing.slice(0, 4).join(", ");
```

## [P2] ui-kusuru — satir 8353

**Mevcut:**
```
    target.appendChild(el("p", "empty", "Satıra tıklayın → dosya sayfası. Bir belgeyi satıra bırakın → o dosyaya yüklenir."));
```

**Neden:** Ok işareti (→) mühendis kısaltmasıdır; ayrıca bu kullanım yönergesi tablonun ALTINA yazılmış, yani avukat tabloyu kullandıktan SONRA okuyor. Dar ekranda satırlar zaten tablo değil kart olarak çiziliyor, "satır" sözü karşılıksız kalıyor.

**Öneri:**
```
Tablonun ÜSTÜNE alınmalı: "Bir dosyanın üstüne tıklayınca dosya sayfası açılır. Bilgisayarınızdaki bir belgeyi dosyanın üstüne sürükleyip bırakırsanız belge o dosyaya yüklenir."
```

## [P2] ton — satir 8515

**Mevcut:**
```
      "Bu çalışma alanı yereldir; UYAP ile eşitlenmez. Belgeler bu bilgisayarda saklanır · açılış " +
```

**Neden:** "Çalışma alanı", "yereldir" ve "eşitlenmez" mühendis dilidir; ortadaki "·" ayracı da tarihi cümlenin kuyruğuna makine gibi yapıştırıyor.

**Öneri:**
```
      "Bu dosya yalnız bu bilgisayarda tutulur; UYAP'a bağlanmaz, UYAP'tan bilgi çekmez. Açılış tarihi: " +
```

## [P2] anlasilmaz-cumle — satir 8695

**Mevcut:**
```
    if (!files.length) { emptyLine(panel, "Bu dosyaya bağlı belge yok — “Belge yükle” ile ekleyin ya da Belgeler'de bir belgeyi “Dosyaya ekle”yin."); return; }
```

**Neden:** "“Dosyaya ekle”yin" bozuk Türkçedir; düğme adına ek getirilmiş. Ayrıca "Belgeler'de" ile ekran adı ve "Dosyaya ekle" ile düğme adı aynı cümlede karışıyor.

**Öneri:**
```
    if (!files.length) { emptyLine(panel, "Bu dava dosyasına henüz belge bağlanmadı. Yukarıdaki “Belge yükle” düğmesiyle yeni bir belge yükleyin ya da Belgeler ekranına gidip daha önce yüklediğiniz bir belgede “Dosyaya ekle” düğmesine basın."); return; }
```

## [P2] eksik-aciklama — satir 8697

**Mevcut:**
```
      panel.appendChild(el("p", "empty", "Otomatik ön inceleme — bağlayıcı değildir; her belgenin kendi sayfasında sorular sorabilir, atıf ve tarihlerini işleyebilirsiniz."));
```

**Neden:** "İşleyebilirsiniz" neyi, nereye işlemek olduğunu söylemiyor (gerçekte zaman çizelgesine olay eklemek kastediliyor). "Otomatik ön inceleme" de başlıksız bir tamlama olarak duruyor; hangi bilginin ön inceleme olduğu belli değil.

**Öneri:**
```
      panel.appendChild(el("p", "empty", "Aşağıdaki özetleri program belgeden kendisi çıkardı; bağlayıcı değildir, kontrol edin. Bir belgenin adına tıklayınca o belgeye soru sorabilir, içindeki tarihleri dosyanın zaman çizelgesine ekleyebilirsiniz."));
```

## [P2] jargon — satir 8707

**Mevcut:**
```
          g.appendChild(el("div", "sub", "Belge deposunda bulunamadı — silinmiş olabilir."));
```

**Neden:** "Belge deposu" makine adıdır; avukat için böyle bir yer yok, o sadece "Belgeler" ekranını bilir.

**Öneri:**
```
          g.appendChild(el("div", "sub", "Bu belge artık Belgeler listesinde yok — silinmiş olabilir. Aşağıdaki düğmeyle bu satırı kaldırabilirsiniz."));
```

## [P2] ton — satir 8735

**Mevcut:**
```
      if (!rows.length) { emptyLine(panel, "Bu dosyada kayıtlı araştırma yok. Aktif dosya bu iken Araştır'da sorulan her soru buraya düşer."); return; }
```

**Neden:** "Buraya düşer" mühendis argosudur. Ayrıca "Aktif dosya bu iken" kurulumu ağır; avukatın yapması gerekeni söylemiyor.

**Öneri:**
```
      if (!rows.length) { emptyLine(panel, "Bu dava dosyasında henüz araştırma yok. Bu dosya üstteki seçicide seçiliyken Araştır ekranında sorduğunuz her soru, cevabıyla birlikte otomatik olarak bu listeye eklenir."); return; }
```

## [P2] ui-kusuru — satir 8780

**Mevcut:**
```
        g.appendChild(el("div", null, (t.title || "(başlıksız taslak)") + " — " + (fmtDateTR(t.createdAt) || "")));
```

**Neden:** Aynı tarih bir satır yukarıda (8778) zaten sol sütunda yazılı; burada başlığın arkasına ikinci kez yapıştırılıyor. Veri olmadığında da başlığın sonunda anlamsız bir " — " kalıyor.

**Öneri:**
```
        g.appendChild(el("div", null, t.title || "(başlıksız taslak)"));
```

## [P2] jargon — satir 8784

**Mevcut:**
```
        sub.appendChild(chip("v" + (t.version || 1), "mute"));
```

**Neden:** "v3" yazılımcı gösterimidir. Avukat için sürüm numarası anlamlıdır ama bu biçimde değil.

**Öneri:**
```
        sub.appendChild(chip((t.version || 1) + ". sürüm", "mute"));
```

## [P2] ui-kusuru — satir 8798

**Mevcut:**
```
            verWrap.textContent = vs.length + " sürüm: " + vs.map(function (v) {
```

**Neden:** "Sürümler" düğmesi ne olacağını söylemiyor ve basıldığında sürümler tek satırda "v1 (03.09.2026 14:22) · v2 (…)" gibi sıkışık bir dizi olarak yazılıyor; açılabilir/tıklanabilir değil, yani avukat eski sürümü göremiyor, sadece varlığını okuyor.

**Öneri:**
```
Düğme "Eski sürümleri gör" olmalı; sonuç, her sürümü ayrı satırda ve "3. sürüm — 03.09.2026 14:22 — Aç" biçiminde açılabilir bir liste olarak çizilmeli.
```

## [P2] anlasilmaz-cumle — satir 9312

**Mevcut:**
```
      row.appendChild(ghostBtn("Dosyalarım'a git (hesabı bırak)", function () {
```

**Neden:** "Hesap" burada süre hesabı anlamında, ama avukat "hesap" deyince önce cari hesabı/kullanıcı hesabını anlar. Parantez içi uyarı bu yüzden ürkütücü ve belirsiz.

**Öneri:**
```
      row.appendChild(ghostBtn("Dosyalarım'a git — hesaplanan süre kaydedilmeden kapanır", function () {
```

## [P2] anlasilmaz-cumle — satir 9610

**Mevcut:**
```
    if (!questions.length) { toast("En az bir soru yazın (her satır bir sütun olur).", "bad"); return; }
```

**Neden:** "Her satır bir sütun olur" tersine dönmüş gibi okunuyor ve kafa karıştırıyor; kastedilen, yazdığınız her sorunun tabloda bir sütun başlığı olacağı.

**Öneri:**
```
    if (!questions.length) { toast("En az bir soru yazın — yazdığınız her soru tabloda ayrı bir sütun olur.", "bad"); return; }
```
