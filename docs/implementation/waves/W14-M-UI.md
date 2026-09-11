# W14 — M-UI (cila hattı): uzun beklemenin ilerlemesi ve “Vazgeç”

**Tarih:** 03.09.2026 · **Tip:** DÜZELTME — bu hattın dokunduğu ürün dosyası
**iki tanedir**: `control-plane/public/console.html` ve
`control-plane/tests/pipeline/console.test.ts`. Üçüncü dosya bu rapordur.
**Port:** 8978 (sunucu) · 8988 (MCP geçidi) — **8787/8898'e hiç dokunulmadı**.
**Veritabanı:** `collex_demo` (koşu başında ve koşu sonunda `demo.mjs
--force-drop-uploads` ile yeniden kuruldu; bayrak yalnız **kendi** probe
yüklemelerim için). **`collex_local`'a hiç bağlanılmadı.**
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, MCP yüzeyi (54)
değişmedi, API sözleşmesine dokunulmadı.

> Bu raporda yazan her sayı **bu koşuda, bu makinede, gerçek bir tarayıcıda
> (Playwright)** ölçüldü. Ölçmediğim yere “ölçmedim” yazdım; başkasının
> sayısını aktardığım yerde hattın adı yazılıdır. Korpus sayıları
> `collex_demo`'nun **SENTETİK** deneme korpusundadır (8 belge / 55 parça) ve
> hukukî kalite ölçüsü değildir; “Karar ara” sayıları **gerçek Bedesten/UYAP**
> yanıtlarından gelir ve bir ilgililik denetimi değildir.

---

## 0. Yönetici özeti

| # | Görev | Hüküm | Ölçülen: önce → sonra |
|---|---|---|---|
| **1** | Korpus/cevap yolunda ilerleme satırı ve “Vazgeç” yok | **KAPANDI** | Bekleme boyunca ekranda **0 karakter → ilerleme kartı** (evre cümlesi + ölçülen saniye + 1 “Vazgeç”); iptal **2,0 sn**'de gerçekleşti, istek ağa hiç çıkmadı |
| **1b** | Aynı tedavi diğer uzun işlere | **KAPANDI (5 yol) · GEREKÇELİ İSTİSNA (1 yol)** | Karar arama · belge yükleme · atıf denetimi · yedekleme · canlı araştırma tedaviyi aldı; **dışa aktarma** (`<a download>`) bilerek dışarıda (§4.6) |
| **2** | Ayarlar › “Verilerim nerede?” gerçek klasörü yazsın | **KAPANDI** — sunucu hattı `/v1/health.uploadsDir`'i **indirdi** | Satır artık klasörün **yerini** yazıyor; alan gelmezse satır hiç çizilmiyor |
| **3** | Karar ara ekranında `totalRecords` | **KAPANDI** — sunucu hattı alanı **indirdi** | “**Kaynakta 761 kayıt var** — burada ilk **13** tanesi listeleniyor” (Yargıtay 758 · Danıştay 3) |
| **4a** | İlk-açılış künyesi kalıntısı | **KAPANDI** | Künye **162 → 129 px**; ilk içerik kartı **253 px (%28,1) → 220 px (%24,4)** |
| **4b** | Cevap kartı uzunluğu kalıntısı | **İYİLEŞTİ, KAPANMADI** | `#out` **5 198 → 5 005 px** (5,78 → **5,56 ekran**); §2 karşıt otorite kartı **769 → 576 px**. Kaynak kartlarına dokunulmadı |

**Kapılar:** `npx tsc --noEmit` **temiz (exit 0)** · `console.test.ts`
**179/179 geçti** (165 → 179, **+14 test**) · her yeni testin **kusuru geri
konunca düştüğü** tek tek gösterildi (**15/15 kırmızı**, §6) · tam süit
**105 dosya · 2 143 geçti · 0 DÜŞTÜ · 6 atlandı**, **art arda üç koşuda da**
· tarayıcıda **yakalanmamış JS istisnası 0** · **390 px'te 12/12 ve 960 px'te
(= 1440 @ %150) 12/12 görünümde yatay kayma yok**, ilerleme kartı ve
“Vazgeçildi” kartı dâhil.

---

## 1. Ana kalem — ilerleme satırı ve çalışan bir “Vazgeç”

C-FINAL §7(6) ve §9'un “ürünü en çok iyileştirecek üçüncü şey”i şuydu:
*avukatın en sık yaşayacağı olumsuz durum (aradığı ifade arşivde yok) aynı
zamanda en pahalı durumdur ve ekran bu sırada hiçbir şey söylemiyor.*

### 1.1 Önce: ekranda ne vardı (ölçüldü)

Bekleme boyunca ekranda duran **tek** şey, düğmenin yanındaki küçük
`#timing` alanına yazılan **sabit** `doğrulanıyor…` dizesiydi. Cevabın
çizileceği `#out` alanı **boştu** ve **hiçbir iptal denetimi yoktu**.

Ölçüm, tarayıcıda, 7 500 ms'lik **enjekte edilmiş gecikmeyle** (§1.3):

| örnekleme | `#timing` | `#out` karakter | görünür “Vazgeç” |
|---:|---|---:|---:|
| 0,2 sn | `doğrulanıyor…` | **0** | **0** |
| 1,0 sn | `doğrulanıyor…` | **0** | **0** |
| 3,0 sn | `doğrulanıyor…` | **0** | **0** |
| 5,0 sn | `doğrulanıyor…` | **0** | **0** |
| 7,0 sn | `doğrulanıyor…` | **0** | **0** |
| 9,0 sn | `7525 ms` | 2 593 (ÇEKİMSER cevabı) | 0 |

### 1.2 Sonra: aynı koşu, aynı gecikme

| örnekleme | evre satırı | ölçülen süre | uzun-bekleme cümlesi | “Vazgeç” |
|---:|---|---|---|---:|
| 0,2 sn | “Soru sunucuya gönderildi; cevap bekleniyor.” | `geçen süre: 0,0 sn` | gizli | **1** |
| 1,0 sn | aynı | `0,8 sn` | gizli | 1 |
| 3,0 sn | aynı | `2,8 sn` | gizli | 1 |
| 5,0 sn | aynı | `4,8 sn` | **görünür** | 1 |
| 7,0 sn | aynı | `6,8 sn` | görünür | 1 |
| 9,2 sn | (kart kalktı) | `7521 ms` | — | 0 |

Kartın kuralları:

* **Yüzde yoktur.** Sunucu ilerleme bildirmez; bir yüzde, bu projenin
  yasakladığı türden **ölçülmemiş bir sayıyı** ekrana yazmak olurdu
  (CLAUDE.md, “Ölçülen sayılar”). Kartta duran tek sayı **tarayıcının kendi
  saatiyle ölçtüğü** geçen süredir; ondalık ayraç Türkçedir (`4,8 sn`).
* **Evre satırı yalnız gerçekten bilinen durumu söyler:** istek gönderildi →
  (filtre reddedilirse) filtresiz yeniden gönderildi → cevap alındı, ekrana
  yazılıyor. Sunucunun içindeki ara adım **uydurulmaz**.
* **Uzun-bekleme cümlesi 3 000 ms'den önce çizilmez** ve içinde **sayı
  yoktur**: *“Bekleme uzuyor. En uzun bekleme, aradığınız ifadenin arşivde hiç
  geçmediği durumdur; böyle bir aramanın sonucu da boş döner…”* Bu, STATUS'un
  iki ölçülmüş tavanından ikincisinin **nitel** ifadesidir; rakam ekrana
  yazılmadı.

**İptal (aynı koşu, 2,0 sn'de tıklandı):**

```
panel kalktı · "Vazgeçildi" kartı: "Bekleme 2,0 sn sonra durduruldu.
  İstek tarayıcıdan iptal edildi. Sunucu bu işi kendi içinde tamamlasa bile
  sonucu ekrana yazılmaz." + "Soru kutusu ve tarih olduğu gibi duruyor."
  + [Aynı soruyu yeniden sor]
düğme yeniden etkin (disabled false) · body.loading kalktı · #timing "vazgeçildi"
soru kutusu doldu kaldı · cevabın geleceği ana kadar beklendi: ekran temiz kaldı
```

**İptalin gerçek olduğunun kanıtı — iki ayrı ölçüm:**

1. **Ürünün kendi yolu.** Sarmalayıcı, konsolun `fetch`'e verdiği seçenekleri
   gözledi: `signal` **geldi** (`signalPassedToFetch: true`), “Vazgeç”te
   **tetiklendi** (`signalFired: true`) ve istek **hiç gönderilmedi**
   (`requestNeverIssued: true`; 8 saniye sonra da gönderilmemişti).
2. **Denetim deneyi.** Gerçek bir `POST /v1/answer` gerçek bir
   `AbortController` ile iptal edildi: söz **`AbortError`** ile reddedildi.
   Yani tarayıcı katmanı gerçekten kesiyor.

Ve iptal edilen bir istek **hata olarak çizilmiyor**: `isAbortError` +
`busy.cancelled()` kapısı, `AbortError`'ın `showError`/`errCard` yoluna
düşmesini engelliyor — yoksa avukat kendi bastığı düğmeden sonra bir
“İstek başarısız” kartı görürdü.

### 1.3 Ölçümün dürüst sınırı — 7,5 saniye BENİM sayım değildir

`collex_demo` **55 parçalık** bir korpustur; boş ifade orada pahalı değildir.
Kendi ölçümüm (aynı soru, aynı sunucu):

| ölçüm | sonuç |
|---|---|
| `curl` × 3, sunucu tarafı | **53,6 ms · 20,2 ms · 13,0 ms** |
| tarayıcıda uçtan uca, iki koşu | **24 ms** ve **69 ms** · durum **ÇEKİMSER** · 0 kanıt / 0 tespit |

STATUS'un ve F-VERIFY'ın **7,5 sn**'si **20 000 parçalık üretilmiş bir probe
korpusunda** ölçülmüştür; **bu koşuda yeniden üretilmedi** ve bir ürün sayısı
olarak alıntılanamaz. Beklemenin kendisini yeniden üretmek için tarayıcıda
`window.fetch` sarmalandı ve `/v1/answer` **7 500 ms geciktirildi**. Bu bir
**ölçüm düzeneğidir, ürünün parçası değildir**; sayfa dosyasında bu düzenekten
tek bir satır yoktur. Önce/sonra tablolarının ikisi de **aynı** düzenekle
alındı, yani karşılaştırma adildir.

**Kısacası:** bu hat beklemeyi kısaltmadı — **beklemeyi görünür ve
durdurulabilir yaptı**. Bir aracın yavaş olması ile ne yaptığını
söylememesi aynı şey değildir.

---

## 2. Diğer uzun işler — hangisi neyi aldı

| İş | Önceki ilerleme | Önceki iptal | Şimdi |
|---|---|---|---|
| Korpus/cevap (`POST /v1/answer`, Araştır) | `doğrulanıyor…` | **yok** | kart + evre + saniye + **Vazgeç** |
| Belge sayfasındaki soru (`askDocument`) | `doğrulanıyor…` | **yok** | aynı kart, cevabın çizileceği yerde |
| Canlı araştırma | gerçek adım paneli + saniye | **yok** | panele **Vazgeç** eklendi (§2.1) |
| Karar arama | kaynak adları + “yanıt bekleniyor” | **yok** | kart + evre + saniye + **Vazgeç** |
| Belge yükleme | `n/N yükleniyor: ad` (soluk satır) | **yok** | kart + `n/N gönderiliyor: ad` + saniye + **Vazgeç** (kuyruğu durdurur) |
| Atıf denetimi | düğme yazısı “Denetleniyor…” | **yok** | kart + evre + saniye + **Vazgeç** |
| Yedekleme | düğme yazısı “Yedekleniyor…” | **yok** | kart + evre + saniye · **Vazgeç YOK, sebebi ekranda** (§2.4) |
| Belge × soru ızgarası (B-21) | `n/N hücre — ad` | **vardı** (“Durdur”) | değişmedi — zaten doğruydu |
| Dışa aktarma (DOCX/MD/UDF/denetim) | yok | tarayıcının kendi indirmesi | bilerek dönüştürülmedi; tek satır dürüst uyarı (§4.6) |

### 2.1 Canlı araştırma — “Vazgeç” koşuyu değil, BEKLEMEYİ durdurur

Canlı koşuyu sunucuda durduracak bir uç **yoktur**. Bu yüzden düğme
“durduruldu” demez:

```
Beklemekten vazgeçildi
Bekleme 6,0 sn sonra bırakıldı. Canlı araştırma sunucuda sürebilir:
bittiğinde sonucu “Kayıtlı cevaplar” listesinde bulursunuz.
[Kayıtlı cevaplara git]
```

Ölçüldü (gerçek `--with-mcp` koşusu, `kamulaştırmasız el atma davasında
zamanaşımı`): 0,3 sn'de panel + Vazgeç; 2,5 sn'de `araç çağrısı: 2`; 6,0
sn'de tıklandı → yoklama durdu, düğme etkinleşti, 10 saniye daha beklendi ve
**cevap çizilmedi** (yani yoklama gerçekten kesildi).

Ayrıca panel artık **202 gelmeden önce de** çiziliyor: eskiden koşu numarası
dönene kadar ekran boştu.

### 2.2 Karar arama — gerçek bir aramada ölçüldü

| Sorgu (tam ifade açık, Yargıtay + Danıştay) | Süre | Künye | Bekleme boyunca ekran |
|---|---:|---:|---|
| `kamulaştırmasız el atma` | **6 610 ms** | 20 | kart, `0,0 → 5,8 sn`, uzun-bekleme cümlesi 3,4 sn'den itibaren, 1 Vazgeç |
| `tahliye taahhüdü` | **23 157 ms** | 13 | aynı kart, kesintisiz |
| `işçilik alacaklarında zamanaşımı` | 2,0 sn'de **iptal** | — | temiz durum; sorgu alanı doldu kaldı; sonrasında **0 satır** çizildi |

Uzun-bekleme cümlesi burada başka bir şey söyler ve doğrudur: *“Resmî kaynak
sunucuları yoğun olduğunda yanıt gecikebilir; bu bekleme ColleX'te değil,
kaynağın kendi sunucusundadır.”*

### 2.3 Belge yükleme — “Vazgeç” kuyruğu da durdurur

* Gerçek yükleme (1 belge, ~600 ms): kart `1/1 gönderiliyor:
  m-ui-ilerleme-denemesi.txt`.
* İptal (2 belge, gecikme düzeneğiyle): 1,8 sn'de kart `1/2 gönderiliyor:
  m-ui-iptal-1.txt`; Vazgeç → sinyal tetiklendi, **ikinci belge hiç
  gönderilmedi** (o anda 0 istek, 5,5 sn sonra da 0), bildirim:
  **“Yükleme durduruldu — 0/2 belge yüklendi; sürmekte olan belge yarım
  kalmış olabilir.”** — tonu **warn**, yani kısmî bir sonuç **yeşil
  görünmüyor** (B-10 kuralı korundu).

### 2.4 Yedekleme — burada “Vazgeç” YOK ve sebebi yazılı

```
Yedek alınıyor                                    [sürüyor]
Veritabanı dökümü ve belge asılları yedek klasörüne kopyalanıyor.
geçen süre: 1,4 sn
Bu iş yarıda durdurulmaz: eksik kopyalanmış bir klasör yedek sayılmaz.
Bitmesini bekleyin — bittiğinde klasörün yeri burada yazacak.
```

Ölçüldü: gerçek yedek **557 ms**; kartın kendisi 3 sn'lik gecikme düzeneğiyle
görüldü ve içinde **0 adet** “Vazgeç” düğmesi var. Bir test bunu ayrıca
pinliyor (`runBackup` gövdesinde `onCancel` geçmemeli).

---

## 3. Sunucu hattının indirdiği iki alan ekrana bağlandı

Görev metni “eğer inerse” diyordu: **ikisi de indi** ve bu koşuda ölçüldü.

### 3.1 IR-1 · `/v1/health.uploadsDir` → “Verilerim nerede?”

```
GET /v1/health -> ... "uploadsDir":"<veri klasörü>\uploads" ...
Ayarlar › Verilerim nerede? (ekrandaki satır):
  "Bu kurulumda o klasörün yeri: …\scratchpad\w14lm-M-UI\data\uploads
   — bu satırı sunucunun kendisi bildirir, ColleX tahmin etmez."
```

C-UI'nin standart ifadesi (`<veri klasörü>/uploads (varsayılan: var/uploads)`)
**olduğu gibi duruyor**; yeni satır onun **altına** ekleniyor ve **yalnız
sunucu alanı gönderdiğinde** çiziliyor (`hidden` kalıyor). Alanı göndermeyen
bir sunucuda ekran bugünkü dürüst hâline döner; konsol **hiçbir yolu tahmin
etmez**. Yolun avukatın önüne çıkması burada kuralın istisnası değil,
kuralın kendisidir: bu satır “Verilerim nerede?” sorusunun **cevabıdır** ve
etiketiyle birlikte yazılır — veritabanı adının Ayarlar'da yazılmasıyla aynı
desen (V-16).

### 3.2 IR-2 · `sources/search` → “kaynakta N kayıt var”

Ekrandaki satır (gerçek arama, `"tahliye taahhüdü"`):

```
Kaynakta 761 kayıt var — burada ilk 13 tanesi listeleniyor. Kalanı
getirilmez; listeyi daraltmak için “Tam ifade”yi açık tutun ya da
süzgeçleri kullanın.
  ▸ Kaynak kaynak sayılar
      Yargıtay — 758 kayıt
      Danıştay — 3 kayıt
```

Kurallar: sayı **kaynağın kendi sayısıdır**; binlik ayracı Türkçedir
(`52.758`); ve **`null` asla 0 diye yazılmaz** — kaynak sayı bildirmediyse
satır *“Kaynak, bu sorgu için kaç kayıt tuttuğunu bildirmedi; bu listenin
kaynaktaki kümenin ne kadarı olduğu bilinmiyor.”* der. (Yargıtay için ölçülen
758, C-UI'nin aynı sorguda ölçtüğü 758 ile birebir aynı çıktı.)

Kaynak adları kataloğdan okunur (`kararSourceName`): izdeki `label` alanı
**aracın** adıdır ve iki kaynakta da aynıdır — ilk denememde ekranda iki kez
“Yargıtay/Danıştay kararları aranıyor” yazdı, düzeltildi.

---

## 4. Ölçülen ayrıntılar ve bilerek yapılmayanlar

### 4.1 İlk-açılış künyesi (görev 4a) — ve C-UI ile arasındaki fark

**Önce (bu koşu, 1440×900, ilk açılış: profil boş + dosya yok):**

| Ölçüm | Önce | Sonra |
|---|---:|---:|
| `header.masthead` yüksekliği | **162 px** | **129 px** |
| Üst çubuk (`.topbar`) | **81 px** (rozetler İKİ satır) | **48 px** (tek satır) |
| Dürüstlük bandı (`.stamp`) üstü | 176 px (**%19,6**) | **143 px (%15,9)** |
| İlk içerik kartı (`#welcome`) üstü | **253 px (%28,1)** | **220 px (%24,4)** |

**Dürüst not:** C-UI bu kalemi kapalı bildirmişti (129 px / 220 px). Benim
koşumda kapalı **değildi**: ilk-açılış kabuğunun içerik sütunu 868 px'tir ve
üç durum rozeti (140 + 177 + 135 px) üst çubuğun küçük marka kopyasıyla
birlikte oraya sığmıyor, **ikinci satıra kırılıyordu** ve künye 33 px
büyüyordu. Rozet metinleri sunucu durumuna göre değişir, yani bu kırılma
duruma bağlıdır — C-UI'nin ölçümü yanlış değil, **başka bir durumda**
alınmıştır.

Yapılan: ilk açılışta **üst çubuktaki küçük marka kopyası gizlendi**
(`body:not(.compact) .topbar .brandmini`). Gerekçe C-UI'nin ikinci monogramı
kaldırma gerekçesiyle aynıdır — marka o ekranda **zaten hemen altta, büyük
künyede** yazılıdır; ikinci kopya hem yer kaplıyor hem de rozetleri satır
dışına itiyordu. **Kompakt kabuk (yani ilk açılıştan sonraki her durum) hiç
değişmedi**; orada marka tek kopyadır ve üst çubuktadır. Bir test her iki
yarıyı da pinliyor.

### 4.2 Cevap kartı uzunluğu (görev 4b) — %3,7 kısaldı, kapanmadı

7 tespitli ŞERHLİ korpus cevabı (`dolandiricilik sucunda nitelikli hal var
midir`, 01.06.2026), 1440×900:

| Bölüm | Önce | Sonra |
|---|---:|---:|
| **`#out` toplam** | **5 198 px (5,78 ekran)** | **5 005 px (5,56 ekran)** |
| Hüküm damgası + cevap künyesi + içindekiler | 440 px | 440 px |
| Tespitler (1 açık + 6 katlı) | 1 519 px | 1 519 px |
| **§2 karşıt otorite kartı** | **769 px** | **576 px** |
| §3 Kaynaklar (8 kaynak, 3'ü açık) | 1 685 px | 1 685 px |
| §4 Uyarılar + §5 İşlem izi | 186 px | 186 px |

(Satırlar toplama birebir oturmaz: bölüm başlıkları, `srcintro` satırı ve
kartlar arası boşluklar tabloda ayrı satır değildir. “§3 Kaynaklar” satırı
`.srcset` kabının kendi yüksekliğidir.)

Yapılan **tek** şey: karşıt otorite bölümündeki **aramaların dökümü tablosu**
(hangi sorgu hangi şeritte koştu — 230 px'lik bir iz tablosu) `<details>`
içine alındı. Bu, karşıt otorite **bulunmayan** dalda **zaten böyleydi**; iki
dal artık aynı şekli kullanıyor. **Katlanan yalnız taramanın izidir**;
taramanın sonucunu söyleyen cümle, çelişen tespitlerin listesi ve “bulundu
ama kanıt kümesine alınmadı” tablosu **açık kalır**.

**Denenip geri alınan:** kaynak kartında merci satırı ile güncellik/kaynak
çiplerini tek bir esnek satırda toplamak. Ölçtüm: kart **567 → 572 px**
oldu, yani **kötüleşti** — çipler zaten aynı satırdaydı ve toplam genişlik
(250 + 242 + 387 px) 750 px'lik sütuna sığmadığı için esnek satır iki satıra
kırıldı. Değişiklik **tümüyle geri alındı**; bu raporda duruyor çünkü bir
sonraki hat aynı fikri yeniden denemesin.

**Neden kapanmadı:** kalan 5 005 px'in **%34'ü sekiz kaynak kartıdır**
(1 685 px, üçü açık + “Diğer 5 kaynağı göster”) ve görev metni kaynak
kartlarını gizlemeyi yasaklıyor; **%29'u tespit kartlarıdır** (C-UI zaten
katladı); geri kalanı dürüstlük bantlarıdır. Kartı 5 ekranın altına indirmek
ancak kaynak kartının **kendi içindeki** ölçülerle (alıntı 192 px, teknik
katlama, boşluklar) uğraşarak olur; bu, ayrı bir tasarım kalemidir ve
ölçmeden yapılacak iş değildir.

### 4.3 Konsol sözleşmesi

| Kapı | Ölçülen |
|---|---|
| CR baytı | **0** |
| `<style>` / `<script>` | **1 / 1** |
| Yasak DOM/kod kanalları (9 kalıp) + satır içi işleyici/stil | **0 eşleşme** |
| 127.0.0.1 dışı `http(s)://` · `<img>` | **0 · 0** |
| Dosya boyutu / satır | 636 239 bayt · 13 277 satır |

### 4.4 Tarayıcı kapıları

| Kapı | Ölçülen |
|---|---|
| Yakalanmamış JS istisnası / promise reddi | **0 / 0** |
| Konsoldaki tek hata satırı | `POST /v1/sources/search` **400** ×3 — “Karar ara” ekranının **bilerek geçersiz** geçit yoklaması (F-UI §7.1'de kayıtlı) |
| Yatay kayma **390 px** | **12/12 görünümde yok** (375); ilerleme kartı 355 px, “Vazgeçildi” kartı 355 px |
| Yatay kayma **960 px** (= 1440 @ %150) | **12/12 görünümde yok** (945); ilerleme kartı da taşırmıyor |
| Yatay kayma 1440 px | yok (1 425) |
| Koyu tema | ilerleme kartı çizildi; evre satırı `rgb(237,229,211)` / kart zemini `rgb(32,27,21)` |

### 4.5 Değişmeyen davranışlar (regresyon)

Cevap yolu uçtan uca yeniden koştu: boş ifade **ÇEKİMSER** (69 ms), 7
tespitli soru **ŞERHLİ** (7 tespit, 8 kaynak kartı) — ikisi de eskisi gibi
çizildi. `demo.mjs` koşu sonunda **6/6 senaryo PASS**. Karar arama, canlı
araştırma, yükleme, denetim ve yedekleme akışlarının tamamı gerçek bir
sunucuda uçtan uca çalıştırıldı.

### 4.6 Dışa aktarmaya neden ilerleme çubuğu KONMADI

Konsoldaki dışa aktarmaların hepsi `<a download>`'dır (DOCX · Markdown · UDF ·
denetim raporu). Dosyayı sunucu üretir, indirmeyi **tarayıcı** yürütür ve
**bitişini bu sayfa göremez**: `<a download>` için tamamlanma olayı yoktur.
Bitişini bilmediğimiz bir çubuk, dönmeye devam eden bir yalan olurdu.

`fetch` + `blob:` ile dönüştürmeyi **bilerek yapmadım**: dosya adı bugün
sunucunun `Content-Disposition`'ından (`filename*`, UTF-8) geliyor ve
reddedilen bir dışa aktarma (409 `EXPORT_REFUSED`) hâlihazırda JSON gövdesiyle
dönüyor — blob yoluna geçmek, o gövdeyi `.docx` diye kaydetme riskini
taşırdı. Bu, kazandığından çok riski olan bir değişiklikti.

Bunun yerine tek satırlık dürüst bir uyarı eklendi: tıklandığında
*“DOCX hazırlanıyor — dosyayı sunucu üretir ve tarayıcınızın indirilenler
listesinde belirir; bu sayfada ilerleme gösterilemez.”* Avukat en azından
nereye bakacağını biliyor. **Bu, görev kaleminin tam karşılığı değildir ve
öyle sunulmuyor** — §7'de sonraki hatta bırakılan kalem olarak duruyor.

---

## 5. Kod — nereye dokunuldu

Tek paylaşılan bileşen (`beginBusy` / `busyCancelledCard` / `busySeconds` /
`isAbortError` / `markExportStarted`) ve onu kullanan yedi çağrı yeri:

| Fonksiyon | Ne oldu |
|---|---|
| `beginBusy(opts)` | İlerleme kartı: evre satırı, `setInterval` ile 200 ms'de bir yenilenen **ölçülen** süre, 3 sn'den sonra beliren uzun-bekleme cümlesi, `AbortController` ve “Vazgeç”. `onCancel` verilmezse düğme çizilmez; `noCancelReason` verilirse sebep yazılır |
| `busyCancelledCard(host, ms, opts)` | Temiz durum kartı: ne kadar beklendi, neyin bilinemeyeceği, tek tıkla geri dönüş |
| `postJson` / `sendJson` / `getJson` | İsteğe bağlı 4. (2.) argüman `signal`; verilmezse davranış **birebir eskisi** |
| `runQuestionFromForm` | Kart + iptal + evre; filtresiz yeniden deneme de aynı sinyali taşır |
| `askDocument` | Aynı kart, belge sayfasının cevap alanında |
| `startLiveRun` / `renderProgress` | Panel 202'den önce de çizilir; koşarken panelde **Vazgeç**; `liveStopped` yoklamayı keser |
| `runKararSearch` | Kart + iptal; iptalde `karar-progress` “beklemekten vazgeçildi” der |
| `uploadFiles` | Kart + `n/N` evre + iptal; iptal kuyruğu boşaltır, bildirimi **warn** tonundadır |
| `runDenetim` | Kart + iptal |
| `runBackup` | Kart, **iptalsiz**, sebep ekranda |
| `applyHealth` | `uploadsDir` satırı (§3.1) |
| `sourceTotalLine` / `fmtCount` / `kararSourceName` | `totalRecords` satırı (§3.2) |
| `render` (§2 karşıt otorite dalı) | Aramaların dökümü `<details>` içine (§4.2) |
| CSS | `.card.busy`, `.busyphase`, `.busytime`, `.busywait`, `.card.busydone`; ve `body:not(.compact) .topbar .brandmini { display: none; }` |

---

## 6. Testler — 14 yeni test, on dördü de boş değil

`console.test.ts` **165 → 179 test**; hepsi geçiyor. Her testin **kusuru geri
konunca düştüğü** tek tek gösterildi: `console.html` üzerinde tek bir kusur
geri konur, süit koşar, dosya **bayt bayt** geri yüklenir (betik:
`scratchpad/w14lm-M-UI/vacuity.mjs`; her turda SHA-256 eşitliği doğrulandı).

| Geri konan kusur | Sonuç |
|---|---|
| 1 · ölçülen saniye satırının adı değiştirildi | **DÜŞTÜ** |
| 2 · ilerleme kartına bir yüzde yazıldı | **DÜŞTÜ** |
| 3 · uzun-bekleme cümlesi ilk kareden itibaren gösterildi | **DÜŞTÜ** |
| 4 · `AbortSignal` cevap formunda `fetch`'e verilmedi | **DÜŞTÜ** |
| 4b · aynı sinyal belge sayfasında verilmedi | **DÜŞTÜ** |
| 4c · her iki JSON yardımcısı da sinyali düşürdü | **DÜŞTÜ** |
| 5 · iptal edilen istek yeniden hata olarak çizildi | **DÜŞTÜ** |
| 6 · “Vazgeçildi” kartından “bilemeyiz” cümlesi çıkarıldı | **DÜŞTÜ** |
| 7 · canlı panel iptal geri çağrısını kaybetti | **DÜŞTÜ** |
| 8 · yükleme iptali kuyruğu boşaltmadı | **DÜŞTÜ** |
| 9 · yedeklemeye tutamayacağı bir “Vazgeç” eklendi | **DÜŞTÜ** |
| 10 · dışa aktarma bağlantısı yeniden sessizleşti | **DÜŞTÜ** |
| 11 · Ayarlar gerçek klasörü yazmayı bıraktı | **DÜŞTÜ** |
| 12 · Karar ara kaynağın kayıt sayısını yazmayı bıraktı | **DÜŞTÜ** |
| 13 · ilk açılışta marka yeniden iki kez yazıldı | **DÜŞTÜ** |
| 14 · karşıt otorite iz tablosu yeniden açık çizildi | **DÜŞTÜ** |

On beş turun on beşinde de `console.html` **bayt bayt** geri yüklendi.

**Değiştirilen iki eski iddia** (ikisi de **daraltıldı**, gevşetilmedi):

* `sendJson("/v1/sources/search", "POST", body)` →
  `sendJson("/v1/sources/search", "POST", body, busy.signal)`;
* `sendJson("/v1/citation-audit", "POST", body)` →
  `sendJson("/v1/citation-audit", "POST", body, busy.signal)`.

Pinlenen sözleşme (hangi ekran hangi uca hangi gövdeyle gider) aynen duruyor;
üstüne **sinyalin geçtiği** de pinlendi. Cevap yolunun sinyali ayrıca **çağrı
yeri yeri** iddia ediliyor — bir akışın sinyali tutması, başka bir akışın onu
düşürmesini örtmesin diye (bu tam olarak ilk turda yakalanan boşluktu).

**Hiçbir test zayıflatılmadı, atlanmadı ya da silinmedi.**

---

## 7. Ayakta kalanlar / sonraki hatta

1. **Dışa aktarmanın gerçek ilerlemesi (§4.6).** `<a download>` bitişini
   bildirmez. Gerçek çözüm sunucu tarafında: dışa aktarmayı önce **hazırlayıp**
   (202 + iş numarası) sonra indirtmek, ya da `EXPORT_REFUSED`'ı indirme
   akışının dışına almak. İstemciden dürüstçe yapılabilecek şey yapıldı.
2. **Cevap kartı hâlâ 5,56 ekran (§4.2).** Kalanın çoğu kaynak kartlarının
   **içindeki** ölçülerdir; kartları gizlemeden kısaltmak ayrı bir tasarım
   kalemidir.
3. **`maybeWelcome` çağrı sırası** (C-UI §6.3'te bildirilmişti) hâlâ açık:
   `#ayarlar`'a doğrudan girişte ilk-açılış kabuğu bazen hiç açılmıyor.
   Ölçmedim, dokunmadım; §4.1'in ölçümü doğrudan `#dosyalarim` açılışında
   alınmıştır.
4. **Karşıt otorite listesindeki `claim-ev-…` kimlikleri** hâlâ ana akışta
   (`4 tespitte kaynaklar çelişiyor` satırının altındaki liste). Bu bir
   makine dizesidir ve B-27'nin ruhuna aykırıdır; tespit numarasıyla
   değiştirilmesi bu hattın altı kaleminin hiçbirine girmediği için
   **ölçüldü, düzeltilmedi**.
5. **Canlı araştırmayı sunucuda durduracak bir uç yok.** Bugünkü “Vazgeç”
   dürüstçe yalnız beklemeyi bırakıyor; gerçek bir iptal
   (`POST /v1/research/runs/{runId}/cancel`) sunucu hattının işidir.

---

## 8. Hijyen

* Açtığım sunucular (**8978**, MCP geçidi **8988**) **nazikçe** kapatıldı
  (`<veri>/collex.stop`). Koşu sonunda `netstat`: **8978, 8988, 8787 ve
  8898'de DİNLEYİCİ YOK**; komut satırı taraması: `serve.mjs` /
  `serve-mcp.mjs` / `uvicorn asgi_app` süreci **yok**. **8787/8898'e hiç
  dokunulmadı.**
* `COLLEX_DATA_DIR` scratch'e verildi; depo `var/` altına **hiçbir pid
  dosyası yazılmadı**, `var/uploads` koşu sonunda **0 dosya**.
* **`collex_local`'a hiç bağlanılmadı, hiç yazılmadı, düşürülmedi.**
  `collex_demo` koşu sonunda `demo.mjs --force-drop-uploads` ile yeniden
  kuruldu (bayrak yalnız kendi probe yüklemelerim için): **6/6 senaryo PASS**.
  Kendi adıma yeni bir veritabanı yaratmadım.
* **Bir hijyen kusurumu kaydediyorum:** yedekleme ekranını denerken
  `POST /v1/backup` ürünün **varsayılan** hedefine yazdı ve scratch'in dışında
  `C:\Users\anile\ColleX-Yedek\` klasörünü **ben yarattım** (iki tarihli alt
  klasör, ikisi de `collex_demo` dökümü). Klasörün tamamı bu koşuda oluştu ve
  koşu sonunda **scratchpad'e taşındı**; kullanıcının ev dizininde ColleX'e
  ait bir klasör kalmadı. Sonraki hat için not: `/v1/backup` çıktı yolunu
  istekten almıyor, `COLLEX_DATA_DIR`'i de dinlemiyor.
* Devlet upstream'lerine giden istekler: **5 karar araması** (ikisi `curl` ile
  ve ikisinde de kaynak `UNAVAILABLE` döndü, biri tarayıcıda iptal edildi) ve
  **1 canlı derin araştırma** (iptal edildi); hepsi tek tek, **paralel
  değil**. Başka dış çağrı yok.
* Playwright'ın çalışma alanına düşürdüğü **kendi** ekran görüntülerim
  scratchpad'e taşındı; başka hatlara ait dosyalara dokunulmadı.
* Geçici dosyaların tamamı `…/scratchpad/w14lm-M-UI/` altında.
* MCP geçidi ayaktayken **tam süit koşulmadı** (C-UI §8'in tuzağı:
  `tests/integration/serve.test.ts` süreç listesinde 48 haneli belirteç
  görüp haklı olarak düşer). Süit, geçit kapatıldıktan sonra **üç kez**
  koşturuldu ve üçünde de yeşil bitti.

### Değişen depo dosyaları

```
control-plane/public/console.html                 (bu hattın münhasır dosyası)
control-plane/tests/pipeline/console.test.ts      (bu hattın münhasır dosyası)
docs/implementation/waves/W14-M-UI.md             (bu rapor)
demo-output/report.md                             (demo.mjs'in KENDİ çıktısı)
```
