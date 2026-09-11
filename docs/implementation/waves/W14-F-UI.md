# W14 — F-UI (Faz C): avukatın ekranındaki on beş kusur

**Tarih:** 02.09.2026 · **Sahiplenilen dosyalar:**
`control-plane/public/console.html`, `control-plane/src/api/consolePage.ts`
(**değişmedi**), `control-plane/tests/pipeline/console.test.ts`
· **Port:** 8973 (sunucu) · 8974 (MCP geçidi, yalnız son turda)
· **Veritabanı:** `collex_demo` (koşu başında `demo.mjs --force-drop-uploads`
ile yeniden kuruldu; probe kayıtları koşu sonunda silindi)
· **`collex_local`'a hiç bağlanılmadı.** Hiçbir git işlemi yapılmadı, `.env`
okunmadı, Supabase/Resend kullanılmadı, MCP araç yüzeyi (54) ve
`openapi.yaml` bu hatta **hiç değişmedi**.

> Bu raporda yazan her sayı **bu koşuda, bu makinede, gerçek tarayıcıda**
> ölçüldü. Ölçüm yöntemi L-VERIFY'ın kullandığı yöntemin aynısıdır
> (`getBoundingClientRect`, `document.documentElement.scrollWidth`, sarmalanmış
> `window.fetch` sayacı, WCAG bağıl parlaklık). Ölçmediğim hiçbir şey için
> hüküm vermedim.

---

## 0. Kapılar

| Kapı | Sonuç |
|---|---|
| `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok, exit 0) |
| `control-plane> npx vitest run` | **102 dosya · 2 081 geçti · 0 DÜŞTÜ · 6 atlandı (2 087)** · 24,09 sn |
| `control-plane> npx vitest run tests/pipeline/console.test.ts` | **152 geçti** (L-VERIFY turunda 129) |
| Yakalanmamış JavaScript istisnası | **0** (12 görünüm × 1440 / 960 / 390 px, iki tema) |
| 390 px'te yatay kayma | **yok** — 12/12 görünümde `scrollWidth 375 ≤ 390` |
| 960 px'te (= 1440 @ %150) yatay kayma | **yok** — 12/12 görünümde `scrollWidth ≤ 960` (11'i 945, `#harc` 960) |
| Konsol sözleşmesi | CR **0** · `<style>` **1** · `<script>` **1** |

Konsolda kaydedilen tek hata satırı, V-3 için **bilerek** yapılan geçit
yoklamasının HTTP yanıtıdır (geçit yokken 502, bağlıyken 400). Bu bir
JavaScript istisnası değil, tarayıcının ağ günlüğüdür; §7'de dürüstçe
kaydedildi.

**Zayıflatılan, atlanan ya da silinen test yok.** Dört mevcut iddia
güncellendi; her birinin gerekçesi §6'da tek tek yazılı ve üçü **negatif**
iddiaya çevrildi (kusurun geri gelmesi artık testi kırar).

---

## 1. Ölçülen sonuç — kalem kalem

| # | Kusur (L-VERIFY) | Önce (ölçülen) | Sonra (bu koşuda ölçülen) |
|---|---|---|---|
| **V-5** | Aktif dosya yokken hesaplanan süre kayboluyor | `POST /v1/matters//items` → 404 · pencere kapanıyor · toast **"HTTP 404"** | **0 istek** · pencere açık · sonuç **08.09.2026 ekranda duruyor** · toast yok, yerine pencere içinde Türkçe açıklama |
| **V-7** | "Alıntı ekle" elenmiş kanıdı uyarısız sunuyor | K-1…K-6, uyarı yok, tek tık | 2/2 elenen kaynak **ayrı başlık** altında, `ALAKASIZ GÖRÜNÜYOR — hukuk alanı bu belgeyle uyuşmuyor` çipiyle; **düğme onay kutusu işaretlenene kadar kapalı** |
| **V-8** | Modal açıkken Geri alttaki ekranı değiştiriyor | hash `#taslak`, görünüm değişti, **modal açık kaldı** | 1. Geri: **modal kapandı**, hash `#dosyalarim` **değişmedi**, görünüm değişmedi · 2. Geri: görünüm `#taslak` |
| **V-9** | Modal kaydırılınca "Kapat (Esc)" görünmüyor | `top = -560 px` | panel sonuna kadar kaydırıldığında (869/869) `top = **+77 px**`, tamamen görünümde — 1440 ve 960 px'te aynı |
| **V-10** | Profil kaydedince yerleşim sıçraması | **449 px** | **0 px** (`Kaydet` düğmesi 428 → 428) |
| **V-11** | Şablon amacı ilk noktada kesiliyor | 7/7 dilekçe şablonu "…(HMK m." | **13/13 tam ifade**; `m.` / `vd.` ile biten **0** kart |
| **V-12** | "Kayıtlı taslaklar" yenilenmiyor | tek seferlik | `#taslak`'a her dönüşte **`GET /v1/drafts?limit=20`** |
| **V-13** | Boş sorguyla "Ara" hiçbir şey yapmıyor | 0 istek, 0 kalıcı geri bildirim | 0 istek + **22 px'lik kalıcı doğrulama satırı**, `aria-invalid="true"`, odak alana döner |
| **V-15** | Koyu temada alt metin 4,37:1 / 12,5 px | 4,37:1 | **5,40:1 / 13 px** (canlı ölçüm: `rgb(154,144,120)` üzerine `rgb(32,27,21)`); token her iki temada panel/panel-2/paper üstünde **≥ 4,5:1** |
| **V-16** | Dosya sayfasında veritabanı adı | "Belge deposu: collex_demo" | dosya sayfasında **0**; ayrıca **üst çubuk rozetinden** ("Veritabanı: bağlı · collex_demo") ve **deneme damgasından** kaldırıldı. Teknik ad **yalnız Ayarlar**'da |
| **V-17** | Şablon seçince form katlamanın altında | form 1 319 px, `scrollY 0` | `scrollY 0 → **1 170**`, form görünümün en üstünde, **ilk alan odaklandı** (`tpl-mahkeme`) |
| **V-18** | Türkçe cümlenin içinde çıplak makine adı | belge sayfasında `ANTHROPIC_API_KEY tanımlı değil — …` | belge sayfasında **0 makine dizesi, 0 UUID**; dosyada kalan tek geçiş Ayarlar › Sistem durumu satırında, Türkçe cümlenin ardından parantezde |
| **V-20** | 390 px'te dosya tablosu | 554 px içerik / 345 px kap | **kart listesi**: tablo 289 px / kap 345 px · `documentElement.scrollWidth 375 ≤ 390` · hiçbir sütun atılmadı, her hücre kendi Türkçe etiketiyle |
| **V-22** | İlk açılışta içerik 537 px'te | 537 px (900 px ekranın **%60**'ı) | **369 px (%41)**; künye bloğu (masthead) **396 → 268 px** (%44 → **%30**) |
| **V-3 (arayüz sonucu)** | "Karar ara" tam etkin çiziliyor, arama 502 | ekran çalışır görünüyor | ekran **ucun kendi cevabına** bakıyor — §4 |

---

## 2. V-5 — dört kusur, dört düzeltme

**Kök neden ölçüldü.** `selectInput(mattersCache.map(…), "")` — istenen değer
(`""`) hiçbir seçeneği eşleştirmediği için `<select>`'in `selectedIndex`'i
**-1**, `value`'su **boş** kalıyordu. Ekran "bir dosya seçili" gibi duruyor,
düğme boş kimlikle istek gönderiyordu.

1. **İstek yok.** Liste artık görünür bir `— dosya seçin —` satırıyla başlar
   ve `if (!msel.value) { explainNoMatter(); return; }` isteği **başlamadan**
   durdurur. Ölçüldü: sarmalanmış `fetch` sayacı **0**.
2. **Türkçe açıklama, iki çıkış yolu.** Pencere içinde uyarı bloğu:
   listeden seçme **ya da** oracıkta yeni dosya açma
   (`POST /v1/matters {title, kind:"dava"}` → açılan dosya seçiliyor, aktif
   yapılıyor ve süre **aynı tıkla** kaydediliyor) — ya da "Dosyalarım'a git".
3. **Hesap korunuyor.** Pencere kapanmıyor; açıklama hesaplanan son günü
   (`08.09.2026`) tekrar yazıyor. Ölçüldü: `#docmodal` açık, `.duebig`
   metni değişmedi.
4. **Çıplak makine dizesi yok.** `errTR` artık her HTTP durumu için bir
   **Türkçe cümle** döndürür (`httpStatusTR`), kodun kendisi yalnız cümlenin
   **ardından parantezde** durur. Bilinmeyen bir `kind` geldiğinde sunucunun
   kendi Türkçe cümlesi öne geçer, kod parantezde kalır.

**Toast denetimi (bug sınıfı).** Sayfadaki bütün `toast(...)` çağrıları
tarandı: `HTTP` geçen üç çağrının üçü de artık `httpStatusTR(...)` üzerinden
Türkçe cümle + parantez biçiminde; bir test bunu regex ile sabitliyor. Kalan
tek belirsiz yol `humanError(error)`'ın beklenmedik bir JS istisnasının
İngilizce mesajını geçirebilmesidir (§7).

**Mutlu yol bozulmadı:** dosya seçiliyken aynı akış
`POST /v1/matters/<uuid>/items` → 201 → *"Süre dosyaya kaydedildi:
08.09.2026"* → pencere kapanıyor ve geçmiş girdisi geri veriliyor
(`history.state === null`).

---

## 3. V-8 / V-9 — pencereler

**V-8.** Her pencere geçmişe **kendi girdisini** bırakır
(`history.pushState({collexModal:true}, "", location.href)` — adres değişmez).
`popstate` penceresi kapatır ve **görünüme dokunmaz**. Kullanıcı pencereyi
kendisi kapatırsa girdi `history.back()` ile geri verilir, böylece ölü bir
"geri" basışı kalmaz. Pencere içinden pencere açılırsa (`"keep"`) geçmişte
**tek** girdi kalır. Hash gerçekten değişirse açık pencere de kapanır.

Ölçülen (L-VERIFY'ın repro adımlarıyla birebir):

```
#taslak → #dosyalarim → pencere aç → history.back()
  önce      : modal true  · hash #dosyalarim · taslak gizli
  1. geri   : modal FALSE · hash #dosyalarim · taslak gizli   ← görünüm değişmedi
  2. geri   : modal false · hash #taslak     · taslak açık
```

**V-9.** `.docpanel` artık **kendisi** kaydırılır (yalnız `formpanel` değil) ve
`.dochead` `position: sticky; top: -22px` ile panelin iç boşluğunu örten
negatif kenar boşluklarıyla üste yapışır. Ölçülen: panel sonuna kadar
kaydırıldığında `Kapat (Esc)` `top = +77 px`, `inView: true` — 1440 ve 960 px,
her iki temada.

---

## 4. V-3'ün arayüz sonucu — ekran artık sağlık rozetine değil, uca bakıyor

L-VERIFY'ın ölçtüğü hâl: `/v1/health mcp:"ok"` ve
`/v1/research/health {"gateway":"ok"}` iken bile `POST /v1/sources/search`
**502** dönüyordu, ama ekran tam etkin çiziliyordu (W13-BACKLOG §G.3.4
vaporware kapısının ihlâli).

Ekran artık açılışta **ucun kendisine** soruyor. Yoklama gövdesi bilerek
seçildi: **şemayı geçer** (`query` ≥ 2 karakter), böylece yönlendiricinin
geçit denetimine ulaşır; ama `yearFrom > yearTo` olduğu için geçit **varsa**
istek 400 ile durur — yani **hiçbir resmî kaynağa istek gitmez**.

| Yoklama cevabı | Ekran |
|---|---|
| **502** (geçit yok) | Kırmızı şerit *"Karar arama bu sunucuda çalışmıyor"* + neden + Kapsam ekranına yönlendirme; **bütün form alanları kapalı ve soluk** (`form.gateoff`). Sunucunun kendi cümlesi (komut satırı bayrağı taşıyabildiği için) katlanır **"Teknik ayrıntılar"** bloğunda |
| **400** (geçit bağlı) | Nötr şerit *"Kaynak geçidi bağlı"* + dürüstlük cümlesi (*"Kaynakların kendisine bu makineden ulaşılıp ulaşılamadığı yalnız gerçek bir aramada belli olur"*); form açılır ve **süzgeçlerin kendi yetenek kilitleri geri konur** |
| başka / ağ hatası | Sarı şerit *"Kaynak geçidinin durumu belirlenemedi"*; form açık, ama sebep yazılı |

**Koordinasyon — F-API ile ölçüldü (koşunun sonunda).** F-API'nin düzeltmesi
indi: `control-plane/src/api/server.ts` artık
`const sourcesGateway = gateway ?? researchGateway;` diyor ve
`createSourcesRouter`'a geçiriyor. Bu makinede ölçtüğüm:

```
serve.mjs --port 8973 --mcp-port 8974 --with-mcp   →  /v1/health mcp:"ok"
POST /v1/sources/search {query, yearFrom:2001, yearTo:2000}  →  HTTP 400
   {"kind":"INVALID_REQUEST", issues:[{path:"yearFrom", …}]}
```

Yani **502 gitti**; ekran `--with-mcp` ile açıldığında etkin, `--with-mcp`
olmadan kapalı çiziliyor. **Gerçek bir arama koşturmadım**: devlet
upstream'lerine bu hattan tek bir istek gitmedi, dolayısıyla "bağlansaydı
künye döner miydi" sorusu bu hatta **ölçülmedi** — ekranın söylediği de tam
olarak budur.

---

## 5. V-11 — Türkçe hukuk metninde cümle sonu

Eski kural `^[^.!?]{3,120}[.!?]` idi: Türk hukuk metnindeki her künye bir
nokta taşır (`HMK m.119`, `TBK m.502 vd.`, `T.C.`, `1.`), bu yüzden kesme
noktası **künyenin ortasına** düşüyordu.

Yeni bölücü bir noktayı cümle sonu saymak için **üç şart** arar: (a) parantez
**dışında** olmak, (b) ardından **boşluk** gelmesi (`m.119` bölünmez),
(c) öncesindeki sözcüğün bilinen bir kısaltma, tek harf ya da sayı
**olmaması** — ve devamın büyük harfle başlaması. Künye parantezini kapatan
`)` sonrası nokta ise **gerçek cümle sonudur**. Hiçbiri tutmazsa amaç cümlesi
ilk **üst düzey iki nokta üst üstede** biter (bu metinlerde alan sayımı orada
başlar).

13 şablonun tamamı ölçüldü; birkaç örnek:

```
Hukuk mahkemesine sunulacak dava dilekçesi taslağı (HMK m.119)
İlk derece kararına karşı istinaf başvuru taslağı (HMK m.342; süre HMK m.345 — kararın tebliğinden itibaren iki hafta)
Noter aracılığıyla gönderilecek ihtarname taslağı
Bağımsız hizmet sağlayıcıdan hizmet alımına ilişkin sözleşme taslağı (TBK m.502 vd. vekâlet veya m.470 vd. eser, işin niteliğine göre).
4857 sayılı İş Kanunu'na tabi belirsiz süreli iş sözleşmesi taslağı (İş K. m.8 — yazılı sözleşme)
```

Tam açıklama `title` ipucunda duruyor; kart iki satıra kırpılıyor
(`-webkit-line-clamp: 2`).

---

## 6. Güncellenen dört mevcut test — neden ve nasıl

Hiçbir iddia gevşetilmedi; dördü de **bu dalgada değişen gerçeği** kaydediyor
ve üçü negatif iddiaya çevrildi.

1. **`"Belge deposu:"`** (V-16). Cümle duruyor; veritabanı adı gitti. İddia
   `toContain("Belgeler bu bilgisayarda saklanır")` +
   **`not.toContain("Belge deposu:")`** + rozetin eski biçiminin yokluğu oldu.
2. **`"ANTHROPIC_API_KEY tanımlı değil"`** (V-18, iki testte). Tek Türkçe
   cümle (`AI_OFF_TEXT`) pinlendi; ayrıca **dosyadaki `ANTHROPIC_API_KEY`
   geçiş sayısının tam olarak 1 olduğu** sabitlendi (Ayarlar satırı).
3. **LANG-7 "names cloud AI …"**. Pinlenen cümle
   `"Bulut yapay zekâ bu sunucuda kapalı"` oldu; yasaklı varyantların
   (`Bulut Yapay Zekâ`, `bulut ai`, `yapay zeka`, `Cloud AI`) hepsi aynen
   yasak kalmaya devam ediyor.
4. **V-12 iddiası** `renderSavedDrafts()` çağrı sayısını (**3**) ve
   `showView` dalındaki yeni çağrıyı sabitliyor.

### 6.1 Boşluk denetimi — sekiz kusur bilerek geri kondu

Her biri **tek tek** geri kondu, süit koşturuldu, geri alındı. Sekizinin
sekizi de **tam bir testi kırmızıya** çevirdi (152 → 151 geçti / 1 düştü):

| Geri konan kusur | Sonuç |
|---|---|
| `--ink-faint` koyu temada `#8a8069` | 1 düştü |
| `if (!msel.value)` kapısı devre dışı | 1 düştü |
| `errTR` eski `"HTTP " + status` biçimi | 1 düştü |
| `.dochead` `position: static` | 1 düştü |
| Onay kutusu düğmeyi her hâlde açıyor | 1 düştü |
| `popstate` dinleyicisi boşaltıldı | 1 düştü |
| `sentenceCut` yeniden adlandırıldı | 1 düştü |
| `table.matters thead` yeniden görünür | 1 düştü |

Eklenen 23 testin bir kısmı yapısaldır (kaynak dizesi araması); bunu
dürüstçe kaydediyorum: bir dize aranıyorsa davranışın kendisi değil,
davranışı taşıyan satır sabitlenmiş oluyor. İki iddia bu kuralın dışındadır
ve **hesaplanır**: `--ink-faint`'in üç yüzeye karşı WCAG oranı iki temada da
kodda hesaplanıyor, ve bütün `toast(...)` çağrıları regex ile taranıp
`HTTP` geçen her birinin `httpStatusTR` üzerinden gitmesi zorunlu kılınıyor.

---

## 7. Ölçmediklerim ve açık kalanlar — dürüst kayıt

1. **Geçit yoklaması tarayıcı ağ günlüğüne bir satır yazıyor.** Yoklamanın
   cevabı 4xx/5xx olduğu için tarayıcı `Failed to load resource` satırı
   basıyor (geçit yokken 502, bağlıyken 400). Bu bir **JavaScript istisnası
   değildir** (yakalanmamış istisna sayısı bütün koşuda **0**), ama konsol
   günlüğünde görünür. Sessiz bir yol için okuma amaçlı bir uç gerekir —
   §8(1).
2. **Gerçek bir kaynak araması koşturulmadı.** Devlet upstream'lerine bu
   hattan **tek bir istek gitmedi**; "Karar ara" ekranının sonuç listesi bu
   koşuda **hiç** çizilmedi.
3. **`humanError(error)`** beklenmedik bir JavaScript istisnasının İngilizce
   mesajını geçirebilir. Ürünün kendi attığı hatalar Türkçedir; bu yol
   tetiklenmedi ve değiştirilmedi.
4. **V-22 %41'de kaldı.** Künye bloğu %60 → %30'a indi, ama ilk içeriğin
   üstünde hâlâ üst çubuk (81 px) ve deneme korpusu damgası (67 px) var.
   İkisi de gerçek içeriktir; daha fazlası ancak damgayı taşımakla olur ve
   bu bir uyarıyı aşağı itmek demektir — yapmadım.
5. **V-7 iki kanıtla ölçüldü**, sekizle değil: bu koşuda alaka kapısı
   `dava-dilekcesi` (özel hukuk) şablonuna bağlanan TCK cevabının **2/2**
   kanıtını `DOMAIN_MISMATCH` ile eledi. Davranış aynı, sayı farklı.
6. **`prefers-reduced-motion`** yine tarayıcıda ölçülmedi
   (W14-L-CONSOLE §10.2 açık kalmaya devam ediyor).
7. **Bu ekranların hiçbiri gerçek bir avukat tarafından kullanılmadı.**
   Bütün ölçümler benim yürüyüşümde, **SENTETİK** demo korpusunda alındı;
   hiçbiri hukukî kalite göstergesi değildir.
8. Ekran görüntüleri (12 adet, 1440×900 / 960×900 / 390×844, açık ve koyu
   tema) depo dışındadır: `…/scratchpad/w14f-F-UI/shots/`.

---

## 8. Entegrasyon istekleri (sahibi olmadığım dosyalar)

1. **`control-plane/src/sources/routes.ts` (L-SOURCES / F-API)** — salt okunur
   bir geçit durumu ucu (`GET /v1/sources/health` → `{gateway:"ok"|"off"}`).
   Konsol bugün geçidi, **bilerek geçersiz** bir arama gövdesiyle yokluyor
   (şemayı geçer, `yearFrom > yearTo` ile 400'de durur, hiçbir upstream'e
   gitmez). Doğru sonucu veriyor ama tarayıcı ağ günlüğüne bir hata satırı
   düşüyor. 200 dönen bir uç bu satırı da kaldırır.
2. **`docs/implementation/STATUS.md` (L-DOCS)** — S30 satırının
   *"Kalan: dosya satırı alt metni koyu temada 4,37:1 / 12,5 px"* kaydı
   **kapandı**: bu koşuda **5,40:1 / 13 px** ölçüldü. S2 satırı da yenilendi:
   **102 dosya · 2 081 geçti · 6 atlandı**. Bu sayılar STATUS'a yazılacaksa
   §0'daki komutlarla yeniden ölçülmelidir.
3. **`docs/KULLANIM-ColleX.md` (L-DOCS)** — üç cümle değişti: dosya sayfası
   künyesi (*"Belgeler bu bilgisayarda saklanır"*), deneme damgası
   (*"DENEME KORPUSU (sentetik deneme belgeleri)"*) ve "Karar ara" ekranının
   geçit yokken **kapalı** çizildiği yeni davranış.
4. **`control-plane/src/api/server.ts` (F-API)** — bu hatta **istek yok**;
   V-3'ün sunucu yarısı zaten indi ve bu koşuda doğrulandı (§4).

---

## 9. Değişen dosyalar

**Değişen:** `control-plane/public/console.html` ·
`control-plane/tests/pipeline/console.test.ts`
**Yeni:** `docs/implementation/waves/W14-F-UI.md` (bu dosya)

`consolePage.ts` **değişmedi** (CSP dosyadan türetilir). Konsol sözleşmesi
yeniden ölçüldü: CR **0**, `<style>` **1**, `<script>` **1**, markup atayan /
kod çalıştıran API **0**, 127.0.0.1 dışı `http(s)://` **yok**, satır içi olay
ya da `style` özniteliği **yok**.

## 10. Hijyen

* Açtığım her sunucu kapatıldı: `netstat` → **8973 ve 8974'te dinleyici yok**;
  **8787/8898'e hiç dokunulmadı**. `var/*.pid` **yok**.
* `collex_demo` koşu başında `demo.mjs --force-drop-uploads` ile yeniden
  kuruldu (6/6 senaryo PASS). Koşu sırasında açtığım probe kayıtlarının
  hepsi silindi: `/v1/matters` **[]**, `/v1/files` **total 0**,
  `/v1/answers` **[]**, `/v1/drafts` **[]**, `var/uploads` **0 dosya**,
  ayar profili boşaltıldı.
* `collex_local`'a **hiç bağlanılmadı**, hiç yazılmadı, düşürülmedi.
* Playwright'ın çalışma alanı köküne düşürdüğü 12 ekran görüntüsü
  scratchpad'e taşındı; kökte **hiçbiri kalmadı**.
* Devlet upstream'lerine **tek bir istek gitmedi**. `.env` okunmadı,
  Supabase/Resend kullanılmadı, hiçbir git işlemi yapılmadı.
