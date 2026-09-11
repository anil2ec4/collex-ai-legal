# js-yardimcilar

Bu bölge (7300-8200) ürünün "sessiz" metinlerini üretir: bekleme kartı cümleleri, doğrulama modalindeki durum satırı, üst çubuk rozetleri, bildirim (toast) yazıları, tarih/gün rozetleri ve Bulut AI onay penceresi. Metinlerin bir kısmı gerçekten iyi yazılmış (bekleme kartının "Vazgeç" açıklaması, süre listesinin boş durum cümlesi, cevap alanı yer tutucusu). Ancak avukatın en çok güven araması gereken yer — belgenin tam metnini açtığında çıkan doğrulama satırı — doğrudan "parmak izi (SHA-256)" diyor; bu, ürünün en değerli iddiasını anlaşılmaz kılıyor. Üst çubukta sürekli "Veritabanı: şema eksik", "Sunucu yanıt vermiyor", model adı ve ham veritabanı adı duruyor; hoş geldiniz kartının son satırı bile "Sistem: veritabanı bağlı" diye başlıyor. Bulut AI onay penceresi kullanıcıya ham alan adını (useCloudAi) ve "çip" sözcüğünü gösteriyor. "korpus", "kanıt paketi", "uç", "istek", "sorgu", "filtre", "ms" gibi sözcükler yardımcı fonksiyonların içinden ekrana sızıyor. Hata durumlarının birçoğu ne olduğunu söylüyor ama NE YAPILACAĞINI söylemiyor.

Bulgu: 35

## [P0] jargon — satir 7431

**Mevcut:**
```
          throw new Error("kanıt paketi alınamadı (HTTP " + res.status + ")");
```

**Neden:** Bu hata metni doğrudan ekrana basılıyor (showDocText → errorText). Hem 'kanıt paketi' tanımsız bir terim, hem de avukatın önüne çıplak 'HTTP 500' düşüyor — projenin kendi kuralı da bunu yasaklıyor.

**Öneri:**
```
          throw new Error("Belgenin tam metni getirilemedi. ColleX'i kapatıp yeniden açın; sorun sürerse soruyu yeniden sorun.");
```

## [P0] eksik-aciklama — satir 7543

**Mevcut:**
```
        "⚠ Alıntı aralığı bu metinle birebir örtüşmedi — teknik doğrulama " +
        "ayrıntılarını kontrol edin.";
```

**Neden:** En kritik uyarı ve avukata NE YAPACAĞINI söylemiyor. 'alıntı aralığı' tanımsız, 'teknik doğrulama ayrıntıları' diye tıklanabilir bir yer de ekranda yok — avukat boşluğa yönlendiriliyor.

**Öneri:**
```
        "⚠ Cevaptaki alıntı, belgenin bu metniyle bire bir örtüşmedi. Bu alıntıyı dilekçede kullanmayın; " +
        "aşağıdaki tam metinden ilgili yeri kendiniz okuyup elle alın.";
```

## [P0] jargon — satir 7554

**Mevcut:**
```
          status.textContent += " Belge parmak izi (SHA-256) eşleşti.";
```

**Neden:** Ürünün EN DEĞERLİ cümlesi burada. Avukat 'SHA-256' ve 'parmak izi' görünce ne söylendiğini anlamıyor; anlamadığı bir güvenceye güvenmez. Teknik doğruluk 'metnin bozulmadığı otomatik denetlendi' denerek de korunur.

**Öneri:**
```
          status.textContent += " Belgenin içeriği, cevabın hazırlandığı andaki hâliyle bire bir aynı; ColleX bunu otomatik denetledi.";
```

**Not:** Ekranın ilk cümlesi zaten alıntının örtüştüğünü söylüyor; bu ikinci cümle onu belgenin tamamına genişletiyor. Aynı bilgi kaybolmadan anlatılabiliyor.

## [P0] jargon — satir 7559

**Mevcut:**
```
            "⚠ Belge parmak izi (SHA-256) EŞLEŞMEDİ — bu metni kullanmayın; belgeyi yeniden yükleyin, " +
            "sorun sürerse ColleX'i yeniden başlatıp sunucu penceresindeki günlüğü saklayın.";
```

**Neden:** Bu, ürünün en ciddi uyarısı ve tam da burada üç anlaşılmaz sözcük var: SHA-256, parmak izi, günlük (log) ve 'sunucu penceresi'. Avukat ekranı kapatır, uyarıyı okumaz.

**Öneri:**
```
            "⚠ Bu belge, cevabın hazırlandığı andaki hâliyle aynı değil — dosyada bir değişiklik olmuş. Bu metni dilekçede kullanmayın. " +
            "Belgeyi Belgeler ekranından yeniden yükleyip soruyu tekrar sorun. Sorun sürerse ColleX'i kapatıp yeniden açın.";
```

**Not:** Teknik kanıt kaybolmuyor: ne olduğu (değişmiş), sonucu (kullanmayın) ve iki adım (yeniden yükle / yeniden başlat) söyleniyor.

## [P0] jargon — satir 7665

**Mevcut:**
```
    if (a && a.fileScope && Array.isArray(a.fileScope.fileIds)) { return "Belge" + (a.fileScope.includeCorpus ? " + korpus" : ""); }
```

**Neden:** Kayıt listelerinde damga olarak 'Belge + korpus' yazıyor. İki sözcük de tanımsız; avukat neyin nerede arandığını anlamıyor.

**Öneri:**
```
    if (a && a.fileScope && Array.isArray(a.fileScope.fileIds)) { return "Yüklenen belgeler" + (a.fileScope.includeCorpus ? " + arşiv" : ""); }
```

## [P0] jargon — satir 7669

**Mevcut:**
```
  var DB_STATE_TR = { ok: "bağlı", missing: "şema eksik", down: "kapalı", off: "yok" };
```

**Neden:** Üst çubukta sürekli görünen rozetin metni. 'şema eksik' saf mühendis dilidir; avukat için hiçbir anlamı yok ve ne yapacağını da söylemiyor. 'bağlı'/'yok' da neye bağlı olduğunu söylemiyor.

**Öneri:**
```
  var DB_STATE_TR = { ok: "çalışıyor", missing: "kurulum tamamlanmamış — ColleX'i kapatıp yeniden açın", down: "açılmadı", off: "kurulu değil" };
```

## [P0] jargon — satir 7674

**Mevcut:**
```
  var ORIGIN_TR = { upload: "yüklediğiniz belge", corpus: "yerel korpus", live: "canlı resmî kaynak" };
```

**Neden:** 'korpus' kullanıcının birebir şikâyet ettiği sözcük. Her kaynak kartında ve cevap üstünde görünür. 'yerel' de bilgisayar terimidir.

**Öneri:**
```
  var ORIGIN_TR = { upload: "yüklediğiniz belge", corpus: "bu bilgisayardaki arşiv", live: "resmî kaynaktan yeni alındı" };
```

## [P0] jargon — satir 7897

**Mevcut:**
```
      "Veritabanı: " + (DB_STATE_TR[db] || db));
```

**Neden:** 'Veritabanı' kullanıcının yasak listesinde. Üst çubukta her ekranda görünen ilk rozet bu; avukatın gördüğü ilk sözcük anlamadığı bir sözcük oluyor.

**Öneri:**
```
      "Kayıtlarım: " + (DB_STATE_TR[db] || db));
```

**Not:** Rozet aslında 'dosyalarınız, cevaplarınız ve taslaklarınız saklanabiliyor mu' sorusunu yanıtlıyor; 'Kayıtlarım' bunu doğru anlatır.

## [P0] jargon — satir 7979

**Mevcut:**
```
      hint.textContent = "model: " + (health.ai.model || "?") + " · canlı sınanmadı · her istek için ayrı onay";
```

**Neden:** Ekranda 'model: claude-sonnet-5 · canlı sınanmadı · her istek için ayrı onay' yazıyor. Makine adı, tanımsız 'canlı sınanmadı' ve 'istek' yan yana; üç parça da avukata hiçbir şey söylemiyor. Kötü durumda '?' basılıyor.

**Öneri:**
```
      hint.textContent = "Açarsanız sorunuz ve ilgili belge metni Anthropic şirketine gider. Bu özellik gerçek koşullarda henüz denenmedi. Her soru için ayrıca onay istenir.";
```

**Not:** Modelin adı Ayarlar › Sistem durumu satırında kalsın; üst şeritte teknik değer taşımıyor.

## [P0] jargon — satir 7999

**Mevcut:**
```
      "Her istek için ayrı onay: çip açıkken gönderilen her soru ‘useCloudAi’ işaretiyle gider; kapattığınız anda hiçbir şey gönderilmez."));
```

**Neden:** Onay penceresinde avukata ham alan adı (useCloudAi) gösteriliyor — bu bir program kodu parçası. Ayrıca 'çip' Türkçede mikroçip demektir; ekrandaki anahtarın adı değildir. 'istek' de teknik.

**Öneri:**
```
      "Her soru için ayrı onay: anahtar açıkken sorduğunuz her soru dışarı gider; anahtarı kapattığınız anda hiçbir şey gönderilmez."));
```

## [P0] jargon — satir 8157

**Mevcut:**
```
      "Sistem: veritabanı " + (DB_STATE_TR[h.db] || h.db || "?") +
```

**Neden:** Bu, ürünün İLK AÇILIŞ kartının son satırı — avukatın ColleX'te okuduğu ilk paragrafın sonu. 'Sistem: veritabanı' ile başlıyor ve '?' bile basabiliyor.

**Öneri:**
```
      "Durum: kayıtlarım " + (DB_STATE_TR[h.db] || "bilinmiyor") +
```

**Not:** Aynı satırın devamı da düzeltilmeli: ' · canlı araştırma …' kalabilir, ' · Bulut AI açık/kapalı' ise 'Bulut yapay zekâ (Bulut AI): kapalı' olmalı.

## [P1] tanimsiz-terim — satir 7317

**Mevcut:**
```
        toast("Bu kapsam için en az bir belge seçin (Belgeler görünümünden yükleyebilirsiniz).", "bad");
```

**Neden:** 'kapsam' bu arayüzde üç ayrı anlamda kullanılıyor ve hiçbirinde tanımlı değil; 'görünüm' de program terimi. Avukat hangi seçimden bahsedildiğini bilmiyor.

**Öneri:**
```
        toast("Bu arama biçimi yüklediğiniz belgelerde arar; önce en az bir belge seçin. Belge yüklemek için Belgeler ekranına gidin.", "bad");
```

## [P1] jargon — satir 7351

**Mevcut:**
```
      phase: "Soru sunucuya gönderildi; cevap bekleniyor.",
```

**Neden:** 'sunucu' avukatın yasak listesinde. ColleX kendi bilgisayarında çalışıyor; 'sunucuya gönderildi' üstelik yanlış bir izlenim (dışarı gitti) veriyor.

**Öneri:**
```
      phase: "Sorunuz alındı; arşiv taranıyor.",
```

## [P1] jargon — satir 7371

**Mevcut:**
```
        busy.phase("Bu sunucu arama filtrelerini desteklemiyor; sorgu filtresiz yeniden gönderildi.");
```

**Neden:** Tek cümlede üç teknik sözcük: sunucu, filtre, sorgu. Ayrıca avukat 'filtre' derken ekranda ne seçtiğini bilmiyor.

**Öneri:**
```
        busy.phase("Bu kurulumda mahkeme/tarih daraltması yapılamıyor; arama daraltma olmadan yeniden çalıştırıldı.");
```

## [P1] jargon — satir 7383

**Mevcut:**
```
      timing.textContent = (Date.now() - started) + " ms";
```

**Neden:** Avukatın ekranında '4213 ms' yazıyor. 'ms' bir birim olarak avukata bir şey söylemez ve dört haneli sayı gereksiz bir teknik gösteriştir.

**Öneri:**
```
      timing.textContent = ((Date.now() - started) / 1000).toFixed(1).replace(".", ",") + " saniye";
```

## [P1] jargon — satir 7394

**Mevcut:**
```
        note.appendChild(el("span", "k", "filtre desteklenmiyor"));
        note.appendChild(document.createTextNode(
          "Bu sunucu arama filtrelerini henüz desteklemiyor — sorgu filtresiz çalıştırıldı."));
```

**Neden:** Cevabın en üstüne düşen damga. 'filtre', 'sunucu', 'sorgu' üçü bir arada; ayrıca damga avukatın sonucu nasıl okuması gerektiğini söylemiyor.

**Öneri:**
```
        note.appendChild(el("span", "k", "daraltma uygulanmadı"));
        note.appendChild(document.createTextNode(
          "Seçtiğiniz daraltmalar bu kurulumda uygulanamadı — aşağıdaki sonuç arşivin tamamında arandı."));
```

## [P1] jargon — satir 7527

**Mevcut:**
```
        "⚠ Bu belgenin tam metni kanıt paketinde bulunamadı; görüntüleme yapılamıyor.";
```

**Neden:** 'kanıt paketi' hiçbir ekranda tanımlanmıyor; 'görüntüleme yapılamıyor' edilgen ve avukatın ne yapacağını söylemiyor.

**Öneri:**
```
        "⚠ Bu belgenin tam metni bu cevapla birlikte saklanmamış; burada açılamıyor. Belgeyi Belgeler ekranından açabilirsiniz.";
```

## [P1] ton — satir 7538

**Mevcut:**
```
        "✓ Bu metin, cevabın üretildiği andaki doğrulanmış sürümdür — alıntı, " +
        "tam metinden yeniden türetildi ve karakteri karakterine örtüştü.";
```

**Neden:** 'üretildiği an', 'yeniden türetildi' mühendis dili. Avukatın duyması gereken şey basit: alıntı uydurulmadı, belgede aynen var.

**Öneri:**
```
        "✓ Aşağıdaki metin, cevabın hazırlandığı andaki belgedir. Cevapta gösterilen alıntı bu metinde " +
        "aynen bulundu ve aşağıda sarıyla işaretlendi.";
```

## [P1] anlasilmaz-cumle — satir 7761

**Mevcut:**
```
    if (n < 0) { return el("span", "days late", "GECİKMİŞ — " + (-n) + " gün"); }
```

**Neden:** 'GECİKMİŞ — 3 gün' iki şekilde okunur: 3 gün geçti mi, 3 gün mü kaldı? Hemen altındaki rozet '3 gün kaldı' diyor; ikisi yan yana durunca karışıyor. Sürede bu belirsizlik kabul edilemez.

**Öneri:**
```
    if (n < 0) { return el("span", "days late", (-n) + " gün GECİKTİ"); }
```

## [P1] jargon — satir 7871

**Mevcut:**
```
    setPill("pill-db", "bad", "Sunucu yanıt vermiyor");
    setPill("pill-mcp", "bad", "Canlı araştırma: sunucu kapalı");
    setPill("pill-ai", "bad", "Bulut AI: sunucu kapalı");
```

**Neden:** Üç rozet birden 'sunucu' diyor. Avukatın zihninde 'sunucu' uzakta bir makinedir; oysa kapanan şey kendi bilgisayarındaki ColleX programıdır. Yanlış zihinsel model kuruyor.

**Öneri:**
```
    setPill("pill-db", "bad", "ColleX çalışmıyor");
    setPill("pill-mcp", "bad", "Canlı araştırma: ColleX çalışmıyor");
    setPill("pill-ai", "bad", "Bulut AI: ColleX çalışmıyor");
```

**Not:** Üst şeritteki uzun açıklama (SERVER_DOWN_TEXT) zaten ColleX-Baslat.cmd'yi söylüyor; rozetler onunla aynı dili konuşmalı.

## [P1] jargon — satir 7882

**Mevcut:**
```
        toast("Sunucu yeniden bağlandı — görünüm yenileniyor.", "ok");
```

**Neden:** Aynı 'sunucu' sorunu; ayrıca 'görünüm' program terimidir, avukat 'ekran'/'sayfa' der.

**Öneri:**
```
        toast("ColleX yeniden çalışıyor — sayfa kendini yeniliyor.", "ok");
```

## [P1] jargon — satir 7903

**Mevcut:**
```
      "Bulut AI: " + (ai.configured ? "açık" + (ai.model ? " · " + ai.model : "") : "kapalı"));
```

**Neden:** Üst çubukta sürekli 'Bulut AI: açık · claude-sonnet-5' duruyor. Makine adı her ekranda avukatın önünde; hiçbir kararına etki etmiyor.

**Öneri:**
```
      "Bulut AI: " + (ai.configured ? "açılabilir" : "kapalı"));
```

**Not:** Model adı zaten Ayarlar › Sistem durumu satırında var; üst çubukta tekrar etmesi gereksiz.

## [P1] jargon — satir 7911

**Mevcut:**
```
    document.getElementById("wheredb").textContent = h.dbName || "collex_local";
```

**Neden:** Ekrana ham makine adı ('collex_local') basılıyor, yanında bir açıklama yok. Avukat bu satırı okuyunca ne olduğunu, silinip silinemeyeceğini bilemez.

**Öneri:**
```
    document.getElementById("wheredb").textContent = (h.dbName || "collex_local") + " (bu bilgisayardaki kayıt alanının adı)";
```

## [P1] ton — satir 7921

**Mevcut:**
```
      whereLine.appendChild(document.createTextNode(
        " — bu satırı sunucunun kendisi bildirir, ColleX tahmin etmez."));
```

**Neden:** 'sunucunun kendisi bildirir, ColleX tahmin etmez' geliştirici not defterinden alınmış gibi duruyor; avukatın umursadığı tek şey klasörün nerede olduğu.

**Öneri:**
```
      whereLine.appendChild(document.createTextNode(
        " — bu yolu ColleX'in kendisi bildirir; kopyalayıp Dosya Gezgini'ne yapıştırabilirsiniz."));
```

## [P1] jargon — satir 7974

**Mevcut:**
```
      hint.textContent = "Bulut yapay zekâ bu bilgisayarda kapalı — anahtar tanımlı değil; her şey yerel çalışıyor.";
```

**Neden:** 'anahtar tanımlı değil' (API anahtarı) ve 'yerel çalışıyor' teknik. Avukat 'anahtar' derken kapı anahtarı düşünür ve nereden alacağını bilmez.

**Öneri:**
```
      hint.textContent = "Bulut yapay zekâ (Bulut AI) bu bilgisayarda kapalı; kurulumu yapan kişiden açmasını isteyebilirsiniz. Şu an hiçbir bilgi dışarı çıkmıyor.";
```

## [P1] jargon — satir 7978

**Mevcut:**
```
      lab.title = "Bu istek için belge/kanıt metni Anthropic'e gönderilir";
```

**Neden:** 'istek' (request) ve 'kanıt metni' teknik; avukat üzerine gelince gördüğü tek açıklama bu ve neyin gideceğini net anlamıyor.

**Öneri:**
```
      lab.title = "Açıkken: sorunuz ve ilgili belge metni Anthropic şirketine gönderilir";
```

## [P1] jargon — satir 7996

**Mevcut:**
```
      "Bulut AI açıkken, gönderdiğiniz soru ile ilgili belge ve kanıt metinleri Anthropic sunucularına gider. " +
```

**Neden:** 'sunucu' yine; ayrıca 'kanıt metinleri' tanımsız. Bu, gizlilikle ilgili en önemli cümle — avukatın hiç tereddütsüz anlaması gerek.

**Öneri:**
```
      "Bulut AI açıkken, sorunuz ve o soruyla ilgili belge parçaları internet üzerinden Anthropic şirketine gönderilir. " +
```

## [P1] tanimsiz-terim — satir 8002

**Mevcut:**
```
      "Üretilen her tespit yine yerel doğrulamadan geçer; doğrulanamayan atıf kabul edilmez."));
```

**Neden:** 'tespit' bu üründe uydurulmuş özel bir anlam taşıyor ve hiçbir yerde tanımlı değil; 'yerel doğrulama' da tanımsız. Avukat cümleden bir güvence çıkaramıyor.

**Öneri:**
```
      "Bulut yapay zekânın yazdığı her cümle, bu bilgisayardaki belgelerle yeniden karşılaştırılır; belgede karşılığı bulunmayan bir alıntı cevaba girmez."));
```

## [P1] jargon — satir 8173

**Mevcut:**
```
      if (res.status === 404) { count.textContent = ""; showNotYet(list, "GET /v1/matters/deadlines", "Süre listesi ucu"); return; }
```

**Neden:** 'uç' (endpoint) doğrudan avukata gösteriliyor: ekranda 'Süre listesi ucu bu sunucuda henüz açık değil' yazacak. Ayrıca kartın devamında ham adres basılıyor.

**Öneri:**
```
      if (res.status === 404) { count.textContent = ""; showNotYet(list, "GET /v1/matters/deadlines", "Süre takibi"); return; }
```

**Not:** Ham adres notYetCard içinde 'Teknik:' başlığı altında kalıyor; en azından etiket avukat Türkçesi olmalı.

## [P2] jargon — satir 7668

**Mevcut:**
```
  var MCP_STATE_TR = { off: "kapalı", starting: "başlatılıyor", ok: "açık", down: "düştü" };
```

**Neden:** 'düştü' bilgisayarcı deyimidir (crashed). Avukat 'canlı araştırma düştü' cümlesinden ne olduğunu ve ne yapacağını çıkaramaz.

**Öneri:**
```
  var MCP_STATE_TR = { off: "kapalı", starting: "açılıyor", ok: "hazır", down: "kesildi — ColleX'i yeniden başlatın" };
```

## [P2] jargon — satir 7670

**Mevcut:**
```
  var PROGRESS_STATUS_TR = {
    running: "sürüyor", ok: "tamamlandı", partial: "kısmen tamamlandı",
    failed: "başarısız", timeout: "zaman aşımı", skipped: "atlandı"
  };
```

**Neden:** 'zaman aşımı' hukukta bambaşka bir anlam taşır (zamanaşımı) — bir hukuk programında bu sözcüğü süre dolması için kullanmak ciddi bir karışıklıktır. 'atlandı' da nedenini söylemiyor.

**Öneri:**
```
  var PROGRESS_STATUS_TR = {
    running: "sürüyor", ok: "tamamlandı", partial: "kısmen tamamlandı",
    failed: "sonuç alınamadı", timeout: "kaynak vaktinde yanıt vermedi", skipped: "bu kaynağa bakılmadı"
  };
```

## [P2] eksik-aciklama — satir 7758

**Mevcut:**
```
    if (n === null) { return el("span", "days", "tarih yok"); }
```

**Neden:** Süre kaydının tarihi okunamadığında rozet 'tarih yok' diyor ama avukat kaydı düzeltmek için nereye gideceğini bilmiyor; sessiz bir kayıp oluyor.

**Öneri:**
```
    if (n === null) { var c = el("span", "days", "tarih girilmemiş"); c.title = "Bu kayıtta son gün yok — dosyayı açıp süreyi düzenleyin."; return c; }
```

## [P2] ui-kusuru — satir 7773

**Mevcut:**
```
    toast.timer = setTimeout(function () { t.hidden = true; }, 3600);
```

**Neden:** Bildirimler 3,6 saniyede kayboluyor ve kapatma düğmesi yok. 'Bu kapsam için en az bir belge seçin (Belgeler görünümünden yükleyebilirsiniz).' gibi uzun bir uyarı okunmadan siliniyor; hata tonundaki bildirimler kalıcı olmalı.

**Öneri:**
```
Hata tonlu bildirim (tone === "bad") kendiliğinden kaybolmasın; sağına küçük bir 'Kapat' düğmesi konsun. Bilgi/başarı bildirimleri için süre 3600'den 6000 ms'ye çıkarılsın.
```

## [P2] anlasilmaz-cumle — satir 8180

**Mevcut:**
```
        : "önümüzdeki 14 gün boş";
```

**Neden:** Rozet olarak tek başına duruyor; 'boş' neyin boş olduğunu söylemiyor. Hemen yanındaki sayım rozetiyle ('3 süre · 1 gecikmiş') aynı dilde değil.

**Öneri:**
```
        : "14 günde süre yok";
```

## [P2] ui-kusuru — satir 8195

**Mevcut:**
```
        var a = el("a", null, r.matterTitle || "dosya");
```

**Neden:** Dosya adı yoksa bağlantının yazısı sadece 'dosya' oluyor; tıklanınca nereye gideceği belirsiz ve liste içinde birden çok satırda aynı yazı tekrarlanıyor.

**Öneri:**
```
        var a = el("a", null, r.matterTitle || "(adsız dosya) — açmak için tıklayın");
```
