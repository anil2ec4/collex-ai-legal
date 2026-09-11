# W14 — C-UI (Faz C, cila hattı): konsolun ayakta kalan altı kusuru

**Tarih:** 03.09.2026 · **Tip:** DÜZELTME — bu hattın dokunduğu ürün dosyası
**iki tanedir**: `control-plane/public/console.html` ve
`control-plane/tests/pipeline/console.test.ts`. Üçüncü dosya bu rapordur.
**Port:** 8976 (sunucu) · 8986 (MCP geçidi) — **8787/8898'e hiç dokunulmadı**.
**Veritabanı:** `collex_demo` (koşu başında ve koşu sonunda `demo.mjs
--force-drop-uploads` ile yeniden kuruldu; bayrak yalnız **kendi** probe
yüklemem için). **`collex_local`'a hiç bağlanılmadı.**
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, MCP yüzeyi (54)
değişmedi, API sözleşmesine dokunulmadı.

> Bu raporda yazan her sayı **bu koşuda, bu makinede, gerçek bir tarayıcıda
> (Playwright)** ölçüldü. Ölçmediğim yere "ölçmedim" yazdım. Korpus sayıları
> **SENTETİK** deneme korpusundadır ve hukukî kalite ölçüsü değildir; "Karar
> ara" sayıları ise **gerçek Bedesten/UYAP** yanıtlarından gelir ve
> **ilgililik denetimi değildir** (§1.4).

---

## 0. Yönetici özeti

| # | Kusur (F-VERIFY §6) | Hüküm | Ölçülen: önce → sonra |
|---|---|---|---|
| **N-4** | "Karar ara" satırında eşleşen cümle yok; liste tek daireye/tek güne yığılıyor | **KAPANDI (liste) · KISMÎ (sıralama)** | Satırın ikinci satırı **0/10 → 13/13, 20/20, 10/10 satırda dolu**; yığılma **1 merci / 1 gün → 8, 7 ve 2 merci / 8–11 ayrı gün** |
| **N-6** | Yeni açılan dosya aktif olmuyor | **KAPANDI** | `#matterselect.value` **`""` → yeni dosyanın kimliği**; hemen ardından yapılan yükleme **dosyaya bağlandı** (`matterId` eşleşti) |
| **N-5** | Korpus cevap kartı 6 135 px | **KAPANDI** | `#out` **6 108 → 5 051 px** (6,79 → **5,61 ekran**); tespit kartı **365 → 179 px**; ilki açık, kalanı katlı, sayılar ekranda |
| **N-2** | Ayarlar "var/uploads" diyor | **KAPANDI** | İki yerde standart ifade: **`<veri klasörü>/uploads (varsayılan: var/uploads)`**; sayfada etiketsiz tek bir `var/uploads` kalmadı |
| **V-10 kal.** | İlk kaydetmede 224 px sıçrama | **KAPANDI** | **−224 px → 0 px** (birinci, ikinci ve üçüncü kaydetmede 0) |
| **V-22 kal.** | İlk içerik %37'de | **KAPANDI** | Künye **235 → 129 px**; ilk içerik kartı **336 px (%37,3) → 220 px (%24,4)**; dürüstlük bandı 143 px (%15,9) |

**Kapılar:** `npx tsc --noEmit` **temiz (exit 0)** · `console.test.ts`
**165/165 geçti** (152 → 165, **+13 test**) · her yeni testin **kusuru geri
koyunca düştüğü** ayrı ayrı gösterildi (§4) · tarayıcıda **yakalanmamış JS
istisnası 0** · **390 px'te 12/12 ve 960 px'te 13/13 görünümde yatay kayma
yok**.

**Tam süit (kapanışta ölçüldü): `npx vitest run` → 103 dosya · 2 114 geçti ·
0 DÜŞTÜ · 6 atlandı (2 120), 22,26 sn, exit 0.** (Koşu ortasında paralel
sunucu hattının `tests/api.test.ts > N-1 · trigram threshold provenance`
testi bir tur düşmüştü — testi inmiş, `src/store/chunkStore.ts` yorumu henüz
inmemişti. O dosyaya dokunmadım; kapanış turunda o da yeşil.)

---

## 1. N-4 — "Karar ara": eşleşen cümle ve sıralama

### 1.1 Kusurun gerçek sebebi (ölçüldü, tahmin değil)

Bedesten'in **arama** yanıtı künye alanlarından ibarettir; içinde ne bir özet,
ne bir eşleşen cümle, ne de bir ilgililik puanı vardır. Ürünün satır şekli
(`SourceSearchRow`) `snippet` alanını taşır ama **gelmez**:

```
POST /v1/sources/search {"query":"tahliye taahhüdü","sources":["yargitay"],"limit":20}
  -> 200 · 10 satır · snippet dolu olan satır: 0 / 10
     örnek satır: title "Yargıtay 3. Hukuk Dairesi E. 2025/6254 K. 2026/3320"
                  court/docketNo/decisionNo/decisionDate/sourceUrl · snippet YOK
```

Konsolun eski satır kodu `if (r.title && r.title !== kunyeLine(r))` diyordu.
`title` künyenin **başka bir yazılışıdır** (nokta/ayraç farkı), yani şart
teknik olarak doğruydu ama satıra **künyenin ikinci kopyasını** yazdırıyordu;
`snippet` dalına ise hiç girilmiyordu. Sonuç: avukat 20 satırın hangisinin
işine yaradığını göremiyordu — F-VERIFY'ın tespiti aynen doğru.

İkinci sebep **sıralamadır ve kaynağındır**. Aynı sorgu, aynı araç, tek fark
tırnak:

| Sorgu | `total_records` | İlk sayfadaki merciler |
|---|---:|---|
| `tahliye taahhüdü` (tam ifade **kapalı**) | **116 090** | **hepsi 8. Ceza Dairesi, hepsi 02.07.2026** |
| `"tahliye taahhüdü"` (tam ifade **açık**) | **758** | 3. HD ×5, 11. HD ×2, 1. HD, 12. HD, 7. HD |

Yani kaynak, tırnaksız sorguyu **sözcüklere bölüp** yüz binlerce kararı
eşleştiriyor ve sonucu **karar tarihine göre yeniden-eskiye** sıralıyor.
F-VERIFY'ın gördüğü "hepsi 8. Ceza Dairesi, 01.07.2026" tablosu **bu**.

### 1.2 Yapılanlar (yalnız istemci tarafı)

1. **Her satırda ikinci satır var.** Kaynak bir cümle verdiyse o yazılır;
   vermediyse satır boş bırakılmaz: *"Eşleşen cümle sağlanmadı — bu kaynak
   liste satırında metin döndürmüyor."* (`title` sadece künyeyi tekrar
   ediyorsa özet sayılmaz — `titleAddsNothing()`.)
2. **"Tam ifade" varsayılan AÇIK.** Kutunun altında ne yaptığını yazan bir
   satır var; kapatmanın sonucu ("liste çok genişler ve kaynak onu genellikle
   ilgililiğe göre değil, karar tarihine göre sıralar") açıkça yazılı. Sonuç
   listesinin başında **"tam ifade"** çipi durur, böylece listeyi hangi kipin
   ürettiği görünür.
3. **Boş sonuç tek tıkla geri alınır:** "Tam ifade olmadan yeniden ara".
4. **Sayfanın şekli sayıyla söylenir:** *"Bu sayfa: 7 ayrı merci · en çok:
   Yargıtay 5. Hukuk Dairesi (8) · karar tarihleri 16.04.2025 – 03.06.2026."*
   Avukat "bu liste tek daireye ve tek güne yığılmış" tespitini tek bakışta
   yapar.
5. **Sıralama ve süzme denetimi:** kaynağın kendi sırası (varsayılan) · karar
   tarihi yeniden-eskiye · karar tarihi eskiden-yeniye · merci adına göre;
   yanında "Listede süz" kutusu (merci, esas no, karar no).
6. **Sınırın kendisi ekranda yazılı:** *"Sıralamayı kaynak sunucu belirler;
   ColleX yalnız ELİNDEKİ sayfayı yeniden sıralar ve süzer. Bu bir ilgililik
   sıralaması değildir — kaynağın sonraki sayfalarında daha uygun kararlar
   olabilir."*

### 1.3 Dört yapısal olarak farklı gerçek arama (tarayıcıda, `--with-mcp`)

Hepsi varsayılan iki kaynakla (Yargıtay + Danıştay), sırayla, tek tek.

| # | Sorgu | Künye | Süre | Sayfanın şekli (ekrandaki cümle) | Eşleşen cümle |
|---|---|---:|---:|---|---|
| 1 | `tahliye taahhüdü` (iki sözcük, özel hukuk) | **13** | 6 610 ms | 8 ayrı merci · en çok **Yargıtay 3. HD (5)** · 29.09.2021 – 20.05.2026 | 13/13 satırda "sağlanmadı" |
| 2 | `kamulaştırmasız el atma` (üç sözcük, idare/eşya) | **20** | 6 592 ms | 7 ayrı merci · en çok **Yargıtay 5. HD (8)** · 16.04.2025 – 03.06.2026 | 20/20 |
| 3 | `işçilik alacaklarında zamanaşımı` (çekimli, iş hukuku) | **10** | 6 629 ms | 2 ayrı merci · en çok **Yargıtay 9. HD (9)** · 16.04.2025 – 08.02.2026 | 10/10 |
| 4 | `kiracının depozitoyu geri alma hakkı ne zaman doğar` (cümle) | **0** | 6 599 ms | — (boş) | — |
| 4b | aynı sorgu, **tam ifade kapatılarak** (ekrandaki düğmeyle) | **20** | 6 660 ms | 3 ayrı merci · en çok **Yargıtay 8. Ceza Dairesi (10)** · 04.03.2026 – 01.07.2026 | 20/20 |

**Bu tablodaki dürüst okuma:**

* Tam ifade açıkken **daire dağılımı konuya oturuyor**: tahliye taahhüdünde
  kira dairesi (3. HD), kamulaştırmasızda kamulaştırma dairesi (5. HD) ve imar
  dairesi (Danıştay 6.), işçilik alacağında iş dairesi (9. HD). 3. sorguda
  Danıştay sıfır satır döndürdü — bir iş hukuku sorusu için **doğru** cevap.
* **Tarih yığılması tam ifadeyle kırılıyor:** 1 gün → 8–11 ayrı gün.
* **4b satırı kusurun kendisini bilerek yeniden üretiyor:** aynı soru, tırnak
  yok → 20 satırın 10'u tek daire, tek gün (01.07.2026). F-VERIFY'ın gördüğü
  tablo budur ve sebebi ColleX'in sıralaması değil, **tırnaksız sorgunun
  kaynakta yüz binlerce kayda açılmasıdır**.
* **İlgililik doğrulaması (F-VERIFY'ın yapamadığı):** iki ayrı satırın tam
  metnini çektim ve sorgu ifadesini metinde **aradım**:
  – `tahliye taahhüdü` / 3. HD 2025/6254: metin 6 433 karakter, ifade
  **3 023. konumda** ("…davacının **tahliye taahhüdüne** dayalı olarak
  başlattığı icra takibine…").
  – `kamulaştırmasız el atma` / 7. HD 2025/4595 (listenin **ilk** satırı):
  metin 4 803 karakter, ifade **4 692. konumda**; kaynak kartı SHA-256
  `9ff48064123b…`, sağlayıcı BEDESTEN.
  Yani tam ifadeyle gelen satırlar, denediğim ikisinde de sorguyu gerçekten
  içeriyor.

### 1.4 İstemciden düzeltemediklerim — açıkça

* **Sıralamayı ben yapamam.** Kaynak 20 satırlık bir sayfa verir; ColleX'in
  elinde 116 090 kaydın hiçbiri yoktur. Ekrandaki sıralama denetimi **yalnız
  gelen sayfayı** yeniden dizer ve bunu ekranda söyler. Gerçek bir ilgililik
  sıralaması ancak sunucu tarafında (birden çok sayfa çekip yeniden puanlama)
  yapılabilir; **bu hattın işi değildir ve yapılmamıştır.**
* **Eşleşen cümleyi ben üretemem.** Kaynağın arama yanıtında metin yoktur;
  cümleyi üretmenin tek yolu her satır için tam metni çekmektir (satır başına
  ~6,5 sn ve devlet sunucusuna 20 ayrı istek). Bunu yapmadım; satırda
  **cümlenin neden olmadığını yazdım**. Alternatifi sunucu tarafında
  ölçülmelidir (§7, IR-2).
* **Kaç kayıt olduğunu ekranda yazamıyorum.** Kaynak `total_records`
  döndürüyor (`116 090` / `758`) ama ürünün satır şekli onu taşımıyor; bu
  bilgi olmadan avukat 20 satırın buzdağının ucu olduğunu göremez. Ek alan
  isteği §7, IR-2.
* **İlgililik ölçmedim.** İki tam metin, bir ilgililik denetimi değildir.
  Sıralamayı kaynak sunucunun mu yoksa ColleX'in gönderdiği parametrelerin mi
  belirlediği sorusunun cevabı ölçülerek şudur: **kaynak sunucu belirliyor**
  (tek değişken tırnaktı ve sonuç tamamen değişti) — ama bu bir ilgililik
  kalitesi ölçümü değildir.

---

## 2. N-6, N-5, N-2 — tek tek

### 2.1 N-6 · Yeni dosya artık aktif dosya oluyor

**Sebep (kod okundu, tahmin değil):** `submitNewMatter()` önce
`setActiveMatter(m)` çağırıyordu. O da `renderMatterSelect()`'i tetikliyor;
orada yeni dosya **henüz `mattersCache`'te olmadığı** için `seen` false
kalıyor ve B-10'un ölü-dosya budaması (`if (activeMatter && !seen &&
mattersLoaded) { forgetActiveMatter(); }`) dosyayı **aynı karede** unutuyordu.

**Düzeltme:** dosya ÖNCE listeye konur, SONRA aktif yapılır. B-10 kapısı
gevşetilmedi — sadece doğru sırayla beslendi. (Aynı desen zaten süre
penceresindeki "Dosyayı aç ve süreyi kaydet" yolunda vardı.)

**Ölçüm (tarayıcı):**

```
önce : #matterselect.value = ""            · localStorage anahtarı YOK  (kusur)
sonra: #matterselect.value = a9a21c77-…    · seçili metin "Dosya: Yılmaz / Kaya kira tahliye"
       localStorage: collex.console.matter.v1 yazıldı
       yükleme ipucu: "Aktif dosya: Yılmaz / Kaya kira tahliye — yüklenen belgeler bu dosyaya bağlanır."
```

**Kanıt, hemen ardından yapılan gerçek yükleme:** `+ Yeni dosya` → `Belgeler`
→ `c-ui-kira-sozlesmesi.txt` yüklendi → `GET /v1/files`:

```
fileId 6cccbaac8ba97110 · matterId a9a21c77-c4f1-4ea9-a5f5-89d852eb4c8d
                        · matterTitle "Yılmaz / Kaya kira tahliye"
```

### 2.2 N-5 · Tespit kartları katlanıyor

Katlanmış kartta ekranda **kalanlar** bilerek seçildi: hüküm çipi, **güven /
dürüstlük cümlesi** (*"Dikkat: 'Kaynak isabeti' boyutu zayıf (%45) — dayanak
yapmadan önce kaynağı mutlaka okuyun."*), tespit metninin ilk **iki satırı** ve
**sayılar** (*"Doğrulanmış atıf: 1 · Karşıt otorite: 1"*). Katlanan yalnız
ayrıntıdır: tam metin, "[n] numaralı kaynağa git", güven ölçerleri ve atıf
bağlantıları. **§ Kaynaklar bölümü hiç değişmedi** — sekiz kaynak kartı her
hâlükârda tam listedir. Yazdırmada (`@media print`) katlama **tümüyle
kalkar**: kâğıda her tespit tam basılır.

| Ölçüm (1440×900, 7 tespitli ŞERHLİ korpus cevabı) | Önce | Sonra |
|---|---:|---:|
| `#out` yüksekliği | **6 108 px** | **5 051 px** |
| Ekran sayısı (900 px) | 6,79 | **5,61** |
| Tespit kartı yüksekliği | 365 / 343 / 371 / 343 / 365 / 365 / 365 | **387 (açık) + 6 × 179** |
| "Tümünü aç" ile | — | 6 302 px |
| "Tümünü kapat" ile | — | **4 835 px** |

**Dürüst sınır:** kazanç %17'dir, çünkü kalan 5 051 px'in büyük kısmı tespit
kartları değil, **sekiz kaynak kartı ve uyarı/işlem izi bölümleridir**. Onları
katlamak "kaynak kartları erişilebilir kalsın" şartıyla çelişirdi;
katlamadım. Yani UXAUDIT P1-6'nın "tespit kartları katlanmıyor" gözlemi
kapandı, "cevap kartı uzun" gözlemi **kısmen** duruyor.

### 2.3 N-2 · "Verilerim nerede?"

Sunucu hattının raporu bu koşuda henüz inmemişti; görev tanımındaki standart
ifade **birebir** kullanıldı. İki yerde:

* Ayarlar › Verilerim nerede?: *"…yüklediğiniz belgelerin aslı veri
  klasörünüzün altındaki **&lt;veri klasörü&gt;/uploads (varsayılan:
  var/uploads)** klasöründe durur. Veri klasörünün yeri kurulumda belirlenir;
  ColleX'i başlatan pencerede "veri" satırında yazılıdır."*
* Yedekleme kartı › geri yükleme anlatımı: *"…veritabanı dökümü ve
  "&lt;veri klasörü&gt;/uploads (varsayılan: var/uploads)" klasörü birlikte
  geri alınır."*

Testte **sayfanın tamamı taranır**: `var/uploads` dizisinin her geçişinin
hemen öncesi `"varsayılan: "` olmak zorundadır; etiketsiz tek bir geçiş
kalırsa test düşer.

*Ölçmediğim:* ekranda veri klasörünün **gerçek yolunu** yazamıyorum, çünkü
`/v1/health` onu bildirmiyor (§7, IR-1). Bu yüzden cümle yolu değil, **yolun
nerede yazdığını** söylüyor.

---

## 3. V-10 ve V-22 kalıntıları

### 3.1 V-10 · Sıçramanın gerçek sebebi

`preserveFocusPosition()` zaten vardı ve doğruydu; **çapası yoktu**.
`lockSubmit()` "Kaydet" düğmesini istek boyunca `disabled` yapar, **devre dışı
bir düğme odağı kaybeder**, dolayısıyla cevap dönüp yeniden düzenleme
koştuğunda `document.activeElement` **`<body>`** oluyordu ve sarmalayıcı
hiçbir şeyi dengelemiyordu. Tarayıcıda doğrulandı: tıklamadan sonra
`document.activeElement` **`BODY`**.

**Düzeltme:** sarmalayıcı isteğe bağlı bir **açık çapa** alır; `saveSettings`
isteği gönderen düğmeyi verir. Mekanizmanın kendisi değişmedi.

| Kaydetme | Önce | Sonra |
|---|---:|---:|
| 1. (ilk-koşu → kompakt geçişi) | **−224 px** | **0 px** (`scrollY` 469 → 360, yani sayfa 109 px'lik daralmayı telafi etti) |
| 2. | 0 px | **0 px** |
| 3. | 0 px | **0 px** |

Ayrıca V-22 düzeltmesi ilk-koşu kabuğunu kompakt kabuğa yaklaştırdığı için
**ham fark da küçüldü**: telafi edilmesi gereken kayma 224 px değil, 109 px.

### 3.2 V-22 · İlk içerik %24,4'te

İlk-koşu künyesinden giden üç şey: (a) üst çubuğun 40 px altındaki
monogramın **ikinci kopyası**, (b) marka ile slogan arasındaki satır
kırılması (ikisi tek satıra indi), (c) iki süs çizgisi. **Marka, slogan,
sekmeler ve SENTETİK dürüstlük bandı yerinde.** Blok
`@media (min-width: 481px)` içine alındı; 480 px'in altındaki dar kabuk
kurallarını özgüllükle geri açmasın diye.

| Ölçüm (1440×900, ilk koşu: profil boş + dosya yok) | Önce | Sonra |
|---|---:|---:|
| `header.masthead` yüksekliği | 235 px | **129 px** |
| Dürüstlük bandı (`.stamp`) üstü | 251 px (%27,9) | **143 px (%15,9)** |
| İlk içerik kartı (`#welcome`) üstü | **336 px (%37,3)** | **220 px (%24,4)** |

Kompakt (profil doldurulduktan sonraki) kabuğun **hiçbir ölçüsü
değişmedi** — testte hem kompakt hem 480 px kuralları ayrıca pinlendi.

---

## 4. Testler — 13 yeni test, on üçü de boş değil

`console.test.ts` **152 → 165 test**; hepsi geçiyor. Her yeni testin
**kusuru geri koyunca düştüğü** ayrı ayrı gösterildi: `console.html` üzerinde
tek bir kusur geri konur, süit koşar, dosya bayt bayt geri yüklenir
(betik: `scratchpad/w14c-C-UI/vacuity.mjs`).

| Geri konan kusur | Sonuç |
|---|---|
| N-2 · standart ifade → çıplak `var/uploads` | **DÜŞTÜ** |
| N-4 · eski `title !== kunyeLine` dalı geri | **DÜŞTÜ** |
| N-4 · sıralama çubuğu kaldırıldı | **DÜŞTÜ** |
| N-4 · "Tam ifade" varsayılanı kapatıldı | **DÜŞTÜ** |
| N-5 · "ilk kart açık" varsayılanı bozuldu | **DÜŞTÜ** |
| N-5 · sayı satırı katlanan bölüme taşındı | **DÜŞTÜ** |
| N-6 · `setActiveMatter` yeniden öne alındı | **DÜŞTÜ** |
| V-10 · açık çapa argümanı kaldırıldı | **DÜŞTÜ** |
| V-22 · ilk-koşu bloğu devre dışı | **DÜŞTÜ** |

Dokuzunda da `console.html` geri yüklemesi bayt bayt doğrulandı.

**Değiştirilen tek eski iddia:** F-UI'nin V-10 testindeki
`"function preserveFocusPosition(fn)"` dizesi, imza artık isteğe bağlı bir
çapa aldığı için `"function preserveFocusPosition(fn, explicitAnchor)"`
oldu. Testin **sözleşmesi zayıflamadı**: sarmalayıcının varlığı, delta
ölçümü ve "odak yokken hiçbir şey yapma" kuralı aynen duruyor, üstüne C-UI
bloğunda **açık çapanın gerçekten geçirildiği** ayrıca pinlendi.

---

## 5. Konsol sözleşmesi ve erişilebilirlik kapıları

| Kapı | Ölçülen |
|---|---|
| CR baytı | **0** |
| `<style>` / `<script>` | **1 / 1** |
| Yasak DOM/kod kanalları (9 kalıp) | **0 eşleşme** (süit) |
| 127.0.0.1 dışı `http(s)://` | **0** |
| `npx tsc --noEmit` | **temiz, exit 0** |
| `console.test.ts` | **165/165** |
| Tarayıcıda yakalanmamış JS istisnası / promise reddi | **0 / 0** |
| Ağ günlüğündeki tek hata satırı | `POST /v1/sources/search` **400** — "Karar ara" ekranının **bilerek geçersiz** geçit yoklaması (F-UI §7.1'de zaten kayıtlı) |
| Yatay kayma 1440 px | yok (`scrollWidth` 1 425) |
| Yatay kayma **960 px (= 1440 @ %150)** | **13/13 görünümde yok** (945) |
| Yatay kayma **390 px** | **12/12 görünümde yok** (375); açık ve koyu temada aynı |
| Yeni satırın satır yüksekliği | `.srcrow` en çok **53 px** (tavan 96 px) |
| Yeni denetimlerin erişilebilirliği | sıralama `<select>` ve süzgeç `<input>` etiketli (`<label for>`), katla düğmesi `aria-expanded` taşıyor |

Ekran görüntüleri (1440×900, 960×900, 390×844; açık ve koyu) alındı ve
tek tek bakıldı: ilk açılış, "Karar ara" sonuçları + getirilmiş kaynak kartı,
katlanmış tespit listesi, Ayarlar "Verilerim nerede?".

---

## 6. Ayakta kalanlar

1. **N-4'ün sıralama yarısı KISMÎ.** İstemci yalnız gelen sayfayı dizer;
   gerçek ilgililik sıralaması sunucu işidir (§1.4).
2. **N-5 kazancı %17.** Cevap kartı hâlâ 5,6 ekran; kalanı kaynak kartları ve
   uyarı bölümleridir (§2.2).
3. **İlk-koşu durumu doğrudan `#ayarlar` ile açıldığında bazen kompakt
   çiziliyor.** `maybeWelcome()` ayarlar gelmeden bir kez koşarsa
   `settingsCache` `null` olduğu için ilk-koşu kabuğu hiç açılmıyor; sonraki
   çağrı bunu düzeltiyor ama `#ayarlar`'a doğrudan girişte düzelmeyebiliyor.
   **Ölçtüm, düzeltmedim** — görev listesinde yok ve `maybeWelcome`'ın çağrı
   sırası bu hattın kapsamındaki altı kalemin hiçbirine dokunmuyor. Bir
   sonraki cila dalgasına.
4. **"Karar ara" listesinde kaç kaydın var olduğu yazmıyor** — sunucudan ek
   alan gerekiyor (§7, IR-2).

---

## 7. Entegrasyon istekleri (başka hatların dosyaları)

**IR-1 · `/v1/health` veri klasörünü bildirsin (ek alan).**
Dosya: `control-plane/src/api/healthReport.ts` (+ `server.ts` bağlaması,
`openapi.yaml`). İstenen: `uploadsDir` (veya `dataDir`) adında **additive**
bir alan — `createApp`'in zaten tek elden çözdüğü `uploadsDir` değeri.
Gerekçe: Ayarlar › "Verilerim nerede?" bugün klasörün **yerini** değil,
**nerede yazdığını** söyleyebiliyor; alan gelirse konsol gerçek yolu
gösterebilir ve N-2 tam kapanır.

**IR-2 · `POST /v1/sources/search` kaynağın kayıt sayısını taşısın (ek alan).**
Dosyalar: `control-plane/src/sources/searchService.ts`,
`control-plane/src/research/payloads.ts`. İstenen: kaynak başına
`totalRecords` (Bedesten yanıtındaki `total_records`; yoksa `null`, asla 0).
Gerekçe: bu koşuda ölçüldü — `tahliye taahhüdü` **116 090**, `"tahliye
taahhüdü"` **758** kayıt. Avukat 20 satırın hangisinin ucunda durduğunu
göremiyor; "20 künye getirildi" cümlesinin yanında "kaynakta N kayıt var"
yazabilmek, tam ifade kararını da tek bakışta gerekçelendirir.

**IR-3 · N-2'nin sunucu yarısı.** F-VERIFY §9.3'ün istediği gibi
`control-plane/src/files/routes.ts`, `.../matters/packageRoutes.ts` ve
`openapi.yaml` da aynı ifadeye (`<veri klasörü>/uploads (varsayılan:
var/uploads)`) geçsin. Konsol yarısı bu raporla kapandı.

---

## 8. Hijyen

* Açtığım her sunucu **nazikçe** kapatıldı (`<veri>/collex.stop`; pid dosyası
  kayboldu). `netstat`: **8976 ve 8986'da dinleyici yok**; **8787/8898'e hiç
  dokunulmadı**.
* Hata ayıklama için tek seferlik açtığım MCP geçidi (port **8987**) —
  `serve-mcp.mjs`'in bearer belirtecini elle vermek zorunda olduğum tek
  yerdi — ölçüm bitince **öldürüldü**. O süreç ayaktayken
  `tests/integration/serve.test.ts`'in süreç listesi taraması **haklı olarak
  düştü** (kendi kabuk satırımda 48 haneli belirteç görünüyordu); süreç
  kapatıldıktan sonra aynı test **geçti**. Bunu yazıyorum çünkü bir sonraki
  okuyucu aynı tuzağa düşebilir: **o düşüş üründe değil, ölçen kişideydi.**
* `COLLEX_DATA_DIR` scratch'e verildi; depo `var/` altına **hiçbir pid dosyası
  ve hiçbir yükleme yazılmadı**.
* `collex_demo` koşu sonunda `demo.mjs --force-drop-uploads` ile **yeniden
  kuruldu** (bayrak yalnız kendi probe yüklemem için): 6/6 senaryo PASS.
  **`collex_local`'a hiç bağlanılmadı.**
* Devlet upstream'lerine giden istekler: **5 arama** (§1.3) ve **2 tam metin
  çekimi**; hepsi tek tek, **paralel değil**. Başka dış çağrı yok.
* Playwright'ın çalışma alanına düşürdüğü **kendi** artefaktlarım
  scratchpad'e taşındı; başka hatlara ait dosyalara dokunulmadı.
* Geçici dosyaların tamamı `…/scratchpad/w14c-C-UI/` altında.

### Değişen depo dosyaları

```
control-plane/public/console.html                 (bu hattın münhasır dosyası)
control-plane/tests/pipeline/console.test.ts      (bu hattın münhasır dosyası)
docs/implementation/waves/W14-C-UI.md             (bu rapor)
demo-output/report.md                             (demo.mjs'in KENDİ çıktısı)
```
