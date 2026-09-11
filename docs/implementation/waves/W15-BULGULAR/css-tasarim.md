# css-tasarim

Bölge (8-1100), ürünün görsel dilini kuran ana CSS bloğudur ve estetik olarak tutarlı bir "basılı külliyat" havası yakalamış; asıl sorun estetikte değil, GÖRÜLEBİLİRLİKTE. En ağır kusur şu: dosya kendi içinde "kenarlık kontrastı" düzeltmesini (B-28, --border = #8e836a) yalnız METİN KUTULARINA uygulamış; düğmeler, mod seçme hapları, tema düğmesi, kartlar ve satır sil düğmeleri hâlâ --line (#e5ddcb) kullanıyor — panel üstünde 1,30:1, yani avukat düğmenin nerede bitip nerede başladığını göremiyor. İkinci ağır kusur: ürünün TEK vaadi olan birebir alıntı bloğunun zemini (--quote-bg #f7f3e7) kart zeminine karşı 1,06:1; alıntı, etrafındaki metinden görsel olarak ayrışmıyor. Üçüncüsü, tıklanabilirlik yanlış işaretleniyor: tıklanamayan .card ile tıklanabilir button.tpl aynı "havalanma" efektini alıyor, seçili şablon ise kendi seçim işareti yerine ODAK HALKASINI kullanıyor — avukat "seçtim mi, yoksa sadece üstünde miyim?" diye soruyor. Ayrıca dosyada iki ayrı tipografi sistemi var: bu bölgedeki sabit piksel değerlerinin büyük kısmı 1698. satırdaki blok tarafından sessizce eziliyor, ölçek jetonları (--sp-*, --fs-*) ise 1904'te ikinci bir :root'ta duruyor; sonuç, ekrandan ekrana değişen başlık boyu (17 px'e karşı 22 px) ve hâlâ yayına çıkan 10,5-11,5 px'lik monospace satırlar.

Bulgu: 23

## [P0] ui-kusuru — satir 57

**Mevcut:**
```
  --quote-bg: #f7f3e7;
```

**Neden:** Bu urunun tek vaadi "karardan aldigimiz cumleyi degistirmedigimizi gosteririz"dir; ekranda o vaadi tasiyan oge alinti blogudur. Ama alintinin zemini (#f7f3e7) kartin zeminine (--panel #fcfaf4) karsi 1,06:1 — yani hicbir fark yok. Alintiyi cevreleyen metinden ayiran tek sey soldaki 3 px'lik ic golge. Avukat sayfaya baktiginda "burasi mahkemenin sozu, surasi bizim sozumuz" ayrimini goremez. Koyu temada da ayni: #1b1712'ye karsi #201b15.

**Öneri:**
```
  --quote-bg: #f1eadb;

(koyu temada satir 100 ve 139: --quote-bg: #16120e;)

Ayrica satir 663'teki ic golgeyi kalinlastirin — alinti solundaki mühür serit 3 px yerine 4 px olsun ve tam opak calissin:
  box-shadow: inset 4px 0 0 var(--seal);

Amac: sayfaya bakan avukat, hangi cumlenin karardan birebir alindigini OKUMADAN gorebilsin.
```

## [P0] ui-kusuru — satir 355

**Mevcut:**
```
label.rchip span {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
```

**Neden:** Bu, urunun en onemli secimidir (yerel calisma / bulut yardimi gibi). Secili olmayan hapin ekranda gorunen TEK siniri bu 1 px kenarliktir ve --line (#e5ddcb) panel zemini (#fcfaf4) uzerinde 1,30:1'dir — koyu temada da 1,27:1. Yani secili olmayan secenek pratikte gorunmez; avukat yalnizca secili olani gorur ve digerinin var oldugunu bilmez. Dosya bu kusuru metin kutulari icin zaten cozmus (satir 35-38, --border = #8e836a, 3,66:1) ama dugme ve haplara uygulamamis.

**Öneri:**
```
label.rchip span {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 999px;

Ayni degisiklik su denetim ogelerinde de yapilmali: .themebtn (satir 217), nav.views (231), button.ghost (795), button.rowdel (866), kbd.hint (343), .mchip (818), details.trace (712). Kural tek cumleyle: ekranda TIKLANABILIR olan her seyin kenarligi --border, yalnizca susleme/ayrac cizgileri --line.
```

## [P0] ui-kusuru — satir 539

**Mevcut:**
```
.card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
```

**Neden:** Fare uzerine gelince kart yukari kalkiyor ve golgesi buyuyor — bu, her arayuzde "beni tiklayabilirsin" demektir. Ama .card tiklanamaz: tespit karti, kaynak karti, uyari karti hepsi durgun icerik. Ayni efektin AYNISI satir 840'ta gercekten tiklanabilir olan sablon kartina veriliyor (button.tpl:hover), ucuncu bir tiklanabilir kart ise (button.workcard, satir 1293) bambaska davraniyor: kalkmiyor, sadece kenarligi renkleniyor. Yani ekranda uc ayri "kart" dili var ve hicbiri tiklanabilirligi dogru soylemiyor. Avukat durgun kartlara tiklar, hicbir sey olmaz, kendini aptal hisseder.

**Öneri:**
```
.card:hover { box-shadow: var(--shadow); }

Yani: tiklanamayan kart fareye HIC tepki vermesin (kalkma yok, golge buyumesi yok). Kalkma efekti (transform: translateY(-2px)) yalnizca gercekten tiklanabilir yuzeylerde kalsin ve orada TEK bicimde olsun — button.tpl (840) ile button.workcard (1293) ayni davransin. Kural: kalkiyorsa tiklanir, kalkmiyorsa tiklanmaz; istisna yok.
```

## [P0] ui-kusuru — satir 732

**Mevcut:**
```
.stage .scounts { grid-column: 1 / -1; font-family: var(--mono); font-size: 10.5px; color: var(--ink-faint); overflow-wrap: anywhere; }
```

**Neden:** 10,5 px daktilo yazisi kagit uzerinde yaklasik 8 punto eder. Hedef okuyucu 20 yillik bir avukattir; bu yastaki cogu okuyucu 8 puntoyu gozlukle bile zorlanarak okur. Ustelik bu satirlar "karar neden boyle verildi" panelindedir — yani okunmasi en gerekli yer, en kucuk yazidir. Dosyanin kendi tasarim kurali (satir 1907-1908) "hicbir yeni yuzey 13 px'in altina inmez" diyor; bu satirlar o kuraldan once yazildigi icin disarida kalmis ve hala yayindalar.

**Öneri:**
```
.stage .scounts { grid-column: 1 / -1; font-family: var(--serif); font-size: 13px; color: var(--ink-soft); overflow-wrap: anywhere; }

Ayni yukseltme su satirlarda da gerekli — hepsi hala 13 px'in altinda yayinda:
  satir 728  .stage .sname     11,5 px -> 13 px
  satir 727  .stage            12 px   -> 13 px
  satir 606  .meters .val      11,5 px -> 13 px
  satir 818  .mchip            11 px   -> 13 px
  satir 340  kbd.hint          10,5 px -> 12,5 px
  satir 626  .cites .refs      12 px   -> 13 px
  satir 784  .statusline       12 px   -> 13 px

Alt sinir tek kural olsun: ekranda 13 px'in altinda hicbir sey yazilmaz.
```

## [P1] ui-kusuru — satir 22

**Mevcut:**
```
  --r-sm: 10px;
  --r: 16px;
  --r-lg: 22px;
```

**Neden:** Dosyada IKI ayri tipografi/aralik sistemi var. Bu bolge (8-1100) her olcuyu elle piksel yaziyor: 10,5 / 11 / 11,5 / 12 / 12,5 / 13 / 13,5 / 14 / 14,5 / 15 / 15,5 / 16 / 16,5 / 17 / 18 / 21 / 22 / 23 / 27 / 32 / 40 / 42 / 62 px — yirmiden fazla farkli boy. Resmi olcek jetonlari (--sp-1..7, --fs-xs..2xl, --lh-*) ise 1904. satirdaki IKINCI bir :root blogunda duruyor ve yalnizca yeni ekranlar onlari kullaniyor. Ustelik bu bolgedeki degerlerin buyuk kismi 1698. satirdaki blok tarafindan sessizce eziliyor (ornek: satir 546'daki .chip 12,5 px, 1717'de 14 px oluyor). Sonuc: burada bir sayiyi degistiren kisi ekranda hicbir sey degismedigini gorur ve nedenini anlamaz; ekranlar arasi olcu tutarsizligi da buradan geliyor.

**Öneri:**
```
Iki :root blogu BIRLESTIRILMELI. Aralik ve tipografi jetonlari en uste, satir 22'nin yanina tasinmali:

  --r-sm: 10px;
  --r: 16px;
  --r-lg: 22px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;
  --fs-xs: 13px; --fs-sm: 14px; --fs-md: 15.5px; --fs-lg: 18px;
  --fs-xl: 22px; --fs-2xl: 28px;
  --lh-tight: 1.25; --lh-body: 1.6;

Ardindan 1698-1745 arasindaki "duzeltme blogu" DAGITILMALI: her degeri ait oldugu kuralin icine yazin ve blogu silin. Kural: bir ogenin boyu dosyada TEK yerde yazilir ve o yer ogenin kendi kuralidir.
```

## [P1] ui-kusuru — satir 377

**Mevcut:**
```
.livebanner {
  border: 0;
  border-radius: var(--r);
  background: color-mix(in srgb, var(--bronze) 9%, var(--panel));
  color: var(--ink-soft);
  font-size: 13.5px;
  font-style: italic;
  padding: 13px 18px;
}
```

**Neden:** Bu bant, urunun DURUSTLUK uyarisini tasiyor — yani okunmasi en zorunlu metin. Ama uc kanaldan birden zayiflatilmis: 13,5 px (govdenin altinda), italik (uzun metinde en yorucu kesim), ve --ink-soft (govde renginden solgun). Italik ayrica bu dosyada bir de yer tutucuda (satir 307), acikalama satirinda (783), dipnotta (943) ve paragraf notunda (902) kullaniliyor; yani "italik" ne demek belli degil, sadece "onemsiz" demeye baslamis. Onemli uyariyi onemsiz gibi dizmek, uyarinin okunmamasi demektir.

**Öneri:**
```
.livebanner {
  border: 0;
  border-left: 4px solid var(--bronze);
  border-radius: var(--r);
  background: color-mix(in srgb, var(--bronze) 9%, var(--panel));
  color: var(--ink);
  font-size: var(--fs-md);
  font-style: normal;
  line-height: var(--lh-body);
  padding: 14px 18px;
}

Kural: italik yalnizca ALINTI ve YABANCI KELIME icin kullanilsin. Uyari metni hicbir zaman italik olmasin, hicbir zaman govde boyunun altina inmesin.
```

## [P1] ui-kusuru — satir 424

**Mevcut:**
```
.notyet .ep { font-family: var(--mono); font-size: 12.5px; color: var(--ink); }
```

**Neden:** Bu kural, "bu ozellik bu sunucuda henuz baglanmadi" kartinin icinde bir sunucu ADRESINI daktilo yazisiyla, ustelik en koyu renkte (--ink) gosteriyor. Kartin en dikkat ceken ogesi, avukatin hicbir sey yapamayacagi ve anlamayacagi bir teknik dizi oluyor. Avukat icin bu satirin degeri sifir; gorsel agirligi ise kartin en yuksegi.

**Öneri:**
```
.notyet .ep { display: none; }

Adres yalnizca "Teknik ayrintilar" acilir satirinin icinde kalsin. Kartta gorunen tek sey su olsun: bu bolum bu bilgisayarda henuz calismiyor, sunu yapin (ornegin ColleX-Baslat.cmd ile yeniden baslatin). Karta bakan avukat ne olduğunu ve ne yapacagini okusun, adresi degil.
```

## [P1] ui-kusuru — satir 470

**Mevcut:**
```
h2.section {
  display: flex; align-items: baseline; gap: 16px;
  font-size: 16px;
```

**Neden:** Bolum basligi 16 px (1727. satirda 17 px'e cikiyor), ama basligin altindaki icerik ondan buyuk veya esit: .src h3 = 17 px (satir 641), .claim .text = 16,5 px (satir 592). Yani baslik, basligi oldugu metinden buyuk degil. Ustelik ayni rutbedeki baslik YENI ekranlarda .screenhead h2 ile 22 px (satir 1915). Avukat "Araştır" ekranindan "Karar ara" ekranina gectiginde ayni seviyedeki basligin 5 px buyudugunu gorur; sayfa hiyerarsisi ekran degistirince degisiyor.

**Öneri:**
```
h2.section {
  display: flex; align-items: baseline; gap: 16px;
  font-size: var(--fs-xl);

ve 1727. satirdaki `h2.section { letter-spacing: .16em; font-size: 17px; }` satirindan font-size KALDIRILMALI. Boylece bolum basligi her ekranda 22 px olur ve icerikten acikca buyuktur. Ayni anda .src h3 (641) ve .claim .text (592) gozden gecirilip govde olcegine (--fs-md, 15,5 px) cekilmeli.
```

## [P1] ui-kusuru — satir 530

**Mevcut:**
```
.card {
  background: var(--panel);
  border: 1px solid var(--line);
```

**Neden:** Kart kenarligi --line (#e5ddcb) ile cizilmis; kartin zemini (#fcfaf4) ile sayfa zemini (#f6f2e8) arasindaki fark da zaten cok kucuk. Yani kartin siniri neredeyse gorunmuyor ve karti sayfadan ayiran tek sey golge. Golge, yuksek parlaklikta bir ekranda veya baski ciktisinda kaybolur (satir 1623'teki @media print blogu golgeyi zaten kaldiriyor). Sonucta ust uste yirmi kart okuyan avukat, birinin nerede bitip digerinin nerede basladigini takip edemez — ozellikle bu urunde her kart AYRI bir kaynak/tespit demek oldugu icin bu bir anlam kaybidir.

**Öneri:**
```
.card {
  background: var(--panel);
  border: 1px solid var(--line-strong);

ve kartlar arasi bosluk buyutulmeli — satir 536 `margin-bottom: 20px;` yerine `margin-bottom: var(--sp-5);` (24 px). Bir kaynak kartinin nerede bittigi, golgeye degil cizgiye ve bosluga bakilarak anlasilmali.
```

## [P1] ui-kusuru — satir 580

**Mevcut:**
```
.claim .index {
  position: absolute; left: 26px; top: 22px;
  font-size: 32px; line-height: 1;
```

**Neden:** Tespit numarasi 32 px, o numaranin etiketledigi tespit metni ise 16,5 px. Yani sira numarasi, icerigin iki kati buyuklukte. Ayni sey kaynak kartinda daha da belirgin: .src .num (satir 630) 42x42 px'lik daireli bir madalyon. Sayfaya bakan avukatin gozu once buyuk kirmizi rakamlara gider, cumleye sonra. Sira numarasi bilgi tasimaz — icerik tasir. Buyuk numara + altina cizilen bronz cizgi (satir 587) tamamen dekoratiftir ve okuma sirasini bozar.

**Öneri:**
```
.claim .index {
  position: absolute; left: 26px; top: 24px;
  font-size: 18px; line-height: 1;

ve satir 587-590'daki `.claim .index::after` sussu (numaranin altindaki bronz cizgi) tumuyle silinmeli. Ayni sekilde .src .num (630) 42x42 px yerine 30x30 px olmali. Kazanilan sol bosluk .claim padding-left'i 78 px'ten 56 px'e, .src'yi 88 px'ten 60 px'e cekmeye yeter — metin daha genis alanda okunur.
```

## [P1] ui-kusuru — satir 599

**Mevcut:**
```
.meters { display: grid; grid-template-columns: 168px 1fr 46px; gap: 8px 14px; align-items: center; }
```

**Neden:** Bu izgara "guven / kapsam" gibi olculeri cubuk olarak gosteriyor. Bilgiyi tasiyan iki kanal var: (a) cubuk RENGI — yesil/sari/kirmizi, satir 602-604, (b) sagdaki SAYI. Renk kanali tek basina yeterli degildir; erkeklerin yaklasik %8'i kirmizi-yesil ayrimini yapamaz. Sayi kanali ise en zayif bicimde diziliyor: 11,5 px, --ink-faint, 46 px'lik dar bir sutunda saga dayali (satir 606). Yani okunabilir olan tek kanal, ekrandaki en kucuk ve en solgun yazidir. Cubuk buyuk ve renkli, sayi minik ve solgun — bilgi hiyerarsisi ters.

**Öneri:**
```
.meters { display: grid; grid-template-columns: 168px 1fr 64px; gap: 8px 14px; align-items: center; }
.meters .val { font-family: var(--mono); font-size: var(--fs-sm); text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; font-weight: 600; }

Ayrica cubugun rengi tek basina anlam tasimasin: dusuk/orta/yuksek durumu sayinin yanina bir kelimeyle de yazilsin ("dusuk" / "orta" / "yuksek"), boylece renk goremeyen okuyucu da ayni bilgiyi alir.
```

## [P1] ui-kusuru — satir 679

**Mevcut:**
```
.hashline {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-faint);
  overflow-wrap: anywhere;
  border-top: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
  padding-top: 10px;
  margin-top: 12px;
}
```

**Neden:** Bu kural, her kaynak kartinin altina 64 haneli bir onaltilik dizi basiyor. Avukat icin bu dizi HICBIR sey ifade etmez; sadece kartin altini kirli gosterir ve gozu "burayi anlamiyorum" hissiyla ekrandan uzaklastirir. 11 px daktilo yazisiyla (1743'te 12 px'e cikiyor, hala kucuk) kart basina iki-uc satir gorsel gurultu ekliyor. Anlatilmak istenen sey "alintinin bozulmadigi otomatik denetlendi" cumlesidir; o cumle zaten .verifline (satir 1073) ile ayrica soyleniyor. Yani gurultu, bilgiyi tekrar etmiyor — bilgiyi orten bir sey ekliyor.

**Öneri:**
```
Dizinin kendisi varsayilan olarak GIZLENMELI ve yalnizca isteyen acmali. Kart altinda kalan tek satir sudur:

  Bu alintinin karardaki metinle birebir ayni oldugu otomatik denetlendi.  [Denetim kaydini goster]

CSS tarafinda:
.hashline { display: none; }
details.mini[open] .hashline {
  display: block;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
  border-top: 1px solid var(--line-strong);
  padding-top: 10px;
  margin-top: 12px;
}

Dosyada zaten `details.mini` kalibi var (satir 1058); bu satir da ona tasinmali.
```

## [P1] ui-kusuru — satir 748

**Mevcut:**
```
.placeholder {
  text-align: center;
  margin-top: 92px;
  color: var(--ink-faint);
}
.placeholder .mark {
  font-size: 62px;
  line-height: 1;
  color: color-mix(in srgb, var(--line-strong) 70%, transparent);
  margin-bottom: 16px;
}
```

**Neden:** Bos ekranda 92 px bosluk + 62 px'lik dev bir "§" isareti + 16 px bosluk, yani yaklasik 170 px, avukata HICBIR sey soylemeyen bir susleme icin harcaniyor. O suslemenin kontrasti da 1,4:1, yani zaten yari gorunmez. Asil is goren satir — "Cevap burada gorunecek. Sorunuzu yazip 'Ara ve dogrula'ya basin." — onun altinda, 14 px ve --ink-faint renkte. Yani ekranin en buyuk ogesi anlamsiz, en kucugu talimat. Bos durum, ne yapilacagini soyleyen yerdir; burada tam tersi olmus.

**Öneri:**
```
.placeholder {
  text-align: center;
  margin-top: var(--sp-6);
  color: var(--ink-soft);
}
.placeholder .mark { display: none; }
.placeholder .line {
  font-size: var(--fs-lg);
  color: var(--ink);
  line-height: var(--lh-body);
  max-width: 34em;
  margin: 0 auto;
}

Susleme gider, talimat buyur. Bos ekranin gorevi bekletmek degil, yol gostermektir.
```

## [P1] ui-kusuru — satir 766

**Mevcut:**
```
.dropzone {
  border: 1.5px dashed color-mix(in srgb, var(--bronze) 45%, transparent);
```

**Neden:** Bu, "Dosyalarim" ekranindaki ANA hedeftir — avukatin belgesini birakacagi yer. Sinirini cizen tek sey %45 saydamlastirilmis kesik cizgi ve bu, panel zemini uzerinde 1,60:1 kontrast veriyor. Yani en buyuk ve en onemli tiklama hedefinin kenari neredeyse gorunmez. Ustelik icindeki yonlendirme yazisi da (.dropzone .line, satir 782) --ink-soft ve 14 px — davetkar degil, silik.

**Öneri:**
```
.dropzone {
  border: 2px dashed var(--bronze);

ve satir 781'deki dekoratif isaretin opakligi kaldirilmali (`opacity: .8` -> silinsin), satir 782'deki yonlendirme yazisi govde rengine ve boyuna cikarilmali:
.dropzone .line { color: var(--ink); font-size: var(--fs-md); }

Ekranin ana hedefi, ekranin en gorunur ogesi olmali.
```

## [P1] ui-kusuru — satir 841

**Mevcut:**
```
button.tpl.sel {
  border-color: color-mix(in srgb, var(--seal) 45%, transparent);
  box-shadow: var(--ring), var(--shadow);
}
```

**Neden:** Secili sablon, kendi secim isareti yerine ODAK HALKASINI (--ring) kullaniyor. Odak halkasi klavyeyle gezinen kullaniciya "su an buradasin" demek icindir; secim ise "bunu sectin" demektir. Ikisi ayni gorununce avukat sekme tusuyla kartlar arasinda gezerken her kartin sirayla "secilmis" gibi yandigini gorur ve hangisini gercekten sectigini bilemez. Ayrica secim durumunun ekranda YAZIYLA karsiligi yok — yalnizca bir halka.

**Öneri:**
```
button.tpl.sel {
  border-color: var(--seal);
  border-width: 2px;
  background: color-mix(in srgb, var(--seal) 6%, var(--panel));
  box-shadow: var(--shadow);
}
button.tpl.sel::before {
  content: "Secili";
  display: block;
  font-size: 13px;
  color: var(--seal);
  margin-bottom: 4px;
}

Boylece secim RENK + KALIN KENARLIK + YAZI olmak uzere uc kanaldan anlatilir, odak halkasi ise yalnizca odagi anlatmaya devam eder.
```

## [P2] ui-kusuru — satir 172

**Mevcut:**
```
:focus-visible { outline: none; box-shadow: var(--ring); }
```

**Neden:** Odak halkasi iki katmanli tanimlanmis: icte 2 px --panel (#fcfaf4), disda 4 px --seal. Ic katman SABIT olarak panel rengidir, ama odaklanabilir ogelerin cogu panel uzerinde durmuyor: nav.views ve .themebtn sayfa zemininde (--paper #f6f2e8), .tin ve label.rchip span ise --panel-2 (#f2ede0) uzerinde. Bu durumda halkanin ic katmani zeminden farkli bir renk oldugu icin ogenin etrafinda ince bir acik cerceve beliriyor — kirli gorunuyor ve odagin nerede oldugunu netlestirmek yerine bulandiriyor.

**Öneri:**
```
Ic katman sabit renk yerine ogenin KENDI zeminini kullanmali. En temiz yol, --ring'i outline'a cevirmek:

:focus-visible { outline: 3px solid var(--seal); outline-offset: 2px; box-shadow: none; }

outline-offset zaten ogenin altindaki gercek zemini bosluk olarak gosterir, dolayisiyla hangi zeminde olursa olsun halka temiz cikar ve ogenin kendi yaricapini bozmaz.
```

## [P2] ui-kusuru — satir 257

**Mevcut:**
```
.stamp {
  margin: 12px auto 18px;
  max-width: 880px;
```

**Neden:** Bu damga bandi, sayfanin en ustunde, sekmelerin hemen altinda, ilk icerik kartindan ONCE duruyor ve genisligi 880 px'e sabitlenmis. Ancak kapsayici .wrap 920 px ve 26 px ic bosluga sahip (satir 174), yani icerik zaten 868 px — 880 px hicbir zaman devreye girmiyor, olu bir deger. Daha onemlisi: bu bant, ilk sorgu calistirilana kadar hicbir bilgi tasimayan bir yer tutucu cumleyle ekranin en degerli yerini isgal ediyor. Ilk acilista avukatin gordugu ilk kutu, ona hicbir sey soylemeyen bir kutudur.

**Öneri:**
```
.stamp {
  margin: var(--sp-3) 0 var(--sp-4);
  max-width: none;

ve bant, icerigi HENUZ YOKKEN hic cizilmemeli (JavaScript tarafinda `hidden` ile). Bilgi geldiginde belirsin. Bos bir uyari kutusu, uyari degildir; sadece gurultudur. Not: satir 273'teki `.stamp.review { max-width: none; ... }` istisnasi da bu degisiklikten sonra gereksizlesir ve silinebilir.
```

## [P2] ui-kusuru — satir 442

**Mevcut:**
```
.card.busy { border-left: 3px solid var(--warn); }
```

**Neden:** Kart `box-sizing: border-box` ile calistigi icin (satir 151), sola eklenen 3 px'lik kenarlik ic bosluktan yer calar ve kartin metni islem suresince 3 px saga kayar. Islem bitince .card.busydone (satir 453) yine 3 px'lik bir kenarlik koyuyor, sonra normal karta donuldugunde metin geri kayar. Bekleyen avukat, ekranda hicbir sebep yokken oynayan bir metin gorur; kucuk ama guven kirici bir titremedir. Ayni sorun .picknotice (satir 1101) ve .card.gated (satir 1112) icin de gecerli.

**Öneri:**
```
.card.busy { box-shadow: inset 3px 0 0 var(--warn), var(--shadow); }
.card.busydone { box-shadow: inset 3px 0 0 var(--line-strong), var(--shadow); }

Ic golge yer kaplamaz; serit ayni yerde ayni kalinlikta gorunur ama metin kimildamaz. Ayni cozum .card.gated icin de kullanilmali.
```

## [P2] ui-kusuru — satir 524

**Mevcut:**
```
.ledger { display: grid; gap: 6px; font-size: 12.5px; color: var(--ink-faint); text-align: right; }
```

**Neden:** Hukum kartinin sag sutunu (kac kaynak, kac tespit, calisma numarasi gibi kunye bilgileri) 12,5 px, --ink-faint renkte ve SAGA DAYALI diziliyor; ic degerler ayrica 12 px daktilo yazisi (satir 525). Soldan saga okunan bir sayfada saga dayali kisa satirlar her satirda goz baslangicini kaydirir; kucuk ve solgun yaziyla birlesince tarama neredeyse imkansiz olur. Bu sutun bir "kunye"dir; kunye taranmak icin vardir.

**Öneri:**
```
.ledger { display: grid; gap: var(--sp-1); font-size: var(--fs-sm); color: var(--ink-soft); text-align: left; }
.ledger b { color: var(--ink); font-weight: 600; font-family: var(--serif); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }

Sola dayali, govdeye yakin boyda, seri yazi tipiyle. Sayilar tabular-nums ile alt alta hizalanir; avukat gozunu tek bir dikey cizgide asagi kaydirarak okur.
```

## [P2] ui-kusuru — satir 541

**Mevcut:**
```
.chip {
  display: inline-block;
  border-radius: 999px;
  padding: 4px 13px 5px;
  font-size: 12.5px;
  font-variant-caps: all-small-caps;
  letter-spacing: .12em;
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  background: color-mix(in srgb, currentColor 8%, transparent);
}
```

**Neden:** Durum rozetinin kenarligi kendi metin renginin yalnizca %32'si; zemine karsi 1,4:1 civari. Ic dolgu da %8. Yani rozet, cevresindeki metinden ayirt edilmiyor — bir kelimenin uzerine kutu cizilmis gibi degil, sadece renkli bir kelime gibi duruyor. Ayrica bu kural (12,5 px, all-small-caps, .12em harf araligi) 1717. satirda tamamen eziliyor (14 px, normal harf, 0 aralik); yani buradaki uc bildirimin ucu de olu kod, bunu bilmeyen kisi buradan degistirmeye calisir ve ekranda hicbir sey degismez.

**Öneri:**
```
.chip {
  display: inline-block;
  border-radius: 999px;
  padding: 4px 12px 5px;
  font-size: var(--fs-sm);
  border: 1px solid color-mix(in srgb, currentColor 65%, transparent);
  background: color-mix(in srgb, currentColor 12%, transparent);
}

(font-variant-caps ve letter-spacing satirlari SILINSIN — 1717'de zaten sifirlaniyor, burada durmalari yaniltici.)
```

## [P2] ui-kusuru — satir 575

**Mevcut:**
```
.abstain-panel p { margin: 0 auto 10px; color: var(--ink-soft); max-width: 560px; }
```

**Neden:** Bu panel, urunun "cevap veremiyorum" dedigi andir — yani en dikkatle okunmasi gereken aciklama. Ama panelin tamami ortalanmis (satir 564, text-align: center). Ortalanmis coklu satir metninde her satirin sol kenari farkli yerden baslar; goz her satirda basi yeniden arar. Iki satirlik bir slogan icin uygundur, birkac cumlelik aciklama icin degil. Ustelik metin --ink-soft ile solgunlastirilmis.

**Öneri:**
```
.abstain-panel { text-align: left; }
.abstain-panel h3 { text-align: left; }
.abstain-panel p { margin: 0 0 var(--sp-3); color: var(--ink); max-width: 62ch; font-size: var(--fs-md); line-height: var(--lh-body); }

Baslik ve metin sola dayali, govde renginde ve govde boyunda. Ortalama yalnizca tek satirlik rozet/damga icin kalsin.
```

## [P2] ui-kusuru — satir 708

**Mevcut:**
```
.scroll { overflow-x: auto; margin-top: 12px; border-radius: var(--r-sm); }
```

**Neden:** Genis tablolar bu kabin icinde yatay kaydiriliyor, ama kaydirilabilecegini soyleyen hicbir gorsel isaret yok. Windows'ta yatay kaydirma cubugu ancak fare uzerine gelince beliriyor; avukat tablonun saginda sutun oldugunu hic gormeyebilir ve eksik veri okur. Dosyada bu sorun icin bir cozum ZATEN var (.tablehint, satir 2167) ama yalnizca yeni ekranlarda kullaniliyor; buradaki eski table.grid kabi disarida kalmis.

**Öneri:**
```
.scroll {
  overflow-x: auto;
  margin-top: var(--sp-3);
  border-radius: var(--r-sm);
  background:
    linear-gradient(to right, var(--panel) 30%, transparent) left / 32px 100% no-repeat,
    linear-gradient(to left, var(--panel) 30%, transparent) right / 32px 100% no-repeat;
  background-attachment: local, local;
}

Boylece kaydirilabilir kenarda yumusak bir solma belirir ve tablo bitmediyse gorunur. Ek olarak .tablehint kalibi bu kaba da uygulanmali — tablonun ustune "Tablo genis; saga dogru kaydirin." satiri konsun.
```

## [P2] ui-kusuru — satir 987

**Mevcut:**
```
button.seal, a.dl { position: relative; overflow: hidden; }
```

**Neden:** Bu iki oge ana eylem dugmeleridir ve yazi tipleri `font: 15px/1` ile satir yuksekligi 1 olarak tanimlanmis (satir 322 ve 913). Turkce buyuk harflerde S ve C'nin kuyrugu ile G'nin ustundeki isaret taban cizgisinin disina tasar. Satir yuksekligi 1 iken bu tasmalar icerik kutusunun disina cikar ve bu kural (`overflow: hidden`) onlari kirpar. Dolgu cogu tarayicida kurtariyor, ama yazi tipi degistiginde veya kullanici tarayici yazi boyunu buyuttugunde "ARAŞTIR" gibi bir etikette S'nin kuyrugu kesilir. Bir hukuk urununde Turkce harflerin dogru cizilmemesi, ilk bakista guven kaybettirir.

**Öneri:**
```
button.seal, a.dl { position: relative; overflow: hidden; }

degismesin ama satir yukseklikleri duzeltilsin — satir 322'de:
  font: 15px/1.2 var(--serif);
ve satir 913'te:
  font: 14px/1.2 var(--serif);

Ayni duzeltme .viewtab (237, `14px/1`), button.ghost (789, `13px/1`), .themebtn (212, `12px/1`) ve input#asof (312, `14px/1`) icin de yapilmali. Kural: hicbir metin ogesinde satir yuksekligi 1,2'nin altina inmesin.
```
