# W13 — SENTEZ: yapım dalgası için tek sıralı ürün yığını

Tarih: **02.09.2026** · Tip: sentez (araştırma/denetim). Bu belge dışında
hiçbir depo dosyası değiştirilmedi, hiçbir git işlemi yapılmadı.

Kaynak: on bir W13 hattının tam raporları —
`W13-{APILEX,DEJURE,TRMARKET,GLOBAL,UXAUDIT,DESIGN,FEATURE,COPY,ENGRISK,ARCH,DAILYFLOW}.md`.
Her kalem, en az bir hattın **ölçülmüş** bulgusuna dayanır ve o hattın
etiketini (`[doğrulandı]` / `[pazarlama]` / `[çıkarım]` / `[ölçüldü]`) taşır.
Bu belge **yeni bir sayı üretmez**; sayılar `STATUS.md` "Ölçülen sayılar"
tablosundan (S1–S22) ve hat raporlarının kendi ölçümlerinden gelir.

Uygulama kısıtları (hepsi CLAUDE.md'den, hiçbiri pazarlık edilemez):
hono + zod + postgres.js + vanilla-JS CSP-sabitli konsol + Python 3.13 veri
düzlemi + **54 araçlık sabit MCP yüzeyi**; **yeni npm bağımlılığı yok**
(`package.json` donmuş, `npm ci` only); uzak servis yok (Supabase/Resend
asla; Anthropic yalnız varsayılan-KAPALI, istek başına onaylı hat);
`collex_local` asla düşürülmez ve test verisi almaz; kapılar
(`DEFAULT_COVERAGE_FLOOR 0.4`, entailment `0.85`, ADR-022, export
`EXPORT_REFUSED`) hiçbir kalem için gevşetilmez.

---

## A. Konumlandırma — bugün de, bu dalgadan sonra da DOĞRU olan tek cümle

> **ColleX, müvekkil dosyası bilgisayardan çıkmadan çalışan, kotasız ve
> aboneliksiz bir kanıt sistemidir: her alıntıyı belge sürümü, Unicode
> konumu ve SHA-256 ile bağlar; bağlayamadığı cümleyi yazmaz; doğrulanamayan
> tek bir atıf varsa dosyayı hiç üretmez — Apilex ve De Jure doğruluğu iddia
> edip kendi sözleşmelerinde o iddiayı geri alırken, ColleX iddia etmez,
> reddeder.**

Neden bugün doğru:
- Hash-bağlı alıntı + offset + belge sürümü: `export/` sözleşme testleri,
  1 karakterlik tahrifat → exit 2 (COMPETITIVE §2.1) [ölçüldü].
- Çekimserlik: `run_evals` kapsam kapısı çekimserliği %100/%100 (S8);
  UXAUDIT konu dışı soruda 0 kaynak / 0 tespit ölçtü [ölçüldü].
- Yerel: `serve.mjs` yalnız 127.0.0.1'e bağlanır; bulut hattı varsayılan
  KAPALI, istek başına onaylı (ADR-018) [kodda].
- Kotasızlık: rakiplerin ikisinde de kota var ve ikisi de sayısını
  yayımlamıyor — Apilex ToU m.3.5 "adil kullanım" + ek maliyet tahsili
  [doğrulandı]; De Jure Mesafeli Satış Sözleşmesi m.6.6 "aylık 100 / 160
  kullanım kotası" örnekleri, sitede hiçbir yerde yok [doğrulandı].

Bu cümleye **eklenmeyecek** olan: doğruluk yüzdesi, "halüsinasyonsuz",
"%100 kaynaklı", "en iyi", kapsam büyüklüğü. Gerekçe §C.

Bu dalganın konuma kattığı tek şey: aynı duruşu **avukatın elinde tutabildiği
bir çıktıya** çevirmek (B-13 Atıf Denetim Raporu, B-36 doğrulama kontrol
listesi, B-14 kapsam manifestosu). Clearbrief'in Cite Check Report'u (300
USD/ay, solo) tam olarak bunu satıyor ve bizde bütün parçaları var, yalnız
render hedefi yok (GLOBAL) [doğrulandı].

---

## B. Özellik pariteliği — dürüst hücreler

"Bugün" = 02.09.2026. Rakip hücreleri yalnız kendi kamusal yüzeylerinden;
ColleX hücreleri yalnız bu depoda **testli çalışan** mekanizmalardan.
`→ B-nn` = bu dalgada kapanması önerilen boşluk.

| Alan | ColleX bugün | Apilex bugün | De Jure bugün |
|---|---|---|---|
| **Alıntı doğrulama** | Hash + Unicode offset + belge sürümü; doğrulanamayan atıfta dışa aktarım **reddedilir** (exit 2). **Ama** editörde alıntının içi değiştirilirse yakalanmıyor → **B-01** | Mekanizma ilan edilmiyor; "%100 Kaynaklı" [pazarlama] ↔ ToU m.9.1 "hiçbir garanti vermez" [doğrulandı] | Mekanizma ilan edilmiyor; SSS "doğruluğu garanti edilmektedir" ↔ m.8.3 "HİÇBİR GARANTİ VERMEZ" [doğrulandı] |
| **Çekimserlik** | Var, çalışıyor. **Ama** çıplak kanun kısaltması ("TBK'ya göre") kapıyı deviriyor → **B-07** | İlan edilmiyor | İlan edilmiyor |
| **Karşıt otorite** | Her cevapta zorunlu; taslakta ayrı bölüm. **Ama** tablo belge bazında tekilleşmiyor ve konu dışı soruda da koşuyor → **B-31/B-27** | İlan edilmiyor | İlan edilmiyor |
| **As-of yürürlük** | Var (ADR-012 veritabanı katmanında). **Ama** zamansal soru cevaplanmadan TAM ilan ediliyor → **B-09** | "Güncellik Faktörü" [pazarlama]; as-of sorgusu yok | Güncellik tarihi hiç yayımlanmıyor [doğrulandı — yokluk] |
| **Kapsam şeffaflığı** | Sayı vermiyor; `/v1/health` + `check_government_servers_health` verisi var, **sayfası yok** → **B-14** | 12M ↔ 11M iki resmî yüzeyde çelişik [çıkarım] | Hiçbir sayı, tarih, sıklık yok; "üniversite kütüphanelerinde" otorite argümanı [doğrulandı] |
| **Karar arama ekranı** | **Yok.** Tek serbest metin sorusu; canlı tavan 6 tam belge; 28–29 MCP aracı hiçbir kod yolundan çağrılmıyor → **B-15/B-16** | "Semantik Karar Arama" [doğrulandı] | Daire + il BAM + yıl aralığı + pozitif/negatif kelime filtresi [doğrulandı] |
| **Dosya çalışma alanı** | Davalarım: kalıcı, otomatik bağlama, 6 öğe türü, yeniden başlatmada eksiksiz geri geliyor [ölçüldü] | "Projeler" — toplu analiz, belgeler arası karşılaştırma [pazarlama] | "Klasörlerim" + UYAP workspace (yalnız 80.000 ₺/yıl Pro) + mobil "Dava dosyalarım" (19.02.2026) [doğrulandı] |
| **Belgeye soru** | Hash'li, konumlu pasajlardan; yüklenen belge **asla** hukukî değerlendirme kaynağı değil (ADR-021) | Mekanizma tarif edilmiyor [pazarlama] | "Dilekçe Analizi"; yüklenen evrak **doğrudan dilekçe metnine giriyor** [doğrulandı] — biz bunu bilinçle yapmıyoruz |
| **Çok belgeli karşılaştırma** | Yok → **B-21** | "kritik farklar … tablolama" [pazarlama] | Yok (resmî sayfalarda) |
| **Dosya kronolojisi** | Elle olay ekleme var; toplu çıkarım yok → **B-18** | "dava dosyası özeti" [doğrulandı — baro PDF + iOS] | Yok |
| **Dilekçe üretimi** | 13 şablon, kanıt disiplini, KAYNAKSIZ rozeti, sürümlü editör. **Ama çıktı bugün mahkemeye gitmez** (%77 SHA eki, Letter sayfa, biçim yok) → **B-02** | "Otomatik dilekçe ve sözleşme hazırlama" [doğrulandı] | Dilekçe ≥ 6.800 ₺/ay; normal/uzun uzunluk; UDF çıktısı [doğrulandı] |
| **UDF** | Yazma var ama **deneysel, imzasız, UYAP editöründe hiç açılmadı** → **B-10** | Girişsiz ücretsiz UDF↔PDF↔DOCX dönüştürücü [doğrulandı] | UDF dışa aktarım + mobilde UDF görüntüleme (08.07.2026) [doğrulandı] |
| **Süre hesabı** | 30 kural, adli tatil, HMK m.92/2; **tamamı `dogrulanmadi` ve ikisi yürürlükten düşmüş hukuk yazıyor** → **B-11** | Yalnız yetim bir sayfada, sahte ilerleme çubuklarıyla [pazarlama] | Takvim modülü (19.02.2026); duruşma takibi yalnız Pro [doğrulandı] |
| **Takvim / duruşma / hatırlatma** | **Yok** (yalnız 14 günlük süre paneli) → **B-17** | "Takvim senkronizasyonu" [pazarlama] | Takvim modülü + hatırlatıcı + bildirim [doğrulandı] |
| **Sözleşme İNCELEME** | Yok (6 sözleşme **oluşturma** şablonu var) → **B-24** | Yok (resmî sayfalarda) | Madde madde risk raporu + mevzuat/içtihat referansı [doğrulandı] |
| **Mevzuat derinliği** | 26 araç: tam metin + **gerekçe** + **madde ağacı** + tür bazlı `search_within_*`. Konsolda görünmüyor, 9 tür aracı ölü → **B-15/B-16** | Kapsamda sayılıyor, mekanizma yok | "Mevzuat ekleme" JS'te var, pazarlanmıyor [doğrulandı] |
| **UYAP / UETS bağlantısı** | Yok ve **bilinçli olarak vaat edilmiyor**; giriş yolu sürükle-bırak → **B-19** | Chrome eklentisi ile UYAP'tan indirme [doğrulandı] | Masaüstü Dilekçe Editörü: satıcı AnyDesk ile kuruyor, avukatın kimliğiyle UYAP'a bağlanıyor, veri Google Cloud AB'ye gidiyor [doğrulandı] |
| **Veri yeri / KVKK** | Her şey `collex_local`; bulut varsayılan KAPALI, istek başına onay. **Ama maskeleme ve kayıt defteri yok** → **B-23** | Yurt dışı hosting + AI sağlayıcısı **adsız**; ToU m.8.3'ün işaret ettiği Sub-Processor tablosu yayında değil [doğrulandı] | Alt işleyen listesi yalnız Google Cloud + İyzico; **hiçbir LLM sağlayıcısı adlandırılmıyor** [doğrulandı — yokluk] |
| **Yedekleme** | **Yok. Tek disk, tek küme, geri dönüş yok** → **B-03** | Bilinmiyor (bulut) | Bilinmiyor (bulut); m.5.5 "gizli yedek alınmaz" ↔ Gizlilik §7 "Günlük yedekler" [doğrulandı] |
| **Kota** | Yok — sınır makinenin hızı | Sayısal kota yok, "adil kullanım" + ek maliyet tahsili hakkı (ToU m.3.5) [doğrulandı] | Sözleşmede var (m.6.6, "100/160" örnekleri), sitede hiçbir yerde yayımlanmıyor [doğrulandı] |
| **Fiyat** | Ticari paketleme kapsam dışı | Yayımlı değil; App Store TR uygulama içi: ₺24.999,99 / ₺39.999,99 [doğrulandı] | Yayımlı: 1.500 ₺/ay … 80.000 ₺/yıl; İzmir Barosu anlaşmalı → yıllıkta %25–40 indirim [doğrulandı] |
| **Ölçek davranışı** | 20 055 parçada `/v1/answer` **45,8 sn** ve trigram şeridi sessizce ölüyor → **B-06** | Ekşi/şikayetvar: haftalarca süren kesinti, "evrak yüklenmiyor" [kullanıcı beyanı] | Play'de son üç yorumun üçü de çökme/oturum düşmesi [doğrulandı] |

**COMPETITIVE.md düzeltmesi (B-46'ya girer):** §1 "De Jure'de dosya/proje/
klasör kavramı geçmiyor" satırı **artık yanlıştır** (DEJURE hattı: "Klasörlerim",
UYAP workspace, mobil "Dava dosyalarım"). Ayrım varlık değil, **konum**dur.
Aynı şekilde De Jure'nin doğruluk garantisi **dar kapsamlıdır** (kaynakçadaki
kararların var olduğu iddiası); §3 bunu yazmalı, yoksa eleştirimiz haksız olur.

---

## C. Yapmayacağımız yedi şey (tuzaklar)

1. **Sayı iddiası kurmak.** Doğruluk yüzdesi, "halüsinasyonsuz", "%100
   kaynaklı", korpus büyüklüğü, "N kaynak taradık" — hiçbiri. Stanford RegLab
   ön-kayıtlı çalışması Lexis+ AI'da %17+, Westlaw AI-AR'da ~%34 halüsinasyon
   ölçtü ve "hallucination-free" iddialarını abartılı buldu (GLOBAL)
   [üçüncü taraf]. Apilex'in `/tr/hakkimizda` sayfasında hâlâ temizlenmemiş
   şablon metni ("Felix Rowe", "138+", "%96 Glassdoor") duruyor [doğrulandı] —
   yayımlanan sayı, doğrulanmadıkça bir yükümlülüktür. **Kural: STATUS
   "Ölçülen sayılar" tablosunda satırı olmayan hiçbir sayı hiçbir yüzeye
   yazılmaz.**
2. **Kapıları gevşetmek.** `DEFAULT_COVERAGE_FLOOR 0.4`, entailment `0.85`,
   ADR-022 alaka kapısı, `EXPORT_REFUSED`. Özellikle **B-02 (temiz çıktı)**
   ve **B-31 (entailment)** bu tuzağın tam üstünde: "daha az uyarı" ve "daha
   çok kesinleştirilebilir cevap" kapıyı gevşeterek de elde edilebilir.
   Elde edilmeyecek. B-31'in kabul ölçütü açıkça "bu bir kusurun kalkmasıdır,
   kalite artışı değildir" der.
3. **UYAP/UETS kimlik entegrasyonu veya tarayıcı eklentisi yazmak.**
   De Jure'nin Ek Protokolü mekanizmayı gösteriyor: satıcı uzaktan kuruyor,
   avukatın kendi kimliğiyle UYAP'a bağlanıyor, veri Google Cloud AB'ye
   gidiyor, "tüm hukuki, cezai ve mesleki sorumluluk münhasıran Üye'ye aittir"
   [doğrulandı]. Bu bizim tek net karşıt konumumuzu yok eder. Karşılığı
   **B-19**: izlenen klasör + toplu sürükle-bırak intake. Bağlanmıyoruz,
   sürtünmeyi kaldırıyoruz.
4. **Bulut bağımlılığı yaratmak.** Hiçbir P0/P1 kalemi bulut AI'a bağlı
   değildir; hepsi kural tabanlıdır. Bulut hattı varsayılan KAPALI kalır,
   istek başına onaylıdır (ADR-018) ve `liveTested:false` etiketi bir canlı
   sınama kaydı yazılana kadar durur. Yeni npm paketi, yeni uzak servis,
   `package.json` düzenlemesi yok.
5. **Yanlış eksende parite kovalamak.** Doktrin/literatür havuzu (lisans
   riski; Apilex apilex.legal ile kendi havuzunu kuruyor), mobil uygulama
   (yerel-makine mimarisiyle çelişir; üstelik iki rakibin de mobili zayıf),
   içerik/SEO pazarlaması, kopya-korpus yarışı (Alexi–Fastcase davası,
   GLOBAL). Kapsam manifestosu (**B-14**) bu boşlukları **ilan eder** —
   ilan edilmiş bir boşluk, ölçülemeyen bir kapsam listesinden güçlüdür.
6. **Dürüstlüğü gürültüye çevirmek.** Bugün bir KISMİ cevap ekranında
   11–14 uyarı bloğu / 20–24 cümle var, ikisi birebir tekrar (COPY §4)
   [ölçüldü]. Tekrar eden uyarı okunmayan uyarıdır ve bu üründe uyarı ürünün
   kendisidir. **Tavan: bir cevap ekranında en fazla 4 uyarı bloğu, en fazla
   8 cümle; hiçbir cümle iki kez yazılmaz** (B-27).
7. **Reklam yasağı çizgisini zorlamak ve makine metnini mahkemeye
   göndermek.** TBB Reklam Yasağı Yönetmeliği (09.08.2024 değişikliği)
   karşısında "başarı oranı", "davanızı kazandırır", "%N doğruluk", "en iyi",
   "avukata gerek kalmadan" ifadeleri yasak (TRMARKET) [doğrulandı-ikincil];
   avukat için pazarlama/SEO metni üreten bir şablon **asla** eklenmez.
   Aynı disiplinin ikinci yarısı: dilekçe gövdesine ham kural kimliği
   (`hmk-istinaf`), şema etiketi (`collex.export.evidence-report/v1`),
   "kiracı yüklemesi" ya da "süre hesabını Süreler ekranından doğrulayın"
   gibi uygulama talimatı **girmez** (COPY L18, L25, M1; B-02).

---

## D. Yığın — P0: bir avukat bunlar olmadan ürüne güvenemez

Her kalem: **ne · neden (kanıt) · nasıl · kabul ölçütü · efor · hat ·
bağımlılık**. Efor: S ≈ yarım gün, M ≈ 1–2 gün, L ≈ 3+ gün.

### B-01 · Alıntı bütünlüğü kapısı — paragraf, kanıtın alıntısını hâlâ içeriyor mu?
- **Neden.** UXAUDIT editörde K-1'i ekledi, sonra alıntının **içini**
  değiştirdi (`üç yıldan yedi yıla` → `beş yıldan on yıla`, `MADDE 157` →
  `MADDE 158`): çip kırılmadı, KAYNAKSIZ çıkmadı, `Ctrl+S` → v3 `issues: []`,
  `export?format=md` → **200** ve dosyada uydurulmuş bir ceza "Dayanak [K-1]"
  künyesiyle duruyor [ölçüldü]. Ürünün tek satılabilir vaadi tam burada
  delindi. Kök neden iki katmanda: `composer.ts::evidenceOverlaps` yalnız
  sözcüksel (`QUOTE_OVERLAP_FLOOR 0.7` + sayılar paragrafın herhangi bir
  yerinde) ve Türk mevzuatında süre/ceza **yazıyla** geçtiği için
  `extractNumbers` görmüyor; `export/draft.py::verify_draft_or_refuse` (≈337)
  yalnız `sha256(entry.quote)==entry.quoteSha256` bakıyor, paragrafın
  alıntıyı hâlâ içerdiğine **hiç** bakmıyor.
- **Nasıl.** `control-plane/src/drafting/composer.ts`: bir paragraf
  `evidenceId` taşıyorsa, o kanıtın kanonik alıntısının **NFC-normalize tam
  alt dizgi** olarak paragrafta bulunması aranır (ADR-003: kod noktası
  aritmetiği; `.length`/`.slice` yasak). Bulunmuyorsa paragraf sessizce
  değil, **gerekçeli** olarak KAYNAKSIZ'a düşer: yeni issue kodu
  `QUOTE_ALTERED` + Türkçe "alıntı değiştirildi — kanıt bağı koptu". Aynı
  denetim `export/draft.py::verify_draft_or_refuse` içinde tekrarlanır →
  `EXPORT_REFUSED`. Sözcüksel eşik yalnız **alıntı dışı** cümleler için
  kalır. Konsol linter'ı aynı kuralı aynalar (B-27); sunucu tarafı tek
  başına yeterlidir ve önce gelir.
- **Kabul ölçütü.** `control-plane/tests/drafting/composer.test.ts` +
  `tests/export/test_cli.py`: aynı taslakta (a) alıntı içinde `üç→beş` ve
  (b) `157→158` değişikliklerinin **ikisi de ayrı ayrı** yakalanır;
  `PUT /v1/drafts/{id}` cevabı `issues` içinde `QUOTE_ALTERED` taşır;
  `GET /v1/drafts/{id}/export?format=md|docx|udf` → `EXPORT_REFUSED`,
  **hiçbir dosya yazılmaz**. Bozulmamış taslakta hiçbir davranış değişmez.
- **Efor** M · **Hat** L-EVID · **Bağımlılık** yok.

### B-02 · Dosyalanabilir çıktı: nihai mod, A4, biçim, ek ayrımı, damga temizliği
- **Neden.** DAILYFLOW ölçtü: dava dilekçesi Markdown'ının **%77'si**
  (13 207 B'nin 10 162'si) gövdede hiç atıf yapılmayan SHA-256 eki; DOCX 236
  paragrafın 189'u ek; sayfa **US Letter**; `bold=False` ve `alignment=None`
  **236/236**; ihtarnamenin ortasında mahkemeye özgü "karar verilmesini
  saygıyla arz ve talep ederiz"; avukatın **kendi eliyle** yazdığı HUKUKÎ
  SEBEPLER paragrafına "⚠ KAYNAKSIZ" damgası basılıyor; ek `PUT` ile silinse
  bile sunucu yeniden üretiyor [ölçüldü]. TRMARKET aynı sonuca kodu okuyarak
  vardı (`export/petition.py::_build_footer` her sayfaya banner yazıyor,
  temiz çıkış anahtarı yok) ve ekledi: **UYAP Word/DOCX kabul etmiyor**
  (yalnız .udf/.pdf/.jpg/.png/.tiff; tek dosya 40 MB, ek 5 evrak)
  [doğrulandı-ikincil]. Sonuç: ürün bugün mahkemeye gönderilebilir tek bir
  belge üretemiyor.
- **Nasıl.** `GET /v1/drafts/{id}/export` iki additive parametre (varsayılan
  = bugünkü davranış, kırıcı değil): `annex=full|none`, `marks=all|none`.
  `annex=none` gövdeyi tek başına verir; kanıt/hash paketi **ayrı** dosya
  (mevcut `export/bundle*.py`). `marks=none` yalnız ekran işaretlerini
  (`⚠ KAYNAKSIZ —` ön eki, `Not: KAYNAKSIZ …` satırı) çıkarır; **doğrulama
  zorunluluğu ve `EXPORT_REFUSED` aynen kalır** (tuzak §C.2).
  `export/petition.py`: `page_width = Cm(21)`, `page_height = Cm(29.7)`;
  mahkeme hitabı `CENTER`, imza bloğu `RIGHT`, gövde `JUSTIFY`, TARAFLAR
  etiketleri `bold`; aynı sadakat `export/udf.py` ve Markdown'da (üç çıktı,
  tek biçim sözleşmesi). `export/text.py`/appendix: **"kiracı yüklemesi" →
  "yüklediğiniz belge"** (COPY M1 — "tenant" veritabanı terimi, kira
  dosyasında karşı taraf anlamına geliyor); `collex.export.evidence-report/v1`
  gibi şema etiketleri okunur metinden çıkar. Dosya adı ayrımı:
  `… - TASLAK.docx` / `… - NİHAİ.udf`. Konsolda UYAP uyarısı (B-27):
  "UYAP yalnız .udf/.pdf/.jpg/.png/.tiff kabul eder; Word yüklenemez."
- **Kabul ölçütü.** `annex=none&marks=none` DOCX python-docx ile okunduğunda:
  `page_width` 21 cm; mahkeme hitabı `CENTER`; en az bir `bold=True` run;
  `"⚠ KAYNAKSIZ"`, `"kiracı yüklemesi"`, `"collex.export."` ve `hmk-istinaf`
  gibi kural kimlikleri **0 kez**; gövde/ek oranı ≥ %90 gövde; çıktı ≤ 40 MB.
  `annex=full&marks=all` bugünkü baytların birebir aynısı (regresyon).
  Doğrulanamayan atıf içeren taslakta `marks=none` de `EXPORT_REFUSED` verir.
- **Efor** M · **Hat** L-EVID (kapanış cümlesi sözleşmesi L-LEGAL ile) ·
  **Bağımlılık** B-01 (aynı export yolu; B-01 önce iner).

### B-03 · Yedekleme ve geri yükleme
- **Neden.** Üç hat bağımsız olarak aynı sonuca vardı: `pg_dump`/`yedek`/
  `backup` ürün kodunda **sıfır** geçiyor (ENGRISK E1, ARCH S1/F3, FEATURE
  F2) [ölçüldü]. Dosyalar, her taslak sürümü, süreler ve yüklenen asıllar tek
  diskte, tek kümede; `var/uploads/` **deponun içinde**. Disk arızası, yanlış
  `scoop uninstall -p postgresql`, fidye yazılımı ya da klasörün taşınması
  her şeyi götürür. "Verileriniz bu bilgisayarda" cümlesi yedek olmadan yarım
  bir sözdür ve müvekkil dosyasının korunması özen borcudur.
- **Nasıl.** ENGRISK §3'teki iki `.cmd` betiği birebir uygulanabilir; komutlar
  bu makinede ölçüldü (`pg_dump -Fc` 0,17–0,22 sn; `pg_restore` exit 0; geri
  yüklenen DB'de 54 indeks / **17 RLS politikası** / 74-74 dolu
  `search_tsv_tr`). Yeni: `ColleX-Yedekle.cmd`, `ColleX-Geri-Yukle.cmd`
  (repo kökü). Pazarlık edilemez tasarım kararları: geri yüklemede **önce
  `alter database collex_local rename to collex_local_eski`**, asla `drop`;
  `pg_restore --exit-on-error`; `robocopy /E` asılları **birleştirir**,
  silmez; doğrulama satırı `pg_policies` sayısını da basar (B-05'e emniyet
  ağı). Ayarlar'da "Yedek al" → `POST /v1/backup` (loopback, B-04'ün ara
  katmanı arkasında, `execFile` + argüman dizisi, shell yok) →
  `{path, sizeBytes, files, at}`. `/v1/health` additive
  `backup: {lastAt, sizeBytes} | null`. Zorunlu uyarı: *"Bu klasör müvekkil
  verisi içerir — şifreli bir diske koyun."* PITR/WAL arşivleme,
  `pg_basebackup` ve otomatik zamanlanmış görev **yapılmaz**.
- **Kabul ölçütü.** 1 dosya + 1 belge + 1 taslak (v2) + 1 süre içeren
  `collex_local` yedeklenir; küme sıfırdan kurulur; geri yükleme sonrası
  `/v1/health` `migrations 11/11` **ve** `rls.present == rls.expected` der;
  `GET /v1/matters` aynı dosyayı, `GET /v1/files/{id}` aynı `sha256`'yı,
  `GET /v1/drafts/{id}/versions` aynı `[1,2]` listesini döndürür. Yedek
  alınırken `collex_local`'a **yazılmaz**. Ayarlar'da "Son yedek" satırı
  7 günden eskiyse turuncu, hiç yoksa kırmızı.
- **Efor** M · **Hat** L-SAFE · **Bağımlılık** B-34 ile aynı hatta.

### B-04 · `localGuard`: CSRF + `Host` denetimi + güvenlik başlıkları
- **Neden.** ENGRISK **gerçek isteklerle kanıtladı** (port 8934):
  `POST /v1/matters` + `Origin: https://evil.example` + `content-type:
  text/plain` → **201**, kayıt gerçekten oluştu; `POST /v1/files` multipart →
  **200**, belge avukatın korpusuna girdi; `Host: evil.example` → **200**
  [ölçüldü]. `text/plain` ve `multipart` CORS-safelisted olduğu için tarayıcı
  preflight yapmaz. Ağırlaştırıcı: `/v1/ai/*` de erişilebilir ve ADR-018'in
  "istek başına onayı" gövdedeki `useCloudAi:true` alanıdır — **saldırgan
  onu kendisi yazar**, yani müvekkil belgesi avukatın bilgisi olmadan
  Anthropic'e gidebilir ve parası harcanır (B-23 ile birlikte sınırsız).
  `Host` denetimsizliği DNS rebinding ile **okuma** açar: yabancı bir sayfa
  `/v1/answers?texts=true` ve `/v1/settings`'i okuyabilir — bu, yazma
  riskinden ağırdır.
- **Nasıl.** Yeni `control-plane/src/api/localGuard.ts`, `createApp`'te ilk
  `app.use("*", …)` (ENGRISK §7.3'te tam kod): (1) `host` başlığı
  `127.0.0.1|localhost|::1` değilse `421`; (2) durum değiştiren metotlarda
  yabancı `Origin` **veya** `Sec-Fetch-Site != same-origin|none` ise tipli
  `403 FORBIDDEN_ORIGIN` + Türkçe mesaj; (3) `/v1/*` cevaplarına
  `cache-control: no-store`, `x-content-type-options: nosniff`,
  `referrer-policy: no-referrer`. `Origin` göndermeyen yerel betikler
  etkilenmez. Konsolun hash-sabitli CSP'si **değiştirilmez**.
- **Kabul ölçütü.** `control-plane/tests/api.test.ts` üç yeni test: yabancı
  `Host` → 421; yabancı `Origin` + POST → 403 **ve pipeline hiç çağrılmadı**
  (sahte port çağrı sayacı 0); `Origin`'siz POST → normal.
  `GET /v1/answers/{runId}/evidence-bundle` cevabı `cache-control: no-store`
  taşır. `console.test.ts` yeşil kalır.
- **Efor** S — **en yüksek getiri/maliyet oranı** · **Hat** L-SAFE ·
  **Bağımlılık** yok.

### B-05 · Ledger: çoklu sentinel + `policy:` kind + `/v1/health rls` + advisory lock
- **Neden.** ENGRISK `collex_ledger_probe` üzerinde **kanıtladı**: bir
  migration'ın ilk 228 satırı uygulanıp RLS bloğu (229–283) uygulanmazsa,
  probe hedefi dosyanın ortasında yaratıldığı için bootstrap dosyayı
  "uygulanmış" sayar → avukatın dosyalarını, cevaplarını, taslaklarını tutan
  **beş `app_private` tablosu RLS'siz ve politikasız kalır**, `--ensure-db`
  bir daha o dosyayı asla uygulamaz ve `/v1/health` `migrations 11/11` der
  [ölçüldü]. Aynı sınıf `20260826060000_rls.sql`'de (probe satır 51,
  politikalar 73–281) ve `20260826010000`'de (probe `extension:btree_gist` —
  üstelik başka bir araç da kurmuş olabilir). Bu, CLAUDE.md'nin ADR-011
  satırının ("that was a P0 leak") engellemek için var olduğu sınıftır ve yol
  erişilebilir: `collex_demo`'da `schema_migrations` tablosu **yoktur**, yani
  demo/probe veritabanları her `/v1/health`'te bu bootstrap yolunu kullanıyor.
- **Nasıl.** (a) `ingestion/migrations.py`: `ledger_sentinel` →
  `ledger_sentinels() -> list[str]`; bootstrap **hepsi** çözülürse kaydeder;
  her dosyaya en az ilk ve **son** yarattığı nesne için birer probe.
  (b) Yeni kind `policy:<schema.table>.<name>` (`pg_policies`) — SQL CASE'e
  tek `when`, **iki runtime'da da** (`store/health.ts` aynı CASE'i çözer).
  (c) `20260826010000`'in probe'u dosyanın **son** yarattığı nesneye çevrilir.
  (d) `/v1/health` additive `rls: { expected, present }` (tam bir
  veritabanında **17**). (e) `apply_missing_migrations` başında
  `pg_advisory_lock(hashtext('collex.migrations'))` — iki eşzamanlı
  `--ensure-db` `create type … enum` üzerinde çakışıyor (E12a).
  CLAUDE.md invaryant satırı da güncellenmeli (B-46).
- **Kabul ölçütü.** `tests/ingestion/test_migrations_ledger.py`: (1) her
  runnable dosyanın probe hedeflerinden en az biri, dosyadaki **son**
  `create/alter/grant` ifadesinden sonra gelen nesneyi adlandırır; (2) yarım
  uygulanmış `20260902120000` senaryosunda bootstrap o dosyayı **kaydetmez**
  ve `--ensure-db` onu uygular; (3) eşzamanlı iki `--ensure-db` boş bir
  veritabanında ikisi de exit 0. `persistence.test.ts` gerçek PG ile
  `rls.present == 17` doğrular.
- **Efor** M · **Hat** L-SAFE · **Bağımlılık** B-12 (CI'da koşabilmesi için).

### B-06 · Trigram şeridi indeksi kullansın (`<%`) + sorgu planı testi
- **Neden.** ENGRISK 20 055 parçalık probe DB'de ölçtü: `POST /v1/answer`
  **45,0–45,9 sn**, durum `ABSTAIN`, `evidence: []`, üç `warning`:
  `RETRIEVAL_LANE_DEGRADED: lane trigram failed: canceling statement due to
  statement timeout` [ölçüldü]. Aynı sunucu `collex_demo` (55 parça) ile
  0,096–0,169 sn — sorun sorgu seçiciliği değil, **korpus boyutu**. Kök neden
  `chunkStore.ts:611-628`: `extensions.word_similarity(q, c.search_text) >= t`
  bir **fonksiyon çağrısıdır, indekslenemez**; `chunks_search_trgm` GIN
  indeksi var ve kullanılmıyor (dosyanın kendi yorumu 606–609 doğru formu
  tarif ediyor). `EXPLAIN ANALYZE`: bugünkü form `Seq Scan` **17 146 ms**,
  `<%` + `order by score desc limit 24` `Bitmap Index Scan` **1,56 ms** —
  ~11 000×, şema değişikliği yok, indeks zaten var. Bugün ölçekte ürünü
  kullanılamaz yapıyor **ve** arayüzde "korpusta karşılık yok" gibi okunuyor.
  B-20 (yerel kütüphane) bu düzeltilmeden ürünü bozar.
- **Nasıl.** `chunkStore.ts::trigramSearch`: `WHERE`'e
  `${queryText} operator(extensions.<%) c.search_text`; eşik aynı bağlantıda
  `set_config('pg_trgm.word_similarity_threshold', ${minSimilarity}::text,
  true)` (işlem-yerel); `word_similarity(...)` yalnız SELECT listesinde skor
  için kalır; `ORDER BY score DESC` korunur (LIMIT'li erken çıkış
  planlayıcıyı yanıltıyor — ölçüldü). `RETRIEVAL_LANE_DEGRADED` konsolda
  **görünür** uyarı olur (B-27).
- **Kabul ölçütü.** `control-plane/tests/store/retrieval.test.ts`: ≥2000
  sentetik parça yüklenir, `explain (format json)` alınır ve planda
  `chunks_search_trgm` geçtiği **iddia edilir** (bugün hiçbir test planı
  denetlemiyor — gerileme bu yüzden fark edilmedi); sonuç kümesi bugünküyle
  aynı kalır.
- **Efor** S — **en yüksek getiri/maliyet oranı** · **Hat** L-ANSWER ·
  **Bağımlılık** yok.

### B-07 · Çıplak kanun atfı çekimserliği devirmesin
- **Neden.** DAILYFLOW mekanizmayı kontrol sorularıyla izole etti: "kira
  sozlesmesinde depozito iadesi ne zaman yapilir" → doğru şekilde
  **ÇEKİMSER**; aynı soruya **"tbk ya gore"** eklenince → **KISMİ, 8 kanıt,
  6 tespit, 3'ü DESTEKLENİYOR**, hepsi haksız fiil/tazminat maddeleri,
  `coverage.ratio 0`, eksik sözcükler `kira, sozlesmesinde, depozito,
  iadesi, gore`. Aynısı "TCK bakımından işyerinde mobbing suç mudur?" →
  7 tespit (yağma, hırsızlık, dolandırıcılık), mobbing hakkında sıfır
  [ölçüldü]. Mekanizma `chunkStore.ts::exactPinLookup` başlığında yazılı:
  *"legislation refs alone → all chunks of that legislation"* → madde
  numarasız atıf **bütün kanunu** sabitliyor → `bypassed-by-reference` →
  `admitUnderReferenceBypass` sabitli pasajı hak olarak kabul ediyor, ve
  burada **her pasaj sabitli**. Bir Türk avukatı her cümlede "TBK'ya göre",
  "HMK uyarınca" yazar; yani bu, ürünün en güçlü özelliğini en sık kullanılan
  cümle kalıbında kapatıyor. UXAUDIT'in "%100/%100/%0" ölçek tablosu bunun
  görünen yüzü.
- **Nasıl.** `answer/coverage.ts` + `pipeline/answerPipeline.ts`: bypass
  **atıf çözünürlüğüne** bağlanır. Madde/karar düzeyi atıf (`ParsedReference`
  madde veya E./K. taşıyor) bugünkü davranışını korur; **çıplak kanun atfı**
  sabitlemeyi sürdürür ama pasajlar **yine de** pasaj pasaj kabulden geçer;
  hiçbiri geçmezse `ABSTAIN` + mevcut `QUESTION_NOT_COVERED`. Kapı değeri
  (`0.4`) değişmez — değişen, hangi pasajın kapıyı atlayacağıdır (§C.2).
- **Kabul ölçütü.** `tests/answer/coverage.test.ts` + `answerHonesty.test.ts`:
  (a) "depozito iadesi … **tbk ya gore**" fixture'ı **ABSTAIN** ve
  `evidence: []`; (b) "TBK m.49 uyarınca haksız fiil şartları" (madde düzeyi)
  bugünkü kanıtlı davranışını **aynen** korur; (c) mevcut P0-1 pasaj pasaj
  kabul testlerinin dördü de yeşil.
- **Efor** M · **Hat** L-ANSWER · **Bağımlılık** yok.

### B-08 · Uzun/olgu içeren soruda kapsam kapısı hukukî soruya uygulansın
- **Neden.** DAILYFLOW: aynı hukukî soru iki cümlelik hâliyle 8 kanıt ve iki
  Yargıtay kararı getiriyor; **1 178 karakterlik gerçek olay örgüsü hâlinde
  1 kanıt, 0 içtihat**, `QUESTION_NOT_COVERED:7`, `coverage.ratio 0,07`
  [ölçüldü]. Kapsam kapısı bütün soru metnine karşı sözcüksel olduğu için
  ~80 lexemeli bir anlatıda hiçbir pasaj tabanı geçemiyor. Bir avukat soruyu
  **olayla birlikte** sorar; ürün bugün tam olarak bu davranışı cezalandırıyor.
- **Nasıl.** `pipeline/questionIntent.ts`: uzun sorularda (eşik sabit ve
  belgelenmiş) hukukî soru çıkarımı — soru işaretli cümle(ler) + son cümle +
  ayrıştırılan atıflar `legalQuestion` olarak ayrılır; `answer/coverage.ts`
  kapsamı **o metin üzerinden** ölçer; olay metni yalnız sıralama sinyali
  olarak `retrieve`'e gider. `CoverageView`'a additive
  `measuredOn: 'soru' | 'soru+olay'` ve konsolda tek satır.
- **Kabul ölçütü.** Aynı hukukî sorunun kısa ve 1 000+ karakterlik uzun
  biçim fixture'ı: uzun biçimin kanıt sayısı kısa biçimin **en az %70'i** ve
  durum aynı sınıfa düşer; `measuredOn` cevapta görünür; kısa sorularda kod
  yolu ve sonuçlar **birebir** değişmez.
- **Efor** M · **Hat** L-ANSWER · **Bağımlılık** yok.

### B-09 · Zamansal soru: `COMPLETE` yasağı + sürüm karşılaştırması
- **Neden.** DAILYFLOW: `asOf 2024-06-01` + "2024'te işlenen suçta 2026
  öncesi mi sonrası mı uygulanır?" → yalnız v1 metni geldi; **7999 sayılı
  değişiklikten, iki metnin farkından ve lehe kanun ölçütünden tek kelime
  yok**; durum **TAM + KESİNLEŞTİRİLEBİLİR** [ölçüldü]. As-of, iki rakipte
  karşılığı olmayan başlık özelliğimiz; bu hâliyle sessizce yanlış cevap
  veriyor — hem de "kesinleştirilebilir" diyerek.
- **Nasıl.** `pipeline/questionIntent.ts`: `asOf` verilmişse **veya** soruda
  zamansal işaretleyici varsa (`öncesi|sonrası|tarihinde|yürürlük|hangisi
  uygulanır`) niyet `TEMPORAL` olur. `answer/verifier.ts`: `TEMPORAL`
  niyetinde cevap, ilgili maddenin **birden fazla sürümünü** ve varsa
  değiştiren kanunu (`legal.document_relations`, ADR-012 — veri zaten var)
  yan yana göstermiyorsa durum **asla `COMPLETE` olamaz**: `QUALIFIED` +
  yeni gerekçe `TEMPORAL_COMPARISON_MISSING` + Türkçe cümle ("Sorulan tarih
  için hangi metnin uygulanacağı karşılaştırılmadı"). Sürümler bulunuyorsa
  cevap kartında "Sorulan tarihte yürürlükte olan metin" / "Sonraki metin"
  ayrımı ve değiştiren kanunun künyesi.
- **Kabul ölçütü.** `tests/pipeline/answerPipeline.test.ts`: TCK m.157 v1/v2
  fixture'ında `asOf 2024-06-01` sorusu **`COMPLETE` dönmez**; iki sürüm de
  kanıt olarak listelenir ve değiştiren kanun künyesiyle görünür;
  karşılaştırma yapılamadığında `TEMPORAL_COMPARISON_MISSING` cevapta ve
  dışa aktarımda birebir yer alır. Zamansal olmayan sorularda değişiklik yok.
- **Efor** M · **Hat** L-ANSWER · **Bağımlılık** yok.

### B-10 · Sessiz yükleme hatası + çift tık ikizi + ölü aktif dosya
- **Neden.** Üç UXAUDIT bulgusu, hepsi günlük kullanımın ilk adımında:
  (a) **P0-2** — taranmış tebligat PDF'i dosya sayfasından yüklendiğinde
  ekranda **hiçbir şey olmuyor**: `console.html:3771 uploadFiles()` hata
  kartını `#fileerrors`/`#filelist` içine, yani **gizli** `#view-belgeler`e
  yazıyor; `:3786` `if (okCount)` yüzünden hiçbiri başarılı olmazsa bildirim
  de çıkmıyor; kısmî başarıda **yeşil** "1/2 belge yüklendi" çıkıyor,
  başarısız dosyanın adı ve nedeni hiç geçmiyor. Hata metninin kendisi
  mükemmel yazılmış — yalnız görünmüyor; tebligat neredeyse her zaman
  taramadır. (b) **P1-2** — "Dosyayı aç" formu korumasız: çift tık **iki
  özdeş dava dosyası** yarattı (`Ara ve doğrula` korumalı, 3 tık → 1 POST).
  (c) **P1-3** — üst çubuk seçicisi **6 dosya** listeledi, `GET /v1/matters`
  **2** döndürdü, ölü kimlik seçilince localStorage'a yazıldı ve **sonraki
  her araştırma `MATTER_NOT_FOUND` ile düştü**; konsol ölü seçimi silmiyor,
  404'ü sessizce yutuyor [ölçüldü].
- **Nasıl.** `console.html` (L-CONSOLE, tek sahip): `uploadFiles` sonucu
  **çağıran görünüme** bildirilir (`opts.onError` + görünür hata kartı);
  `okCount === 0` hâlinde `tone:'bad'`; kısmî başarıda başarısız dosyanın
  **adı + nedeni** bildirimde. Bütün kayıt formlarına gönderim sırasında
  `disabled` + tekrar-gönderim kilidi; oluşturmada "aynı başlık/esas no ile
  açık dosya var" uyarısı. Üst çubuk seçicisi `GET /v1/matters` sonucuyla
  **budanır**; `MATTER_NOT_FOUND` alınınca aktif dosya temizlenir ve tek
  Türkçe cümleyle söylenir.
- **Kabul ölçütü.** `console.test.ts`: hata yolunda `#toast` `tone:'bad'` ve
  dosya adı geçer; `okCount===0` bildirimsiz kalmaz; form `submit` sırasında
  `disabled` atanır; seçici listesi yalnız `GET /v1/matters` kimliklerini
  içerir; `MATTER_NOT_FOUND` sonrası aktif dosya anahtarı temizlenir.
- **Efor** M · **Hat** L-CONSOLE · **Bağımlılık** yok.

### B-11 · İki yanlış süre kuralı + 30 kuralın madde metniyle doğrulanması
- **Neden.** COPY hattı denetim günü mevzuat.gov.tr'ye `yargi-mevzuat` MCP
  ile **erişebildi** ve altı kuralı madde metniyle karşılaştırdı; **ikisi
  yanlış çıktı** [doğrulandı]: (1) `iik-icra-mahkemesi-istinaf` "10 gün,
  tefhimden" diyor; İİK m.363/1 **7499 s.K. (yür. 01.06.2024)** ile "iki
  hafta, **tebliğ tarihinden**" oldu ve "tefhim veya" ibaresi madde
  metninden **çıkarıldı**; aynı yanlış sayı `hmk-istinaf` notunda tekrar
  ediyor. (2) `hmk-islah` notu "davanın her aşamasında bir kez" diyor;
  m.176/2 birebir "**Aynı davada, taraflar ancak bir kez**" — ıslah hakkını
  **çoğaltan** bir yanlış. m.363/1 notu ayrıca kapsamı **ters** okuyor ve
  parasal sınırı hiç anmıyor. Bir kural motorunda en pahalı hata türü budur:
  yanlış olan sonuç değil **dayanak cümlesidir**, ve avukat dayanağı okuyup
  güvenir. STATUS S12'nin "ağ yoktu" gerekçesi artık geçerli değil; TRMARKET
  ekliyor: doğrulanmamış bir takvime avukat davasını emanet etmez, yani
  ürünün en çok para eden yeteneği bugün kullanılamaz durumda.
- **Nasıl.** `control-plane/src/deadlines/rules.ts` (L-LEGAL, tek sahip):
  COPY §3'teki hazır kayıt (18 madde) doğrudan uygulanır — L1–L4, L29–L33.
  Kalan kurallar aynı yolla (`search_within_kanun` / `get_mevzuat_content`)
  doğrulanır; `verified` **yalnız madde metni elde varken** `dogrulandi`
  olur ve `verified.source` çekilen ibareye + erişim tarihine atıf yapar
  (test "ağ yoktu" kaynağını reddediyor). Doğrulanamayan kural
  `dogrulanmadi` kalır — bu bir başarısızlık değil, sözleşmenin kendisidir.
  `DEADLINE_DISCLAIMER`'da "**uygulama** sorumlu değildir" → "**ColleX
  sorumlu değildir**" (COPY L31: hukuk Türkçesinde "uygulama" = yerleşik
  içtihat). Ham kural kimlikleri (`'ozel'`, `'is-ise-iade-dava'`) kullanıcı
  metninden çıkar (L32, L33). Eksik yüksek frekanslı kurallar eklenir:
  **HMK m.281 bilirkişi raporuna itiraz (2 hafta)**, HMK m.94, m.140, m.318;
  İİK m.78, m.128/a (7 gün), m.134 (7 gün), m.269 (7 gün); TBK m.315 (30
  gün), m.352 (1 ay); TMK m.606 (3 ay). Adli tatil kutusu **üç durumlu**
  olur (`adliTatileTabi: true|false|'belirsiz'`): HMK m.104 uzatması yalnız
  adli tatile **tâbi** işlerde ve yalnız son gün tatile rastlarsa geçerlidir;
  bugünkü kural bazında ön-işaretlilik **güvensiz tarafta** hata üretiyor
  (TRMARKET) [doğrulandı-ikincil]. `'belirsiz'`te iki tarih birden gösterilir.
- **Kabul ölçütü.** `GET /v1/deadlines/rules` sayısı ≥ 40;
  `verified.status === 'dogrulandi'` olan her kuralın `verified.source`'u
  madde adı + erişim tarihi taşır ve `tests/deadlines/rules.test.ts`
  kaynaksız `dogrulandi`'yı reddeder; `iik-icra-mahkemesi-istinaf` 2 hafta/
  tebliğ döner; `hmk-islah` notu "ancak bir kez" der; yeni
  `DEADLINE_DISCLAIMER` her cevapta, kartta, çıktıda ve (B-17 sonrası) her
  `.ics` açıklamasında **birebir** geçer; `adliTatileTabi:'belirsiz'` iki
  tarih döndürür.
- **Efor** L · **Hat** L-LEGAL · **Bağımlılık** yok.

### B-12 · CI'ya PostgreSQL 18 + venv — kalıcılık katmanı bugün CI'da hiç koşmuyor
- **Neden.** ENGRISK: `ci.yml` `control-plane` işi `services:` bloğu, Python
  ve venv içermiyor; `tests/store/testDb.ts:125 requireScratchPostgres()`
  **skip etmez, `throw` eder** — yani iş ya kalıcı olarak kırmızıdır ya hiç
  yeşile ulaşmamıştır. Dahası, ortam-atlamalı dört süit (`real-export`,
  `store/persistence`, `integration/serve`, `integration/real-exec`) CI'da
  **her zaman** atlanıyor ve bu dördü `PgAnswerStore`/`PgDraftStore`/
  `PgMatterStore`/`PgSettingsStore`'un — avukatın verisini tutan katmanın
  tamamının — tek testidir (`grep`: bu adlar yalnız `persistence.test.ts`'te
  geçiyor). Sonuç: geçen dalganın **P0-2'si tam korumalı değil** (asıl hata
  FK 23503'tü, onu yalnız gerçek-PG testi kanıtlıyor) ve B-05'in sınıfı
  CI'da yakalanamaz [ölçüldü].
- **Nasıl.** ENGRISK §E9'daki hazır YAML: `postgres:18` servisi
  (`POSTGRES_HOST_AUTH_METHOD: trust`, port 55432, healthcheck) +
  `actions/setup-python@v5` + venv kurulumu. `eval-gate` işi zaten bir
  `postgres` servisi kuruyor — kalıp hazır (port/sürüm hizalanır).
  `ci.yml` **tamamen offline kalır**.
- **Kabul ölçütü.** `control-plane` işinde 4 atlama 4 **koşuya** döner ve
  `npm test` çıktısında dördü de koşmuş görünür; B-05'in yarım-migration
  testi CI'da yeşil.
- **Efor** S · **Hat** L-SAFE · **Bağımlılık** yok.

---

## E. Yığın — P1: bizi Apilex ve De Jure yerine seçtiren şeyler

### B-13 · Atıf Denetim Raporu + karşı tarafın dilekçesinin toplu denetimi
- **Neden.** Bu dalganın **tek numaralı farklılaştırıcısı**. Dört hat
  bağımsız olarak aynı yere işaret etti: (a) GLOBAL — Clearbrief'in Cite
  Check Report'u tam olarak bu ve solo fiyatı 300 USD/ay; değeri atıf listesi
  değil, "her sorunu kimin, nasıl, hangi notla ele aldığı"nın dosyada
  kalması, yani **dosyalama öncesi gereken özenin kalıcı kaydı**
  [doğrulandı]; Charlotin'in AI Hallucination Cases veritabanı 11.08.2026'da
  **1 871 kayıt** ve yaptırım kayıtlarındaki tek tutarlı örüntü, gereken
  özeni kanıtlayabilen avukatın daha az ceza almasıdır [üçüncü taraf].
  (b) TRMARKET — Kızılcahamam/Ankara, 20.06.2026: 25 yıllık bir avukatın
  AI'ya yazdırdığı dilekçedeki Yargıtay künyeleri uydurma çıktı, savcılık
  **ve** Ankara Barosu soruşturma açtı [doğrulandı-ikincil]. (c) DEJURE —
  "Dilekçe Analizi" 6.800 ₺/ay'lık kalemin kendisi. (d) FEATURE/ARCH —
  bütün parçalar bizde çalışıyor, **paketlenmiş akış yok**.
- **Nasıl.** Belge sayfasına tek düğme: "**Bu dilekçedeki bütün atıfları
  denetle**". `intake/analysis.py::extract_references` (FIX-2 ile
  tekilleştirilmiş, `count`'lu) çıktısı sırayla `POST /v1/answer`'a gider;
  **`asOf` = dilekçenin tarihi** (bugün `console.html:8340-8346` `asOf`
  göndermiyor — bu kusur burada kapanır). Sonuç tablosu: atıf · bulundu/
  bulunamadı/belirsiz (**üç kova**, GLOBAL: eyecite kalıbı — "bulunamadı"
  uydurma uyarısı, "belirsiz" kapsam sorunudur, bugün arayüz ikisini
  ayırmıyor) · dilekçe tarihi itibarıyla yürürlük · varsa aksi yöndeki karar ·
  tam metne git. Yeni dışa aktarım hedefi:
  `GET /v1/drafts/{id}/export?format=denetim-docx` ve cevap için eşdeğeri
  (`format` enum'una **additive**). Rapor satırları: atıf · bulundu mu ·
  alıntı hash'i doğrulandı mı · as-of yürürlük · aleyhe kayıt · inceleyen/
  tarih/not · **yeniden doğrulama tarifi** (mevcut `export/bundle*.py`
  sözleşmesi). Kural tabanlı; bulut gerekmez.
- **Kabul ölçütü.** En az 5 atıf içeren sentetik bir dilekçe yüklenir; tek
  istekle 5 satırlık tablo üretilir; her satırın yürürlük rozeti **dilekçe
  tarihine** göredir; bulunamayan atıf açıkça "bulunamadı" der ve **asla
  uydurulmuş bir künye gösterilmez**; rapor DOCX olarak iner ve içindeki her
  alıntı `export/` doğrulamasından geçer (geçmezse dosya yazılmaz).
- **Efor** M · **Hat** L-EVID (uç + rapor) + L-CONSOLE (düğme + tablo) ·
  **Bağımlılık** B-01; sonucun güçlü olması için B-15/B-20.

### B-14 · Kapsam manifestosu — "neyi tarıyoruz, neyi taramıyoruz"
- **Neden.** İki rakip de kapsamı **sayıyla** satıyor ve ikisi de
  çelişiyor: Apilex `/tr/platform` "12 milyondan fazla", Play "11 milyondan
  fazla" ve `/tr/ictihat-arama-motoru` kapsamı sayısız olarak "AİHM +
  ilk derece + kurul" diye genişletiyor [çıkarım]; De Jure **hiçbir yüzeyde**
  korpus büyüklüğü, güncellik tarihi veya tazeleme sıklığı yayımlamıyor ve
  yerine otorite argümanı kullanıyor ("üniversite kütüphanelerinde yer
  almaktadır") [doğrulandı — yokluk]. Sayı yarışına girmeden kazanılacak tek
  yer burası; ayrıca UXAUDIT'in ve TRMARKET'in ortak bulgusu olan "neden
  sonuç yok?" sürprizini de ortadan kaldırır. COMPETITIVE.md §2 kalem 8 bunu
  zaten yol haritası olarak işaretlemiş; veri hazır, **sayfa yok**.
- **Nasıl.** Yeni görünüm `#kapsam` (Ayarlar › Sistem durumu'nun genişlemiş
  hâli): kaynak başına **canlı durum + son başarılı erişim zaman damgası +
  bilinen boşluklar**. Veri: `check_government_servers_health`,
  `GET /v1/research/health` (`state`), `GET /v1/health` (`corpus`, `mcp`,
  `db`, `migrations`, yeni `rls`, yeni `backup`). Yeni
  `GET /v1/sources/manifest` bunları tek cevapta birleştirir + statik
  "bilinen boşluklar" listesi: **AİHM/HUDOC kapsamda değildir** (grep:
  `aihm|echr` → 0 sonuç); **doktrin/literatür taranmaz**; **Reklam Kurulu ve
  RTÜK yoktur**; ilk derece yalnız Emsal şeridi üzerinden ve ölçülmemiştir;
  yerel korpus varsayılan kurulumda **boştur** (B-20'den önce). Hiçbir hücre
  sayı uydurmaz; ölçülmeyen alan "ölçülmedi" der.
- **Kabul ölçütü.** `GET /v1/sources/manifest` her kaynak için `{id, ad,
  durum, sonErisim|null, notlar}` döndürür; ekranda sayı olan tek hücreler
  `/v1/health`'ten gelenlerdir; "bilinen boşluklar" bölümü en az beş satır
  taşır; `console.test.ts` "AİHM kapsamda değildir" cümlesini birebir
  doğrular; sayfa MCP kapalıyken de açılır ve durumu "kapalı" der.
- **Efor** M · **Hat** L-SOURCES (uç) + L-CONSOLE (ekran) · **Bağımlılık**
  B-03/B-05 (`backup`/`rls` alanları) — yoksa alanlar atlanır.

### B-15 · Ölü MCP hatlarını aç: Emsal, Uyuşmazlık, `WITHIN_BY_TYPE` + erişilebilirlik testi
- **Neden.** FEATURE 28, ARCH 29 aracın **hiçbir kod yolundan çağrılmadığını**
  ölçtü (ikisi aynı olguyu farklı sayıyor; ikisi de listeledi). Üçü ürün
  kusuru: (G1) `search_uyusmazlik_decisions` planlanıyor ama
  `FETCH_BY_PROVIDER`'da `UYUSMAZLIK` **yok** — arama özeti kanıt
  sayılmadığı için (doğru kural) **bulunan Uyuşmazlık kararı hiçbir cevaba
  giremiyor**, arama bütçesi boşa gidiyor; `get_uyusmazlik_document_markdown_from_url`
  kayıtlı ve kullanılmıyor (~10 satırlık düzeltme, **bütün bir mahkemeyi
  geri açıyor**). (G2) `search_emsal_detailed_decisions` hiçbir şablonda
  planlanmıyor → EMSAL isabeti hiç üretilmiyor → fetch aracı da ölü; oysa
  Emsal, bir İzmir solo litigatörünün **yerel mahkeme + istinaf** içtihadını
  bulduğu katmandır. (G3) `statuteRead` yalnız `search_within_kanun`
  çağırıyor → yönetmelik, tebliğ, KHK, CBK **bulunuyor ama içi okunamıyor**.
- **Nasıl.** `planner/templates.ts`: `FETCH_BY_PROVIDER`'a
  `{ toolName: "get_uyusmazlik_document_markdown_from_url", idParam:
  "document_url" }`; `mevzuat_amendment_ictihat` ve
  `yargitay_danistay_contrary` birincil fazlarına bir `mkCall
  search_emsal_detailed_decisions`; `WITHIN_BY_TYPE` tablosu (`mevzuat_tur`
  → ilgili `search_within_*`), `FETCH_BY_PROVIDER` ile birebir paralel.
  Ayrıca ARCH'ın iki ucuz isabet düzeltmesi: `bedestenInput`'a
  `kararTarihiStart` (bugün yalnız `kararTarihiEnd: asOf` var — her içtihat
  şeridi geriye **sınırsız**, torba kanunla yeniden yazılan bir hükümde en
  pahalı retrieval kusuru) ve `gapQueryForIssue`'nun sabit `"emsal karar"`
  ibaresini kaldırmak (Bedesten token'ları AND'lediği için round-2 sorgusu
  round-1'den **daha dar** oluyor). **Tool yüzeyi 54'te sabit kalır** — hiçbir
  araç eklenmiyor, yalnız var olanlar bağlanıyor.
- **Kabul ölçütü.** Yeni `tests/planner/reachability.test.ts`: 54 aracın
  **tamamı** `REACHABLE` veya `NOT_YET_WIRED` olarak sınıflanır, ikincisinin
  her satırı tek cümlelik gerekçe taşır ve `REACHABLE` sayısı ≥ 30; sahte
  gateway ile bir Uyuşmazlık isabeti **kanıta dönüşür**; bir Emsal araması
  planlanır; `mevzuat_tur='yonetmelik'` bir isabette
  `search_within_kurum_yonetmelik` çağrılır. `smoke_check.py` **54** kalır.
- **Efor** M · **Hat** L-SOURCES · **Bağımlılık** yok.

### B-16 · "Karar ara" ekranı — 54 aracın üstünde gerçek arama
- **Neden.** FEATURE'a göre ürünün **en zayıf halkası**: araştırma tek bloklu
  serbest metin sorusu, canlı tavan **6 tam belge**, sonuç tek bir *cevap*
  olarak çiziliyor; getirilen kararların listesi, künyesi, "şunu da aç" yolu
  yok. Bir litigatörün araştırması **liste tarama** işidir ("İzmir BAM,
  2023–2025, tahliye taahhüdü, 30 karar tara, 5'ini işaretle") ve bugün
  **imkânsız**. ARCH aynı yeri S5/W7 olarak işaretledi: `searchLegalCorpus`
  yalnız iki iç çağıran tarafından kullanılıyor, `POST /v1/search` tek araçlık
  bir iskelet ve konsoldan **hiç** çağrılmıyor (`grep` → 0). De Jure daire +
  il BAM + yıl aralığı + pozitif/negatif kelime filtresi satıyor [doğrulandı].
- **Nasıl.** Yeni `control-plane/src/sources/routes.ts`:
  `POST /v1/sources/search` (mahkeme/kurul seçimi, `court_types`, daire
  (`birimAdi`), tarih aralığı, karar türü, kanun no, tam ifade, negatif
  kelime) ve `POST /v1/sources/fetch` (tam metin → **hash'li kanıt kartı**,
  `research/liveEvidence.ts` ile aynı offset+sha256 yolu — bir sağlayıcı
  özeti **asla** kanıt olmaz). Yeni sekme `#karar-ara`: sonuç listesi (künye
  + eşleşen cümle) → satırda "Tam metni getir" / "Dosyaya kaydet" /
  "Taslakta kullan" / "Etiketle". Kaydedilmiş aramalar `matter_items`
  üzerinde. Ayrıca `POST /v1/answer` `filters`'a **additive**
  `courts[]`, `chambers[]`, `yearFrom`, `yearTo`, `excludeTerms[]`.
  Mevcut taşlar: `research/mcpSession.ts`, `research/payloads.ts` (dokuz
  tür-özel mevzuat aracını ve Emsal'i **zaten tanıyor**), `progress.ts`
  (54 aracın Türkçe etiketi hazır), `security/untrusted.ts`.
- **Kabul ölçütü.** Ağı olan bir makinede "Yargıtay 3. HD · 2023-01-01 →
  2025-12-31 · `"tahliye taahhüdü"`" araması ≥ 10 künye döndürür; bir satırda
  "Tam metni getir" **hash'li** bir kanıt kartı üretir; aynı kart "Taslakta
  kullan" ile dilekçeye `[K-n]` olarak girer; arama bir dosyaya kaydedilip
  yeniden çalıştırılabilir; `/v1/health registeredToolCount` **54** kalır.
- **Efor** L (alt dilimler: **B-16a** uç + liste, **B-16b** kaydedilmiş
  arama/etiket) · **Hat** L-SOURCES (uç) + L-CONSOLE (ekran) ·
  **Bağımlılık** B-15.

### B-17 · Takvim + duruşma öğesi + `.ics` akışı
- **Neden.** FEATURE: litigatörün takvimindeki en kritik nesne — **duruşma** —
  sistemde **hiç yok** (`duruşma` yalnız kural notlarında ve şablon
  metinlerinde geçiyor) [ölçüldü]. De Jure 19.02.2026'da "Takvim modülü:
  duruşma ve tebligat takibi, hatırlatıcılar ve bildirimler" ekledi ve
  duruşma takibini **yalnız 80.000 ₺/yıl Pro**'ya kilitledi [doğrulandı];
  Apilex iOS açıklamasında "takvim senkronizasyonu" var [doğrulandı].
  Bizde karşılığı **ucuz ve tamamen çevrimdışı**: `.ics` sunucu, OAuth,
  entegrasyon istemez; çift tıkla Outlook/Takvim'e girer. Ayrıca TRMARKET:
  e-Duruşma 81 ilde yaygınlaştı (Temmuz 2026 itibarıyla 5,6 M+ duruşma), yani
  avukatın günü masa başına kaydı ve "duruşma hazırlığı" daha da değerli.
- **Nasıl.** `matters/types.ts`'e yeni öğe türü `hearing { date, time,
  court, salon, kind: 'durusma'|'kesif'|'e-durusma', note, status }` —
  `deadline` ile **birebir aynı kalıp**. `GET /v1/matters/deadlines?
  format=ics` ve `GET /v1/matters/{id}/calendar.ics` (süre + duruşma birlikte,
  `text/calendar`). **`DEADLINE_DISCLAIMER` birebir `.ics` DESCRIPTION
  alanına gömülür** (CLAUDE.md invaryantı: hesaplanmış tarih gösteren her
  yüzey). Konsolda Dosyalarım panelinin takvim (ay/hafta) görünümü; 7 gün
  kala kırmızı; duruşmaya tıklayınca **hazırlık kartı**: açık süreler, son üç
  belge, dosyanın kronolojisi (B-18), karşı tarafın dayanaklarının as-of
  denetimi (B-13). `GET /v1/deadlines/holidays` de arayüze bağlanır (bugün
  veri var, ekran yok).
- **Kabul ölçütü.** Bir dosyaya duruşma eklenir; takvimde süreyle birlikte
  görünür; `.ics` dosyası Outlook/Takvim'de doğru tarih **ve saatle** açılır
  ve açıklamasında `DEADLINE_DISCLAIMER` birebir yer alır; hazırlık kartı o
  dosyanın açık sürelerini ve son üç belgesini listeler;
  `tests/matters/ics.test.ts` RFC 5545 zorunlu alanlarını ve disclaimer'ı
  doğrular.
- **Efor** M · **Hat** L-MATTER (+ L-CONSOLE ekran) · **Bağımlılık** B-11
  (disclaimer metni).

### B-18 · Kanıta bağlı dosya kronolojisi (toplu tarih aktarımı + batch uç)
- **Neden.** APILEX: "dava dosyası özeti" hem İstanbul Barosu tanıtım PDF'inde
  hem iOS açıklamasında var [doğrulandı]; GLOBAL: CoCounsel'in Timeline
  skill'i dosyaları kelime kelime okuyup "dynamic, searchable list" veriyor.
  Bizde `intake/analysis.py::extract_dates` (tarih başına tek kayıt + `count`
  + 40 karakter bağlam) ve `event` öğesi **var**, ama DAILYFLOW ölçtü:
  4 belgenin 13 tarihi için **13 ayrı `POST`** gerekiyor ve `analysis.dates`
  şekli (`{date, context, count}`) ile olay şeması (`{date, title, source,
  verified}`) **uyuşmuyor** [ölçüldü]. TRMARKET'in TBB kanıtına göre avukatın
  gününü asıl yiyen iş **dosya inceleme**dir: TBB'nin kendi platformunda
  avukatlar "belgeler tarihe göre sıralanamıyor — 2015'ten süregelen bir
  dosyayı incelemek neredeyse imkânsız" diyor [doğrulandı].
- **Nasıl.** `POST /v1/matters/{id}/items:batch` (≤50 kayıt, tek istek, tek
  onay, `MAX_ITEM_PAYLOAD_BYTES` her kalem için ayrı uygulanır); yükleme
  cevabındaki `analysis.dates[]` doğrudan `{date, title, source}` şeklinde
  gelir (`context` → `title`, kelime sınırında kırpılmış — UXAUDIT P1-18:
  bugün yedi parçanın hepsi **kelime ortasından** kesiliyor). Belge
  sayfasında "Tüm tarihleri zaman çizelgesine aktar"; her olay
  `verified:false` + "belgeden sezgisel çıkarım — doğrulanmadı" çipi + kaynak
  `belge:<fileId>:analiz` + parça çapası. Dosya sekmesinde birleşik
  kronoloji ve "Kronolojiyi DOCX indir" (`export/bundle_docx.py`).
- **Kabul ölçütü.** 12 tarih içeren bir belgede tek tıkla 12 olay eklenir
  (**1 HTTP isteği**), hepsi doğrulanmadı çipi taşır ve kaynak belgeye
  bağlanır; ikinci kez basıldığında kopya oluşmaz; kronoloji DOCX'i tarih
  sırasında ve kaynak sütunuyla üretilir; hiçbir başlık kelime ortasından
  kesilmez.
- **Efor** S/M · **Hat** L-MATTER (+ L-SAFE `intake/analysis.py` başlık
  kırpma) · **Bağımlılık** yok.

### B-19 · Klasör / toplu intake ("UYAP'tan indirdiğiniz klasörü bırakın")
- **Neden.** APILEX P0: Apilex üç ana sayfada da "UYAP Chrome Eklentisini
  indirin. … tüm dosyalarınızı tek tıkla indirin" diyor [doğrulandı]; De Jure
  bunu masaüstü Dilekçe Editörü + uzaktan kurulum ile yapıyor [doğrulandı].
  Biz eklentiyi ve kimlik entegrasyonunu **bilinçle yapmıyoruz** (§C.3), ama
  acının büyük kısmı eklenti olmadan kapanır: avukat UYAP'tan indirdiği
  klasörü bırakır, intake sırayla işler, hepsi matter'a bağlanır. TRMARKET
  ayrıca ölçtü: **UYAP tek evrakta 40 MB'a izin veriyor**, bizim sınırımız
  25 MB — "klasör içe aktar" bu sınırla çalışamaz.
- **Nasıl.** Konsolda klasör sürükle-bırak (webkitdirectory) + kuyruk +
  **ilerleme kanalı**; her dosya mevcut `POST /v1/files` yolundan geçer
  (yeni intake yolu yok, karantina ve magic-byte denetimi aynen kalır).
  `UPLOAD_CAP_MIB` **tek kaynak kuralı korunarak** 25 → 40'a çıkar
  (`intake/quarantine.py` + `files/routes.ts` aynası +
  `tests/files/uploadCap.test.ts` Python satırını parse etmeye devam eder);
  `INTAKE_EXEC_TIMEOUT_MS` gözden geçirilir ve `MAX_CONCURRENT_INTAKE = 2`
  semaforu eklenir (ENGRISK §5.1: bugün API tarafında eşzamanlılık sınırı
  yok, kötü bir istemci N Python süreci doğurabilir). Zaten yüklü belge
  "zaten yüklüydü" der (mevcut davranış).
- **Kabul ölçütü.** 20 dosyalık bir klasör tek sürükle-bırakla yüklenir;
  ilerleme her dosya için görünür; başarısız dosyalar **adı ve nedeniyle**
  listelenir (B-10); 35 MB'lık tek bir PDF kabul edilir; 45 MB reddedilir
  ve mesaj sınırı söyler; `tests/files/uploadCap.test.ts` iki tarafın da 40
  dediğini doğrular; eşzamanlı 10 istekte en fazla 2 Python süreci koşar.
- **Efor** M · **Hat** L-SAFE (intake + files sınırları) + L-CONSOLE (ekran)
  · **Bağımlılık** B-10.

### B-20 · Yerel kütüphane: canlı araştırmada getirilen belgeler `collex_local`'a yazılsın
- **Neden.** ARCH ölçtü: `collex_local` **tamamen boş** — 0 matter, 0 answer,
  0 draft, 0 document, **0 chunk** [ölçüldü]. Sonuç: "Yerel korpus" kapsamı
  gerçek kurulumda **her zaman ÇEKİMSER**, `POST /v1/search`, Türkçe FTS
  indeksi, citator şeridi ve as-of motoru **veri bulamıyor**; aynı kararı
  ikinci kez getirmek için tekrar ağa çıkılıyor. TRMARKET buna kullanıcı
  tarafından bakıyor: avukat ürünü ilk açtığında en doğal şeyi yapıyor ve
  ÇEKİMSER görüyor — dürüstlük burada ürünü öldürüyor. Bu kalem ColleX'i
  tek seferlik bir araçtan **biriken bir varlığa** çevirir ve B-13/B-16'nın
  değerini açar.
- **Nasıl.** Canlı araştırmanın (ve B-16'nın) `document.fetch` ile getirdiği
  her **tam belge**, mevcut ingestion boru hattından (`ingestion/pipeline.py
  ::connect_local` — tek giriş noktası) `scope='public'`,
  `source='<PROVIDER>'`, provenance ve **alınma zaman damgasıyla**
  `collex_local`'a yazılır; `relations.py` citator kenarlarını üretir.
  Kaynak çipi "yerel kütüphane · alınma GG.AA.YYYY" der — **asla
  "(SENTETİK)" demez** (TRMARKET: bu etiket bir avukat için "sahte karar
  üretiyor" çağrışımı yapıyor; deneme veritabanı çipi de "örnek metin —
  gerçek karar değil" olur). Ayarlar'da basit bir üst sınır + temizlik
  (disk büyümesi). **Varsayılan araştırma kapsamı** "Canlı kaynaklar" olur;
  "Yerel korpus" boşken "(boş — araştırma yaptıkça dolar)" diye etiketlenir.
- **Kabul ölçütü.** Bir canlı araştırma koşusu sonrası `/v1/health`
  `corpus.publicDocuments` artar; aynı soru ikinci kez "Yerel korpus"
  kapsamıyla sorulduğunda **ağa çıkılmadan** aynı alıntıyı hash'iyle
  döndürür; `POST /v1/search` aynı belgeyi bulur; hiçbir yüzeyde
  "(SENTETİK)" görünmez; `collex_local` şeması ve migration sayısı
  değişmez.
- **Efor** M · **Hat** L-SOURCES · **Bağımlılık** **B-06 zorunlu** (indekssiz
  trigram bu veriyle ürünü 45 sn'ye kilitler).

### B-21 · Belge × soru ızgarası (tabular review)
- **Neden.** GLOBAL: Legora'nın imza özelliği "one row per document, one
  column per question, with each cell linked to the source"; CoCounsel'in
  üç skill'i çıktıyı **tablo** olarak veriyor [doğrulandı]. APILEX: Projeler
  modülü "kritik farklar ve ortak noktalar tablolama özelliğiyle" diyor
  [pazarlama — mekanizma gösterilmiyor]. Bizim farkımız kritik: **rakibin
  tablosu kaynağa bağlı değil**, bizimki her hücrede `fileId` + Unicode
  offset taşır. Algılanan değer sıçraması en büyük kalem ve **yeni HTTP ucu
  gerektirmiyor**.
- **Nasıl.** Yeni görünüm; satır = dosyadaki belge, sütun = soru, hücre =
  kısa cevap + kaynak çipi; boş hücre "kapsanmadı" der (asla boş kalmaz).
  Motor: mevcut `POST /v1/answer` + `filters.fileIds` üzerinde **sıralı
  kuyruk** (`DEFAULT_ANSWER_TIME_BUDGET_MS` 60 000 her istek için ayrı
  geçerlidir; kuyruk ilerlemeyi gösterir ve iptal edilebilir). Türk solo
  avukatın gerçek işi: ek yığınında tebligat tarihi / ihtarname / bedel
  arama.
- **Kabul ölçütü.** 5 belge × 3 soru ızgarası tek ekranda üretilir; her dolu
  hücre tıklanınca ilgili belge bölümüne **offset çapasıyla** gider;
  kapsanmayan hücre "kapsanmadı" der; ızgara CSV/DOCX olarak dışa aktarılır
  ve her hücrenin kaynağı (fileId + parça) sütun olarak yer alır.
- **Efor** M · **Hat** L-CONSOLE · **Bağımlılık** yok.

### B-22 · Adlandırılmış iş kartları — ürünün yarısı bugün keşfedilemiyor
- **Neden.** GLOBAL: CoCounsel **on adlandırılmış iş** sunuyor, her biri tek
  cümlelik sözleşme ve **sabit çıktı biçimiyle**; Descrybe'ın API'si de
  fiilleri ayırıyor (`verify_quote`, `check_case_status`, `find_cases_that_cite`)
  [doğrulandı]. ColleX'te 35 yol var ama avukata görünen tek fiil "soru sor"
  — `POST /v1/answer` her şeyi yapıyor. UXAUDIT'in "on dakikada ürünü
  çalıştırabildim ama ne olduğunu anlayamadım" sonucunun doğrudan nedeni.
- **Nasıl.** Araştır sekmesine 8–10 iş kartı; her kart mevcut uçlara **sabit
  gövde** gönderir, yeni uç yok: *Belgeyi özetle · Kronoloji çıkar (B-18) ·
  Atıfları denetle (B-13) · Karşı tarafın dilekçesini denetle (B-13) ·
  Belge × soru ızgarası (B-21) · Kontrol listesine göre incele (B-24) ·
  Süre hesapla · Duruşma hazırlık özeti (B-17) · Karşıt içtihat tara ·
  Karar ara (B-16)*. Ayrıca Araştır kutusu **boş** başlar (bugün
  `#q.value === #q.placeholder`, fark edilmeden basılınca bir kira dosyasına
  ceza hukuku araştırması otomatik dosyalanıyor — UXAUDIT P1-14) ve demo
  sorusu yalnız "Örnek sorular" şeridinde durur.
- **Kabul ölçütü.** Araştır sekmesinde en az 8 iş kartı görünür; her kart
  tıklandığında ilgili ekranı/akışı açar; `#q.value === ""` ilk açılışta;
  `console.test.ts` kart adlarını ve boş kutu kuralını sabitler.
- **Efor** M · **Hat** L-CONSOLE · **Bağımlılık** ilgili kalemler indikçe
  kartlar etkinleşir (inmemiş kart gösterilmez — **vaporware yasağı**).

### B-23 · Bulut AI: göndermeden önce maskeleme + kayıt defteri + hız/maliyet tavanı
- **Neden.** TRMARKET, Ankara Barosu HUBİTEM rehberi v1.0'ı birebir okudu:
  *"müvekkillere ilişkin her türlü kişisel bilgi anonim hale getirilmeli ve
  müvekkillerin kimliğinin saptanmasında kullanılabilecek veriler yapay zekâ
  girdisinde yer almamalıdır"*; ayrıca avukat aracın kendini eğitip
  eğitmediğini bilmeli ve müvekkilini bilgilendirmelidir [doğrulandı].
  TBB **28.08.2026'da** kendi AI rehberini yayımladı (dört risk kademesi,
  uygun güvence olmadan yurt dışı sunucu yok, nihai sorumluluk avukatta)
  [doğrulandı-ikincil]. KVKK m.9 (7499 değişikliği): açık rıza artık genel
  kural değil **istisna**; rutin yurt dışı aktarımın aracı standart sözleşme
  + 5 iş günü bildirimidir ve **veri sorumlusu avukattır**, ColleX değil.
  Bizde bugün ne maskeleme ne kayıt var — yalnız istek başına onay kutusu.
  ENGRISK ayrıca ölçtü: kümülatif çağrı/token/maliyet tavanı **yok**
  (`grep`: `cost`/`quota`/`rateLimit` karşılığı yok) ve B-04 ile birleşince
  yabancı bir sayfa anahtarı sınırsız harcatabilir.
- **Nasıl.** (a) `control-plane/src/ai/` içinde **maskeleme**: TCKN (11
  hane), VKN (10 hane), telefon, IBAN ve matters'taki taraf adları
  `[MÜVEKKİL]`/`[KARŞI TARAF]`/`[TCKN]` ile değiştirilir; gönderimden önce
  avukata **önizleme** gösterilir; iki düğme: "Maskele ve gönder" /
  "Maskelemeden gönder". Maskeleme saf kural tabanlıdır ve **bulut
  gerektirmez**. (b) `app_private.settings` altında **kayıt defteri**:
  tarih, dosya, karakter sayısı, model, hangi bölüm — **metnin kendisi
  saklanmaz**; Ayarlar › "Bulut AI kayıt defteri". (c) `ai/routes.ts`'e
  `AI_MAX_CALLS_PER_HOUR` (ör. 60) ve `AI_MAX_INPUT_TOKENS_PER_DAY`; aşımda
  tipli `429 AI_RATE_LIMITED` + Türkçe mesaj; Ayarlar › Sistem durumu'nda
  "Bugün: N çağrı / ~M jeton". (d) İlk açılışta tek seferlik bilgilendirme
  ekranı (TRMARKET §7 G-2 metni). ADR-018 **gevşetilmez**: varsayılan KAPALI,
  istek başına onay, hatırlanan onay yok, `liveTested:false` durur.
- **Kabul ölçütü.** `tests/ai/masking.test.ts`: TCKN/VKN/IBAN/telefon ve
  matter taraf adları maskelenir, maskelenmiş metinde 11 haneli hiçbir sayı
  kalmaz; `POST /v1/ai/*` maskeleme önizlemesi olmadan çağrılamaz (istek
  gövdesinde açık seçim zorunlu); 61. çağrı `429 AI_RATE_LIMITED`; kayıt
  defteri satırında **belge metni bulunmaz** (test dizeyi arar).
- **Efor** M · **Hat** L-SAFE · **Bağımlılık** B-04.

### B-24 · Sözleşme/kontrol listesi inceleme motoru (kural tabanlı)
- **Neden.** DEJURE: `/sozlesme` "mevcut sözleşmenizi risk, eksik ve
  uyumsuzluk açısından analiz eder … her madde için iyileştirme önerileri
  sunar" [doğrulandı] — bizde **hiç yok**; 13 şablonun 6'sı sözleşme
  **oluşturma**. GLOBAL: Spellbook'un Custom Playbooks'u ve CoCounsel'in
  Contract Policy Compliance'ı aynı işi yapıyor ve **tamamen kural tabanlı
  kurulabilir** — sıfır halüsinasyon riskli değer. Türk solo avukatının en
  tekrarlı işi.
- **Nasıl.** Yeni `POST /v1/contracts/review`: yüklenen sözleşme madde madde
  bölünür; her madde için (i) korpus/mevzuat karşılığı (mevcut
  `answerPipeline` + `coverage.ts` + `relevance.ts` yeniden kullanılır),
  (ii) **yalnız hash'li alıntıya bağlanabilen** risk notu, (iii) bağlanamayan
  gözlem `⚠ KAYNAKSIZ`. Yanında avukatın kendi yazdığı, dosyada saklanan
  **kontrol listeleri** (ör. kira: depozito · artış oranı · tahliye
  taahhüdü · damga vergisi); her madde VAR (kanıt bağlı) / YOK / BELİRSİZ.
  Liste `app_private.settings` ya da matter item olarak saklanır. Yeni model
  gerekmez, bulut gerekmez.
- **Kabul ölçütü.** 10 maddelik sentetik bir kira sözleşmesi yüklenir;
  inceleme her madde için üç durumdan birini verir; hiçbir "risk" satırı
  hash'li alıntı olmadan yazılmaz (test: kaynaksız satır `⚠ KAYNAKSIZ`
  etiketi taşır ve "risk" kelimesini kullanmaz); kullanıcı kontrol listesi
  kaydedilir, ikinci sözleşmede yeniden koşar; çıktı DOCX olarak iner ve
  export doğrulamasından geçer.
- **Efor** M · **Hat** L-EVID · **Bağımlılık** B-01.

### B-25 · Şablonların hukukî içerik düzeltmeleri (COPY L5–L28)
- **Neden.** COPY hattı 13 şablonu (2 104 satır) tam metin okudu ve
  **imzalanacak metne giren** hatalar buldu, çoğu madde metni çekilerek
  [doğrulandı]: tahliye taahhütnamesinde **TBK m.352/1'in bir aylık hak
  düşürücü süresi hiç yok** ve "el yazısı" şartı **uydurulmuş** (kanun
  yalnız "yazılı" diyor) — tahliye taahhüdünde kaybedilen dosyaların birinci
  sebebi tam o bir aydır; avukatlık ücret sözleşmesi Av.K. m.164/2'yi
  **ters** anlatıyor (%25 her ücretin değil, yalnız **nispi** ücretin
  tavanıdır — şablon avukata kendi ücretini gereksizce kısıtlatıyor);
  hizmet sözleşmesinin fikri mülkiyet hükmü **FSEK m.52'nin "hakların ayrı
  ayrı gösterilmesi" şartını atlıyor** ve kendi varsayılan metniyle
  **geçersiz doğuyor**; TBK m.344/1 "ortalamasını" diye aktarılmış, madde
  "**ortalamalara göre değişim oranını**" diyor ve hüküm konut **ve çatılı
  işyeri** kiralarına aittir; İş K. m.41'in üç emredici sayısı (1,5 saat /
  6 ay / 270 saat) yok; istinaf ve temyiz şablonları kanunun saydığı
  **"Kararın özeti"** unsurunu (HMK m.342/2-d, m.364/2-e) taşımıyor ve
  tebliğ tarihi `required` değil; cevap dilekçesi şablonunun **zamanaşımı
  def'ini soracak hiçbir alanı yok**; altı sözleşme şablonunda taraflar
  makine üretimi "bilgi amaçlı hukukî notlar" bölümünün **altına imza
  atıyor**.
- **Nasıl.** `control-plane/src/drafting/templates.ts` (L-LEGAL, tek sahip):
  COPY §2.1 tablosundaki L5–L28 önerilen metinleri birebir uygulanır;
  `[çıkarım]` etiketli kalemler (L11 TBK m.347, L17, L23, L24, L27, L29)
  build sırasında `search_within_kanun` ile **doğrulanır**, doğrulanamayan
  kalem **uygulanmaz**. Yeni zorunlu bölümler ("KARARIN ÖZETİ"), yeni
  alanlar (`defiler`, `karsiDava`, `kararOzeti`), `tebligTarihi
  required: true`. `dayanakNotlariSection` sözleşme şablonlarında imza
  bloğunun **altına** taşınır ve başlığı "EK — … SÖZLEŞMENİN PARÇASI
  DEĞİLDİR" olur (ya da `kind:'sozlesme'`de hiç üretilmez). Dilekçe
  gövdesinden uygulama talimatı ve ham kural kimliği çıkar (L18, L25 —
  B-02 ile aynı disiplin). ARCH S7'nin uzun vadeli önerisi (şablonları
  `templates/*.json` + zod şeması yapmak) bu dalgada **yapılmaz**, bir
  sonraki dalgaya not düşülür.
- **Kabul ölçütü.** `GET /v1/draft-templates` sayısı ve `domain` alanları
  korunur; `tests/drafting/templates.test.ts`: her sözleşme şablonunda
  "bir ay içinde" (tahliye), "ayrı ayrı gösterilmesi" (FSEK), "değişim
  oranını" (TBK m.344), "nispi" (Av.K. m.164/2) dizeleri bulunur;
  istinaf/temyiz şablonlarında `karar-ozeti` bölümü ve `tebligTarihi
  required` doğrulanır; hiçbir şablon gövdesinde `hmk-istinaf`,
  `Süreler ekranından` veya `doğrulayın` talimatı geçmez; imza bloğu
  `dayanakNotlariSection`'dan **önce** gelir.
- **Efor** L · **Hat** L-LEGAL · **Bağımlılık** yok.

### B-26 · Silme, süzgeç ve alan eksikleri — "sessizce yok sayma" biter
- **Neden.** DAILYFLOW ölçtü: `/v1/answers?q=` ve `?status=` **sessizce yok
  sayılıyor** (5 satır dönüyor), `/v1/files?matterId=` **9 belgenin tümünü**
  döndürüyor, `/v1/drafts?q=` süzmüyor — 400 bile değil; en kötü hata
  biçimi, çünkü arayüz süzdüğünü sanır. `DELETE /v1/answers/{runId}` ve
  `DELETE /v1/drafts/{id}` **yok** (404) → aynı soru ikinci kez sorulunca
  yeni satır açılıyor, geçmiş kalıcı olarak kirleniyor; eski taslak sürümünün
  metni okunamıyor (`/versions/{n}` yok) → sürüm var, geri dönüş yok.
  Belge silinince matter'daki `file` kaydı, taslağın `Ek-n` satırı ve 25
  `[K-n]` kaydı **öksüz kalıyor, uyarı yok**, ve o belgeye sorulan soru
  `FILE_NOT_FOUND` yerine `ABSTAIN` dönüyor. `nextDeadline` **49 gün
  geçmiş** bir süreyi "sonraki süre" olarak gösteriyor, 6 gün kalan gerçek
  süre arkasında gizli. `GET /v1/drafts` satırında `updatedAt`,
  `GET /v1/answers` satırında dosya başlığı, `GET /v1/files` satırında
  `matterId` yok (N+1) [ölçüldü].
- **Nasıl.** `matters/`, `files/`, `api/answerService.ts`,
  `store/{answerStore,draftStore}.ts` (L-MATTER): süzgeçler **gerçekten
  uygulanır** ya da tanınmayan sorgu parametresi **400** döner (sessiz yok
  sayma yasak). `DELETE /v1/answers/{runId}`, `DELETE /v1/drafts/{draftId}`,
  `GET /v1/drafts/{id}/versions/{n}`. `DELETE /v1/files/{id}` matter
  kayıtlarını da düşürür ve o belgeye bağlı taslakları
  `EVIDENCE_FILE_DELETED` uyarısıyla işaretler (P0-2'nin `detachMatter`
  kalıbının ters yönü); silinmiş `fileId`'ye sorulan soru
  `404 FILE_NOT_FOUND` döner. `matters[].nextDeadline` geçmişi atlar,
  `daysLeft` ve `overdue` alanları eklenir, ayrı `overdueCount`;
  `GET /v1/matters/deadlines` varsayılan `until = bugün + 30 gün` ve
  `computed` bloğu yalnız `?include=computed` ile gelir (bugün 4 süre =
  9 965 bayt, panelde gösterilmeyen veri). Additive alanlar: `updatedAt`,
  `matterTitle`, `matterId`.
- **Kabul ölçütü.** `tests/matters/routes.test.ts` + `tests/files` +
  `answerService`: her süzgeç ya süzer ya 400 verir (test her ikisini de
  kapsar); silme uçları 204 döner ve ikinci çağrıda 404; silinmiş belgeye
  sorulan soru `FILE_NOT_FOUND`; `nextDeadline` geçmiş süreyi göstermez ve
  `overdueCount` doğru sayar; `GET /v1/matters/deadlines` varsayılan gövdesi
  ≥ %80 küçülür.
- **Efor** M · **Hat** L-MATTER · **Bağımlılık** yok.

### B-27 · Uyarı bütçesi + makine sözlüğü + tanımsız terimler
- **Neden.** COPY ölçtü: bir KISMİ cevap ekranında **11–14 uyarı bloğu /
  20–24 cümle**, ikisi birebir tekrar (kesinleştirme cümlesi iki kez, veri
  kaynağı cümlesi iki kez) [ölçüldü]. UXAUDIT ölçtü: bir korpus cevabında
  **8 farklı İngilizce makine kodu, ~40 geçiş**; bir belge sayfasında
  **19 UUID + 19 × "konum N-M (Unicode karakter sayımı)" + SHA-256 +
  ANTHROPIC_API_KEY**; belge sorusu cevap kartı **7 432 px = 8,3 ekran** ve
  aynı feragat cümlesi kart içinde **6 kez**; karşıt otorite tablosunda aynı
  Yargıtay kararı **3 kez**, aynı kanun **4 kez**, üstelik özet "aleyhe karar
  bulunamadı" derken; "aktif dosya" ürünün merkezî kavramı ve **hiçbir yerde
  tanımlı değil** (4 çipin dördünde de `title: null`); `KAYNAKSIZ` editörde
  22+ kez geçiyor ve **tek bir tanım cümlesi yok**; çekimserlik "KESİNLEŞTİ-
  RİLEMEZ — en az bir doğrulama **başarısız**" diyor, oysa hiçbir şey
  başarısız olmadı [ölçüldü].
- **Nasıl.** `console.html` (L-CONSOLE): COPY §4.2'nin **3 sabit + 1
  koşullu** yapısı — (1) cevabın başında tek blok (durum damgası + tek
  cümlelik anlamı + kesinleştirme cümlesi **aynı blokta**), (2) tek künye
  listesi (kapsam % + eksik sözcükler + üretim yolu + veri kaynağı +
  varsa süre bütçesi / alıntı kısaltıldı / yalnız-yükleme), (3) sonda
  katlanmış "Uyarılar" kartı, (4) yalnız deneme korpusunda `#demobanner`.
  Ham makine kodları yalnız "Teknik ayrıntılar" `<details>` içinde; UUID/
  offset/hash **hiçbir zaman ana akışta değil**. Karşıt otorite tablosu
  **belge bazında tekilleştirilir** (hangi aramada bulunduğu ayrı rozet).
  Tespit kartlarındaki boilerplate karta **bir kez** yazılır. Tek cümlelik
  tanımlar: "aktif dosya", `KAYNAKSIZ`, `K-n`, "sürüm", "deneysel".
  Çekimserlik için ayrı, nötr cümle: "Bu soru elinizdeki kaynaklarda karşılık
  bulmuyor" + eylemler (canlı kaynaklarda ara / belge yükle / soruyu daralt /
  tarihi değiştir) — GLOBAL: çekimserlik bir **yol ayrımı** olmalı, duvar
  değil. "(SENTETİK)" çipi → "örnek metin — gerçek karar değil" (TRMARKET).
  `RETRIEVAL_LANE_DEGRADED` görünür uyarı olur (B-06).
- **Kabul ölçütü.** `console.test.ts`: bir KISMİ cevap görünümünde uyarı
  bloğu sayısı **≤ 4** ve toplam uyarı cümlesi **≤ 8**; hiçbir cümle iki kez
  geçmez (dize sayacı); ana akışta `NORM_CONTENT|AFFIRMATIVE|NEGATIVE|
  NEUTRAL|EVIDENCE_CAP_APPLIED|QUESTION_NOT_COVERED` dizeleri **0** kez
  (yalnız `<details>` içinde); karşıt otorite tablosunda aynı belge kimliği
  **1** satır; "aktif dosya", "KAYNAKSIZ", "K-n" için birer `title`/tanım
  cümlesi bulunur; çekimserlik metninde "başarısız" geçmez.
- **Efor** L · **Hat** L-CONSOLE · **Bağımlılık** B-06 (yeni uyarı), B-11
  (yeni disclaimer metni).

### B-28 · Erişilebilirlik P0 dörtlüsü + koyu tema kırıkları
- **Neden.** DESIGN hesapladı ve UXAUDIT ölçtü: klavye odak halkası
  **1,36:1 (açık) / 1,51:1 (koyu)** — `outline-style: none`, tek gösterge
  `box-shadow … rgba(125,42,51,.18)`; WCAG 2.4.11 **3:1** ister, yani yalnız
  klavye kullanan bir avukat nerede olduğunu göremiyor. Girdi sınırı
  **1,12:1 / 1,08:1** — alanlar görünmüyor (UXAUDIT: "bej zemin üstünde bej
  kutu"). Koyu temada `.viewtab.active` **2,45:1**, `.toast.ok` **2,08:1**,
  `GECİKMİŞ — N gün` çipi **2,76:1** (açık temada 6,77) — yani **en acil öğe
  en okunmaz öğe** ve çip koyu temada açık renkli olduğu için görsel aciliyet
  **tersine dönüyor**. 960 px'te (1440 ekranda %150 yakınlaştırma)
  `scrollWidth 1087 > 960` → durum rozetleri ve tema düğmesi ekran dışında.
  390 px'te `.edacts a.dl.udf .tag { display: none }` yüzünden UDF
  düğmesinde **"deneysel" etiketi kayboluyor** ve dokunmatik cihazda `title`
  ipucu da görünmediği için CLAUDE.md'nin "UDF her yüzeyde deneysel der"
  ilkesi tam o kırılma noktasında tutmuyor.
- **Nasıl.** DESIGN §8.7 `--ring` bloğu (yeni oran 9,43/7,72);
  `.field { border: 1px solid var(--border) }` (3,66/3,57);
  `--on-seal` her iki temada açık ve `.viewtab.active` onu kullanır;
  toast/`.days.late` sabit `#fff` kaldırılır (`background: var(--ink);
  color: var(--surface)`, renk yalnız 4 px sol kenar); `--scrim:
  rgba(34,31,25,.55)` + `backdrop-filter: blur(2px)`;
  `prefers-reduced-motion` için tek bloklu evrensel sıfırlama;
  900–1100 px ölü bölgesi (`.pills`, `.pill.mute`, `.themebtn` taşması);
  `deneysel` etiketi **hiçbir kırılma noktasında gizlenmez**.
- **Kabul ölçütü.** `console.test.ts` + hesap betiği: odak halkası ≥ 3:1,
  girdi sınırı ≥ 3:1, `GECİKMİŞ` çipi ve toast ≥ 4,5:1 **her iki temada**;
  960 px'te `document.scrollWidth <= innerWidth`; 390 px'te UDF düğmesinin
  metninde "deneysel" geçer; `prefers-reduced-motion` altında sonsuz
  animasyon yok.
- **Efor** M · **Hat** L-CONSOLE · **Bağımlılık** yok.

### B-29 · Genel arama — "şu ibare hangi dosyamdaydı?"
- **Neden.** FEATURE: bugün üç ayrı, dar arama var (dosya alanları ILIKE,
  belge **adı** ILIKE, soru kutusu); not, olay, süre, cevap ve taslak metni
  **aranamıyor**. DAILYFLOW doğruladı: `/v1/matters?q=depozito` → `[]`.
  ARCH: sütunlar zaten var (`answers.question`, `drafts.title`,
  `matters.title/client/docket_no`), `pg_trgm` kurulu, `legal.chunks
  .search_tsv_tr` Türkçe FTS indeksi hazır ve `POST /v1/search` **hiç
  çağrılmıyor**.
- **Nasıl.** Yeni migration: iki GIN trigram indeksi (`answers.question`,
  `drafts.title`) — **B-05'in çoklu sentinel kuralına uygun**. Yeni
  `GET /v1/search/all?q=` beş küçük sorguyu `kind` ayırıcısıyla birleştirir
  (dosya · belge içeriği · not · olay · cevap · taslak). Belge içeriği
  mevcut `POST /v1/search`/`chunkStore` üzerinden; sonuç tıklanınca ilgili
  bölüme **offset çapasıyla** gider. Üst çubukta tek arama kutusu.
- **Kabul ölçütü.** Bir belgenin gövdesinde geçen ve hiçbir başlıkta olmayan
  bir ibare aratıldığında o belge çıkar ve tıklanınca bölüme gider; aynı ibare
  bir notta da geçiyorsa not satırı da listelenir; arama < 500 ms döner
  (yerel, tek kullanıcı, 2000 belgelik probe DB'de ölçülür).
- **Efor** M · **Hat** L-MATTER · **Bağımlılık** B-06.

### B-30 · Dosya paketi (ZIP) dışa aktarımı
- **Neden.** FEATURE: bugün yalnız **tek** taslak ya da **tek** kanıt paketi
  dışa aktarılabiliyor; meslektaşa devir, müvekkile teslim, arşiv ve denetim
  hepsi dosya paketini ister. TRMARKET'in "arşiv" durağı ve ENGRISK'in
  `var/uploads/` bulgusu (asıl baytları **hiçbir kod okumuyor**, avukat
  yüklediği PDF'i ColleX'ten geri alamıyor) aynı boşluğun iki yüzü.
- **Nasıl.** Dosya sayfasında "Dosya paketini indir": `dosya-ozeti.docx`
  (künye, taraflar, kronoloji, süreler, notlar) + `belgeler/` (**asıl**
  dosyalar — `var/uploads` bu yolla ilk kez okunur) + `taslaklar/` (her
  taslağın son sürümü DOCX) + `arastirmalar/` (her cevabın kanıt paketi
  JSON + DOCX) + `MANIFEST.json` (sha256 listesi). Ayrıca
  `GET /v1/files/{id}/original` (`Content-Disposition: attachment`) ve
  konsolda "Aslını indir"; asıl yoksa açık Türkçe uyarı.
- **Kabul ölçütü.** 2 belge, 2 cevap, 1 taslak (v2) ve 2 süre içeren bir
  dosyanın ZIP'i dört klasör ve `MANIFEST.json` içerir; manifestteki her
  sha256 dosyanın kendisiyle doğrulanır; **doğrulanamayan tek bir alıntı
  varsa paket yazılmaz** (mevcut export sözleşmesiyle aynı sertlik);
  `GET /v1/files/{id}/original` yüklenen baytın birebir aynısını döndürür.
- **Efor** M · **Hat** L-EVID (paket) + L-MATTER (`/original` ucu) ·
  **Bağımlılık** B-02, B-34.

### B-31 · Entailment: iddia parçalarına atıf + kural tabanlı eksenin dürüst gösterimi
- **Neden.** ARCH teşhisi **yeniden üretti** ve iki yeni şey söyledi:
  9/21 gold satırın PARTIAL kalması bir rule-drafter tuhaflığı **değil** —
  `ClaimDraft` ve `EntailmentPort`'ta *hangi atfın iddianın hangi kısmını
  desteklediği* kavramı yok, ve `max()` bir tümel iddia için **ters**
  aggregatördür ("bir pasaj her şeyi taşıyor mu?" — yapı gereği imkânsız).
  Ölçülen: bugün `max` 0,633 / 0,563 ✗; birleşim yüzeyi ve **parça bazlı
  `min`** ikisi de **1,000 ✓** [ölçüldü]. İkinci bulgu (W2): kural tabanlı
  modda iddia metni **alıntıların kendisi** olduğu için eksen bir totolojidir
  ve tek pasajlı iddia tam **1,000** alır — ama konsol bunu "Anlamsal
  doğrulama %100" diye gösteriyor ve hukukçu bunu *anlamsal* teyit olarak
  okuyor. Ayrıca `addressesSameIssue` **herhangi bir ortak sayı** (yıl,
  tutar) üzerinden çelişki bağı kuruyor — DAILYFLOW bunun sonucunu sahada
  gördü: TCK m.168 (etkin pişmanlık) kapora kararıyla "çelişkili" ilan
  edildi ve ayrılabilir iki karar kutuplaştırıldı.
- **Nasıl.** ARCH §4.3'ün additive sözleşmesi: `evidence/types.ts`
  `ClaimDraft.segments?: {text, evidenceIds}[]`; `llm/ports.ts`
  `EntailmentPort.assessSet?`; `verifier.ts` `confidence.entailment` =
  segment varsa **parça bazlı `min`**, yoksa çok kanıtlı kural tabanlı
  iddiada `assessSet`, bulut iddiasında bugünkü `max` + görünür
  `ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM`; padding'e karşı
  `UNUSED_CITATION:<claimId>:<evidenceId>` uyarısı.
  `ENTAILMENT_THRESHOLD = 0.85` ve hiçbir kapı değeri **değişmez**.
  `addressesSameIssue`: sayı kuralı yalnız mevzuat/madde/E./K. token'larına
  daraltılır. Konsolda `aiUsed.entailment === false` iken eksen
  "— (kural tabanlı üretimde ölçülmez)" diye gösterilir (W12-B2'nin
  `currentnessApplicable === false` kalıbı).
- **Kabul ölçütü.** ARCH'ın iki probe fixture'ı (iki fıkra; çapraz referans
  numarası taşıyan fıkra) **SUPPORTED** döner; tek pasajlı iddia davranışı
  değişmez; `run_evals` yeniden koşulur ve kesinleştirilebilir oranındaki
  artış raporda **"bir kusurun kalkması, kalite artışı değil"** diye
  yazılır (§C.1); konsolda kural tabanlı modda yüzde **gösterilmez**.
- **Efor** M · **Hat** L-ANSWER · **Bağımlılık** yok.

### B-32 · Liste uçlarının ölçek performansı
- **Neden.** ENGRISK ölçtü (2000 belge / 2000 cevap): `GET /v1/files` sorgu
  süresinin **%91'i** yalnız `length(v.canonical_text)` için her belgenin
  kanonik metnini TOAST'tan açmak (148,9 ms → 12,4 ms); alt sorgu **tüm
  `legal.chunks`** tablosunu her çağrıda tarıyor; HTTP tarafında 487 KB
  gövde, **sayfalama yok**, konsol 2000 kartı DOM'a basıyor.
  `GET /v1/answers?fileId=` jsonb üzerinde `Seq Scan`: **15,5 ms → 0,087 ms**
  tek GIN indeksiyle (119×) ve konsol bunu **her belge sayfası açılışında**
  yapıyor [ölçüldü].
- **Nasıl.** `chars` yüklemede metadata'ya yazılır (`IntakeResult.chars`
  zaten var), listede `v.metadata`'dan okunur (`coalesce` geçiş yolu);
  `listFiles`'a `limit`/`offset` (varsayılan 50) + `page: {offset, limit,
  total}` (additive); parça sayımı `lateral` ile sayfanın satırlarına
  sınırlanır; yeni migration `answers_filescope_gin` (B-05 kuralına uygun,
  128 kB) ve `answerStore.list` predikatı `result -> 'fileScope' @> …`
  biçimine çevrilir (ifade indeksle **birebir** aynı olmalı).
- **Kabul ölçütü.** 2000 belgelik probe DB'de `GET /v1/files` < 60 ms ve
  gövde < 60 KB; `GET /v1/answers?fileId=` < 5 ms; `explain` planında
  `answers_filescope_gin` görünür; konsol "Daha fazla göster" ile devam eder.
- **Efor** M · **Hat** L-MATTER (files/answers) + L-SAFE (migration +
  `intake/ingest.py` metadata) · **Bağımlılık** B-05.

### B-33 · Intake sınırları: PDF sayfa tavanı, eşzamanlılık, yazma sırası
- **Neden.** ENGRISK: `intake/extract.py`'de **sayfa sınırı yok** (OCR'de
  100 var) — 25 MB'lık 3 000 sayfalık bir tarama 150–300 sn sürer, 180 sn
  bütçeyi aşar, 504 `UPLOAD_TIMEOUT` ve **üç dakika kayıp**; kullanıcı bunu
  2 saniyede öğrenebilirdi. Asıl bayt **DB commit'inden SONRA** yazılıyor
  (`ingest.py` 278 vs 309): disk dolarsa belge veritabanına girer, asıl bayt
  yoktur, kullanıcı 500 görür ve aynı baytları tekrar yüklediğinde "zaten
  yüklüydü" der — yani doğru hareketiyle bile ilerleyemez. Yazma atomik
  değil (`write_bytes`, geçici dosya + rename yok, `fsync` yok) ve onarım
  yok (`if not target.exists()` → kırık/kısa dosya "var" sayılır ve adı
  içeriğin sha256'sı olduğu için **yalan söyler**) [kodda + ölçüldü].
- **Nasıl.** `PDF_MAX_PAGES` (600 ya da OCR ile aynı 100) + tipli
  `EXTRACTION_FAILED` ve Türkçe mesaj ("Belge N sayfa; en fazla M sayfa
  işlenebilir — belgeyi bölün"); `_store_original` `Pipeline(...).run()`
  **öncesine** alınır; atomik yazma (`.part` → `fsync` → `os.replace`);
  onarım (`target.exists() and stat().st_size == verified.size_bytes`);
  `MAX_CONCURRENT_INTAKE = 2` (B-19 ile birlikte).
- **Kabul ölçütü.** Sayfa sınırını aşan bir PDF **2 sn içinde** tipli hata
  döner; kesilen bir yazma sonrası aynı belge yeniden yüklendiğinde asıl
  bayt **onarılır**; `tests/intake/` yeni testleri sayfa sınırı, atomik
  yazma ve yazma sırasını sabitler.
- **Efor** S · **Hat** L-SAFE · **Bağımlılık** yok.

### B-34 · Veri dizini, sürüm, tek örnek kilidi, nazik durdurma
- **Neden.** ARCH S2: avukatın verisi **kodun içinde** (`VAR_DIR =
  <repo>/var`, `pgdata` scoop klasöründe) ve yolun içinde ASCII olmayan
  karakterler var (`yargı-anıl`) — klasörü taşımak kurulumu, klasörü
  değiştirmek veriyi bozar; yedek (B-03) ve güncelleme bunun üstüne kurulur.
  ARCH §6.1: **üç sürüm numarası çelişiyor** (`pyproject` 1.0.0,
  `package.json` 0.1.0, `API_VERSION` "1.0.0-w12") ve hiçbir kayıt hangi
  yapının ürettiğini söylemiyor. ENGRISK E10: `ColleX-Durdur.cmd`
  `taskkill /F` yapıyor, yani `serve.mjs`'in `shutdown()` yolu —
  `flush()`, pid temizliği, `sql.end()` — **hiç çalışmıyor**; E12b: sabırsız
  bir kullanıcının ikinci başlatıcı tıkı **açılmakta olan sunucuyu
  öldürüyor**. ARCH: hiçbir şey ikinci bir `serve.mjs`'in aynı
  `collex_local`'a bağlanmasını engellemiyor, oysa tek-worker invaryantı
  hız sınırlayıcının varsayımı.
- **Nasıl.** Tek `COLLEX_DATA_DIR` çözücüsü (varsayılan
  `%LOCALAPPDATA%\ColleX\data`) — `serve.mjs` (`VAR_DIR`, iki pid dosyası),
  `intake/quarantine.py` (`var/uploads`), başlatıcı ve durdurucu aynı değeri
  kullanır; mevcut `var/uploads` içeriği ilk açılışta taşınır. Tek `VERSION`
  dosyası (repo kökü), `API_VERSION` oradan okunur ve `pyproject.toml` ile
  eşitliği test edilir. `serve.mjs` başlangıcında DSN kapsamlı
  `pg_try_advisory_lock` → tutuluysa Türkçe mesaj + exit 1. Nazik durdurma:
  `serve.mjs` `var/collex.stop` dosyasını 500 ms'de bir yoklar;
  `ColleX-Durdur.cmd` önce onu oluşturur, 5 sn bekler, pid hâlâ duruyorsa
  `/F`; başlatıcı adım 1'den önce `collex.pid`'e bakar ve yaşayan ColleX
  sürecini **öldürmez** ("zaten başlıyor, bekleniyor").
  `pg_ctl -m fast -w stop` korunur (`-m immediate` **asla**).
- **Kabul ölçütü.** `tests/integration/launcher.test.ts` (bugün 7 test):
  nazik durdurma yolu `flush()` çağrısını gerçekten tetikler ve
  `var/collex.pid` **silinir**; ikinci başlatıcı tıkı çalışan sunucuyu
  öldürmez; ikinci `serve.mjs` aynı DSN'e bağlanamaz ve Türkçe mesajla
  exit 1 verir; `VERSION` ile `pyproject.toml` eşitliği testli;
  `COLLEX_DATA_DIR` ayarlıyken hiçbir bayt repo klasörüne yazılmaz.
  **Port bazlı kill geri gelmez** (mevcut invaryant).
- **Efor** M · **Hat** L-SAFE · **Bağımlılık** yok (B-03 bunun üstüne biner).

### B-35 · Harç / parasal sınır / AAÜT hesaplayıcısı
- **Neden.** APILEX: rakip bunu **blog yazısı** olarak veriyor (2026 yargı
  harçları, tebligat ücretleri, istinaf kesinlik sınırı — örnek yazı HMK
  Ek m.1 + VUK mük. m.298 üzerinden 2024/2025/2026 sınırlarını işliyor)
  [doğrulandı]; ne Apilex'te ne bizde bunun bir **araç** karşılığı var —
  hesaplayan kazanır ve bu tek kişilik büronun haftalık işidir. FEATURE aynı
  boşluğu iki durakta gördü (istinafta kesinlik sınırı kontrolü yok; harç ve
  AAÜT hiç yok). COPY ayrıca L2'de gösterdi: İİK m.363/1 notu parasal sınırı
  hiç anmıyor.
- **Nasıl.** `deadlines/` kalıbı **birebir kopyalanır** (saf TS, I/O yok:
  veri dosyası + `calc` + `routes` + `verified` alanı + değiştirilemez
  disclaimer): yeni `control-plane/src/fees/`. Yıl seçimli tarife verisi
  (başvurma, peşin, karar-ilam, istinaf/temyiz harçları; AAÜT kademeleri;
  istinaf/temyiz kesinlik sınırları). `GET /v1/fees/tariffs`,
  `POST /v1/fees/compute`. **Her kalem `verified.status:'dogrulanmadi'`
  başlar** ve ancak Resmî Gazete/tarife metni elde varken çevrilir —
  süre kurallarıyla **aynı disiplin**. Sonuç dosyaya `expense` öğesi olarak
  kaydedilebilir.
- **Kabul ölçütü.** `GET /v1/fees/tariffs` yıl bazlı tarifeyi döndürür ve
  doğrulanmamış her kalem `dogrulanmadi` taşır; bir dava değeri için hesap
  **adım adım** gösterilir; her ekranda ve her çıktıda tarife uyarısı birebir
  yer alır; `tests/fees/` kaynaksız `dogrulandi`'yı reddeder.
- **Efor** M · **Hat** L-LEGAL · **Bağımlılık** B-11 (aynı disiplin kalıbı).

### B-36 · Dosyalama öncesi doğrulama kontrol listesi + inceleme denetim izi
- **Neden.** GLOBAL: Harvey Academy kullanıcıya taslak elden çıkmadan önce
  atıfları, kilit iddiaları ve çapraz referansları teyit ettiren **üç adımlı
  bir alışkanlık** öğretiyor; Clearbrief raporunun asıl değeri "her sorunu
  kimin, nasıl, hangi notla ele aldığının izlenmesi" — tek kişilik büroda
  bile **altı ay sonra kendine karşı savunma** [doğrulandı]. ColleX'te dışa
  aktarım öncesi hiçbir insan onay adımı ve kanıt düzeyinde kalıcı inceleme
  durumu yok. Ayrıca ADR-022'nin elediği kanıt, aynı paragrafın "Alıntı ekle"
  penceresinde **hiçbir uyarı olmadan ilk sırada** listeleniyor — iki yüzey
  birbiriyle çelişiyor (UXAUDIT P1-21).
- **Nasıl.** Editörde üç kutulu **kalıcı** liste: (a) her `[K-n]` açıldı,
  (b) her `⚠ KAYNAKSIZ` paragraf gözden geçirildi, (c) KARŞI İÇTİHAT bölümü
  okundu. İşaretler taslak sürümüne yazılır ve **B-13'ün denetim raporuna
  düşer**. Dışa aktarımı **engellemez**; işaretlenmemişse çıktıda
  "doğrulama tamamlanmadı" satırı çıkar. Kanıt/atıf başına kalıcı inceleme
  durumu (incelendi + not + zaman) — additive taslak sürüm alanı ya da
  matter item `kind:'review'`. "Alıntı ekle" penceresi alaka kapısının
  elediği kanıtı **uyarıyla** gösterir. Dürüstlük sınırı: **biz
  doğrulamıyoruz, avukatın doğruladığını kaydediyoruz** — bu cümle arayüzde
  aynen yazılır.
- **Kabul ölçütü.** Kutular işaretlenmeden dışa aktarılan belgede
  "doğrulama tamamlanmadı" satırı bulunur; işaretlendiğinde satır kalkar ve
  denetim raporunda inceleyen/tarih/not görünür; işaretler taslak
  sürümleriyle birlikte kalıcıdır (yeniden başlatmada geri gelir);
  "Alıntı ekle" penceresinde elenmiş kanıtın yanında gerekçe rozeti çıkar.
- **Efor** M · **Hat** L-EVID (kayıt + rapor) + L-CONSOLE (liste) ·
  **Bağımlılık** B-13.

### B-37 · Belge ön incelemesinin kalitesi
- **Neden.** İki hat aynı kusurları ölçtü. UXAUDIT: "TARİHLER" listesindeki
  yedi parçanın **hepsi kelime ortasından** kesilmiş; "TALEPLER" dilekçenin
  numaralı SONUÇ VE İSTEM maddelerini (fesih, tahliye, 148.500 TL)
  **kaçırmış**, iki yan cümle bulmuş; "ATIFLAR"da sözleşmenin **kendi madde
  numarası** kanun maddesi gibi çıkıyor ve `TBK m. 315` ile `m. 315` iki ayrı
  satır oluyor. DAILYFLOW: `kira_sozlesmesi.txt`'te **müvekkil bulunamadı**
  ("KİRAYA VEREN: Ali Yılmaz" açıkça yazıyor), `ihtarname.docx`'te **aynı
  vekil iki kez** (FIX-2 tekilleştirmesi `references`/`dates`'e uygulanmış,
  `parties`'e değil), "İHTAR EDEN"/"MUHATAP" hiç yakalanmamış [ölçüldü].
- **Nasıl.** `intake/analysis.py`: bağlam kırpması **kelime sınırında**;
  `parties` tekilleştirmesi (normalize edilmiş ad üzerinden) ve Türk dilekçe
  rol etiketleri (`KİRAYA VEREN`, `KİRACI`, `İHTAR EDEN`, `MUHATAP`,
  `DAVACI`, `DAVALI`, `VEKİL`); talep çıkarımı numaralı SONUÇ VE İSTEM
  bloğunu önceler; referans çıkarımında **kanun bağlamı olmayan "madde N"**
  hukukî atıf sayılmaz ve `TBK m.315` ile bağlamdan çözülen `m.315` tek
  satırda birleşir (`legal_reference/` kısaltma tabloları zaten var).
  Ayrıca GLOBAL'in üç kova kuralı: çıktı **eşleşti / belirsiz / bulunamadı**
  olarak ayrılır.
- **Kabul ölçütü.** `tests/intake/test_analysis.py`: sentetik kira
  sözleşmesinde hem kiraya veren hem kiracı çıkar; ihtarnamede vekil **tek**
  satır; hiçbir bağlam kelime ortasından başlamaz veya bitmez; sözleşme
  madde numaraları `references`'ta görünmez; numaralı talep maddeleri
  yakalanır.
- **Efor** S/M · **Hat** L-SAFE · **Bağımlılık** yok.

### B-38 · Türkçe kısa-biçim atıf ayrıştırma (iki runtime, tek fixture)
- **Neden.** GLOBAL: Free Law'ın `eyecite`'ı tam atıf, kısa biçim, `supra`,
  `id.` ve `ibid.` referanslarını **ayrı ayrı** tanıyor ve 50 M+ atıfa karşı
  test edilmiş. Türkçe karşılıkları "anılan karar", "aynı yönde", "yukarıda
  anılan", "agk.", tekrar eden "m. …" biçimleridir. Bizim ayrıştırıcımız
  bunları tanımıyorsa **karşı taraf denetimi (B-13) sessizce eksik kalır** —
  ve sessiz eksik, bu üründe en kötü hata biçimidir.
- **Nasıl.** `legal_reference/` (Python) **ve**
  `control-plane/src/retrieval/referenceParser.ts` (TS) — CLAUDE.md
  invaryantı: **ikisinde birden ya da hiçbirinde**. Türkçe kısa-biçim
  kalıpları eklenir; `evals/fixtures/reference_parity.json` genişletilir.
- **Kabul ölçütü.** Genişletilmiş `reference_parity.json` her iki runtime'da
  da geçer; "yukarıda anılan TBK m.315" ve tekrar eden "m.352" gibi kısa
  biçimler bağlamdan çözülür; çözülemeyen kısa biçim **"belirsiz"** kovasına
  düşer, asla tam atıf gibi gösterilmez.
- **Efor** M · **Hat** L-SOURCES · **Bağımlılık** yok (B-13'ün kalitesini
  belirler).

---

## F. Yığın — P2: cila

Bu kalemler ürünü **profesyonel** yapar ama hiçbiri bir vaadi kurtarmaz.
Hepsi tek hatta sığar ve hiçbiri bir invaryantı zorlamaz.

### B-39 · Tasarım sistemi: rakamlar, iki yazı tipi, ölçek disiplini
DESIGN'ın "en yüksek etkili 10" listesinin 1, 2, 7, 8 ve 10 numaraları.
(1) `font-variant-numeric: lining-nums tabular-nums` — esas no, madde no,
tarih, tutar ve sayaç anında "veri" gibi görünür; hukuk yazılımında en
görünür detay, maliyeti **tek CSS bloğu** (bugün "54", "13", "30" taban
altında oturuyor `[ekran]`). (2) İki yazı tipi: kabuk `--ui`, hukuk metni
`--serif` (~15 satır). (7) Gölge hafifletme + yarıçap düşürme + `.card:hover`
kaldırımının kaldırılması — "bulut" görünümü gider, kâğıt gelir. (8) 29 punto
→ 9, 34 boşluk → 10, 18 harf aralığı → 2, small-caps kaldırılır (mekanik ama
geniş; **en son yapılır**). (10) `--measure: 68ch` + tek kap (1152 px);
bugün `body.compact`'ta satır başına 115–125 karakter. **Kısıt:** CSP
`font-src 'none'` ve `img-src 'none'` — webfont ve görsel **yasak**, satır
içi `<svg>` serbest; tek `<style>`, tek `<script>`, yalnız `textContent`.
**Kabul:** `console.test.ts` punto/boşluk token sayısını ve
`font-variant-numeric` kuralını sabitler; hiçbir `@font-face`, `url(` ya da
`<img` eklenmez. **Efor** M · **Hat** L-CONSOLE.

### B-40 · Belge sayfası ve cevap kartının uzunluğu
Belge sayfası sekmelenir, UUID/offset/hash satırları `<details>` içine alınır
(DESIGN: 4 321 px → ~1 400 px); 390 px'te dosya tablosu yerine **kart
listesi** (UXAUDIT P1-17: bugün tablo kendi kabında 611 px'e taşıyor ve
`Sonraki süre` sütunu — mobildeki **en kritik bilgi** — ekran dışında
kalıyor); belge sayfasının ilk ekranı künye değil **belge metni + "Belgeye
sor"** ile başlar (bugün `Parmak izi (SHA-256)` mobilde ilk alan).
**Kabul:** 1440 px'te belge sayfası yüksekliği ≤ 2 000 px; 390 px'te dosya
listesinde "sonraki süre" görünür. **Efor** M · **Hat** L-CONSOLE.

### B-41 · Modal, kaydırma ve gezinme kırıkları
Modal başlığı `position: sticky` (UXAUDIT P1-15: pencere kaydırılınca
`Kapat` düğmesi `top: -560` ile görünüm dışına çıkıyor, geriye yalnız Esc
kalıyor ve o da artık ekranda yazmıyor); modallar `history.pushState` ile
geri tuşuna bağlanır (P1-16: süre penceresi açıkken geri tuşu **arkadaki
ekranı** taslak editörüne çevirdi, pencere açık kaldı); şablon seçimi
formu `scrollIntoView` eder ve katalog tek satırlık "Seçilen şablon: … —
değiştir" şeridine iner (P1-5: form 5 500 px'lik sayfanın 2 581. px'inde,
seçimde `scrollY` 8'de kalıyor — avukat basıyor, ekranda hiçbir şey
değişmiyor); `scroll-behavior: smooth` genelden kaldırılır; kaydedilmemiş
taslak uyarısı yerel `confirm()` yerine ürünün kendi modalı olur.
**Kabul:** modal başlığı her kaydırma konumunda görünür; geri tuşu modalı
kapatır ve alttaki ekranı değiştirmez; şablon seçiminden sonra form
görünümde. **Efor** M · **Hat** L-CONSOLE.

### B-42 · Kişi kartları + menfaat çatışması uyarısı
`contact { ad, tckn|vkn, adres, telefon, eposta, uetsAdresi, rol }`; dosya
bu kayda referans verir; taslak ön-dolumu kişiden okur; yeni dosya açarken
"bu müvekkilin diğer dosyaları" ve **menfaat çatışması uyarısı** ("bu ad
karşı taraf olarak şu dosyada geçiyor"). Bugün `client`/`opposing` düz
metin, her taslakta yeniden yazılıyor ve çatışma taraması **imkânsız**.
Mevcut taşlar: `intake/analysis.py::extract_parties` (B-37 ile düzelmiş
hâli), `drafting/input.ts DraftParty` (aynı alan seti),
`settings/store.ts` (kalıcı jsonb kalıbı). **Kabul:** bir kişi bir kez
girilir, iki dosyada kullanılır; aynı ad karşı taraf olarak girilince uyarı
çıkar; taslak blokları kişiden dolar ve "otomatik — kontrol edin" çipi
taşır. **Efor** M · **Hat** L-MATTER.

### B-43 · "Nerede kalmıştım" + araştırma geçmişinin kullanılabilirliği
`GET /v1/matters/{id}/activity?since=` — son N kayıt (cevap/taslak/belge/
not/olay/süre) tek listede, tür + başlık + zaman. DAILYFLOW: bir hafta
sonra dönen avukat bugün **dört sekmeyi tek tek gezmek** zorunda;
`lastActivityAt` var ama neyin değiştiği yok. Yanında: dosya bazlı
"Bu dosyada daha önce sorulanlar" (uç zaten var, yalnız UI) ve aynı sorunun
ikinci kez sorulmasında tekilleştirme. **Kabul:** dosya sayfası açılışında
son 10 hareket tek listede görünür ve her satır kendi ekranına gider.
**Efor** S · **Hat** L-MATTER.

### B-44 · Depo temizliği ve okunabilirlik borcu
ARCH S13: `example_fastapi_app.py` (80 KB), `migration_app.py`,
`redis_session_store.py` (17 KB, hiçbir şey referans vermiyor),
`Dockerfile`, `railway.json`, `control-plane/dist/` (7 modüllük bayat kısmi
yapı — `ts-loader.mjs` **hiç okumuyor**), `control-plane/test/` (dört
hiç koşmamış kopya): ~200 KB, bir build ajanının yanlış cevap bulacağı yer
(ARCH raporunda yazarı `dist/` yüzünden zaman kaybettiğini söylüyor).
S11: `hybrid.ts` içinde **ham NUL baytı** (47 720. bayt) — `file` kaynağı
`data` diye raporluyor, `grep` dosyayı ikili sayıp atlıyor. S9: GG.AA.YYYY
biçimi TS'te dört, Python'da bir kez daha uygulanmış, hiçbir yere
sabitlenmemiş → tek `src/format/date.ts` + Python ile paylaşılan fixture.
S10: `coverage.ts`'in ~120 durak sözcüğü + `stemTurkish`'i ile
`lexicalEntailment.ts`'in **22** durak sözcüğü ve **stemmer'sızlığı**
birbirine sabitlenmemiş — aynı Türkçe metin üzerinde iki farklı kapı kararı
veriyorlar. **Kabul:** `npx tsc --noEmit` temiz; silinen dosyalara hiçbir
import kalmaz; `date.ts` fixture'ı iki runtime'da geçer; iki durak sözcük
listesinin ilişkisi bir testle sabitlenir. **Efor** M · **Hat** L-SAFE.

### B-45 · Küçük dayanıklılık kalemleri (ENGRISK E15, E18–E22)
Ledger'da olup diskte olmayan migration için additive `unknown[]` + Türkçe
uyarı ("Veritabanı bu sürümden daha yeni — ColleX'i güncelleyin");
başlatıcı `pg_isready` başarılıysa kümenin **ColleX'in veri dizini**
olduğunu doğrular (yanlış kümede "bütün dosyalarım gitti" paniği);
`collex.console.filehistory.v1` en yeni 100 `fileId` ile sınırlanır;
tarayıcı ↔ sunucu saat sapması > 24 saat ise üst çubukta uyarı (yanlış
saatli makinede "değerlendirme tarihi" ve süre başlangıçları sessizce
yanlış olur); `GET /v1/files/{id}` parça önizlemeleri de enjeksiyon
taramasından geçer (bugün cevapta işaretlenen yük, belge sayfasında
işaretsiz); `mcpState` 60 sn sonra `'starting'`den `'down'`a düşer ve
konsolda "canlı araştırma için sunucuyu yeniden başlatın" görünür;
cevap önbelleği tavanı (32 × 5 MiB) RUNBOOK §7'ye yazılır.
**Efor** S · **Hat** L-SAFE.

### B-46 · Belge uzlaştırması (dürüstlük borcu)
Bu dalganın sonunda tek hatta toplanır ve **hiçbir sayıyı yeniden
ölçmeden** yazılmaz:
- `STATUS.md` — "Ölçülen sayılar" tablosu yeniden ölçülür (S1–S9);
  "Kalıcılık sözü · Çekince 1" **bugünkü kodu olduğundan kötü anlatıyor**:
  `POST /v1/answer`, `POST/PUT /v1/drafts`, `POST /v1/ai/draft-paragraph`,
  tüm `/v1/matters*` ve `PUT /v1/settings` yollarında cevap **yazma
  sonuçlandıktan sonra** dönüyor (ENGRISK E10 tablosu); gerçek kayıp
  penceresi yalnız `POST /v1/research/start` (202) ve `matterLink`'tir —
  bu, kullanıcıya verilen güvencenin **artmasıdır**. "Known risks"e yedek
  (E1) ve 20 000 parçada ölçülen cevap süresi (E2) satırları.
- `CLAUDE.md` — ledger invaryantı probe'un "dosyanın **SON** yarattığı
  şeyi" adlandırması gerektiğini söyler (B-05); yeni uçlar ve yeni
  `.cmd` dosyaları directory map'e girer.
- `COMPETITIVE.md` — §1'in "De Jure'de dosya/proje/klasör kavramı geçmiyor"
  satırı **düzeltilir** (artık yanlış); De Jure'nin doğruluk garantisinin
  **dar kapsamlı** olduğu yazılır (aksi hâlde eleştirimiz haksız görünür);
  fiyat satırına paket→özellik kilidi ve **indirimli** rakam (İzmir Barosu
  üyesi için Pro 48.000 / 60.000 ₺) eklenir; Apilex'in girişsiz UDF
  dönüştürücüsü, ISO 42001/EU AI Act rozetleri ve `apilex.legal` eklenir.
- `KULLANIM-ColleX.md` — "verileriniz bu bilgisayarda" cümlesi yedek
  düğmesiyle **tamamlanır**; tek paragraflık "verileriniz nereye gidiyor"
  bölümü (rakiplerin alt işleyen boşluğuna karşı); "not 64 KB" → gerçek
  sınır (20 000 karakter); varsayılan kapsam değişikliği (B-20).
- `RISKS.md` #22 tamamlanır (pid dosyalarını bırakan şey **ürünün kendi
  durdurucusudur**); `ADRS.md`'ye yeni ADR'ler (alıntı bütünlüğü kapısı,
  geriye uyumlu migration kuralı); `RUNBOOK.md` §7'ye bellek tavanı ve
  `statement_timeout` 15 sn; `openapi.yaml` bütün additive alanlarla
  (`35 yol / 44 işlem` sayısı yeniden sayılır).
**Kabul:** hiçbir belgede STATUS tablosunda satırı olmayan bir sayı
bulunmaz; `openapi.yaml` çözülmeyen `$ref` taşımaz; `docs/` içindeki her
rakip iddiası etiket + URL + erişim tarihi taşır. **Efor** M · **Hat**
L-DOCS (Faz B).

---

## G. Dalga planı — eşzamanlı hatlar ve AYRIK dosya sahipliği

**Bu bölüm bağlayıcıdır.** Build ajanları aynı anda koşar; bir dosyanın
**tek bir sahibi** vardır. Sahibi olmayan bir hat o dosyaya dokunmaz; ihtiyaç
duyarsa sahibine spesifikasyon olarak yazar ve kendi kaleminden o parçayı
düşürür.

### G.1 Faz A — yedi hat paralel

| Hat | Kalemler | **Sahip olduğu dosyalar (yalnız bunlar)** |
|---|---|---|
| **L-EVID** | B-01, B-02, B-13, B-24, B-30(paket), B-36(kayıt) | `control-plane/src/drafting/**` **hariç `templates.ts`** · `control-plane/src/verification/**` · yeni `control-plane/src/contracts/**` · `export/**` (`draft.py`, `petition.py`, `udf.py`, `text.py`, `bundle*.py`, `cli.py`, appendix) · `control-plane/tests/drafting/**` **hariç `templates.test.ts`** · `tests/export/**` |
| **L-ANSWER** | B-06, B-07, B-08, B-09, B-31 | `control-plane/src/answer/**` · `control-plane/src/pipeline/**` **hariç** `tests` · `control-plane/src/retrieval/{hybrid,normalize,rrf,corpusErrors}.ts` · `control-plane/src/store/chunkStore.ts` · `control-plane/src/llm/**` · `control-plane/src/evidence/types.ts` · `control-plane/src/planner/contrary.ts` · `control-plane/tests/{answer,pipeline,quality}/**` **hariç `tests/pipeline/console.test.ts`** · `control-plane/tests/store/retrieval.test.ts` |
| **L-SAFE** | B-03, B-04, B-05, B-12, B-19(intake), B-23, B-32(migration+metadata), B-33, B-34, B-37, B-44, B-45 | `control-plane/src/api/{server.ts,localGuard.ts,healthReport.ts,consoleGuard.ts}` · `control-plane/src/store/{health.ts,db.ts}` · `control-plane/src/ai/**` · `ingestion/**` · `intake/**` · `control-plane/scripts/{serve,serve-mcp,demo}.mjs` · `ColleX-*.cmd` (+2 yeni) · `.github/workflows/ci.yml` · `supabase/migrations/<yeni dosyalar>` · `VERSION` · `control-plane/tests/{api.test.ts,store/persistence.test.ts,integration/**,ai/**}` · `tests/{ingestion,intake}/**` · silinecek upstream artıkları |
| **L-MATTER** | B-17, B-18, B-26, B-29, B-30(`/original`), B-32(files/answers), B-42, B-43 | `control-plane/src/matters/**` · `control-plane/src/files/**` · `control-plane/src/settings/**` · `control-plane/src/deadlines/{dates,holidays,calc,routes}.ts` · `control-plane/src/api/answerService.ts` · `control-plane/src/store/{answerStore,draftStore,persistNotice}.ts` · `control-plane/tests/{matters,files,deadlines,settings}/**` |
| **L-LEGAL** | B-11, B-25, B-35 | `control-plane/src/drafting/templates.ts` · `control-plane/src/deadlines/rules.ts` · yeni `control-plane/src/fees/**` · `control-plane/tests/drafting/templates.test.ts` · `control-plane/tests/deadlines/rules.test.ts` · `control-plane/tests/fees/**` |
| **L-SOURCES** | B-14(uç), B-15, B-16(uç), B-20, B-38 | `control-plane/src/planner/{templates,rulePlanner,intake,outcomes}.ts` · `control-plane/src/research/**` · `control-plane/src/retrieval/{searchService,referenceParser}.ts` · `control-plane/src/capabilities/**` · yeni `control-plane/src/sources/**` · `legal_reference/**` · `evals/fixtures/reference_parity.json` · `control-plane/tests/{research,planner,capabilities}/**` |
| **L-CONSOLE** | B-10, B-21, B-22, B-27, B-28 (Faz A dilimi) | `control-plane/public/console.html` (**MÜNHASIR**) · `control-plane/src/api/consolePage.ts` · `control-plane/tests/pipeline/console.test.ts` |

**Sözleşmeler (Faz A başlamadan yazılır, sonra değişmez):**
1. **`server.ts` yalnız L-SAFE'indir.** Yeni router mount edecek hatlar
   (L-SOURCES → `/v1/sources/*`, L-EVID → `/v1/contracts/*`, L-LEGAL →
   `/v1/fees/*`) yollarını **dalga başında** L-SAFE'e bildirir; L-SAFE
   bütün mount satırlarını **tek seferde** ekler ve boş router dosyaları
   ilgili hatlar tarafından doldurulur.
2. **`console.html`'e Faz A'da yalnız L-CONSOLE dokunur.** Diğer hatların
   UI ihtiyacı (B-13 tablosu, B-14 sayfası, B-16 sekmesi, B-17 takvimi,
   B-19 klasör bırakma, B-36 kutuları) Faz B'de aynı hat tarafından
   uygulanır; Faz A'da o kalemlerin **sunucu tarafı** teslim edilir ve
   hat raporuna tam UI sözleşmesi (uç, gövde, alan adları) yazılır.
3. **`openapi.yaml`'a Faz A'da kimse dokunmaz.** Her hat additive alan
   deltasını kendi raporunda listeler; L-DOCS Faz B'de tek seferde işler.
4. **`STATUS.md` ve `CLAUDE.md`'ye Faz A'da kimse dokunmaz** (L-DOCS,
   Faz B). Hatlar ölçtükleri sayıyı **kendi raporlarına** yazar.
5. **Yeni migration dosyası yalnız L-SAFE tarafından yaratılır** (B-05'in
   çoklu sentinel grameriyle). L-MATTER ve L-SOURCES gereken indeks/
   sütunları L-SAFE'e bildirir.
6. **`evals/` altına yalnız L-SOURCES ve L-ANSWER yazar**
   (`reference_parity.json` L-SOURCES, gold/fixture L-ANSWER).
7. Hiçbir hat `package.json`, `.env`, `collex_local` ya da
   `../_baseline-backup/` dosyalarına dokunmaz. Probe veritabanları hat
   başına ayrıdır ve dalga başında dağıtılır (`collex_demo` paylaşılıyorsa
   `--force-drop-uploads` **kullanılmaz**).

### G.2 Faz B — üç hat paralel (Faz A birleştikten sonra)

| Hat | İş | Sahip olduğu dosyalar |
|---|---|---|
| **L-CONSOLE (B)** | Faz A'nın yeni uçlarını bağlar: B-13 tablosu, B-14 kapsam sayfası, B-16 `#karar-ara`, B-17 takvim + hazırlık kartı, B-19 klasör bırakma, B-30 "Aslını indir", B-36 kontrol listesi, B-39/B-40/B-41 cila | `control-plane/public/console.html`, `consolePage.ts`, `console.test.ts` |
| **L-DOCS** | B-46 | `docs/**`, `CLAUDE.md`, `control-plane/src/api/openapi.yaml` |
| **L-VERIFY** | Tam ölçüm turu: `tsc --noEmit`, `vitest run`, `pytest tests evals/tests`, `smoke_check`, `http_e2e_check`, `live_local_gateway_check`, `db_local_check`, `run_evals`, `demo.mjs`; **ENGRISK'in 20 000 parçalık probe DB'si yeniden kurulup B-06 ölçümü tekrarlanır**; tarayıcı yürüyüşü (BROWSER LANE) | hiçbir ürün dosyası — yalnız kendi raporu |

### G.3 Sıra ve kapılar

1. **Kapı 1 (Faz A ortası):** B-04, B-06, B-12 iner. Bu üçü birlikte yarım
   günlük iştir ve en büyük üç riski kapatır (tarayıcı üzerinden yazma/okuma,
   ölçekte kullanılamazlık, kalıcılık katmanının CI körlüğü — ENGRISK §10).
2. **Kapı 2 (Faz A sonu):** B-01 ve B-02 birlikte doğrulanır — **ürünün ana
   vaadi ve ilk kez mahkemeye gidebilen çıktısı**. B-01 inmeden B-02
   birleştirilmez.
3. **Kapı 3 (Faz B):** L-VERIFY'ın ölçümleri olmadan `STATUS.md`
   güncellenmez; tek bir sayı bile yeniden ölçülmeden yazılmaz.
4. **Vaporware kapısı:** inmemiş hiçbir kalem konsolda kart, düğme veya
   sekme olarak görünmez (B-22).

### G.4 Bu dalgada bilinçle YAPILMAYANLAR

Hat raporlarında geçen, gerekçesiyle ertelenen kalemler — bir sonraki
dalganın girdisi olsun diye kayda geçiyor:
- **Şablonların ve süre kurallarının JSON'a taşınması** (ARCH S7/§7.4).
  Doğru fikir; B-11 ve B-25 zaten aynı dosyaları değiştiriyor, ikisini aynı
  anda yapmak hem hukukî içeriği hem taşıma hatasını aynı diffe koyar.
- **`console.html`'in altı-sekiz bloğa bölünmesi** (ARCH S6). CSP bunu
  engellemiyor (`buildConsoleCsp` **her** bloğu hash'liyor); engelleyen tek
  şey iki test iddiası. Ama bu dalgada L-CONSOLE zaten beş kalem taşıyor;
  bölme, ondan sonra tek başına yapılmalı.
- **Taşınabilir paket / gömülü Node + PostgreSQL** (ARCH §5.3). B-34
  (`COLLEX_DATA_DIR` + `VERSION`) bunun **ön koşuludur** ve bu dalgada
  iniyor; paketin kendisi ayrı bir dalgadır.
- **Yerel (bulutsuz) OCR** (FEATURE F15). Harici ikili bağımlılık ve kurulum
  yükü; "her şey bilgisayarınızda" sözünü tamamlayan tek yol ama bu dalganın
  bağımlılık disiplinine sığmıyor.
- **AİHM/HUDOC, Reklam Kurulu, RTÜK araçları.** Tool yüzeyi **54'te
  sabittir** (CLAUDE.md kural 4); önce açık bir invaryant kararı gerekir.
  B-14 bu boşlukları **ilan eder** — bu dalganın doğru cevabı budur.
- **Tahsilat, müvekkil portalı, muhasebe, icra takip motoru** (TRMARKET'in
  beş pazar kaleminden ikisi). Ya eklenir ya iddia daraltılır; bu dalga
  iddiayı "araştırma + dilekçe + süre + dosya" olarak **daraltıyor** ve
  B-46 bunu KULLANIM-ColleX.md'ye yazıyor.
- **UDF'nin UYAP Doküman Editörü'nde açılması.** Kod işi değil, **kullanıcı
  işi** (STATUS Next actions #4). B-02 dosyayı UYAP'ın kabul ettiği biçime
  hazırlar; açılana kadar **"deneysel" etiketi kalır** — bu bizim
  duruşumuzdur, gizlenmez.

---

## H. Dürüstlük notları

- Bu belge **hiçbir yeni ölçüm yapmadı**. Alıntılanan her sayı bir hat
  raporundaki ölçüme ya da `STATUS.md` S1–S22'ye aittir; hiçbiri hukukî
  kalite ölçüsü değildir (`evals/fixtures/corpus/` **sentetiktir** ve
  `collex_local` **boştur**).
- Rakip satırları hat raporlarının etiketleriyle taşındı; hiçbiri yeniden
  teyit edilmedi. Etiketsiz tek bir rakip iddiası yoktur.
- Efor tahminleri (S/M/L) bu deponun mimarisine ve test disiplinine göredir;
  hiçbiri ölçülmüş bir süre değildir.
- UXAUDIT P1-3'ün kök nedeni (listeleme ucunun veritabanında olmayan
  dosyalar döndürmesi) **hâlâ açıklanmadı**; B-10 belirtiyi kurtarıyor,
  nedeni değil. L-MATTER bunu B-26 sırasında araştırmalı ve bulgusunu
  raporuna yazmalıdır.
- Wayback üzerinden 12 aylık rakip diff'i iki hatta da alınamadı (HTTP 429);
  "değişti" diyen her satır arşive değil, **iki tarihli kendi ölçümümüze**
  dayanır (28.08.2026 ve 02.09.2026).
