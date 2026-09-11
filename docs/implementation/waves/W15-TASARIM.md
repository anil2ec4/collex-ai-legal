# KARAR
SECILEN YAKLASIM: "Tek Kapi + Buro Dili + Uc Katmanli Cevap" — dort seritli tek bir tasarim.

Her problem alani icin ayri bir kazanan temel alindi, cunku juri raporlari tek bir onerinin her uc alani birden cozmedigini gosterdi:

(1) ILK KULLANIM ve ACIKLAMA MIMARISI — temel: SIRA 1 (7.7, "Tek Kapi").
Alinan cekirdek: "Tek Kapi yasasi" (hicbir aciklama kendiliginden acilmaz, kapatildigi yerde kapali kalir, geri donus ust cubuktaki tek "?" dugmesinden olur) ve genisletilmis TERM_TR'nin TEK KAYNAK olarak hem satir ici "?" kartini hem Sozluk ekranini beslemesi. Bu, ayni terime iki farkli soz veren iki ekrani yapisal olarak imkansiz kiliyor.

(2) DIL — temel: SIRA 2 (7.7, "Buro dili").
Alinan cekirdek: terim esleme sozlugunun kendisi (korpus -> hukuk kutuphanesi, SHA-256 -> parmak izi, Unicode konumu -> metindeki yeri, CEKIMSER -> dayanak bulunamadi, endpoint -> islem). Kullanicinin sikayeti birebir buydu. SIRA 1'in "acikla ama degistirme" refleksi reddedildi: bir etiketi anlamak icin sozluge gitmek gerekiyorsa etiket yanlistir.

(3) HER GUN GORULEN EKRAN — temel: SIRA 3/4/5'in ortak cekirdegi (7.3 x3, uc bagimsiz oneri ayni sonuca vardi).
Alinan cekirdek: cevap ekraninin "karar -> dayanak -> denetim" diye siralanmasi; en buyuk puntonun makine damgasi yerine tek Turkce cumleye verilmesi; tespit ile alintisinin ayni kartta birlesmesi; aleyhe kararin celistigi tespitin altina inmesi; uc ayri § bolumun tek "Denetim kaydi" cekmecesine toplanmasi. Uc jurinin de SIRA 1 ve 2 icin yazdigi ortak elestiri suydu: on kapiyi duzeltiyor, odalari duzeltmiyor. Bu serit o bosluğu kapatiyor.

(4) GEZINME — temel: SIRA 6/7'nin YALNIZ ucuz ve dogrulanmis kismi.
Alinan: soru kutusunun ekranin en ustune cikmasi (console.html:2301 ile 2306 arasi isaretleme takasi — 5 satir), 15 is kartinin uc aileye inip cevabin altina katlanmasi, kart adlarinin cikti adiyla degil ISIN adiyla yazilmasi, "Cikti:" satirlarinin silinmesi, ve butun .cmd talimatlarinin duz Turkceye cevrilmesi.

REDDEDILEN VE GEREKCELERI (hepsi dosyada dogrulandi):

a) Karsilama kartinin openModal'a tam ekran tasinmasi (SIRA 1) REDDEDILDI. maybeWelcome (console.html:8129) yalnizca kart cizmiyor; body.classList.toggle("compact", !first) ile SAYFA KROMUNU yonetiyor ve bu kip makinesi console.test.ts:1933-1951'de birebir pinlenmis ("body:not(.compact) .stamp" dahil). Karsilama #welcome kabinda KART olarak kalir, yalnizca icerigi degisir.

b) Kirmizi "Veri kaynagi" damgasinin (console.html:2231) dogrudan silinmesi REDDEDILDI. Dosyada dogruladim: applyHealth icinde `document.getElementById("demobanner").hidden = true;` KOSULSUZ calisiyor (console.html:7906) — yani #demobanner OLU KODDUR ve sentetik korpus uyarisini bugun TASIYAN sey tam da silinmek istenen damganin icidir (#corpus-notice, 7907-7909). Ayni damga markServerDown icinde SERVER_DOWN_TEXT'i de tasiyor (7875). Once uyari iki bagimsiz yuzeye tasinir, sonra damga kaldirilir.

c) Uc durum rozetinin tek "Durum" dugmesinde birlesmesi (SIRA 1) REDDEDILDI. Korpus sentetikken ya da bosken dugme "Durum: hazir" yazar — bu ustu kapali bir dogruluk iddiasidir. Yerine: rozetler avukat adiyla yeniden adlandirilir, ve kutuphane sentetik/bos oldugunda hicbir yerde "hazir" sozcugu gecmez.

d) MUTLAK KIP (SIRA 1'in "yazmaz / uydurmaz / her cumlenin", SIRA 7'nin "dayanagi olmayan cumleyi kurmaz") REDDEDILDI. Urun taslakta dayanagi olmayan paragrafi URETIR, yalnizca KAYNAKSIZ diye isaretler (console.html:6562, 10468). Kalip: "bulamazsa cevap vermez; bulamadigi yeri isaretler; son kontrol sizindir."

e) uploadOnly dalinin dort damgali taksonomiye ezilmesi (SIRA 5, SIRA 7) REDDEDILDI. console.html:3947'de bilerek yazilmis koruma var: yalniz yuklenen belgeye dayanan cevapta damga yerine "N pasaj bulundu" yazilir. Kod yorumu: "TAM sorunun cevaplandigi anlamina gelmez — baslik bir getirme ifadesidir, hukum degil." Bu dal aynen korunur.

f) status ile finalizable'in tek satira ezilmesi (SIRA 7) REDDEDILDI. Bunlar iki AYRI eksendir; KESINLESTIRILEMEZ, durum TAM iken de cikabilir. Baslik kartinda ayri satir olarak kalir.

g) answerMetaBlock'un (console.html:9365) dayanaklarin ALTINA, kapali cekmeceye inmesi (SIRA 5) REDDEDILDI. Kodun kendi yorumu bunu yasakliyor: "bir arama seridinin sessizce dusmesi KAPSAM kaybidir; katlanmis uyari kartinda saklanmaz" (9406) ve partiallyCovered "tespitlerden ONCE soyler" (9394). Blok yerinde kalir, yalnizca dili degisir.

h) "Aslina uygunluk numarasi" adi (SIRA 5) REDDEDILDI. Turk hukuk pratiginde "asli gibidir" bir TASDIK kaydinin adidir; urunun vermedigi bir guvenceyi verir gibi okunur. Dosyanin kendi sozcugu olan "parmak izi" (console.html:3675) korunur, yalnizca "(SHA-256)" bir katman asagi iner.

i) Sekme yapisinin dortlemesi ve 15 kartin silinmesi (SIRA 6/7) BU DALGADA REDDEDILDI (P2'ye birakildi). Dogruladim: #izgara, #harc, #denetim, #karar-ara gorunumlerinin dosyadaki TEK giris noktasi silinecek is kartinin kendisidir; hicbir test bunu yakalamaz. Kartlar silinmez, yeniden adlandirilip gruplanir.

j) CSP ozetlerinin elle guncellenmesi diye bir adim YOKTUR. src/api/consolePage.ts icindeki buildConsoleCsp, her <script> ve <style> blogunu dosyadan yukleme aninda SHA-256'liyor (hashesOf). Gercek kisitlar yalniz sunlardir: LF-only, TEK script ve TEK style blogu, innerHTML/DOMParser/eval yok, satir ici on* ve style yok, dis kaynak yok. Bu yuzden degisiklik parca parca inebilir; "buyuk patlama" dayatmasi gecersizdir.

# ILK KULLANIM
ILK KULLANIM DENEYIMI — SON TASARIM

Konum: console.html #welcome kabi (satir 2242), maybeWelcome() (8129). Kart olarak kalir, tam ekran modal DEGILDIR (body.compact kip makinesi buna asili).

GORUNURLUK KURALI (bugunku kosul korunur, tek ekle):
first = settingsCache !== null && !settingsCache.profile.ad && mattersCache.length === 0
Ek: /v1/settings hata verirse settingsCache null kalir ve karsilama HIC gelmez. Bu yuzden kosul yerel bir anahtarla VE'lenir: localStorage "collex.welcome.seen" yoksa ve sunucu cevabi gelmediyse kart yine cizilir, sistem satiri yerine tek cumle yazar: "Sistem durumu okunamadi — Ayarlar › Sistem durumu."

---

BOLUM 1 — BASLIK (serif, tek satir)
"ColleX — her cumlenin altinda dayanagi yazar"

BOLUM 2 — GIRIS (tek paragraf, WELCOME_LEAD_TR)
"Hukuki sorunuzu sorarsiniz; ColleX bu bilgisayardaki hukuk kutuphanesinde ve sizin yukledginiz belgelerde arar. Yazdigi her tespitin yanina, o tespitin hangi belgenin hangi satirindan geldigini koyar; tiklarsiniz, belgenin tam o yeri acilir. Dayanak bulamazsa cevap yazmaz — bunu size acikca soyler."

BOLUM 3 — UC ADIM (WELCOME_STEPS_TR, canli kontrol listesi; welcomeSteps() mantigi aynen korunur, yapilan adim ✓ gelir)
Baslik: "Baslamak icin uc adim"
1. "Adinizi ve baro bilgilerinizi yazin — dilekcelerin altina bunlar gecer."   [dugme: Ayarlar]
2. "Ilk dava dosyanizi acin — bundan sonra her sey o dosyaya baglanir."   [dugme: + Yeni dosya]
3. "Bir belge yukleyin ya da ilk sorunuzu sorun."   [dugme: Belgeler]

SOZCUK BUTCESI: BOLUM 1+2+3 = 74 sozcuk. console.test.ts:1489-1496'daki 90 sozcuk tavani KORUNUR, degistirilmez. (Bugunku metin 90'in altinda; yenisi de altinda.)

BOLUM 4 — INCE BORDO AYRAC (hr.rule)

BOLUM 5 — DURUSTLUK PARAGRAFI (yeni sabit: WELCOME_LIMITS_TR, kendi 45 sozcuk butcesiyle test edilir; 28 sozcuk)
"Sunu bilerek kullanin: ColleX yuzde vermez, garanti vermez, davanin sonucunu tahmin etmez. Dayanagini gosteremedigi yeri bos birakmaz — KAYNAKSIZ diye isaretler ve onunuze koyar. Son kontrol her zaman sizindir."

BOLUM 6 — SISTEM SATIRI (bugunku teknik satirin yerine; degerler health'ten canli)
Normal: "Su an: kendi kayitlariniz acik · hukuk kutuphanesi 12.480 belge · canli arastirma kapali · bulut yapay zeka kapali."
health.demoCorpus === true ise ayni satirda kutuphane boyle yazar: "hukuk kutuphanesi — DENEME BELGELERI (gercek mevzuat degil)".
health.corpus.publicDocuments === 0 ise: "hukuk kutuphanesi bos — su an yalniz kendi yukledginiz belgelerde arayabilirsiniz."
KURAL: kutuphane sentetik ya da bosken bu satirda "hazir" sozcugu HICBIR KOSULDA gecmez.

BOLUM 7 — IKI DUGME
"Baslayalim"   ·   "Once nasil calistigini okuyayim"

BOLUM 8 — KAPANIS SATIRI (kucuk punto)
"Bu kart, ilk iki adimi tamamladiginizda kendiliginden kalkar. Anlatimin tamami sag ustteki ? dugmesinde durur."

---

ILK ACILISTA SUSTURULAN SERITLER (Tek Kapi yasasinin acilisa uygulanmasi):

1. Sari "Dosyasiz calisma" seridi (console.html:2234): ilk kullanimda (first === true) bastirilir. Gerekcesi: henuz hic dosya acmamis birine dosya secmedigini soylemek bilgi degil sitemdir. Ilk dosya acildigi anda serit bugunku kosuluyla (Arastir/Belgeler/Taslak ekranlarinda ve aktif dosya yokken) normale doner.

2. Kirmizi "Veri kaynagi" damgasi (console.html:2231): metni HALA yer tutucu cumleyse ("...ilk cevapla birlikte burada gorunecek") HIC CIZILMEZ. Deneme belgeleri uyarisi ya da sunucu kapali uyarisi tasiyorsa AYNEN kalir. ONEMLI: bu degisiklik, DEMO_CORPUS_TEXT iki bagimsiz yuzeye tasinmadan once YAPILMAZ (bkz. uygulama adimi 2).

3. Ayni anda en cok IKI serit gorunur. Oncelik sirasi sabittir: sunucu kapali > deneme belgeleri > dosyasiz calisma.

---

ILK CEVAPTA BIR KEZ: "Bu cevabi nasil okurum?" REHBERI

Cevap kartinin basliginin sag ustunde kucuk dugme. Ilk uc cevapta ACIK gelir (sayac localStorage'da: "collex.answerguide.seen", lsGet/lsSet sarmalayicilari console.html:3296'da hazir; sunucuya yeni alan EKLENMEZ). Sayac okunamiyorsa ACIK varsayilir.

Dort satir, her biri tek satir:
"1) En ustteki cumle, bu cevabi kullanip kullanamayacaginizi soyler."
"2) Ortadaki kartlar tespitlerdir; her tespitin altinda dayandigi alinti durur."
"3) Alintinin ustundeki baslige tiklayin: belgenin tam o yeri acilir."
"4) En alttaki denetim kaydi, cevabi okumak icin degil savunmak icin vardir."
Kapanis: "Anladim" · "Bu rehber uc cevaptan sonra kendiliginden kapanir; sag ustteki dugmeden geri getirebilirsiniz."

# CEVAP EKRANI
CEVAP EKRANI — SON TASARIM (yukaridan asagi)

Konum: console.html render() (3910-4290), sourceCard (3574), claimCard (3436), answerMetaBlock (9365).
YAPI: uc katman — KARAR / DAYANAK / DENETIM. Hicbir teknik veri SILINMEZ; yer degistirir.

=====================================================
KATMAN 1 — KARAR (baslik karti, console.html:3937-3985 yerine)
=====================================================

(a) Muhur madalyonu — 76 px, korunur, rengi durumdan gelir.

(b) EN BUYUK PUNTO — tek Turkce cumle (bugunku .word'un icine makine sozcugu yerine bu gelir):

  TAM:      "Her tespit bir alintiya baglandi."
  SERHLI:   "Tespitler alintiya baglandi; ancak bir cekince ya da aksi yonde bir kaynak var."
  KISMI:    "Bazi tespitler alintiya baglanamadi."
  CEKIMSER: "Bu soruya cevap yazilmadi."
  uploadOnly (data.status !== ABSTAIN): DEGISMEZ — "N pasaj bulundu" aynen kalir.

  Bu cumleler bilerek GETIRME ifadesidir, hukum degildir. "Dayanagi bulundu" / "Sorunuzun karsiligi bulundu" gibi ustu kapali "sorunuz cevaplandi" vaadi kurulmaz.

(c) IKINCI SATIR — tek talimat:
  TAM:      "Alintilari kendi gozunuzle okuyun; nihai hukuki degerlendirme sizindir."
  SERHLI:   "Aksi yondeki kaynak da bu ekranda; iki tarafi karsilastirmadan dilekceye tasimayin."
  KISMI:    "Baglanamayan tespitler asagida ayrica isaretli; o kismi kaynaga baglamadan kullanmayin."
  uploadOnly: bugunku cumle aynen korunur ("Yuklediginiz belgeden alintilar birebir dogrulandi; bu bir hukuki degerlendirme degildir — belge sorunuzu cevapliyor mu, karari siz verin.") ama sonundaki "(Teknik durum: TAM)" parantezi kucuk rozete iner.

(d) DURUM ROZETI + "?" — kucuk cip, cumlenin ALTINDA:
  "Durum: TAM"  [?]   /  "Durum: SERHLI" [?]  /  "Durum: KISMI" [?]  /  "Durum: DAYANAK BULUNAMADI (CEKIMSER)" [?]
  Makine sozcugu SILINMEZ — kucultulur ve yanina her zaman tek cumlelik karsiligi acan "?" dugmesi konur.

(e) KESINLESTIRME SATIRI — .fin AYNEN KALIR, ayri eksendir, hicbir kosulda birlestirilmez:
  yes: "KESINLESTIRILEBILIR — teknik kontroller tamamlandi; nihai hukuki degerlendirme avukatindir"
  no:  YENIDEN YAZILIR. Bugunku "en az bir dogrulama basarisiz" avukatta "program coktu" izlenimi birakiyor:
       "KESINLESTIRILEMEZ — ic kontrollerden biri sonuc veremedi; asagidaki gerekceleri okumadan kullanmayin"
  CEKIMSER'de: ABSTAIN_NEUTRAL_TR aynen kalir.

(f) KUNYE — tek sessiz satir (bugunku sag dikey .ledger blogu buraya AKAR, dikey blok kalkar):
  "3 Eylul 2026 tarihinde yururlukte olan metne gore degerlendirildi · 4 kaynak · 3 tespit"

(g) DENETIM DOSYASI BAGLANTISI — kunye satirinin altinda, yarim punto aciklamayla:
  "Denetim dosyasini indir"
  "Bu cevabin butun alintilarini, belge surumlerini ve parmak izlerini iceren tek dosya; meslektasiniza ya da bilirkisiye verebilirsiniz." 
  (Bugunku "(JSON — alintilarin bagimsiz denetimi icin)" ibaresi kalkar; JSON adi sozlukte kalir.)

=====================================================
KATMAN 1b — DAYANAK BULUNAMADI (CEKIMSER) — YOL AYRIMI KARTI
=====================================================
Bugun ayni bilgi DORT yerde yaziliyor: baslik damgasi, "CEKIMSER — cevap uretilmedi" h3 (console.html:3998), "gosterilen kaynak karti: 0 · uretilen tespit: 0" (4001), kunyedeki "Soru kapsami: %0". Tek karta iner.

Baslik: "Dayanak bulunamadi — bu yuzden cevap yazilmadi."
Kural cumlesi: "Bu bir ariza degil, urunun kuralidir: ColleX dayanagini gosteremeyecegi bir cumleyi kurmaz. Ekranda tespit ve kaynak karti olmamasinin sebebi budur."
Sinanabilir cumle (KORUNUR, silinmez): "Asagida hicbir kaynak karti ve hicbir tespit yoktur."
NEDEN satiri — iki dal:
  cov.missing dolu ise: "Neden: sorunuzdaki su sozcuklerin taranan kaynaklarda karsiligi yok — kira, tahliye, ihtar." (her sozcuk tiklanabilir; tiklaninca soru kutusunda o sozcugu secili yapar)
  cov.missing bos ise (YEDEK CUMLE ZORUNLU): "Neden: sorunuzun sozcukleri kaynaklarda geciyor, ancak hicbir pasaj sorunun kendisine karsilik gelmiyor — yalniz benzer sozcukler tasiyorlar."
"Buradan sonra dort yol var:" basligi altinda dort eylem, her birinin ALTINDA ne yaptigini soyleyen yarim punto satir:
  "Resmi kaynaklarda ara" — "Yargitay, Danistay ve mevzuat sunucularina baglanir; disari yalnizca sorunuzdan turetilen arama metni gider. Ekli belgeniz varsa canli arastirmada baglam olarak kayda gecer."
  "Belge yukle" — "Sozlesmeyi, karari ya da bilirkisi raporunu yukleyin; cevap dogrudan o belgenin metnine dayansin."
  "Soruyu daralt" — "Kanunun adini, madde numarasini ya da kararin esas numarasini yazmak sonucu en cok degistiren seydir."
  "Degerlendirme tarihini degistir" — "Cevap, sectiginiz tarihte yururlukte olan metne gore verilir."
  "onerilen" ibaresi SABIT YAZILMAZ; health durumundan turetilir (canli arastirma kapaliyken avukat cikmaz dugmeye yollanmaz).
Alt satir (cov.setAside > 0 ise, KORUNUR): "Taramada gorulen ama dayanak sayilmayan belgeler (4)" — katli. Ici: "Asagidaki belgeler aramada gorundu, ancak sorunuzla yalniz sozcuk duzeyinde benziyor. Dogrulamadan gecmemis metni alinti gibi gostermiyoruz; kunyelerini gorebilir, kendiniz acabilirsiniz."
CEKIMSER'de Icindekiler seridi ve § numaralari HIC CIZILMEZ.
CEKIMSER'de bile su satir DENETIM KAYDINDA DEGIL, GORUNUR kalir: "Aleyhe karar arandi: 6 ayri arama yapildi, aksi yonde karar bulunamadi. Bu, aksi yonde karar olmadigi anlamina gelmez; yalnizca bu arsivde bulunmadigi anlamina gelir."

=====================================================
KATMAN 1c — KUNYE BLOGU (answerMetaBlock, console.html:9365) — YERINDE KALIR
=====================================================
SIRA 5'in "dayanaklarin altina indir" onerisi reddedildi: kodun kendi yorumu (9394, 9406) bu satirlarin tespitlerden ONCE gorunmesini sart kosuyor. Blok yerinde kalir, YALNIZ DILI degisir:

  "Soru kapsami: %22 — soru sozcuklerinin kaynaklarda karsiligi"
  =>  "Sorunuzun 9 anahtar sozcugunden 2'si kaynaklarda karsilik buldu. Karsilik bulmayanlar: kidem, ihbar, fesih."
  (% isareti ana akistan kalkar; sayinin kendisi Denetim kaydinda kalir.)

  "Kapsam — yalniz yuklediginiz 3 belge — yerel korpus taranmadi."
  =>  "Yalniz yuklediginiz 3 belgede arandi; hukuk kutuphaneniz taranmadi."

  "Uretim: Kural tabanli — yerel"
  =>  "Bu cevabi yapay zeka yazmadi: cumleler kaynaklardan oldugu gibi alindi, siralamasi kurallarla yapildi."
  "Uretim: Bulut AI ..."
  =>  "Taslagi bulut yapay zeka yazdi; yazdigi her cumlenin dayanagi bu bilgisayarda tek tek dogrulandi."

  "Veri kaynagi: ..." (corpusNotice, sunucudan gelir) — KORUNUR; sunucu metni de ayni dalgada Turkcelestirilir (src/pipeline/answerPipeline.ts:127).

  RETRIEVAL_LANE_DEGRADED satiri, partiallyCovered satiri, setAside satiri ve UPLOAD_CLAIM_NOTE_TR: HEPSI GORUNUR KALIR, hicbiri katlanmaz. Kodun 9406'daki yorumu ("bir arama seridinin sessizce dusmesi KAPSAM kaybidir") baglayicidir.

=====================================================
KATMAN 2 — DAYANAK (tespit karti + alintisi ayni kartta)
=====================================================
En buyuk yapisal degisiklik: bugun avukat tespiti okuyup "[1] numarali kaynaga git" ile ayri bir bolume kayiyor. Artik alinti tespitin ALTINDA.

TESPIT KARTI, yukaridan asagi:
  - Hukum cipi (kendini aciklayan Turkce; VERDICT_TR yeniden yazilir) + "?" dugmesi
  - Tespit metni
  - Guven cumlesi — YUZDE CUBUKLARI ANA AKISTAN KALKAR, ama teshis SABITLENMEZ:
      confidenceSummary bugun bes boyutun EN DUSUGUNU hesaplayip adini yaziyor. Bu korunur, yalnizca yuzde silinir:
      guclu:  "Bu dayanagin zayif yani cikmadi; alinti, belgenin kayitli nushasiyla harfi harfine karsilastirildi."
      orta:   "Bu dayanagin en zayif yani: {boyut adi}. Dilekceye gecirmeden once kaynagi kendiniz okuyun."
      zayif:  "Dikkat: bu dayanagin {boyut adi} yani zayif. Kaynagi acip kendiniz okumadan bu tespiti kullanmayin."
      (Sabit tek cumle YAZILMAZ — hep KAPSAM'i suclamak, zayif boyut Guncellik iken mulga bir hukmun ustunu orter.)
  - Sayac satiri: "2 kaynaga dayaniyor · aleyhe 1 kaynak"
  - DAYANAK BLOGU (tespitin ici): kaynak basligi · mahkeme/tarih · YURURLUK ROZETI (mulga / guncel degil / henuz yururlukte degil — ILK BAKISTA gorunur, asla katlanmaz) · "Alinti, belgenin bu bilgisayarda kayitli halinden harfi harfine alinmistir; tek sozcugu degistirilmemistir." · serif blok alinti · kisa kunye (E./K., mevzuat no, madde) · "Belgeyi tam metniyle ac"
  - KATLAMA COZUMU (juri celiskisini kapatir): ilk tespit acik, kalanlar katli davranisi KORUNUR; katlandiginda kapakta MUTLAKA su dorder oge kalir: hukum cipi, tespit metninin ilk iki satiri, guven cumlesi, kaynak basligi + yururluk rozeti. Boylece katli bir tespit bile nereden geldigini soyler ve 6.108 px olcumu (console.html:3412) geri gelmez.

AKSI YONDE KARAR BLOGU — ayri § bolum olmaktan cikar, celistigi tespitin ALTINA iner:
  Sol kenari bordo cizgili alt blok. Baslik: "Bu tespitin aksine karar var"
  "Aleyhinize olan kaynak gizlenmez. Asagidaki karar, yukaridaki tespitin tersi yonde sonuca varmistir."
  + karsit kaynagin basligi, yururluk rozeti ve birebir alintisi.

FILL/DOGRULAMA CUMLESI KOSULLUDUR, SABIT DEGIL: fillDocText (console.html:7521-7565) karakter dilimini karsilastirir ve ya "✓ karakteri karakterine ortustu" ya "⚠ Alinti araligi bu metinle birebir ortusmedi" yazar; asenkron parmak izi kontrolu bunu "⚠ Belge parmak izi ESLESMEDI — bu metni kullanmayin"a cevirebilir. Bu uc dal AYNEN korunur; olumlu cumle asla sabit basilmaz.

=====================================================
KATMAN 3 — "BU CEVABIN DENETIM KAYDI" (tek katli cekmece, sayfa sonu)
=====================================================
Bugun ayri ayri § baslik ve ayri Icindekiler satiri alan uc bolum (console.html:4064 sec-karsit, 4244 sec-uyarilar, 4270 sec-iz) tek baslik altinda dort katli satira iner.

Baslik: "Bu cevabin denetim kaydi"
Giris (KOSULLU — mutlak degil): 
  finalizable === true ve hicbir dogrulama bileseni hata bildirmediyse:
    "Asagidakiler cevabi okumak icin gerekmez; bu cevabi bir baskasina — hakime, bilirkisiye, karsi vekile — karsi savunmaniz gerektiginde gerekir."
  finalizable === false YA DA CANONICAL_TEXT_PORT_FAILED / VERSION_FACTS_FAILED / ENTAILMENT_PORT_FAILED / DRAFTER_FAILED uyarilarindan biri varsa:
    Uyarilar bolumu KATLANMAZ ve cekmecenin USTUNDE, katlanmayan kalin tek satir olarak durur: "Bu cevabi oldugu gibi kullanmayin: asagidaki gerekcelerden en az biri, cevabin bir bolumunun dayanagini zayiflatiyor." Giris cumlesi bu halde YAZILMAZ.

Dort katli satir:
  "Aleyhe karar taramasi (6 arama)" — ama SONUC cumlesi kapaginin USTUNDE, gorunur kalir (yukarida yazildi). Kapagin icinde yalniz sorgu dokumu ve ham kodlar.
  "Kanit kumesine alinmayan belgeler (4)"
  "Uyarilar ve dogrulama gerekceleri (2)" — her satir Turkce cumle; ham kod (QUESTION_NOT_COVERED, EVIDENCE_CAP_APPLIED) cumlenin ardindan soluk parantez icinde.
  "Cevap nasil uretildi (13 adim)" — adim adlari Turkce; milisaniye sayilari yalniz burada.
Icinde ayrica: soru kapsami yuzdesi, arama seritlerinin dokumu, arastirma numarasi.
CAPA KURALI: #sec-karsit, #sec-uyarilar, #sec-iz kimlikleri KORUNUR (console.test.ts ve pendingAnswerJump bunlara bagli). Kimlikler artik <details> uzerindedir; render() sonunda calisan jump (console.html:4276) SICRAMADAN ONCE hedefin details.open = true yapmalidir — yoksa "Karsit ictihat tara" is karti (9892) kapali bir kutunun ustune duser.

=====================================================
KAYNAK KARTINDAKI TEKNIK SATIR (console.html:3675-3681)
=====================================================
Bugun cizilen:  "Alinti parmak izi (SHA-256) ... · Belge parmak izi (SHA-256) ... · Konum 1240–1512 (Unicode karakter sayimi) · Belge surumu 7"
Yeni hali — katli kapak: "Bu alinti nasil dogrulandi?"
Kapagin ici, ilk satir aciklama (WARN_BUDGET'ten GECMEZ, kendi .expl-def sinifini alir):
  "Asagidaki numaralar, metnin tek bir harfi degisse bile bambaska cikar. Alintinin belgeden koparilmadigini boyle gosteriyoruz; bu bir noter onayi degildir ve numara, resmi yayimlanmis metinle degil, bu bilgisayarda kayitli nusha ile eslesmeyi gosterir."
Satirlar:
  "Alintinin parmak izi"  (deger) · "(Teknik adi: SHA-256.)"
  "Belgenin parmak izi"   (deger)
  "Alintinin belgedeki yeri: 1.240. harften 1.512. harfe kadar"   ("Unicode karakter sayimi" ibaresi buradan cikar, sozlukte kalir)
  "Belgenin kayitli 7. surumu — belge her yeniden yuklendiginde numara artar, eski surumler silinmez"

=====================================================
UYARI BUTCESI KURALI (baglayici)
=====================================================
Yeni aciklama ve tanim cumlelerinin HICBIRI noticeLine() uzerinden gecmez ve WARN_BUDGET_SENTENCES (console.html:3860, deger 8) muhasebesine girmez. Kendi sinifini alir (.expl-def). Gecerlerse gercek uyarilar 8 cumle sinirini asip katlanmis karta itilir ve ekrandan duser — urunun en kritik davranisi sessizce korelir.

# GEZINME
GEZINME — SON HALI

=====================================================
A) SEKME YAPISI — 5 SEKME KORUNUR
=====================================================
"Dosyalarim · Arastir · Belgeler · Taslak · Ayarlar" aynen kalir.
Dortleme (Bugun/Dosyalarim/Arastirma/Ayarlar) bu dalgada YAPILMAZ. Gerekce: #izgara, #harc, #denetim, #karar-ara gorunumlerinin dosyadaki TEK gotoView giris noktasi silinmesi onerilen is kartinin kendisidir ve hicbir test bunu yakalamaz; sekme indirimi ancak her hedefin yeni girisi baglanip dogrulandiktan SONRA, ayri bir dalgada yapilir.

UST CUBUK — soldan saga:
  monogram · aktif dosya secici · Kendi kayitlarim · Canli arastirma · Bulut yapay zeka · ? · ◐ Tema

Uc rozet SILINMEZ (tek "Durum" dugmesinde birlestirilmez — korpus sentetik ya da bosken "Durum: hazir" yazmasi ustu kapali bir dogruluk iddiasi olurdu). Yalniz adlari degisir:
  "Veritabani"      => "Kendi kayitlarim"        (title: "Kendi kayitlariniz: dava dosyalariniz, belgeleriniz, cevaplariniz — Ayarlar › Sistem durumu")
  "Canli arastirma" => aynen kalir
  "Bulut AI"        => "Bulut yapay zeka"        (LANG-7 tek-ad kurali korunur; console.test.ts:801-803 yeni tek ada tasinir, prose'daki "bulut yapay zeka (Bulut AI)" ikilemesi tekilesir)

YENI: "?" DUGMESI — ◐ Tema'nin soluna, ayni boyda, kalici, her ekranda.
Basilinca sekmelerin hemen altinda sага yasli dort satirlik liste acilir:
  "Nasil calisir?" · "Sozluk" · "Neyi tariyoruz?" · "Verilerim nerede?"
Ince ayrac, sonra tek satir: "Karsilama kartini yeniden goster"
Klavye: mevcut nav[role=tablist] ok tusu duzeniyle CAKISMAZ (menu ayri bir role=menu kabidir, ok tuslari yalniz menu acikken menuye aittir).

TEK KAPI YASASI (uc sinanabilir kural, tum ekranlarda gecerli):
  1. Hicbir aciklama katmani kendiliginden acilmaz.
  2. Kapatildigi yerde kapali kalir; durum hatirlanmaz.
  3. Geri donus tek kapidan — ust cubuktaki "?" dugmesinden — olur.
  Ek: ayni anda tek satir ici kart acik kalir; Esc kapatir.

=====================================================
B) ARASTIR EKRANI — SORU KUTUSU EN USTE
=====================================================
Bugun: <section class="workwrap" id="workwrap"> (console.html:2301) soru formundan (2306, <section class="bench">) ONCE geliyor; soru kutusu 1188. pikselde kaliyor.
Yeni: iki bolumun yeri takas edilir. Bu bir isaretleme hareketidir (~5 satir); JS mantigi degismez.

Yeni sira:
  1. "Neyi ogrenmek istiyorsunuz?" basligi + altinda tek satir gri aciklama: "Cevabin her tespitinin altinda dayandigi belge ve pasaj yazar."
  2. Buyuk soru kutusu (dort satir yuksekliginde). Sayfa acilinca imlec burada.
  3. "Nerede arayalim?" — uc secenek, her birinin ALTINDA tek satir aciklama:
       "Hukuk kutuphanemde" — "Internete cikilmaz; yalniz bu bilgisayara kurulu mevzuat ve karar metinleri taranir."   (bugunku "Yerel korpus", console.html:2315)
       "Yukledigim belgelerde" — "Yalniz isaretlediginiz belgelerin metni okunur."
       "Resmi kaynaklarda" — "Yargitay, Danistay ve Mevzuat Bilgi Sistemi gibi resmi kaynaklara baglanilir. Bir arastirma en cok 2 dakika surer ve en cok 10 belgenin tam metnini getirir. Arama sonuc listeleri dayanak sayilmaz; dayanak, getirilen belgenin tam metnidir."
     Onay kutusu (console.html:2332): "korpusla birlikte — yerel korpus da taransin" => "hukuk kutuphanem de taransin"
     Kapali secenek soluk gorunur ve nedenini KENDI satirinda duz Turkce yazar (bkz. D).
  4. "Ara ve dayanagiyla getir" muhru + "Hangi tarihteki hukuka gore?" tarih alani yan yana.
  5. Katlanmis "Ayrintili arama" — mahkeme turu, tarih araligi, bulut yapay zeka anahtari, ekli belgeler.
  6. CEVAP ALANI.
  7. Katlanmis "Hazir isler" (bkz. C).
  8. Katlanmis "Son arastirmalarim".

Aktif dosya yokken soru kutusunun ALTINDA tek satir (tam genislik sari serit yerine):
  "Bir dava dosyasi secili degil — bu cevap hicbir dosyaya kaydedilmeyecek. Baglamak icin ust cubuktan bir dosya secin."
Secici bosken kehribar cerceve alir. Sari serit (console.html:2234) yalniz bu tek satira iner; silinmez, TASINIR.

=====================================================
C) IS KARTLARI — 15 KART, UC AILE, KATLI TEK BOLUM
=====================================================
Bolum adi: "Hazir isler" — cevabin ALTINDA, katlanmis. Aciklama: "Sik yapilan hazirliklar. Her biri tek tikla calisir; ne yaptigi kendi satirinda yazar."
Butun "out:" ("Cikti: ...") satirlari SILINIR — avukat isini cikti bicimine gore secmez.
IKI KART DUSER, 13 KART KALIR. Hicbir gotoView hedefi yetim birakilmaz:
  - "soru" (Hukuki soru sor) DUSER — soru kutusu artik ekranin en ustunde; kart tekrardir.
  - "takvim" DUSER — Dosyalarim'daki sure panelinde ZATEN calisan "Takvimi ac" dugmesi var (console.html:2250). Dogrulandi.
Kalan 11 kartin hedefi (izgara, karar-ara, denetim, harc, sozlesme, kapsam) aynen korunur.

AILE A — "BELGELERIMLE CALIS"
  "Belgeyi ozetle" — "Sectiginiz belgeden konu, taraflar, talepler ve tarihleri cikarir; her cumlenin altinda alintisi durur."
  "Tarih sirasi cikar" — "Belgedeki tarihleri ve her tarihe bagli olayi, gectigi pasajla birlikte listeler."   (eski: "Kronoloji cikar")
  "Ayni soruyu bircok belgeye sor" — "Satir belge, sutun soru; her hucre kaynagina bagli."   (eski: "Belge × soru izgarasi")
  "Sozlesmeyi kontrol listemle karsilastir" — "Kendi kontrol listenizle karsilastirir; kural tabanlidir, yorum uretmez."

AILE B — "KARAR VE MEVZUAT BUL"
  "Karar ve mevzuat ara" — "Merci, daire, yil araligi, tam ifade ve haric tutulacak kelimelerle arar; bulunan belgenin tam metnini getirir."   (eski satirdaki "hash'li tam metin karti" ifadesi silinir)
  "Aleyhe kararlari da tara" — "Sorunuzu calistirir ve dogrudan aleyhe kaynak taramasina goturur; aleyhinize olan kaynak gizlenmez."   (eski: "Karsit ictihat tara")
  "Resmi kaynaklarda arastir" — "Resmi kaynaklara baglanir; en fazla 2 dakika ve en fazla 10 tam belge."
  "Hangi kaynaklara bakabiliyoruz?" — "Bagli kaynaklar, bugun kapali olanlar ve kapsam disi kalan alanlar — olculmemis alana sayi yazilmaz."   (eski: "Neyi tariyoruz?", "kapsam manifestosu" ifadesi silinir)

AILE C — "HESAP VE DENETIM"
  "Sure hesapla" — "30 usul kurali, adli tatil ve HMK m. 92/2 ile hesaplar. Her sonuc DOGRULANMADI etiketiyle gelir: sureyi mutlaka kendiniz de kontrol edin."
  "Harc ve gider hesapla" — "492 s.K. tarifesine gore basvurma, karar-ilam ve pesin harc; bilinmeyen tutar uydurulmaz, sizden istenir."
  "Dilekcemdeki atiflari denetle" — "Dilekcedeki her atfi arar; yururlugu DILEKCENIN TARIHINE gore okur, cozemedigi kunyeyi bos birakir."   (eski: "Atif Denetim Raporu")
  "Dilekce taslagi hazirla" — "13 sablon; dayanagi olmayan her paragraf KAYNAKSIZ isaretlenir, dogrulanamayan atifta disa aktarim reddedilir."
  "Kayitli arastirmalarim" — "Bu bilgisayarda saklanan onceki cevaplari acar; hicbiri disari gonderilmez."

CALISAMAYAN KART: silik gorunur ve nedenini KENDI satirinda duz Turkce yazar:
  "Once Belgeler'e bir belge yukleyin."
  "Hukuk kutuphaneniz bu sunucuda bos."   (eski: "Bu sunucuda yerel korpus bos.")
  "Canli arastirma su an kapali. ColleX'i kapatip masaustundeki ColleX simgesine yeniden tiklayin."   (eski: "ColleX-Baslat.cmd ile baslatin.")

=====================================================
D) .CMD TALIMATLARININ DUZ TURKCEYE CEVRILMESI
=====================================================
Avukat .cmd dosyasinin ne oldugunu, nerede durdugunu ve "calistirmanin" ne demek oldugunu bilmez. Uc yerde birden degisir:
  SERVER_DOWN_TEXT (console.html:2785) =>
    "Sunucuya ulasilamadi — ColleX kapali gorunuyor. ColleX'i kapatip masaustundeki ColleX simgesine yeniden ciftlkatiklayin; baglanti gelince bu sayfa kendini yeniler."
  STORE_UNAVAILABLE_TEXT (console.html:2781) =>
    "Kendi kayitlariniza ulasilamadi. ColleX'i kapatip masaustundeki ColleX simgesine yeniden ciftlkatiklayin; sorun surerse acilan siyah pencerenin icindeki yaziyi saklayin ve destege gosterin."
  livehint (console.html:2318) ve canli is kartinin blocked cumlesi (console.html:9906) => yukaridaki aile C metni.
Teknik adlar (ColleX-Baslat.cmd, ColleX-Durdur.cmd) YALNIZ Ayarlar › Sistem durumu satirinda, Turkce cumlenin ARDINDAN parantez icinde kalir.

# SOZLUK EKRANI
SOZLUK VE "NASIL CALISIR" EKRANLARI — SON TASARIM

=====================================================
ALTYAPI — TEK KAYNAK KURALI (baglayici)
=====================================================
console.html:3884'teki TERM_TR dizgeden NESNEYE cevrilir ve tek kaynak olur:

  var TERM_TR = {
    "parmak-izi": {
      ad: "Belge parmak izi",
      tanim: "Bir belgenin metninden hesaplanan, o metne ozel kisa imza.",
      neden: "Belgede tek harf degisse imza da degisir; alintinin hala ayni belgeden, ayni haliyle geldigini boyle gosterebilirsiniz.",
      teknik: "SHA-256",
      nerede: "Kaynak kartindaki 'Bu alinti nasil dogrulandi?' kapaginda ve belge kunyesinde."
    }, ...
  }

  - Satir ici "?" karti ve Sozluk ekrani AYNI nesneden cizilir. Hicbir tanim metni ikinci kez elle yazilmaz.
  - defineTerm(node, key) artik node.title YAZMAZ. Bugunku hali dokunmatikte ve klavyede tamamen gorunmez — bir suslemem, onarimdir.
  - Bugunku BES tanimin (aktif dosya, KAYNAKSIZ, K-n, surum, deneysel) hepsi yeni yapida KORUNUR; hicbiri kaybolmaz.

SATIR ICI "?" BILESENI (SCR-D):
  (a) DUGME: terimin sagında 16 px yuvarlak, ince bronz cerceveli "?" — satir yuksekligini degistirmez, aria-expanded tasir, erisilebilir adi: "'KAYNAKSIZ' ne demek?"
  (b) KART: basilinca AYNI kartin icinde, o satirin hemen ALTINDA acilir — YUZEN KATMAN DEGIL, akisin icinde. Gerekce: satir ici style yasak oldugu icin CSS ile konumlanan bir balon dar ekranda, tablo icinde ve overflow:auto kapsayicilarda tasar.
  (c) Kart icerigi: terim adi (kucuk bordo etiket) · tek cumle tanim · gerekiyorsa tek satir "Neden onemli" · alt satirda "Sozlukte ac" ve "Kapat". En fazla dort satir; daha uzunu Sozluk'e aittir.
  (d) Acilip kapanma MUTLAKA preserveFocusPosition(fn, dugme) sarmalayicisindan (console.html:8117) gecer ve acan dugme ACIK CAPA olarak verilir; yoksa akis icinde acilan kutu avukatin bastigi dugmeyi ekrandan kaydirir (dosyada 449 px ve 224 px olarak olculmus kusur).
  (e) Ayni terim ayni ekranda yalnizca ILK gectigi yerde isaretlenir; ayni anda tek kart acik kalir; Esc kapatir; durum hatirlanmaz.

"?" DUGMESI ZORUNLU OLAN YERLER (tercih degil):
  Durum rozeti (TAM/SERHLI/KISMI/DAYANAK BULUNAMADI) · KAYNAKSIZ rozeti · K-n cipleri · yururluk rozetleri · SENTETIK kanit cipi · "kanit bagi koptu" satiri · ayrilan/setAside notu · aleyhe kaynak gostergesi · DOGRULANMADI (sure hesabi) · "deneysel" etiketi · aktif dosya secici · parmak izi satiri.
  Kural: uyari tasiyan HER etiket "?" alir. "Bir ekranda en fazla uc ?" gibi estetik bir kota KONULMAZ — o kota aciklamayi degil uyariyi kirpardi.

=====================================================
EKRAN 1 — "NASIL CALISIR?" (#nasil)
=====================================================
Kurulum: HIDDEN_VIEWS'a `nasil: "ayarlar"`, ARGLESS_HIDDEN'a `nasil: true` eklenir (console.html:4382-4390). Kendi "← geri" baglantisini tasir. Hicbir kosulda kendiliginden acilmaz.

Baslik: "ColleX nasil calisir?"
Alt baslik: "Bes dakikada okunur. Gecen terimlerin tamami Sozluk'te tek cumleyle aciklanmistir."

1. TEK CUMLEDE (cerceveli tek paragraf)
"Bir soru sorarsiniz; ColleX belgelerde arar, buldugu bolumleri belgeden birebir kopyalar ve cevabin her tespitini bu kopyalara baglar. Baglayamadigi tespiti yazmaz."

2. BIR SORUNUN YOLCULUGU (dort numarali adim, sema yok, ikon yok)
"1. Sorunuz — Sorunuzu gundelik Turkceyle yazarsiniz; hukuk terimi kullanmak zorunda degilsiniz."
"2. Arama — Uc yerde arayabilir: bu bilgisayardaki hukuk kutuphanesi, sizin yukledginiz belgeler ve aciksa resmi kaynaklar. Nerede aradigini cevabin basinda yazar."
"3. Alinti — Buldugu her bolumu belgenin bu bilgisayarda kayitli halinden birebir kopyalar. Bu bir ozet degil, alintidir; ustune tiklarsaniz belgenin o satirina gidersiniz."
"4. Cevap — Cevaptaki her tespitin altinda dayandigi alinti durur. Dayanagini gosteremedigi tespiti yazmaz."

3. CEVABIN USTUNDEKI ETIKET NE DEMEK? (mevcut STATUS_TR renkleriyle)
"TAM — Cevaptaki butun tespitler bir alintiya baglandi."
"SERHLI — Tespitler kaynakli, ama bir cekince ya da aksi yonde bir karar da bulundu. Ikisi de gosterilir."
"KISMI — Bazi tespitler dogrulanamadi. Cevap eksiktir; oldugu gibi kullanmayin."
"DAYANAK BULUNAMADI (CEKIMSER) — Yeterli dayanak bulunamadigi icin ColleX cevap yazmadi. Bu bir ariza degildir; urunun asil davranisidir."
Ayri satir: "KESINLESTIRILEMEZ — Ic kontrollerden biri sonuc veremedi. Bu, durumdan AYRI bir bilgidir: cevap TAM iken de cikabilir."

4. BU BIR DOGRULUK GARANTISI DEGILDIR (urunun tek acik inkar cumlesi, kalici ekranda durur)
"Bu bir dogruluk garantisi degildir — her tespiti kendi gozunuzle kaynagindan okuyabilesiniz diye kurulmus bir duzendir."

5. COLLEX NE YAPMAZ
"Yuzde vermez, 'hatasiz' demez, davanin sonucunu tahmin etmez."
"Dayanagini gosteremedigi yeri bos birakmaz; KAYNAKSIZ diye isaretler ve onunuze koyar — gizlemez."
"UYAP ile esitlenmez ve sizin adiniza hicbir yere evrak gondermez."
"Hicbir karari sizin yerinize vermez."

6. BIR CEVABI NASIL DENETLERSINIZ? (dort adim)
"1) Cevabin basindaki cumleyi okuyun: bu cevabi kullanip kullanamayacaginizi soyler."
"2) Her tespitin altindaki alintiyi okuyun."
"3) Alintinin basligina tiklayin: belgenin tam o yeri acilir."
"4) Alintinin belgede birebir gectigini kendi gozunuzle gorun. Gormediginiz bir cumleyi kullanmayin."

7. VERILERINIZ NEREDE DURUYOR?
"Dava dosyalariniz, yuklediginiz belgeler, cevaplar ve taslaklar bu bilgisayarda kalir. Iki istisna vardir ve ikisi de ekranda acikca yazar: 'Resmi kaynaklarda ara' sectiginizde sorunuzdan cikan arama sozcukleri o kaynaklarin sitelerine gider (ekli belgeniz varsa canli arastirmada baglam olarak kayda gecer); 'Bulut yapay zeka'yi siz acarsaniz yalniz o istek icin ilgili belge metni disaridaki bir servise gider — bu secenek varsayilan olarak kapalidir. Bu calisma alani UYAP ile eslesmez."

8. SIK SORULAN BES SORU (mevcut <details class="mini"> kalibiyla)
"Cevabin dogrulugunu nasil kontrol ederim? — Tespitin altindaki alintinin basligina tiklayin; belgenin o satirina gidersiniz. Alinti ile belgedeki metin birebir ayni degilse ColleX sizi uyarir."
"Internet kapaliyken calisir mi? — Evet. Yalniz resmi kaynak aramasi ve bulut yapay zeka internet ister; diger her sey bu bilgisayarda calisir."
"Neden bazi sorularima cevap vermiyor? — Elindeki belgelerde o soruya dayanak bulamadigi icin. Belgelerinizi yukleyip yeniden sorun ya da resmi kaynaklarda aratin."
"Hazirladigi dilekceyi oldugu gibi verebilir miyim? — Hayir. Bu bir taslaktir; her paragrafini okumaniz, KAYNAKSIZ isaretli paragraflari ya tamamlamaniz ya da cikarmaniz gerekir."
"Bir aksilik olursa ne yaparim? — Ust cubuktaki rozetlere bakin. Kirmiziysa ne yapmaniz gerektigi orada tek cumleyle yazar."

Alt bar: "Sozlugu ac"  ·  "Karsilama ekranini yeniden goster"

=====================================================
EKRAN 2 — "SOZLUK" (#sozluk)
=====================================================
Kurulum: HIDDEN_VIEWS'a `sozluk: "ayarlar"`, ARGLESS_HIDDEN'a `sozluk: true`.

Baslik: "Sozluk"
Alt baslik: "ColleX'te gecen her terimin tek cumlelik karsiligi. Ekranda anlamadiginiz bir kelime gorurseniz yanindaki ? dugmesine basin; sizi dogrudan buraya getirir."
Arama kutusu (mevcut .tin.search kalibi): "Sozlukte ara — terim ya da kelime"
Bos sonuc: "Bu kelime sozlukte yok. Aradiginiz sey bir ekranda geciyorsa yanindaki ? dugmesine basin."
Alfabetik tek sutun. Her maddenin kendi id'si var (sozluk-parmak-izi gibi); satir ici "?" karti buraya derin baglanti verir.
Her madde: kalin BASLIK (avukatin ekranda GORDUGU kelime, teknik ad degil) + tek cumle tanim + gerekiyorsa "Neden onemli" + "Nerede gorursunuz" + gerekiyorsa sonda "(Teknik adi: ...)".

MADDELER:

Aktif dosya — Ust cubuktan sectiginiz dava dosyasi. Seciliyken urettiginiz cevap, yuklediginiz belge ve yazdiginiz taslak kendiliginden o dosyaya baglanir; secili degilken hicbiri bir dosyaya baglanmaz.

Alinti — Belgeden birebir kopyalanmis metin parcasi. Ozetlenmemis, kisaltilmamis, kelimesi degistirilmemistir. Nerede gorursunuz: her tespitin altinda.

Pasaj — Bir belgenin, alintinin alindigi bolumu; cogu zaman birkac paragraf. ColleX uzun belgeleri pasajlara ayirir ve her alintiyi tek bir pasaja baglar.

K-1, K-2 … — Cevaptaki alintilarin numarasidir. Her numara belirli bir belgenin belirli bir bolumunu gosterir.

Tespit — ColleX'in cevapta kurdugu tek bir hukum cumlesi. Her tespitin altinda dayandigi alinti durur.

Hukuk kutuphanesi — ColleX kurulurken bu bilgisayara konulan mevzuat ve karar metinleri. "Yerel" olmasi, aramanin internete hic cikmadan yapilmasi demektir. Nerede gorursunuz: Arastir ekranindaki kapsam secimi. (Ekranin bazi yerlerinde eskiden "yerel korpus" yaziyordu.)

Resmi kaynaklar — Yargitay, Danistay, Anayasa Mahkemesi ve Mevzuat Bilgi Sistemi gibi kaynak siteleri. Bu secenek internet ister; bir arastirma en fazla 2 dakika surer ve en fazla 10 belgenin tam metnini getirir. Arama sonuc listeleri dayanak sayilmaz; dayanak, getirilen belgenin tam metnidir.

Bulut yapay zeka — Cevabi yazarken bu bilgisayar disindaki bir yapay zeka servisinden yardim alma secenegi. Varsayilan olarak kapalidir. Acarsaniz yalniz sizin baslattiginiz istek icin ilgili belge metni disari gider ve ColleX bunu her seferinde ekranda yazar.

Belge parmak izi — Bir belgenin metninden hesaplanan, o metne ozel kisa imza. Belgede tek harf degisse imza da degisir. Neden onemli: alintinin hala ayni belgeden, ayni haliyle geldigini boyle gosterebilirsiniz. Bu bir noter onayi degildir; imza, resmi yayimlanmis metinle degil, bu bilgisayarda kayitli nusha ile eslesmeyi gosterir. (Teknik adi: SHA-256.)

Metindeki yeri — Alintinin, belgenin kacinci harfinden kacinci harfine kadar uzandigi. Ayni alintiyi baskasinin da ayni yerde bulabilmesi icindir. (Teknik adi: Unicode karakter sayimi.)

Belge surumu (nusha no) — Ayni belgenin her yuklenisi ayri surum sayilir ve eskiler silinmez. Bir alinti hangi surumden alindiysa onun numarasi yazilir.

Taslak surumu — Taslagin her kaydedilisi ayri numara alir. Eski surumler durur; istediginiz zaman geri donebilirsiniz.

DAYANAK BULUNAMADI (CEKIMSER) — ColleX yeterli dayanak bulamadigi icin cevap yazmadi. Tahmin etmek yerine susmayi secer. Neden onemli: bu etiketi gordugunuzde belge yukleyip ya da kapsami genisletip yeniden sorabilirsiniz.

TAM · SERHLI · KISMI — Cevabin ustundeki durum etiketleri. TAM: butun tespitler bir alintiya baglandi. SERHLI: tespitler kaynakli, ama bir cekince ya da aksi yonde bir karar da bulundu. KISMI: bazi tespitler dogrulanamadi; cevap eksiktir.

KESINLESTIRILEMEZ — Ic kontrollerden biri sonuc veremedi. Durumdan ayri bir bilgidir; cevap TAM iken de cikabilir. Neden onemli: gerekcelerini okumadan bu cevabi kullanmayin.

KAYNAKSIZ — Bu paragrafin metni, taslaga bagli belgelerin hicbirindeki alintiyla ortusmuyor. Dayanagini siz eklemelisiniz. Neden onemli: KAYNAKSIZ paragraf duruyorken taslak disa aktarilmaz — yanlislikla dayanaksiz dilekce vermeyesiniz diye.

Aleyhe kaynak — Bulunan sonucun aksini soyleyen karar ya da hukum. ColleX bunlari gizlemez; celistigi tespitin hemen altina koyar. (Ekranin bazi yerlerinde eskiden "karsit otorite" yaziyordu.)

Yururluk — Bir hukmun sorulan tarihte gecerli olup olmadigi. Rozetler: yururlukte · guncel degil · mulga · henuz yururlukte degil · biliniyor degil · yuklediginiz belge — yururluk degerlendirilemez.

Deneme belgeleri — Bu kurulumda gercek mevzuat yerine deneme amaciyla uretilmis metinler var. Cikan hicbir sonuc gercek hukuki degerlendirme degildir; dilekcede kullanmayin.

Deneysel — Bu cikti bicimi uretiliyor, ama hedef programda (UYAP Dokuman Editoru) henuz hic acilmadi. Acildigi dogrulanana kadar bu etiket kalkmaz.

DOGRULANMADI (sure hesabi) — Sure, kuralina gore hesaplandi; ancak hicbir merci onaylamadi. Neden onemli: sureyi mutlaka kendiniz de kontrol edin; ColleX bunu size her hesapta hatirlatir.

Denetim dosyasi — Bir cevabin butun alintilarini, belge surumlerini ve parmak izlerini iceren tek dosya. Baska bir kisi ya da program bu cevabi bu dosyayla bagimsiz olarak denetleyebilir. (Teknik adi: JSON.)

Kendi kayitlariniz — Dava dosyalariniz, belgeleriniz, cevaplariniz ve taslaklarinizin durdugu yer. Bu bilgisayardan cikmaz. Teknik ayrintisi: Ayarlar › Sistem durumu.

=====================================================
EKRAN 3 — AYARLAR'A EKLENEN KART
=====================================================
Mevcut "Neyi tariyoruz, neyi taramiyoruz?" kartinin hemen USTUNE:
Baslik: "Nasil calisir?"
Tek cumle: "ColleX'in ne yaptigini, ne yapmadigini ve bir cevabi nasil denetleyeceginizi bes dakikada anlatir."
Iki dugme: "Anlatimi ac" · "Sozluk"
Ayarlar dort karta iner: "Kendim" (ad, baro, sicil, adres — dilekcelerin vekil blogu) · "Tercihler" · "Verilerim nerede?" · "Sistem durumu ve yedekleme". Veritabani adi ve klasor yolu "Verilerim nerede?" kartinin icinde, "Teknik ayrinti" basligi altinda kalir.

# ADIMLAR
1. [P0] control-plane/tests/pipeline/console.test.ts -- ONCE TESTLERI TASI (kod degismeden). Pinlenen dizgeler: 99 'CEKIMSER', 234 'Unicode karakter sayimi', 296 gizlilik cumlesi, 337 'Dosyasiz calisma', 423 ve 1205 'yerel korpus (SENTETIK)', 467/477 demo damgasi + 'Bulut AI: kapali', 637-645 demobanner/compact, 801-803 LANG-7 'Bulut AI' tek-ad, 1075 CSV basligi 'Konum (Unicode)'/'Alinti SHA-256', 1165 'Teknik ayrintilar (parca kimligi ve Unicode konumu)', 1174-1185 defineTerm pinleri, 1195 eski duvar metni, 1483 WELCOME_TITLE_TR birebir, 1489-1496 90 sozcuk tavani, 1933-1951 body:not(.compact) + .stamp CSS blogu. Her birini yeni sabite tasi; 90 sozcuk tavanini KALDIRMA, koru ve WELCOME_LIMITS_TR icin ayri 45 sozcuk tavani ekle.
2. [P0] control-plane/public/console.html -- OLU KODU DUZELT VE SENTETIK UYARISINI COGALT. applyHealth icindeki kosulsuz 'document.getElementById("demobanner").hidden = true;' (~7906) ile #demobanner elemani (2233) silinir. DEMO_CORPUS_TEXT bundan sonra IKI bagimsiz yuzeyde yazar: (a) soru kutusunun yanindaki 'deneme belgeleri' cipi, (b) her cevap kartinin icindeki corpusNotice satiri. Bu adim tamamlanmadan .stamp'e DOKUNULMAZ.
3. [P0] control-plane/public/console.html -- SERIT SIRASI VE GORUNURLUK KURALI. .stamp (2231) yalniz gercek bir not geldiginde ya da sunucu kapaliyken cizilir; yer tutucu cumleyle asla. #nomatterstrip (2234) ilk kullanimda (first===true) bastirilir ve tam genislik serit olmaktan cikip soru kutusunun altindaki tek satira iner. Ayni anda en cok iki serit; oncelik: sunucu kapali > deneme belgeleri > dosyasiz calisma.
4. [P0] control-plane/public/console.html -- TERM_TR'yi (3884) dizgeden nesneye cevir: {ad, tanim, neden?, teknik?, nerede?}. Mevcut bes anahtar (aktif dosya, KAYNAKSIZ, K-n, surum, deneysel) korunur, 22 maddeye cikarilir. Bu nesne tek kaynaktir; hicbir tanim ikinci kez elle yazilmaz.
5. [P0] control-plane/public/console.html -- defineTerm(node,key) (3891) node.title yazmayi BIRAKIR. Yerine gercek '?' bilesenini uretir: 16 px yuvarlak button, aria-expanded, erisilebilir ad "'X' ne demek?"; basilinca AYNI kartin icinde, satirin ALTINDA acilan kart (yuzen katman degil). Acilip kapanma preserveFocusPosition(fn, dugme) (8117) sarmalayicisindan gecer ve acan dugme ACIK CAPA olarak verilir. Ayni anda tek kart acik; Esc kapatir; durum hatirlanmaz; hicbir zaman kendiliginden acilmaz.
6. [P0] control-plane/public/console.html -- YENI CSS: .qmark (? dugmesi), .termcard (satir ici tanim karti), .expl-def (aciklama/tanim cumleleri — noticeLine ve WARN_BUDGET DISINDA), .statusline-inline. Tek <style> blogu icinde, satir ici style niteligi kullanmadan. Yaklasik 120-150 satir.
7. [P0] control-plane/public/console.html -- UST CUBUK: rozet adlari 'Veritabani'->'Kendi kayitlarim', 'Bulut AI'->'Bulut yapay zeka' (2740-2745). Rozetler SILINMEZ, tek 'Durum' dugmesinde birlestirilmez. '◐ Tema' soluna kalici '?' dugmesi ve dort satirlik yardim menusu eklenir: Nasil calisir? / Sozluk / Neyi tariyoruz? / Verilerim nerede? / Karsilama kartini yeniden goster.
8. [P0] control-plane/public/console.html -- GIZLI GORUNUMLER: HIDDEN_VIEWS'a nasil:'ayarlar' ve sozluk:'ayarlar', ARGLESS_HIDDEN'a nasil:true ve sozluk:true eklenir (4382-4390). Iki yeni <section id='view-nasil'> ve <section id='view-sozluk'> kabi; showView icine openNasil()/openSozluk() cagrilari (4455 civari). Her ikisi de kendi '← geri' baglantisini tasir.
9. [P0] control-plane/public/console.html -- SOZLUK EKRANI (#sozluk): baslik, alt baslik, arama kutusu (.tin.search, yazdikca suzer), alfabetik tek sutun. Her madde TERM_TR'den cizilir, kendi id'sini alir (sozluk-<anahtar>) ve satir ici ? karti buraya derin baglanti verir. Bos sonuc cumlesi zorunlu.
10. [P0] control-plane/public/console.html -- NASIL CALISIR EKRANI (#nasil): sekiz bolum (Tek cumlede / Bir sorunun yolculugu / Etiket ne demek / Bu bir dogruluk garantisi degildir / Ne yapmaz / Bir cevabi nasil denetlersiniz / Verileriniz nerede / SSS). SSS mevcut <details class='mini'> kalibiyla. Alt bar: Sozlugu ac + Karsilama ekranini yeniden goster.
11. [P0] control-plane/public/console.html -- KARSILAMA KARTI: WELCOME_TITLE_TR / WELCOME_LEAD_TR / WELCOME_STEPS_TR (13108-13112) yeniden yazilir (toplam 74 sozcuk, 90 tavani korunur). Yeni WELCOME_LIMITS_TR durustluk paragrafi eklenir. maybeWelcome (8129) icindeki teknik sistem satiri (8155-8159) avukat diline cevrilir ve kutuphane sentetik/bosken 'hazir' sozcugu gecmez. body.classList.toggle('compact', !first) AYNEN KALIR. Kosula yerel anahtar (localStorage 'collex.welcome.seen') VE ile baglanir ki /v1/settings hata verdiginde kart temelli kaybolmasin.
12. [P0] control-plane/public/console.html -- CEKIMSER YOL AYRIMI (3996-4020): 'CEKIMSER — cevap uretilmedi' h3'u ve 'gosterilen kaynak karti: 0 · uretilen tespit: 0' sayaci kalkar; 'Asagida hicbir kaynak karti ve hicbir tespit yoktur' sinanabilir cumlesi KALIR. Baslik 'Dayanak bulunamadi — bu yuzden cevap yazilmadi.' + kural cumlesi + NEDEN satiri (cov.missing dolu/bos iki dal, yedek cumle ZORUNLU) + dort eylemin ALTINA birer aciklama satiri. 'onerilen' ibaresi health'ten turetilir. Bos cevapta Icindekiler ve § numarasi cizilmez.
13. [P0] control-plane/public/console.html -- CEVAP BASLIK BLOGU (3937-3985): en buyuk punto (.word) makine sozcugu yerine tek Turkce getirme cumlesi alir; makine sozcugu 'Durum: TAM' kucuk rozetine iner ve yaninda ? tasir. uploadOnly dali (3947) AYNEN KORUNUR — 'N pasaj bulundu' degismez. .fin satiri ayri eksen olarak KALIR; FINALIZE_TR.no metni 'en az bir dogrulama basarisiz' yerine 'ic kontrollerden biri sonuc veremedi' olur. Sag dikey .ledger blogu tek sessiz kunye satirina akar. Indirme baglantisindan '(JSON)' ibaresi cikar.
14. [P0] control-plane/public/console.html -- ANSWERMETABLOCK (9365) YERINDE KALIR, dili degisir: 'Soru kapsami: %22' -> '9 anahtar sozcugunuzden 2'si karsilik buldu. Karsilik bulmayanlar: ...'; 'Uretim:' -> 'Bu cevabi yapay zeka yazmadi...' / 'Taslagi bulut yapay zeka yazdi...'; 'Kapsam — yalniz ... yerel korpus' -> 'hukuk kutuphaneniz'. partiallyCovered, setAside, RETRIEVAL_LANE_DEGRADED ve UPLOAD_CLAIM_NOTE_TR satirlari GORUNUR kalir, katlanmaz (kodun 9394 ve 9406 yorumlari baglayici).
15. [P1] control-plane/public/console.html -- TESPIT + ALINTI BIRLESMESI: claimCard (3436) icine sourceCard(evidenceById[id], numbers[id], flags, {anchor:false, viewer:true}) cagrisi eklenir; ayri Kaynaklar bolumu ana akistan cikar. KATLAMA KURALI: ilk tespit acik / kalanlar katli davranisi korunur, ama katli kapakta hukum cipi + tespit metninin ilk iki satiri + guven cumlesi + kaynak basligi + yururluk rozeti MUTLAKA gorunur kalir. Ayni kaynak birden cok tespitte geciyorsa id='kaynak-n' capasi YALNIZ ilk cizimde uretilir.
16. [P1] control-plane/public/console.html -- ALEYHE KAYNAK BLOGU: '§ Karsit otorite taramasi' (4064) ayri bolum olmaktan cikar; aksi yonde karar, celistigi tespitin ALTINDA bordo cizgili acik (katlanmaz) blok olur. Bolum adi her yerde 'Aleyhe kaynaklar'a cevrilir. SONUC cumlesi ('6 ayri arama yapildi, aksi yonde karar bulunamadi. Bu, aksi yonde karar olmadigi anlamina gelmez; yalnizca bu arsivde bulunmadigi anlamina gelir.') GORUNUR kalir — CEKIMSER'de bile. Yalniz sorgu dokumu katlanir.
17. [P1] control-plane/public/console.html -- DENETIM KAYDI CEKMECESI: sec-karsit (4064), sec-uyarilar (4244), sec-iz (4270) tek 'Bu cevabin denetim kaydi' basligi altinda dort katli satira toplanir. Capa kimlikleri <details> uzerinde KORUNUR. Giris cumlesi KOSULLUDUR: finalizable===false ya da CANONICAL_TEXT_PORT_FAILED/VERSION_FACTS_FAILED/ENTAILMENT_PORT_FAILED/DRAFTER_FAILED varsa uyari bolumu KATLANMAZ ve cekmecenin ustunde kalin tek satir olarak durur. Denetim dosyasi indirme dugmesi kapak kapaliyken de gorunur.
18. [P1] control-plane/public/console.html -- SICRAMA DUZELTMESI: render() sonundaki pendingAnswerJump islemi (4276-4277) hedefe kaydirmadan ONCE, hedef bir <details> icindeyse details.open = true yapmalidir; revealAnchorTarget (4504) da details.open'i taniyacak sekilde genisletilir (bugun yalniz hidden ve data-collapsed'i tariyor). Yoksa 'Aleyhe kararlari da tara' is karti (9892) kapali bir kutunun ustune duser.
19. [P1] control-plane/public/console.html -- KAYNAK KARTI TEKNIK SATIRI (3675-3681): 'Alinti parmak izi (SHA-256) ... Konum ... (Unicode karakter sayimi)' katli 'Bu alinti nasil dogrulandi?' kapaginin icine iner. Kapak ilk satiri: 'Asagidaki numaralar, metnin tek bir harfi degisse bile bambaska cikar ... bu bir noter onayi degildir ve numara, resmi yayimlanmis metinle degil, bu bilgisayarda kayitli nusha ile eslesmeyi gosterir.' Teknik adlar '(Teknik adi: SHA-256.)' olarak satir sonunda kalir. fillDocText'in (7521-7565) uc kosullu dogrulama dali AYNEN korunur; olumlu cumle sabit basilmaz.
20. [P1] control-plane/public/console.html -- GUVEN CUMLELERI: confidenceSummary (3383-3405) yuzde cubuklarini ana akistan cikarir ama EN DUSUK BOYUTUN ADINI korur: 'Bu dayanagin en zayif yani: {boyut}. Dilekceye gecirmeden once kaynagi kendiniz okuyun.' Sabit tek cumle yazilmaz (hep KAPSAM'i suclamak, zayif boyut Guncellik iken mulga hukmun ustunu orter). 'Bu dayanak guclu' -> 'Bu dayanagin zayif yani cikmadi'. Yuzdeler Denetim kaydinin 'Bes olcut tek tek' kabina iner.
21. [P1] control-plane/public/console.html -- SORU KUTUSU EN USTE: <section class="workwrap" id="workwrap"> (2301-2305) ile <section class="bench"> (2306) yerleri takas edilir; workwrap katli 'Hazir isler' <details> icine alinir ve cevap alaninin ALTINA konur. Sayfa acilinca imlec #q'da. Yaklasik 5 satirlik isaretleme hareketi, JS mantigi degismez.
22. [P1] control-plane/public/console.html -- IS KARTLARI (WORK_CARDS, 9816): butun 'out:' alanlari silinir; kartlar uc aileye (Belgelerimle calis / Karar ve mevzuat bul / Hesap ve denetim) gruplanir; adlar isin adiyla yeniden yazilir. IKI kart duser: 'soru' (soru kutusu artik ustte) ve 'takvim' (Dosyalarim sure panelindeki 'Takvimi ac' dugmesi zaten canli giris noktasi, 2250). izgara/harc/denetim/karar-ara/sozlesme/kapsam hedefleri KORUNUR — hicbir gotoView yetim birakilmaz. blocked() cumleleri duz Turkceye cevrilir.
23. [P1] control-plane/public/console.html -- ARASTIR EKRANI KAPSAM SECIMI: 'Yerel korpus' (2315) -> 'Hukuk kutuphanemde'; 'Canli kaynaklar — derin arastirma' -> 'Resmi kaynaklarda'; 'Yuklediğim belgeler' -> 'Yukledigim belgelerde'. 'korpusla birlikte — yerel korpus da taransin' (2332) -> 'hukuk kutuphanem de taransin'. Her secenegin ALTINA tek satir aciklama; kapali secenek soluk gorunur ve nedenini kendi satirinda yazar.
24. [P1] control-plane/public/console.html -- CMD TALIMATLARI DUZ TURKCEYE: SERVER_DOWN_TEXT (2785), STORE_UNAVAILABLE_TEXT (2781), livehint (2318), livedowncard (2321) ve canli is kartinin blocked cumlesi (9906) 'ColleX-Baslat.cmd ile baslatin' yerine 'ColleX'i kapatip masaustundeki ColleX simgesine yeniden ciftlkatiklayin' der. Teknik dosya adlari yalniz Ayarlar › Sistem durumu satirinda, Turkce cumlenin ardindan parantez icinde kalir.
25. [P1] control-plane/public/console.html -- VERDICT_TR (2757-2764) avukat cumlesine cevrilir: DESTEKLENIYOR->'kaynakla destekleniyor', CELISEN OTORITELER->'kaynaklar celisiyor', YETERSIZ KANIT->'dayanak yetersiz', GUNCEL OLMAYAN KAYNAK->'kaynak o tarihte yururlukte degil' (suphe diline yumusatilmaz), KISMI KAYNAK KAPSAMI->'kaynak soruyu kismen karsiliyor'. STATUS_TR anahtarlari (COMPLETE/QUALIFIED/PARTIAL/ABSTAIN) ve butun istek/yanit alan adlari, capalar (#parca-<id>, #kaynak-n) DEGISMEZ — yalniz gorunen etiket degisir.
26. [P1] control-plane/src/answer/renderer.ts -- PAYLASILAN SOZLUK IKIZI: STATUS_TR (satir 64), VERDICT_TR (74), FINALIZE_TR (100) ve NO_EVIDENCE metni (132) console.html ile AYNI dalgada guncellenir. Dosyanin kendi yorumu bunlari 'EVERY surface (console, markdown, DOCX)' degismezi ilan ediyor; tek yuzey degisirse ekran ile indirilen DOCX farkli kelime kullanir. tests/answer/renderer.test.ts ve tests/pipeline/answerPipeline.test.ts ayni islemde guncellenir.
27. [P1] control-plane/src/pipeline/answerPipeline.ts -- SUNUCUDAN GELEN GORUNEN METIN: DEFAULT_CORPUS_NOTICE (satir 126-128, 'SENTETIK TEST VERISI — ... korpus ...') ve 1728-1730'daki kapsam cumlesi avukat diline cevrilir; 'korpus' -> 'hukuk kutuphanesi'. Bu metin data.corpusNotice olarak konsola aynen basiliyor (console.html:9419) — istemcide eslemeyle gizlenemez.
28. [P2] control-plane/src/contracts/corpusResolver.ts -- Atif notlarindaki dort 'korpus' gecisi (83, 86, 88, 99) 'hukuk kutuphanesi'ne cevrilir. Bu cumleler denetim raporunda avukatin gozune ciplak cikiyor.
29. [P2] control-plane/src/drafting/composer.ts + src/drafting/markdown.ts + src/retrieval/corpusErrors.ts + src/sources/manifest.ts + src/api/server.ts -- Kalan gorunur 'korpus' dizgeleri: composer.ts:1027 ve markdown.ts:46 SENTETIK bantlari, corpusErrors.ts:33, manifest.ts:170-195 ('yerel-korpus' KIMLIGI degismez, yalniz baslik/aciklama metni), server.ts:757 ve 825. Toplam 30 gecis console.html'de, ~19 gorunur gecis src/'de.
30. [P1] control-plane/tests/pipeline/console.test.ts -- KILITLEME TESTLERI EKLE: (1) console.html'de 'SHA-256', 'Unicode', 'korpus', 'endpoint' sozcuklerinin katlanmamis ana akista SIFIR kez gectigi; (2) yeni aciklama/tanim cumlelerinin noticeLine()'dan GECMEDIGI (.expl-def sinifi .warnline saymaz); (3) TERM_TR'nin tek kaynak oldugu — Sozluk ekraninin sabit metin icermedigi; (4) satir ici ? kartinin preserveFocusPosition'dan gectigi; (5) uploadOnly dalinin hala 'pasaj bulundu' yazdigi; (6) .fin satirinin ayri eksen olarak durdugu; (7) partiallyCovered/setAside/RETRIEVAL_LANE_DEGRADED satirlarinin katlanmadigi; (8) hicbir metinde 'yuzde', 'garanti', 'hatasiz' ve mutlak kip ('yazmaz'i takip eden mutlak vaat) gecmedigi; (9) kutuphane sentetik ya da bosken 'hazir' sozcugunun yazilmadigi; (10) dosyanin hala TEK <script> ve TEK <style> tasidigi ve CR icermedigi.