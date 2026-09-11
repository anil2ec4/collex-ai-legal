# gorsel-tasarim

Konsolun görsel dili tek bir tasarımdan değil, üst üste binmiş beş dalganın katmanlarından oluşuyor; sonuç, tek tek bakıldığında özenli ama bir arada bakıldığında dağınık bir ekran. Somut ölçüler: 30 farklı yazı boyu (10px'ten 62px'e, sekizi yarım punto), 18 farklı harf aralığı, yedi köşe yarıçapı, sekiz geçiş süresi, sekiz etiket sütunu genişliği, dört ayrı tablo görünümü, dokuz ayrı rozet biçimi. Aynı seçici (table.grid, .chip, .tplgrid, button.tpl, .verdict .word, .stamp) iki kez, farklı değerlerle tanımlanıyor. En ağır iki kusur okunabilirlikte: metin satırları 120-140 karaktere uzuyor (hedef 65-75) ve koyu temada kart ile sayfa zemini arasındaki fark 1,05:1 — kartların kenarı pratikte kayboluyor. Arayüzün tamamı serif ile yazılmış; buton, etiket ve tablo başlıklarında küçük büyük harf kullanıldığı için Türkçe Ğ/Ş/İ harfleri bozuk çıkıyor. W13-DESIGN-SPEC bu kusurların çoğunu isim isim tarif edip düzeltmeyi yazmış; şartname yazılmış, uygulanmamış.

Bulgu: 32

## [P0] ui-kusuru — satir 19

**Mevcut:**
```
--serif: Constantia, "Iowan Old Style", "Palatino Linotype", Palatino, Cambria, Georgia, "Times New Roman", serif;
```

**Neden:** Stil sayfasinda arayuz icin ayri bir yazi tipi jetonu yok: butonlar, etiketler, tablo basliklari, rozetler, form alanlari, durum haplari, hepsi Constantia ile yaziliyor. Serif, uzun hukuk metni icin dogru; 12-14px'lik arayuz etiketleri icin degil — kucuk boyutta serif tirnaklari bulaniklasip ekrani yorgun gosteriyor. Su an dosyada tek bir yerde var(--ui) gectigi halde --ui hic tanimli degil (satir 1317), yani o kural da sessizce serif'e dusuyor.

**Öneri:**
```
:root'a ekleyin: --ui: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Segoe UI Emoji", Arial, sans-serif; sonra body { font-family: var(--ui); } yapin ve serif'i kapali bir listeye geri verin: blockquote.quote, .claim .text, .para .ptext, .edpara .ptext, .doctext, .src h3, h1, h2, h3, .verdict .word, .verdict .expl, .duebig, .welcome ol, .abstain-panel p, .note-p, .steps { font-family: var(--serif); }. Hukuk metni serif kalir, kabuk sans olur.
```

**Not:** W13-DESIGN-SPEC 1.3'te ayni ikili sistem birebir yazili.

## [P0] ui-kusuru — satir 22

**Mevcut:**
```
--r-sm: 10px;
```

**Neden:** Kose yaricapinda yedi ayri deger dolasiyor: 10px, 16px, 22px, 999px, %50, 6px, 4px, 3px. Daha kotusu hiyerarsi ters: birincil eylem (button.seal, a.dl) 10px kose yariciapli dikdortgen, buton olmayan her sey (ghost, pill, rchip, viewtab, themebtn, nav.toc, toast) tam hap. Goz ilk once haplari sectigi icin ikincil dugmeler birincilden daha buton gorunuyor.

**Öneri:**
```
Yaricapi dorde indirin ve haplari kisitlayin: --r-1: 6px (cip, rozet, kbd); --r-2: 10px (buton, girdi); --r-3: 14px (kart); --r-4: 20px (panel, modal); --r-pill: 999px sadece durum haplari ve segment sekmesi icin. button.ghost, .themebtn, button.rowdel, .toast, nav.toc, button.gsrc hepsi --r-2'ye iner; .card, details.trace, .notyet --r-3; .bench, .docpanel, .abstain-panel --r-4.
```

**Not:** 3px (.doctext mark) ve 4px (button.calitem) tek tuk kalanlar --r-1'e cekilmeli.

## [P0] ui-kusuru — satir 115

**Mevcut:**
```
--panel: #201b15;
```

**Neden:** Koyu temada sayfa zemini (--paper #191511) ile kart zemini (--panel #201b15) arasindaki fark 1,05:1. Kartin kenarligi (--line #352e20) de panele karsi 1,28:1. Golgeler saf siyah oldugu icin neredeyse siyah bir zeminde hicbir sey yapmiyor. Sonuc: koyu temada kartlar birbirine yapisiyor, ekran tek bir kahverengi-siyah leke gibi gorunuyor. Acik temada tasarim duruyor, koyu temada dagiliyor.

**Öneri:**
```
Koyu temada yuzey ayrimini renk farkiyla kurun, golgeyle degil. Her iki koyu blokta (@media prefers-color-scheme ve [data-theme="dark"]) su degerleri kullanin: --paper-deep: #100e0a; --paper: #16130f; --panel: #241f18; --panel-2: #2d2619; --line: #3f3626; --line-strong: #574c34. Bu, panel/paper arasini ~1,35:1'e, cizgi/panel arasini ~1,9:1'e cikarir ve golgeye hic guvenmez.
```

**Not:** Ayni satirlar 79 ve 115'te iki kez tanimli; ikisini birden degistirin.

## [P0] ui-kusuru — satir 164

**Mevcut:**
```
font: 15.5px/1.68 var(--serif);
```

**Neden:** Stil sayfasinda 30 ayri font-size degeri var: 10px, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 18, 19, 20, 21, 23, 24, 26, 27, 28, 30, 32, 34, 40, 42, 62. Yarim puntolar (12.5/13.5/14.5/15.5/16.5) 56 kez geciyor; 10-11.5px arasi kucuk yazi 17 kez. Sonuc: hicbir iki bilgi ayni buyuklukte degil, dolayisiyla hicbir hiyerarsi okunmuyor — ekran "kalabalik" hissi veriyor. 10.5px'lik kbd.hint ve .evchip ise 50 yas ustu bir okuyucu icin fiilen okunamaz.

**Öneri:**
```
Dokuz basamakli tek olcek kurun ve baska deger kullanmayin: --fs-100: 12px; --fs-200: 13px; --fs-300: 14px; --fs-400: 15px; --fs-500: 16px; --fs-600: 18px; --fs-700: 21px; --fs-800: 26px; --fs-900: 34px. Govde body { font: var(--fs-500)/1.6 var(--ui); } olur. 10-11.5px'lik her deger --fs-100'e, her yarim punto en yakin basamaga cikar. 62px'lik dekoratif isaret (.placeholder .mark) 34px'e iner.
```

**Not:** W13-DESIGN-SPEC T1/T2 bu iki yasagi zaten koymus.

## [P0] ui-kusuru — satir 1310

**Mevcut:**
```
table.grid { width: 100%; border-collapse: collapse; font-size: 13.5px; }
```

**Neden:** Ayni secici stil sayfasinda iki kez tanimli: satir 699'da 12,5px ve ince cizgili, satir 1310'da 13,5px ve kalin cizgili. Hangisinin gecerli oldugu ancak dosyanin sonuna kadar okununca anlasiliyor. Ayni durum .chip (541 ve 1715), .tplgrid (827 ve 2084), button.tpl (828 ve 2085), .verdict .word (519 ve 1730) ve .stamp (257 ve 1734) icin de var. Bu, urunu bakimi imkansiz hale getirdigi gibi, bir sonraki kucuk degisiklikte gorunumun rastgele bozulmasini garanti ediyor.

**Öneri:**
```
Her cakisan cifti tek bir tanimda birlestirin ve eskisini silin. table.grid icin tek tanim: table.grid { width: 100%; border-collapse: collapse; font-size: 14px; } ve hucre kurali table.grid th, table.grid td { border: 0; border-bottom: 1px solid var(--line); padding: 10px 12px; text-align: left; vertical-align: top; }. Ayni islemi .chip, .tplgrid, button.tpl, .verdict .word ve .stamp icin de yapin.
```

**Not:** Satir 699 ile 1310, 827 ile 2084, 828 ile 2085, 519 ile 1730, 257 ile 1734, 541 ile 1715.

## [P0] ui-kusuru — satir 1651

**Mevcut:**
```
body.compact .wrap { max-width: 1120px; }
```

**Neden:** Gunluk kullanimdaki varsayilan kabuk bu. 1120px kaptan ic bosluklar dusunce metin genisligi ~1010px kaliyor; 15,5px serif ile satir basina 130-140 karakter demek. Avukat bir cevabi okurken gozu satir sonundan satir basina donerken kayboluyor. Basili hukuk kulliyati estetigi iddia eden bir urunde satir uzunlugu 65-75 karakter olmali; hicbir kitapta 140 karakterlik satir yoktur.

**Öneri:**
```
Kap genisligini tek degere indirin (body.compact .wrap { max-width: 1152px; }) ve prozayi kabin tamamina yaymayin. :root'a --measure: 68ch ekleyip su kurali yazin: .claim .text, .answermeta, .abstain-panel p, .note-p, .welcome ol, blockquote.quote, .strip, .stamp, .livebanner, .notyet, .empty p { max-width: var(--measure); }. Tablolar, izgaralar ve editor bundan muaf.
```

**Not:** W13-DESIGN-SPEC 2.3 ayni olcumu yapmis (115-125 karakter) ve --measure: 68ch onermis; uygulanmamis.

## [P0] ui-kusuru — satir 1711

**Mevcut:**
```
.viewtab, .fieldlabel, .panelhead, h2.section, nav.toc { font-variant-caps: all-small-caps; }
```

**Neden:** Urunun ana gezinme sekmeleri bunlar: Dosyalarim, Arastir, Belgeler, Taslak, Ayarlar. Constantia'nin kucuk-buyuk-harf setinde S, G, I, C icin gercek glif yok; tarayici bu harfleri kucultulmus normal buyuk harften uretiyor ve komsularindan belirgin ince cikiyorlar. "ARASTIR" ve "DEGERLENDIRME" yazilari sirf bu yuzden ucuz ve bozuk gorunuyor. Turkce bir hukuk urununde en cok bakilan bes sozcuk bunlar.

**Öneri:**
```
Kurali tamamen silin. Yerine: .viewtab, .fieldlabel, .panelhead, h2.section, nav.toc { font-variant-caps: normal; text-transform: none; } ve ayirt ediciligi agirlik + renkle kurun: .fieldlabel, .panelhead { font-weight: 600; font-size: 14px; letter-spacing: .04em; color: var(--bronze-text); }. Sekmelerde ise .viewtab { font-size: 15px; letter-spacing: 0; } yeterli; aktif sekme zaten dolu bordo.
```

**Not:** W13-DESIGN-SPEC T4 bu kaldirmayi acikca sart kosuyor ve gerekcesini ayni sekilde yaziyor.

## [P0] ui-kusuru — satir 1978

**Mevcut:**
```
table.audtable th { text-align: left; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-soft); border-bottom: 1px solid var(--line-strong); padding: var(--sp-2) var(--sp-2) var(--sp-2) 0; vertical-align: bottom; font-weight: 600; }
```

**Neden:** Uc tabloda (atif denetimi, kapsam, harc) baslik satirlari 13px buyuk harfe cevriliyor. Buyuk harf Turkcede her zaman risklidir; ayrica 13px buyuk harf + harf araligi, sayfada en cok goz yoran sey. Urunun dorduncu tablo bicimi de bu — .grid tam izgara, .matters alt cizgi, bu uclu buyuk harf, .calgrid ayri. Ayni ekranda dort farkli tablo gorunumu var.

**Öneri:**
```
Buyuk harfi kaldirin ve tek tablo bicimi kullanin: table.audtable th, table.mantable th, table.feetable th { text-align: left; font-size: 14px; text-transform: none; letter-spacing: 0; font-weight: 600; color: var(--ink-soft); border-bottom: 1px solid var(--line-strong); padding: 10px 12px 10px 0; }. Satir 2031 ve 2048'deki ayni kurallari da bu tek kurala baglayin.
```

**Not:** W13-DESIGN-SPEC T5: text-transform: uppercase hicbir kurala eklenmez. Satir 2031, 2048, 2171 de ayni kusurdur.

## [P1] ui-kusuru — satir 37

**Mevcut:**
```
--border: #8e836a;
```

**Neden:** Her girdi alani hem koyu zeytin bir 1px cerceve (3,66:1) hem de zeminden farkli bir dolgu (--panel-2) tasiyor. Iki sinyal ayni isi yapiyor ve sekiz alanli bir formda ekran cerceve tarlasina donuyor. Ayrica bu cerceveler kartin kendi cercevesi, fieldset.tgroup cercevesi, .prow cercevesi ve .srcgroup cercevesiyle birlikte dort kat ic ice kutu uretiyor.

**Öneri:**
```
Erisilebilirlik sinirini koruyun ama tek sinyale indirin: girdi zeminini kart zeminiyle esitleyin (background: var(--panel)) ve --border'i olduğu gibi birakin. Ayrica ic ice cerceveleri kaldirin: fieldset.tgroup { border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 16px 0 0; } ve .prow { border: 0; background: var(--panel-2); } ve .srcgroup { border: 0; background: var(--panel-2); }. Bir seviyede yalniz bir cerceve kalsin.
```

**Not:** textarea#q (294), input#asof (311), .tin (846), .edpara .ptext (1798) ayni ikili sinyali tasiyor.

## [P1] ui-kusuru — satir 61

**Mevcut:**
```
0 28px 56px -24px rgba(42,35,24,.22);
```

**Neden:** Her kart uc katmanli, 56px bulanikligi olan bir golge tasiyor; .card sayfada 10-20 kez tekrar ediyor. Sonuc, "tul gibi golge" hedefinin tersi: yirmi kart yirmi buyuk bulanik leke uretiyor ve ekran bulanik gorunuyor. Ustelik .card:hover golgeyi --shadow-lift'e (72px, %30) cikariyor, yani fare gezdikce sayfa nefes alip veriyor gibi oynuyor.

**Öneri:**
```
Uc kademeli, cok daha yumusak bir yukselti olcegi kurun: --e-1: 0 1px 2px rgba(34,31,25,.05), 0 2px 8px -2px rgba(34,31,25,.06); --e-2: 0 2px 4px rgba(34,31,25,.06), 0 12px 28px -8px rgba(34,31,25,.14); --e-3: 0 8px 16px rgba(34,31,25,.10), 0 32px 64px -16px rgba(34,31,25,.28). Kartlar --e-1 alsin, tezgah/panel --e-2, yalniz modal --e-3. Boylece derinlik siralamasi geri gelir.
```

**Not:** Koyu temada golge yerine yuzey rengi ayrimi kullanin (bkz. --panel maddesi).

## [P1] ui-kusuru — satir 69

**Mevcut:**
```
--ring: 0 0 0 2px var(--panel), 0 0 0 4px var(--seal);
```

**Neden:** Odak halkasinin ic katmani her zaman --panel rengine sabitlenmis. Ama odaklanabilir ogelerin bir kismi --panel-2 zeminli kaplarin icinde (.srcgroup, .prow, tablo basliklari) ya da dogrudan --paper uzerinde. Oralarda halkanin ic katmani zeminden farkli cikiyor ve dugmenin etrafinda acik renkli, kirli bir bant olusuyor. Klavyeyle gezen bir kullanici icin bu, en cok goreceyi seylerden biri.

**Öneri:**
```
Halkayi yerel yuzey degiskeni uzerinden kurun: :root'a --surface: var(--panel); ekleyin, --ring: 0 0 0 2px var(--surface), 0 0 0 4px var(--seal); yapin; sonra farkli zeminli kaplarda yuzeyi bildirin: .srcgroup, .prow, table.grid thead th, .calcell.out, body { --surface: ... } gibi. Boylece halka her zerinde temiz oturur.
```

**Not:** Satir 69 ve 148'de iki kez tanimli.

## [P1] ui-kusuru — satir 165

**Mevcut:**
```
border-top: 4px solid var(--band);
```

**Neden:** Sayfanin en ustunde 4px kalinliginda dolu kirmizi-bordo bir serit var. Koyu temada bu serit --band #8d2f39 rengiyle bir hata cubugu gibi okunuyor; kullanici her acilista bir saniyeligine "bir sey mi bozuldu" diye bakiyor. Ayrica marka rengini dekoratif olarak harcadigi icin, ayni bordo gercekten anlam tasidigi yerde (birincil eylem, dogrulanmis atif) etkisini kaybediyor.

**Öneri:**
```
body { border-top: 1px solid var(--seal); } yapin ya da tamamen kaldirin. Bordo, ekranda yalniz uc isi yapmali: birincil eylem dolgusu, aktif sekme dolgusu ve dogrulanmis atif/baglanti metni.
```

**Not:** Bugun var(--seal) 84 yerde geciyor: gezinme, baglanti, buton, rozet kenari, secim rengi, alinti seridi, numara dairesi. Luks kitliktan gelir.

## [P1] ui-kusuru — satir 259

**Mevcut:**
```
max-width: 880px;
```

**Neden:** Durustluk damgasinin genisligi 880px'e sabitlenmis, oysa iceren kap (body.compact .wrap) 1120px ve kartlar 1068px genisliginde. Sonuc: sayfanin en ustundeki serit, altindaki her kartla hizasiz duruyor — sol ve sag kenarda 94px'lik bir kayma var. Goz bunu "bir sey yamuk" diye okur. Ayni sorun .abstain-panel p'de (560px) da var.

**Öneri:**
```
.stamp { max-width: none; } (satir 1734'teki ikinci tanimla birlestirerek) yapin ve icindeki metni --measure ile sinirlayin: .stamp .notice-text { display: inline-block; max-width: var(--measure); }. Boylece kutu kartlarla hizali, metin okunur genislikte kalir.
```

**Not:** Satir 1734'te .stamp yeniden tanimlaniyor; ikisi birlestirilmeli.

## [P1] ui-kusuru — satir 294

**Mevcut:**
```
textarea#q {
  width: 100%;
  font: 400 22px/1.5 var(--serif);
  color: var(--ink);
  background: var(--panel-2);
  border: 1px solid var(--border);
```

**Neden:** Sorunun yazildigi ana alan 22px serif; hemen yanindaki tarih alani (input#asof) 14px monospace; alt satirdaki mod cipleri 14px serif kucuk-buyuk-harf. Ayni formda uc ayri yazi dunyasi var. 22px, hukuk metni degil bir soru cumlesi icin gereksiz buyuk; yaninda 12px'lik ipuclariyla birlikte olcek ucurumu yaratiyor.

**Öneri:**
```
textarea#q { font: 400 18px/1.55 var(--serif); background: var(--panel); border: 1px solid var(--border); } ve input#asof { font: 15px/1.2 var(--ui); font-variant-numeric: lining-nums tabular-nums; } yapin. Tarih bir kimliktir, monospace gerektirmez; hizali rakam yeter.
```

**Not:** Formdaki tum alanlar tek olcege (--fs-400/--fs-500) inmeli.

## [P1] ui-kusuru — satir 334

**Mevcut:**
```
button.seal:hover { transform: translateY(-1px); filter: brightness(1.05); box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 14px 30px -10px var(--btn-deep); }
```

**Neden:** Birincil buton uzerine gelindiginde ayni anda dort sey oluyor: 1px yukari ziplama, parlaklik artisi, golge buyumesi ve capraz beyaz bir parilti sweep'i (satir 981). Bu, oyun arayuzu dili; agirbasli bir hukuk urununde ucuz gorunuyor ve "tikladim mi tiklamadim mi" belirsizligi yaratiyor.

**Öneri:**
```
Tek, sessiz bir tepki birakin: button.seal:hover { transform: none; background: linear-gradient(180deg, var(--btn-deep), var(--btn-deep)); box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 4px 12px -6px var(--btn-deep); } ve button.seal:active { transform: translateY(1px); }. Parilti kurallarini (button.seal::after, a.dl::after ve :hover::after) tamamen silin.
```

**Not:** Satir 976-981 arasindaki ::after parilti blogu kaldirilmali.

## [P1] ui-kusuru — satir 338

**Mevcut:**
```
.timing { font: 12px/1.4 var(--mono); color: var(--ink-faint); align-self: center; }
```

**Neden:** Monospace 32 yerde kullaniliyor ama cogunda makine kimligi yok: sure bilgisi (.timing), gerekce listesi (ul.reasons), durum satiri (.statusline), cekimserlik sayilari (.abstain-panel .counts), sablonun zorunlu alanlari (button.tpl .req), rozetler (.mchip, .evchip), tarih sutunu (.itemrow .when, .deadrow .due). Daktilo yazisi avukatta "bu bir program cikisi" hissi uyandiriyor — tam da urunun kacinmasi gereken izlenim.

**Öneri:**
```
Monospace'i kapali bir listeye indirin: yalnizca .hashline .h, .chunkline .tech, .rawcode ve .backpath. Kalan her yerde var(--ui) kullanip rakam hizalamasini font-variant-numeric: lining-nums tabular-nums ile yapin. Ornek: .timing { font: 13px/1.4 var(--ui); font-variant-numeric: lining-nums tabular-nums; color: var(--ink-faint); }.
```

**Not:** W13-DESIGN-SPEC T6 ayni listeyi veriyor.

## [P1] ui-kusuru — satir 539

**Mevcut:**
```
.card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
```

**Neden:** Dosya listesi, kaynak listesi ve sablon izgarasi gibi ekranlarda 15-25 kart alt alta duruyor. Fare listede gezindikce her kart 2px yukari zipliyor; goz siralamayi kaybediyor ve ekran huzursuz gorunuyor. Bu, tuketici uygulamalarina ait bir hareket; bir kanit sisteminde kartin yer degistirmesi "bir sey oldu" sinyali verir, oysa hicbir sey olmamistir.

**Öneri:**
```
.card:hover { transform: none; box-shadow: var(--e-2); border-color: var(--line-strong); } yapin — yukseklik degil, kenar netlesir. Ayni degisikligi button.tpl:hover (satir 836) icin de uygulayin.
```

**Not:** W13-DESIGN-SPEC 1.6 bu kuralin kaldirilmasini acikca istiyor.

## [P1] ui-kusuru — satir 541

**Mevcut:**
```
.chip {
  display: inline-block;
  border-radius: 999px;
  padding: 4px 13px 5px;
  font-size: 12.5px;
  font-variant-caps: all-small-caps;
  letter-spacing: .12em;
```

**Neden:** Ekranda dokuz ayri rozet/cip bicimi var: .chip (currentColor tonlu), .mchip (monospace, panel-2), .evchip (bronz), .fchip (bordo), .autochip (turuncu), .days (currentColor), .kaynaksiz (bordo hap), .audstate (nokta+metin), button.pill (nokta+metin). Uc farkli olcu sistemi, uc farkli dolgu mantigi. Kullanici hangi rozetin ne anlama geldigini bicimden ogrenemiyor cunku bicim rastgele.

**Öneri:**
```
Tek rozet tabani kurun: .badge { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--r-1); padding: 3px 10px 4px; font: 500 13px/1.35 var(--ui); border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: color-mix(in srgb, currentColor 8%, transparent); letter-spacing: 0; } ve anlami yalniz renk sinifiyla verin (.badge.ok/.warn/.bad/.abstain/.mute). .mchip, .evchip, .fchip, .autochip, .days, .kaynaksiz hepsi bu tabani miras alsin; yalniz .audstate ve button.pill nokta gostergesini korusun.
```

**Not:** W13-DESIGN-SPEC 3.3: on bilesen, uc olcu sistemi, tek rozete inecek.

## [P1] ui-kusuru — satir 599

**Mevcut:**
```
.meters { display: grid; grid-template-columns: 168px 1fr 46px; gap: 8px 14px; align-items: center; }
```

**Neden:** Etiket sutunu sayfa boyunca sekiz farkli genislikte: 104px (.calrow), 110px (.evcard .meta), 150px (.stage, .rrow.olay), 158px (.meta), 168px (.meters), 170px (.inlineform .row), 200px (.kv), 220px (.edgrid). Kullanici sayfayi kaydirirken sol kenar sekiz kez kayiyor. Duzgun bir belgede tek bir sol kenar olur; burada yok.

**Öneri:**
```
:root'a --label-col: 168px ekleyin ve sekiz kurali da ona baglayin: .meters { grid-template-columns: var(--label-col) 1fr 46px; }, .meta, .kv, .evcard .meta { grid-template-columns: var(--label-col) minmax(0,1fr); }, .stage, .inlineform .row, .rrow.olay { grid-template-columns: var(--label-col) minmax(0,1fr) auto; }, .calrow, .deadpanel .deadrow { grid-template-columns: var(--label-col) minmax(0,1fr) auto; }.
```

**Not:** Ilgili satirlar: 599, 649, 727, 1400, 1478, 1537, 1812, 2021.

## [P1] ui-kusuru — satir 745

**Mevcut:**
```
.empty { color: var(--ink-faint); font-size: 13.5px; }
```

**Neden:** Bos durum, urunun en cok goruldugu ekranlardan biri: yeni kurulumda dosya listesi, belge listesi, sure listesi hepsi bos. Bugun bos durum = soluk renkte 13,5px tek satir. Ne oldugunu, ne yapilmasi gerektigini ve nereye tiklanacagini soylemiyor; ekran "bozuk" gorunuyor. Yaninda ise .placeholder .mark 62px'lik dev bir sus glifi koyuyor — bos ekranin en buyuk ogesi anlamsiz bir isaret oluyor.

**Öneri:**
```
Tek bir bos durum bileseni kurun: .empty { display: grid; gap: 8px; justify-items: start; padding: 32px 0; color: var(--ink-soft); font-size: 15px; max-width: var(--measure); } icinde bir baslik (16px, --ink), bir aciklama cumlesi ve bir eylem dugmesi (button.ghost.primary) olsun. .placeholder .mark { font-size: 34px; } yapin ya da isareti tumden kaldirin.
```

**Not:** Satir 753-756 .placeholder .mark blogu.

## [P1] ton — satir 967

**Mevcut:**
```
.monomark:hover .mg-tick { animation-duration: 14s; }
```

**Neden:** Marka isaretinde 96 saniyede bir tam tur atan kesikli bir halka var; fare uzerine gelince 14 saniyeye hizlaniyor. Hicbir bilgi tasimiyor, sadece hareket ediyor. Bir kanit sisteminde ekranda kendiliginden hareket eden tek sey, gercekten bir sey olurken olmali; suslu donen halka urunun ciddiyetini dusuruyor.

**Öneri:**
```
.mg-tick kuralini, @keyframes mgspin blogunu (satir 961-962) ve bu hover kuralini silin. Marka isareti sabit kalsin. Isterseniz monogrami da sadelestirin: bugun C (40px, x=34) ve X (30px, x=53) 9px ust uste biniyor ve iki farkli taban cizgisinde duruyor; tek bir bordo halka + icinde tek bir paragraf isareti her boyda temiz okunur.
```

**Not:** W13-DESIGN-SPEC 1.6 ve 2.2 ayni iki degisikligi istiyor.

## [P1] ui-kusuru — satir 1383

**Mevcut:**
```
background: var(--ink); color: var(--paper);
  border-radius: 999px; padding: 12px 22px;
```

**Neden:** Bildirim kutusu tam hap seklinde ama en fazla 640px genislige kadar uzayabiliyor ve icindeki metin cok satirli olabiliyor. Iki satirlik bir Turkce cumle 640px'lik bir kapsulun icine sikistirildiginda kenarlar sisiyor ve oge bir buton mu bildirim mi belirsizlesiyor. Ayrica anlam rengi yalniz 4px sol kenarda tasindigi icin — dolu hap ile birlestiginde — hangi renk oldugu bir bakista secilmiyor.

**Öneri:**
```
.toast { border-radius: var(--r-2); padding: 14px 18px; text-align: left; max-width: min(92vw, 520px); box-shadow: var(--e-3); } yapin; sol kenar seridini 4px'ten 3px'e indirip yaninda 8px dolgu birakin. Hap sekli yalniz tek sozcuklu durum haplarinda kalsin.
```

**Not:** Satir 1391-1393 arasindaki .toast.bad/.ok/.warn sinif kurallari korunur.

## [P1] ui-kusuru — satir 1712

**Mevcut:**
```
.viewtab { letter-spacing: .2em; font-size: 15px; }
```

**Neden:** Stil sayfasinda 18 farkli harf araligi degeri var (.01em'den .34em'e). En genisleri (.2em, .22em, .3em, .34em) Turkce sozcukleri harf yigilarina donusturuyor: "D O S Y A L A R I M" bir sozcuk olarak degil, harf harf okunuyor. Genis harf araligi ancak tek-iki kelimelik, seyrek kullanilan etiketlerde ise yarar; ana gezinmede okumayi yavaslatir.

**Öneri:**
```
Uc degere indirin: --tracking-flat: 0 (varsayilan, HER YER), --tracking-label: .04em (yalniz .fieldlabel ve h2.section), --tracking-tight: -.01em (yalniz 26px ve ustu basliklar). .viewtab { letter-spacing: 0; font-size: 15px; }, .masthead .brand { letter-spacing: 0; text-indent: 0; }, .stamp/.chip/.days/button.pill/.kaynaksiz/button.ghost/a.dl/button.seal hepsinde letter-spacing: 0.
```

**Not:** Satir 186 (.34em) ve 194 (.3em) marka blogunda; 271, 291, 361 ve digerleri cip/etiketlerde.

## [P1] ui-kusuru — satir 1825

**Mevcut:**
```
@media (max-width: 1100px) {
```

**Neden:** Stil sayfasinda alti kirilma noktasi var: 1200, 1100, 900, 800, 640, 480. Ustelik 1100 ve 800 yalniz editor icin; sonuc, 850px genislikte belge sayfasi tek sutuna inmisken editorun hala iki sutunda kalmasi gibi tutarsiz ara durumlar. Kullanici pencereyi yavasca daralttiginda duzen alti kez, ustelik farkli mantiklarla degisiyor.

**Öneri:**
```
Dort kirilma noktasina indirin: 640px (tek sutun, tablo kart listesine doner, sekmeler kaydirilabilir serit), 900px (iki sutunlu izgaralar tek sutuna, belge sayfasi ve editor sag paneli alta), 1200px (ust cubuk iki satira, editor uc sutundan iki sutuna), 1560px (kap --w-page'te sabit kalir). @media (max-width: 1100px) blogunu 1200'e, @media (max-width: 800px) blogunu 900'e tasiyin.
```

**Not:** W13-DESIGN-SPEC 1.5 ayni dortlu tabloyu veriyor; dogrulama noktalari 390/768/960/1024/1440/1920.

## [P1] ui-kusuru — satir 1904

**Mevcut:**
```
--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
```

**Neden:** Bu jeton kumesi dosyanin 1904. satirinda, yani stilin son ucte birinde tanimlanmis ve yalnizca 58 yerde kullaniliyor. Ondan onceki 1900 satir hala serbest piksel yaziyor: dolgu ve kenar bosluklarinda 37 farkli deger (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,20,22,24,26,28,30,32,34,36,38,40,48,50,54,58,60,64,72,88,120). Ayni ekranda kart ici bosluk 20px, 22px, 24px, 26px ve 28px olarak bes farkli sekilde gorunuyor; goz bu duzensizligi "ozensiz" diye okur.

**Öneri:**
```
Jeton kumesini :root'un ilk blogu icine (satir 17 civari) tasiyin ve on basamaga tamamlayin: --s-1:4px --s-2:8px --s-3:12px --s-4:16px --s-5:20px --s-6:24px --s-7:32px --s-8:40px --s-9:56px --s-10:72px. Sonra mekanik esleme uygulayin: 1-3 to --s-1, 5-7 to --s-2, 9-11 to --s-3, 13-15 to --s-4, 18-22 to --s-5, 24-28 to --s-6, 30-38 to --s-7, 40-50 to --s-8, 54-64 to --s-9, 72-120 to --s-10. Dikey ritim: kart ici blok arasi --s-4, kart-kart --s-4, bolum-bolum --s-9.
```

**Not:** --sp-* ve --s-* iki ayri isim kumesi olmasin; birini secip digerini silin.

## [P2] ui-kusuru — satir 56

**Mevcut:**
```
--abstain: #5d5776;
```

**Neden:** Ekranda alti renk ayni anda anlam tasiyor: bordo (marka + eylem + baglanti), bronz (etiket + cizgi + ilerleme), yesil (olumlu), turuncu (uyari), kirmizi (olumsuz), mor (cekimser). Alti renkli bir sema hicbir renge oncelik birakmiyor; ozellikle mor, hukuk urununde hicbir kulturel karsiligi olmadigi icin ogrenilmesi gereken fazladan bir kod.

**Öneri:**
```
Cekimserligi kendi hue'suyla degil, notr + desen ile anlatin: --abstain: var(--ink-soft) yapin ve .verdict.abstain ile .abstain-panel'i dolu renk yerine kesikli kenar + notr zeminle ayirin. Renk butcesini dorde indirin: bordo (marka/eylem), bronz (etiket/cizgi), yesil/turuncu/kirmizi (yalniz durum).
```

**Not:** --abstain 79 ve 137. satirlarda koyu tema icin de tanimli.

## [P2] ui-kusuru — satir 181

**Mevcut:**
```
.masthead .brand {
  margin: 0;
  font-size: 23px;
  line-height: 1.22;
  font-weight: 400;
  letter-spacing: .34em;
```

**Neden:** Marka adi 0,34em harf araligiyla yaziliyor: alti harfli "ColleX" ekranda "C o l l e X" olarak, yani bir kelime olmaktan cikarak goruluyor. Ayrica font-variant-caps: small-caps ile birlesince X harfi digerlerinden farkli bir govdede kaliyor. Marka, urunun ilk izlenimi; burada dagilmasi tum ekranin "ozensiz" okunmasina neden oluyor.

**Öneri:**
```
.masthead .brand { font-size: 26px; letter-spacing: -.01em; text-indent: 0; font-variant-caps: normal; font-weight: 400; } yapin. Ayni degisikligi .brandmini (satir 1225) icin de uygulayin: letter-spacing: 0; font-variant-caps: normal;.
```

**Not:** Satir 186-188 (letter-spacing, text-indent, font-variant-caps).

## [P2] ui-kusuru — satir 221

**Mevcut:**
```
transition: color .25s var(--ease), border-color .25s var(--ease), box-shadow .25s var(--ease);
```

**Neden:** Stil sayfasinda sekiz farkli gecis suresi var: .2s, .25s, .3s, .35s, .4s, .45s, .6s, .7s. En cok kullanilan .25s (49 kez), basit bir renk degisimi icin agir: fare bir dugmeden digerine gecerken renkler birbirini kovalyor ve arayuz "yapiskan" hissettiriyor. Premium his, hizli ve tutarli tepkiden gelir.

**Öneri:**
```
Uc sureye indirin: --t-fast: 120ms (renk, opaklik), --t-base: 180ms (denetim durumu, kenar, golge), --t-slow: 240ms (giris/cikis animasyonlari). Tum .2s/.25s renk gecisleri --t-fast, kenar/golge gecisleri --t-base, viewIn/rise/grow --t-slow olsun.
```

**Not:** Toplam 79 gecis bildirimi var; hepsi bu uc jetona baglanmali.

## [P2] ui-kusuru — satir 699

**Mevcut:**
```
table.grid th, table.grid td { border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); padding: 8px 12px; text-align: left; vertical-align: top; }
```

**Neden:** Belge-soru izgarasi her hucrenin dort kenarina cizgi ciziyor. On satirlik bir tabloda bu ~90 cizgi demek ve tablo bir hesap cetveli gibi gorunuyor. Ayni urunun dosya tablosu (table.matters) yalniz alt cizgi kullaniyor; ayni ekranda iki farkli tablo felsefesi var. Yatay cizgi gozu satirda tutar, dikey cizgi bolar.

**Öneri:**
```
Tum tablolarda tek bicim kullanin: hucrelerde yalniz alt cizgi, baslik satirinda daha koyu tek cizgi. table.grid th, table.grid td { border: 0; border-bottom: 1px solid var(--line); padding: 10px 12px; } ve table.grid thead th { border-bottom: 1px solid var(--line-strong); background: transparent; }. Sutun ayrimini cizgiyle degil dolguyla (12px) kurun.
```

**Not:** Satir 1310-1315'teki ikinci table.grid tanimiyla birlestirilmeli.

## [P2] ui-kusuru — satir 766

**Mevcut:**
```
border: 1.5px dashed color-mix(in srgb, var(--bronze) 45%, transparent);
```

**Neden:** Dosyanin tamaminda tek non-tam-sayi kenar kalinligi bu. 1,5px, ekranin piksel izgarasina oturmadigi icin tarayici cizgiyi ya 1px ya 2px'e yuvarliyor ve kesikli desen esit araliksiz cikiyor; birakma alani "cizilmis" degil "titrek" gorunuyor.

**Öneri:**
```
.dropzone { border: 1px dashed color-mix(in srgb, var(--bronze) 55%, transparent); } yapin. Kesikli desen istikrari icin ayrica border-radius'u --r-4'e sabitleyin.
```

## [P2] ui-kusuru — satir 987

**Mevcut:**
```
.verdict .medal { animation: medalIn .7s var(--ease) both; }
```

**Neden:** Hukum kartinin 76px'lik madalya dairesi acilirken zipliyor (medalIn: %55'ten %105'e, sonra %100). Bir cevabin hukmunun ekrana zıplayarak girmesi, o hukmun tartilmis bir yargi degil bir odul oldugu izlenimi veriyor. Ayrica 0,7 saniye, bir bilgi ogesi icin uzun.

**Öneri:**
```
.verdict .medal { animation: none; } yapin ya da yalnizca yumusak bir opaklik gecisi birakin: @keyframes medalIn { from { opacity: 0; } to { opacity: 1; } } ve suresini 240ms'e indirin.
```

**Not:** @keyframes medalIn blogu satir 988-992.

## [P2] ui-kusuru — satir 1070

**Mevcut:**
```
nav.toc {
  position: sticky;
  top: 10px;
  z-index: 6;
```

**Neden:** Cevap ekranindaki icindekiler cubugu, ust cubuktan bagimsiz olarak 10px'te yapisiyor ve kendi golgesini tasiyor. Ust cubuk da yapiskan degil, yani kaydirinca ekranda tek basina yuzen bir hap kaliyor. Ayrica z-index degeri (6) urunun geri kalanindaki katman sayilariyla (docmodal 40, toast 70) ayni sistemden gelmiyor.

**Öneri:**
```
Katman jetonlari tanimlayin (--z-sticky: 10; --z-topbar: 20; --z-popover: 40; --z-modal: 60; --z-toast: 80) ve nav.toc { top: 0; z-index: var(--z-sticky); box-shadow: none; border-bottom: 1px solid var(--line); border-radius: 0; background: var(--paper); } yapin — cubuk sayfanin ustune oturur, havada yuzmez.
```

**Not:** .docmodal z-index 40, .toast 70; jetonlarla birlikte guncellenmeli.
