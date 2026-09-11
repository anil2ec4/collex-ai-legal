# css-bilesen

Bu bölge (1100-2178) bileşen, tablo, modal ve dar ekran kurallarını taşıyor; büyük kısmı görsel davranış olduğu için bulgular metinden çok "ekranda ne oluyor" düzeyinde. En ağır kusur yazdırma kurallarında: kâğıda basınca uyarı şeritleri (.strip) ve editörde ZORUNLU kontrol bandı (.stamp) ile uyarı listesi tümüyle siliniyor — ekranda avukatı uyaran her şey basılı nüshada yok oluyor. İkinci ağır kusur, "kapalı" görünmesi gereken form ve kartların yalnızca soluklaştırılması: form hâlâ tıklanabilir/yazılabilir görünüyor, üstelik %55 saydamlıkta açıklama metni okunamaz hâle geliyor. Üçüncü küme okunabilirlik: takvim öğeleri 10,5-11,5 punto, dosya kartı etiketleri 12,5 punto, satır düğmeleri 3 piksel iç boşlukla ~21 piksel yüksekliğinde — dosyanın kendi "hiçbir yüzey 13 px altına inmez" kuralını ve kendi 14 px düğme ölçüsünü çiğniyor. Ayrıca tablo başlıklarındaki text-transform: uppercase Türkçe'de "i" harfini "I" yapıyor (İÇTİHAT yerine ICTIHAT), künyesi bulunamayan hücrenin taralı gösterimi teknik nedenle hiç çizilmiyor, ve "belirsiz/doğrulanamadı" durumu ekranın en soluk rengiyle yani en görünmez biçimde çiziliyor — oysa avukatın elle bakması gereken tek satır odur. Metin kırpma (künye, şablon amacı, alıntı kutusu) birçok yerde uyarısız yapılıyor: avukat kırpıldığını anlamıyor.

Bulgu: 28

## [P0] ui-kusuru — satir 1370

**Mevcut:**
```
form.gateoff { opacity: .55; }
```

**Neden:** "Calismayan" arama formu SADECE soluklastiriliyor. Saydamlik tiklamayi ve yazmayi engellemez: avukat alanlara yazar, dugmeye basar, hicbir sey olmaz ya da anlasilmaz bir hata gorur. Ayrica %55 saydamlik yuzunden formun neden kapali oldugunu anlatan aciklama metni de okunamaz hale gelir — yani en cok okunmasi gereken cumle en soluk cumle olur.

**Öneri:**
```
Saydamligi 0.55'ten 0.75'e cikarin ve gorsel degil GERCEK kapatma ekleyin: `form.gateoff { opacity: .75; } form.gateoff input, form.gateoff select, form.gateoff textarea, form.gateoff button { pointer-events: none; }` (alanlar HTML'de de `disabled` olmali). Formun ustunde tam opak, soluklastirilmamis bir aciklama satiri kalmali: "Bu arama simdilik kullanilamiyor. Nedeni: ..." Aciklama satiri gateoff soluklugunun DISINDA tutulmali (`form.gateoff .gatereason { opacity: 1; }`).
```

## [P0] ui-kusuru — satir 1628

**Mevcut:**
```
nav.toc, .docmodal, .topbar, .strip, .toolbar, .subtabs, .toast, .actions { display: none; }
```

**Neden:** Yazdırma kurallarında .strip gizleniyor. Ekrandaki sarı/kirmizi uyari seritleri (ornegin "bu calisma bir dosyaya bagli degil" ya da deneme verisiyle calisildigi uyarisi) kagida hic basilmiyor. Avukat cikti aldiginda, ekranda kendisini uyaran bandin izi yok; ciktiyi dosyaya koyar ya da muvekkile verir, uyari kaybolmustur. Uyari urunun kendisidir; kagitta silinmesi en agir kusurdur.

**Öneri:**
```
.strip yazdirma listesinden CIKARILMALI. Yerine yazdirmada sadeleserek KALMALI: gri cerceve, siyah metin, 12 punto (ornegin `@media print { .strip { background: #fff; color: #000; border: 1px solid #000; } }`). Yalnizca hicbir uyari tasimayan bilgi seritleri (.strip.mute) gizlenebilir.
```

**Not:** Ayni satirda .toast ve .actions gizlenmesi dogru; sorun yalniz .strip.

## [P0] ui-kusuru — satir 1839

**Mevcut:**
```
body.editing .masthead, body.editing .stamp, body.editing .strip, body.editing #templates, body.editing #draftform,
```

**Neden:** Editorde yazdirma yapildiginda .stamp (zorunlu kontrol bandi: "bu metin avukat tarafindan kontrol edilmelidir") ve hemen altindaki satirda #edissues (uyari/eksik listesi) ile footer.note ekrandan da kagittan da kaldiriliyor. Boylece bir dilekce taslagi, uzerinde hicbir kontrol uyarisi olmadan ciktilaniyor ve son hali gibi gorunuyor. Urunun kendi kurali "kontrol bandi ve dipnot her kipte kalir" diyor; burasi bunu ihlal ediyor.

**Öneri:**
```
body.editing .stamp ve body.editing footer.note yazdirma gizleme listesinden CIKARILMALI; ikisi de kagida sade bicimde basilmali. #edissues de gizlenmek yerine yazdirmada "KONTROL EDILECEK NOKTALAR" basligiyla son sayfaya basilmali.
```

**Not:** Ayni bloktaki #edtop, #edoutline, #edevidence, .ptools gizlemeleri dogrudur — onlar aractir, uyari degildir.

## [P1] ui-kusuru — satir 1297

**Mevcut:**
```
button.workcard[disabled] { cursor: not-allowed; opacity: .62; background: var(--panel-2); }
```

**Neden:** Kapali is kartinin gerekcesi bir alt satirda zaten en soluk renge (--ink-faint) aliniyor; ustune %62 saydamlik binince gerekce cumlesi pratikte okunamaz. Oysa urunun kurali, kapali bir ekranin NEDEN kapali oldugunu ekrana yazmak. Avukat gri bir kutu gorur, nicin kapali oldugunu okuyamaz, kartin bozuk oldugunu sanir.

**Öneri:**
```
Kart govdesini soluklastirmak yerine yalniz basligi soluklastirin, gerekceyi tam opak birakin: `button.workcard[disabled] { cursor: not-allowed; background: var(--panel-2); } button.workcard[disabled] .wt { color: var(--ink-soft); } button.workcard[disabled] .wl { color: var(--ink-soft); opacity: 1; }` ve gerekce satirinin onune sabit bir "Su an kullanilamiyor —" on eki gelmeli.
```

## [P1] ui-kusuru — satir 1298

**Mevcut:**
```
button.workcard[disabled] .wl { color: var(--ink-faint); }
```

**Neden:** Kapali kartin aciklama satirinin rengi en soluk mürekkep. Ustteki %62 saydamlikla birlesince koyu temada da acik temada da metin/zemin karsitligi erisilebilirlik esiginin altina duser. Ekranin avukata soyledigi tek sey okunmaz olur.

**Öneri:**
```
button.workcard[disabled] .wl { color: var(--ink-soft); }
```

## [P1] ui-kusuru — satir 1433

**Mevcut:**
```
table.matters tbody tr { cursor: pointer; transition: background .2s var(--ease); }
```

**Neden:** Dosya tablosunun satirlari tiklanabilir ama bunu soyleyen tek sey farenin uzerine gelince degisen arka plan. Dokunmatik ekranda ve ilk bakista satirin tiklanabilir oldugu anlasilmaz; avukat dosyayi acmak icin nereye basacagini bilemez. Dar ekranda satir bir karta donusuyor (2136) ve orada da hicbir "ac" isareti yok.

**Öneri:**
```
Her satirin son sutununa gorunur bir eylem konmali: ya "Dosyayi ac" baglantisi ya da sag kenarda sabit bir ok (`table.matters td.ttl::after { content: " \203A"; color: var(--seal); }`). Kart gorunumunde ise kartin altina tam genislikte "Dosyayi ac" dugmesi eklenmeli.
```

## [P1] ui-kusuru — satir 1811

**Mevcut:**
```
.evcard blockquote.quote { font-size: 14px; padding: 12px 14px 12px 36px; margin: 10px 0; max-height: 180px; overflow: auto; }
```

**Neden:** Kanit alintisi — urunun tum iddiasini tasiyan metin — 180 piksellik bir kutuya sikistiriliyor ve icinde kayiyor. Kutunun tastigina dair hicbir isaret yok (solma, "devami var" satiri, ok). Avukat alintiyi tam okuduğunu sanip yarisini gormeden dilekceye koyabilir.

**Öneri:**
```
max-height kaldirilmali ya da tasma acikca soylenmeli: `.evcard blockquote.quote { max-height: 260px; overflow: auto; }` + kutunun altinda sabit bir satir: "Alintinin tamami icin kaydiriniz" ve alt kenarda solma (`mask-image`). Tercih edilen: `.evcard blockquote.quote.clipped::after { content: "Alintinin devami var — tamamini gormek icin belgeyi acin"; }`
```

## [P1] ui-kusuru — satir 1935

**Mevcut:**
```
.srcrow { border-bottom: 1px solid var(--line); padding: var(--sp-2) 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 var(--sp-3); align-items: start; max-height: 96px; overflow: hidden; }
```

**Neden:** Satir 96 pikselde sert kesiliyor (overflow: hidden) ve kesildigine dair hicbir gorsel isaret yok. Icerik tam bu sinirin ustundeyse metnin alti kirpilir; avukat satirin acilabilir oldugunu (.srcrow.open) da bilmez, cunku ekranda "genislet" isareti yoktur.

**Öneri:**
```
Kesme yerine acilir satir yapilmali ve acilabilirligi soylenmeli: max-height korunacaksa alt kenara solma eklenmeli (`.srcrow:not(.open) { -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent); }`) ve satirin sagina her zaman gorunur "Ayrintiyi ac" dugmesi konmali.
```

## [P1] ui-kusuru — satir 1937

**Mevcut:**
```
.srcrow .kunye { font-size: var(--fs-sm); font-weight: 600; color: var(--ink); line-height: var(--lh-tight); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

**Neden:** Karar kunyesi (mahkeme, daire, esas/karar numarasi, tarih) tek satira zorlanip uc noktayla kesiliyor. Kunye avukatin karari TESHIS ETTIGI seydir; esas numarasinin yarisi kesilirse satir ise yaramaz. Dar ekranda kesilme daha da erken olur.

**Öneri:**
```
.srcrow .kunye { font-size: var(--fs-sm); font-weight: 600; color: var(--ink); line-height: var(--lh-tight); white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }  — yani en cok iki satir, kesme uc noktayla degil satir sonunda. .srcrow'un max-height: 96px degeri de 112px'e cikarilmali.
```

## [P1] ui-kusuru — satir 1951

**Mevcut:**
```
.srcrow .rowacts button.ghost { padding: 3px 8px 4px; font-size: var(--fs-xs); }
```

**Neden:** Arama sonucu satirindaki ana dugmeler (satiri acma, dosyaya ekleme) 13 punto ve 3 piksel ic bosluklu; toplam yukseklik ~21 piksel. Ayni dosyanin 1716-1717. satirlari dugmeler icin 14 punto ve 8 piksel ic bosluk sart kosuyor. Bu boyutta bir dugmeye fare ile bile isabet ettirmek zor, dokunmatik ekranda imkansiza yakin; avukat yanlis satiri acar.

**Öneri:**
```
.srcrow .rowacts button.ghost { padding: 7px 12px 8px; font-size: var(--fs-sm); min-height: 34px; }
```

**Not:** Ayni sorun .chipbtns button.ghost (satir 2174) icin de gecerli.

## [P1] ui-kusuru — satir 1978

**Mevcut:**
```
table.audtable th { text-align: left; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .06em;
```

**Neden:** text-transform: uppercase Turkce'de yanlis calisir: "ictihat" -> "ICTIHAT" (ICTIHAT degil ICTİHAT olmali), "kunye" -> "KUNYE", "iliski" -> "ILISKI". Noktali i, noktasiz I'ya donusur. Denetim raporunun sutun basliklari boylece hatali Turkce ile yazilir; ayrica 13 punto buyuk harf, ayni dosyanin "tablo basliklari normal buyuk/kucuk harf, >= 14 px" kuralini (1699-1701. satirlardaki yorum) cigner.

**Öneri:**
```
text-transform kaldirilmali, punto buyutulmeli: `table.audtable th { text-align: left; font-size: var(--fs-sm); letter-spacing: 0; ... }` ve baslik metinleri HTML'de dogrudan "Atif", "Durum", "Kunye" seklinde normal yazilmali.
```

**Not:** Ayni kusur table.mantable th (2031), table.feetable th (2048) ve .ndlabel (2171) icin de gecerli — hepsi text-transform: uppercase kullaniyor.

## [P1] ui-kusuru — satir 1986

**Mevcut:**
```
table.audtable td.kunye:empty { background: repeating-linear-gradient(135deg, transparent, transparent 5px, var(--line) 5px, var(--line) 6px); background-clip: content-box; }
```

**Neden:** Iki ayri kusur var. (1) Teknik: hucre bos oldugu icin icerik kutusunun yuksekligi sifirdir; `background-clip: content-box` deseni yalniz icerik kutusuna boyar, yani tarama EKRANDA HIC CIZILMEZ. Tasarlanan isaret gorunmuyor, hucre bombos kaliyor. (2) Tasarim: cizilse bile capraz tarama, tanimi ekranda hicbir yerde yazmayan bir simgedir; avukat "tarali hucre ne demek" diye soracak yer bulamaz.

**Öneri:**
```
Desen yerine ACIK METIN kullanilmali: `table.audtable td.kunye:empty::after { content: "Bulunamadi — elle bakiniz"; color: var(--ink-soft); font-style: italic; }` ve tablonun altinda tek satir aciklama: "Bos kunye hucresi, atfin karsiligini ColleX'in bulamadigi anlamina gelir; uydurulmus bir kunye yazilmaz."
```

**Not:** Urunun kendi kurali "kunye uydurulmaz, hucre bos birakilir" diyor — bu dogru; eksik olan, BOSLUGUN NE DEMEK OLDUGUNUN yazilmasi.

## [P1] ui-kusuru — satir 1991

**Mevcut:**
```
.audstate.uncertain { color: var(--ink-faint); } .audstate.uncertain .d { background: var(--ink-faint); }
```

**Neden:** "Dogrulanamadi" durumu ekranin EN SOLUK rengiyle ciziliyor. Oysa avukatin elle kontrol etmesi gereken tek satir tam olarak budur: bulundu (yesil) ve bulunamadi (kirmizi) kendini anlatir, "bakamadik" ise gozden kacar. Gorsel aciliyet tersine donmus; ustelik ayirt etme yalniz RENGE dayaniyor, renk korlugunde uc durum ayirt edilemez.

**Öneri:**
```
.audstate.uncertain { color: var(--ink); } .audstate.uncertain .d { background: transparent; border: 2px solid var(--ink-soft); }  — yani ici bos halka + normal koyulukta metin. Ayrica her uc durumun yaninda metin de bulunmali: "Bulundu", "Bulunamadi", "Kontrol edilemedi" (yalniz renk degil).
```

**Not:** Ayni sorun .clfind .st.belirsiz (satir 2059) ve .numgrid .n .v.none (2040) icin de gecerli.

## [P1] ui-kusuru — satir 2010

**Mevcut:**
```
font-size: 11.5px; line-height: 1.25; cursor: pointer;
```

**Neden:** Takvim hucresindeki durusma/sure ogeleri 11,5 punto ve tek satira kirpiliyor. Dosyanin kendi kurali (ayni dosyada, --fs-xs tanimi yaninda) "hicbir yeni yuzey 13 px'in altina inmez" diyor; takvim bunu ihlal ediyor. 20 yillik bir avukat icin 11,5 punto tek satir kirpilmis dosya adi okunamaz; ustelik hangi durusma oldugunu ayirt edemez.

**Öneri:**
```
font-size: var(--fs-xs); line-height: 1.3; cursor: pointer;  (yani 13 px). Hucre yuksekligi de buna gore .calcell { min-height: 96px; } olmali.
```

**Not:** Ayni oge 480 px altinda 10,5 punto'ya iniyor (satir 2128) — orasi da duzeltilmeli.

## [P1] ui-kusuru — satir 2043

**Mevcut:**
```
.toolinv .tl .nm { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; }
```

**Neden:** Arac envanteri, 340 piksellik kaydirilabilir bir kutuda daktilo yazisiyla makine adlarini listeliyor (search_bedesten_unified gibi ingilizce alt cizgili adlar). Bu, ana ekranda avukata gosterilecek bir sey degil: hicbirinin Turkce karsiligi yok, hicbiri ne ise yaradigini soylemiyor. Daktilo yazisi + ingilizce ad, avukatin "burasi bana gore degil" deyip kapattigi tam olarak o yuzeydir.

**Öneri:**
```
Liste ana akistan cikarilip katlanabilir "Teknik ayrintilar" icine alinmali; disarida yalniz sayi kalmali ("18 kaynak baglantisi hazir"). Kutuda kalacaksa her satir Turkce ad tasimali ve daktilo yazisi ikincil, kucuk gri satira inmeli: `.toolinv .tl .nm { font-family: var(--serif); } .toolinv .tl .nm code { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }`
```

## [P1] ui-kusuru — satir 2087

**Mevcut:**
```
button.tpl p.purpose { margin: 0; font-size: var(--fs-xs); color: var(--ink-soft); line-height: var(--lh-tight); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

**Neden:** Sablon kartinda, sablonun NE ISE YARADIGINI soyleyen tek cumle 13 punto ve tek satira kirpiliyor. Sutun genisligi 268 piksel oldugu icin cumlenin cogu kayboluyor: "Kiraci aleyhine tahliye talepli..." gibi bir metin daha basinda kesilir. Avukat hangi sablonu sectigini kartin basligindan tahmin etmek zorunda kalir.

**Öneri:**
```
button.tpl p.purpose { margin: 0; font-size: var(--fs-sm); color: var(--ink-soft); line-height: var(--lh-body); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }  — iki satira izin verin ve puntoyu 14'e cikarin.
```

## [P1] ui-kusuru — satir 2128

**Mevcut:**
```
button.calitem { font-size: 10.5px; }
```

**Neden:** Dar ekranda (telefon) takvim ogesi 10,5 puntoya iniyor ve 7 sutunlu izgarada hucre genisligi ~50 piksel kaliyor: her oge en fazla 4-5 harf gosterir. Avukat telefonda takvime baktiginda hicbir seyi okuyamaz, yalnizca renkli cizgiler gorur.

**Öneri:**
```
Dar ekranda 7 sutunlu ay izgarasi yerine LISTE'ye gecilmeli: `@media (max-width: 640px) { .calgrid { display: none; } .callist { display: block; } }` ve liste satirlari 14 punto tarih + dosya adi + "kalan gun" seklinde. Izgara korunacaksa oge yazisi en az 13 punto olmali ve hucre "3 kayit" gibi sayi gostermeli.
```

## [P1] ui-kusuru — satir 2148

**Mevcut:**
```
font-variant-caps: all-small-caps;
```

**Neden:** Dar ekranda dosya kartinin alan etiketleri (data-label) kucuk-buyuk harf (small-caps) ve 12,5 punto ciziliyor. Ayni dosyanin 1699-1701. satirlarindaki kural, kucuk-buyuk harfin YALNIZ gezinme sekmeleri ve bolum baslik cizgilerinde kullanilacagini soyluyor; buradaki etiketler o kuralin disina cikmis. Turkce'de small-caps ayrica noktali i'yi bozar ve 12,5 punto 13 punto tabaninin altindadir.

**Öneri:**
```
font-variant-caps: normal; letter-spacing: 0; font-size: var(--fs-xs);  — etiketler normal buyuk/kucuk harf ve en az 13 punto olmali ("Muvekkil", "Karsi taraf", "Son islem").
```

## [P1] ui-kusuru — satir 2167

**Mevcut:**
```
@media (max-width: 900px) { .tablehint { display: block; } }
```

**Neden:** "Tablo yana kayiyor" ipucu yalniz 900 pikselin ALTINDA gosteriliyor; ama denetim tablosu (table.audtable) 880 piksel asgari genislikte ve sayfa kenar bosluklariyla birlikte yaklasik 940 piksele kadar tasmaya devam ediyor. 900-940 piksel arasinda tablo yatay kayar ama ipucu gizlidir: avukat sag taraftaki sutunlarin (Karsi ictihat, Islem) var oldugunu hic gormez.

**Öneri:**
```
@media (max-width: 1000px) { .tablehint { display: block; } }  — esik, tablonun asgari genisligi + sayfa ic boslugunun ustune cekilmeli. Daha saglami: ipucu her zaman gorunur olsun ve tabloya `.tablescroll` kaydirilabildiginde sag kenarda solma eklensin.
```

## [P2] ui-kusuru — satir 1174

**Mevcut:**
```
overflow: auto;
```

**Neden:** .docpanel'in kendisi kayiyor, icindeki .doctext (satir 1196) de ayri ayri kayiyor. Ic ice iki kaydirma alani olusuyor: avukat fare tekerini cevirdiginde bazen ic kutu, bazen pencere kayar; hangisinde oldugunu anlamak icin denemek zorunda kalir. Bu klasik bir kullanim kusurudur.

**Öneri:**
```
Tek kaydirma birakilmali: pencere basligi yapiskan kaldiktan sonra govde tek kaydirici olsun. `.docpanel { overflow: auto; } .docpanel .doctext { overflow: visible; max-height: none; }` — yani belge metni kendi kutusunda degil, pencerenin kendisinde kaysin.
```

## [P2] ui-kusuru — satir 1290

**Mevcut:**
```
padding: 12px 14px 13px; display: grid; gap: 5px; min-height: var(--tap, 40px);
```

**Neden:** Is kartlarinin en kucuk dokunma yuksekligi 40 piksel olarak tanimlanmis. Yaygin erisilebilirlik olcusu 44 pikseldir; 40 piksel, ekranda yan yana duran kartlarda yanlis karta basmayi kolaylastirir. Kartlar urunun ana giris noktasi oldugu icin bu isabet hatasi pahali.

**Öneri:**
```
min-height: var(--tap, 44px);  — ve --tap degiskeni tanimliysa 44px'e cekilmeli.
```

## [P2] ui-kusuru — satir 1331

**Mevcut:**
```
.gridpick { display: grid; gap: 6px; max-height: 240px; overflow: auto; padding: 4px 0; }
```

**Neden:** Belge secme listesi 240 piksele sikistirilip icinde kaydiriliyor; listenin devami oldugunu soyleyen hicbir isaret yok. Alti kesilen listede avukat, secmek istedigi belgenin listede olmadigini sanabilir.

**Öneri:**
```
.gridpick { max-height: 240px; overflow: auto; } kalsin ama sayilabilir hale gelsin: listenin ustune "12 belgeden 12'si listeleniyor" satiri ve kutunun alt kenarina solma eklensin (`-webkit-mask-image: linear-gradient(to bottom, #000 88%, transparent)`).
```

## [P2] ton — satir 1333

**Mevcut:**
```
/* Şeritler: dosyasız çalışma (sarı) ve deneme korpusu. */
```

**Neden:** Yorum satiri kullaniciya gorunmez ama sinifi tanimladigi seridin ekrandaki adini ele veriyor: "deneme korpusu". "Korpus" avukatin bilmedigi bir sozcuktur; bu serit ekranda gorunen bir uyaridir ve o adla ciziliyor (.strip.demo). Serit, uzerinde durdugu seyi avukat Turkcesiyle soylemelidir.

**Öneri:**
```
Serit metni degistirilmeli: "DENEME KORPUSU" yerine "ORNEK VERI — bu ekrandaki kararlar gercek degildir, deneme amaciyla hazirlanmistir". CSS tarafinda .strip.demo tek satira sigmayacagi icin `justify-content: center` yerine `justify-content: flex-start` ve `text-align: left` olmali.
```

## [P2] ui-kusuru — satir 1421

**Mevcut:**
```
.days.late { color: var(--paper); background: var(--ink); border-color: var(--ink); border-left: 4px solid var(--bad); padding-left: 8px; }
```

**Neden:** "Gecikmis" damgasi dolu siyah zemin + kirmizi kenar ile ciziliyor; bu dogru bir karar. Ancak ayni satirdaki .days.orange ve .days.red yalnizca RENK degistiriyor (1416-1417): renk korlugu olan ya da ekrani parlak isikta okuyan bir avukat "3 gun kaldi" ile "12 gun kaldi" arasindaki aciliyet farkini goremez.

**Öneri:**
```
Aciliyet renge ek olarak metinle tasinmali: .days.red icin `font-weight: 700` ve rozet metninin "3 GUN — ACIL" bicimine gecmesi; .days.orange icin ince kirmizi sol kenar (`border-left: 3px solid var(--warn); padding-left: 8px`). Yalniz renkle anlatilan hicbir aciliyet birakilmamali.
```

## [P2] ui-kusuru — satir 1563

**Mevcut:**
```
.topbar { grid-template-columns: 1fr; grid-template-areas: "brand" "theme" "matter" "pills"; justify-items: center; }
```

**Neden:** 481-640 piksel arasinda ust cubuk dort satira iniyor; ama ayni araligi kapsayan bir sonraki kural (satir 1688) ilk acilista marka kopyasini gizliyor. Boylece "brand" alani BOS kaliyor ve ust cubugun en ustunde acikllanamayan bos bir satir olusuyor. Ilk izlenim, hizali olmayan bir ekran.

**Öneri:**
```
Bos satiri kaldirmak icin ayni kirilimda alan listesi kisaltilmali: `body:not(.compact) .topbar { grid-template-areas: "theme" "matter" "pills"; }` — ya da 481-640 araliginda brandmini gizlenmemeli.
```

## [P2] ui-kusuru — satir 1956

**Mevcut:**
```
.srcfail .cid { color: var(--ink-faint); font-family: var(--mono); font-size: var(--fs-xs); }
```

**Neden:** Arama basarisiz oldugunda ekranda daktilo yazisiyla bir takip numarasi gosteriliyor. Avukat bunun ne oldugunu bilmez; hicbir yerde "bu numarayi destege bildirin" gibi bir aciklamasi yok. Aciklamasiz makine dizisi, ekrani kapattiran tam o unsurdur.

**Öneri:**
```
Satir kendini aciklamali: numaranin onune sabit Turkce metin gelmeli — `.srcfail .cid::before { content: "Kayit no (yardim isterken bildirin): "; font-family: var(--serif); color: var(--ink-soft); }` — ya da numara katlanabilir "Teknik ayrintilar" icine alinmali.
```

## [P2] ui-kusuru — satir 2063

**Mevcut:**
```
.obsline.unsourced { color: var(--bad); border-left: 3px solid var(--bad); padding-left: var(--sp-2); }
```

**Neden:** Kaynagi dogrulanamayan gozlem satirinin TAMAMI kirmizi yaziliyor. Uzun bir cumlenin bastan sona kirmizi olmasi okumayi zorlastirir ve "kirmizi = hata" izlenimi verir; oysa kastedilen "bu satir bir kaynaga baglanmadi". Ayrica ayirt etme yalniz renge dayaniyor.

**Öneri:**
```
.obsline.unsourced { color: var(--ink); border-left: 3px solid var(--bad); padding-left: var(--sp-2); background: color-mix(in srgb, var(--bad) 5%, transparent); }  — metin normal mürekkep, uyari sol kenar + hafif zemin ile tasinsin; satirin basindaki "KAYNAKSIZ" etiketi kirmizi kalsin.
```

## [P2] ui-kusuru — satir 2071

**Mevcut:**
```
.backpath { font-family: var(--mono); font-size: var(--fs-xs); color: var(--ink-soft); word-break: break-all; }
```

**Neden:** Yedek klasorunun yolu daktilo yazisiyla, 13 punto soluk gri ve `word-break: break-all` ile yaziliyor. break-all kelimeyi harf ortasindan kirar: "C:\Kulla / nicilar\..." gibi okunamaz bir sonuc cikar. Avukat yedeginin nerede oldugunu kopyalamak ya da Windows Gezgini'nde bulmak ister; bu bicimde okuyamaz.

**Öneri:**
```
.backpath { font-family: var(--mono); font-size: var(--fs-sm); color: var(--ink); word-break: normal; overflow-wrap: anywhere; }  — ve yaninda "Klasoru ac" dugmesi bulunmali; yol metni secilebilir kalmali.
```
