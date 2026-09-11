# W14 — Hat L-CONSOLE (Faz A): B-10 · B-21 · B-22 · B-27 · B-28

Tarih: **02.09.2026** · Hat: **L-CONSOLE** · Faz: **A** · Durum: **teslim edildi**;
aşağıdaki her sayı bu makinede koşan gerçek komut ya da gerçek tarayıcı
ölçümüdür.

Sahiplik (W13-BACKLOG §G.1): `control-plane/public/console.html` (**münhasır**),
`control-plane/src/api/consolePage.ts`, `control-plane/tests/pipeline/console.test.ts`.
**Başka hiçbir depo dosyası değiştirilmedi.** `consolePage.ts` bu dalgada
değişmedi (CSP hash'i dosyadan türediği için düzenleme gerekmedi).

Konsol sözleşmesi korundu ve yeniden doğrulandı: TEK `<style>` + TEK
`<script>`, dosya **LF-only (0 CR)**, **450 575 bayt / 9 618 satır**, DOM
yalnız `createElement`/`textContent`, markup API'si yok, `on*=`/`style=`
özniteliği yok, `https?://` yok (127.0.0.1 hariç), dış kaynak/yazı tipi yok.
`node --check` temiz. İçtihat Külliyatı kimliği (fildişi kâğıt, bordo mühür,
bronz iz, serif hukuk metni) olduğu gibi duruyor.

Probe ortamı: `node control-plane/scripts/demo.mjs` → **6/6 senaryo PASS**
(collex_demo yeniden kuruldu) · `node control-plane/scripts/serve.mjs --port
8946 --dsn …/collex_demo` (db ok, 11/11 migrasyon, mcp kapalı, ai kapalı,
demoCorpus). **Sunucu kapatıldı, `netstat` ile doğrulandı, pid dosyası
bırakılmadı; 8787/8898'e dokunulmadı.** Probe yüklemelerim ve probe
dosyalarım collex_demo'dan **silindi** (`/v1/health corpus` →
`publicDocuments: 6, uploads: 0`), böylece bir sonraki `demo.mjs`
`--force-drop-uploads` gerektirmiyor.

---

## 0. Kalem özeti

| Kalem | Durum | Kabul ölçütü |
|---|---|---|
| **B-10** Sessiz yükleme hatası + çift tık ikizi + ölü aktif dosya | **indi** | üçü de tarayıcıda ölçüldü (§1) |
| **B-21** Belge × soru ızgarası | **indi (DOCX hariç)** | 5×3 ve 6×3 ızgara üretildi, 0 boş hücre, hücre→offset çapası çalışıyor, CSV iniyor; **DOCX yapılmadı** (§2, sapma) |
| **B-22** Adlandırılmış iş kartları | **indi** | 10 kart, hepsi bugün çalışan bir uca bağlı; `#q.value === ""` (§3) |
| **B-27** Uyarı bütçesi + makine sözlüğü + tanımsız terimler | **indi (kısmî bağımlılık)** | ölçülen: ≤ 4 blok / ≤ 8 cümle, 0 tekrar, 0 makine kodu (§4) |
| **B-28** Erişilebilirlik P0 dörtlüsü + koyu tema kırıkları | **indi** | dört oran hesaplandı ve testle sabitlendi; 960 px taşması kapandı (§5) |

---

## 1. B-10 — sessiz yükleme hatası, çift tık ikizi, ölü aktif dosya

### 1.1 Ne yapıldı

**(a) UXAUDIT P0-2 — dosya sayfasından yüklenen belge sessizce ölüyordu.**
`uploadFiles(fileList, opts)` artık `opts.errorHost` alır; bu bir DOM düğümü
**veya bir fonksiyon** olabilir. `fileErrorCard(fileName, err, httpStatus, host)`
kartı çağıran görünüme yazar. Dosya sayfası kendi kabını verir
(`#matterupload-errors`, "Belge yükle" düğmesinin hemen altında).

`onDone` (dosya sayfasında `refreshMatterPage()`) **asenkron** olarak sayfayı
yeniden çizdiği için kart bir kez daha kayboluyordu; başarısızlıklar artık
`lastUploadFailures = { matterId, list }` içinde durur ve `renderMatterPage()`
her çizimde kartları geri koyar (+ "Bu uyarıları kapat").

Bildirim üç ayrı tona ayrıldı — kısmî başarı **asla yeşil değildir**:

| Sonuç | Ton | Metin |
|---|---|---|
| `okCount === total` | `ok` | "N/N belge yüklendi ve dosyaya bağlandı." |
| `okCount === 0` | **`bad`** | "`<dosya adı>` yüklenemedi — `<neden>`" |
| kısmî | **`warn`** (yeni) | "1/2 belge yüklendi ve dosyaya bağlandı · `<dosya adı>` yüklenemedi — `<neden>`" |

**(b) UXAUDIT P1-2 — çift tık ikiz dava dosyası yaratıyordu.**
Yeni `lockSubmit(key, button, busyText)`: bir bayrak **ve** `disabled`.
Uygulandığı formlar: `newmatterform` (POST /v1/matters), Ayarlar
(PUT /v1/settings), süre hesabı (POST /v1/deadlines/compute), taslak
oluşturma (POST /v1/drafts). Ayrıca `duplicateMatterOf(title, docketNo)`:
**kapalı olmayan** bir dosyada aynı başlık ya da aynı esas numarası varsa
POST yapılmaz; "Mevcut dosyayı aç" / "Yine de yeni dosya aç" seçenekleri
sunulur.

**(c) UXAUDIT P1-3 — ölü aktif dosya her araştırmayı düşürüyordu.**
`renderMatterSelect()` artık **yalnız `GET /v1/matters` kimliklerini** listeler
(sunucuda olmayan aktif dosyayı seçeneğe geri ekleyen kod silindi).
`mattersLoaded` bayrağı sunucu listesinin en az bir kez alındığını söyler —
ağ hatası dosyayı silmez. `parseJson()` (her `fetch`in tek geçtiği yer)
`noticeMatterNotFound(body)` ile hem `error.kind === "MATTER_NOT_FOUND"`
hem `warnings[]` içindeki kodu yakalar ve `forgetActiveMatter()` çağırır:
anahtar silinir, seçici budanır, tek Türkçe cümle söylenir.

### 1.2 Kabul kanıtı (tarayıcı, gerçek sunucu)

Sessiz hata — dosya sayfasından boş `.txt` yüklendi:

```
{ "toastClass": "toast bad",
  "toastText": "probe_bos.txt yüklenemedi — Belge boş — içeriği olan bir belge seçin.",
  "errorCard": "Belge yüklenemedi — probe_bos.txtBelge boş — içeriği olan bir
                belge seçin.(INVALID_REQUEST: boş dosya)Bu uyarıları kapat",
  "cardVisible": true }
```

Kısmî başarı (boş + geçerli birlikte):

```
{ "toastClass": "toast warn",
  "toastText": "1/2 belge yüklendi ve dosyaya bağlandı · probe_bos.txt
                yüklenemedi — Belge boş — içeriği olan bir belge seçin." }
```

Çift tık (`window.fetch` sarılarak POST sayıldı):

```
{ "posts": 1, "before": false, "duringDisabled": true, "afterDisabled": false }
```

İkiz uyarısı (aynı başlıkla ikinci deneme):

```
{ "posts": 0,
  "err": "Bu başlıkla açık bir dosyanız zaten var (aynı başlık): “W14 ÇİFT TIK
          PROBE”. … Mevcut dosyayı aç / Yine de yeni dosya aç" }
```

Ölü aktif dosya (`localStorage`e uydurma bir kimlik yazılıp sayfa yenilendi):

```
{ "stored": null, "selValue": "",
  "optionsSubsetOfServer": true, "optCount": 2, "serverCount": 2,
  "toast": "Aktif dosya artık yok: “ÖLÜ DOSYA (silinmiş)” silinmiş olabilir.
            Dosyasız çalışmaya geçildi — üst çubuktan bir dosya seçin.",
  "selTitle": "Aktif dosya: üst çubuktan seçtiğiniz dava dosyası — bu ekran…" }
```

### 1.3 Yan bulgu (düzeltildi)

`showView` `belge` görünümünü `openDocument(arg, {})` ile açıyordu; `{}`
truthy olduğu için `docPage.pendingOpts` **hiçbir zaman okunmuyordu** —
`gotoDocument(fileId, {focusAsk:true})` seçeneği W12'den beri ölüydü.
`openDocument(arg)` yapıldı; `focusAsk` ve yeni `focusChunk` artık çalışıyor.

---

## 2. B-21 — belge × soru ızgarası (tabular review)

### 2.1 Ne yapıldı

Yeni gizli görünüm **`#izgara`** (`view-izgara`), Araştır sekmesini vurgular
(`HIDDEN_VIEWS.izgara = "arastir"`, `ARGLESS_HIDDEN.izgara = true` — dosya/belge
sayfalarının aksine argümansız). İş kartından ve doğrudan hash'ten açılır.

**Motor yeni uç gerektirmez.** Satır = belge, sütun = soru, hücre = mevcut
`POST /v1/answer` isteğinin sonucu; her istek `filters.fileIds = [tek belge]`,
`includeCorpus: false` taşır ve aktif dosya varsa `matterId` eklenir. Kuyruk
**sıralıdır** (her isteğin kendi 60 sn'lik sunucu bütçesi geçerli kalsın diye),
ilerlemeyi `N/M hücre` olarak gösterir ve **"Durdur"** ile kesilebilir.

Hücre kuralları:
- Dolu hücre: ilk tespitin metni (260 kod noktasına kısaltılmış) + sonuç yönü
  rozeti + **"kaynağa git — parça `<chunkId>` · konum `başlangıç–bitiş`"** düğmesi.
- Düğme `gotoDocument(fileId, { focusChunk })` çağırır; belge sayfası açılır ve
  `highlightChunk` ilgili `#parca-<chunkId>` çapasını vurgulayıp oraya kaydırır.
- **Boş hücre yoktur**: kapsanmayan hücre "kapsanmadı" der, kapsam verisi varsa
  "kapsanmadı — karşılığı bulunamayan sözcükler: …" ekler.
- İstek hata verirse hücre "istek başarısız — `<Türkçe hata>`" yazar.

Sorular her satır bir sütun olacak biçimde girilir (en çok 6), altı hazır soru
şeridi vardır (tebligat tarihi, bedel, ihtarname, taraflar, yetki, vade) — Türk
solo avukatının ek yığınında gerçekten aradığı şeyler.

Dışa aktarım: **CSV**. Sütunlar

```
Belge; Belge kimliği; Soru; Durum; Cevap; Kaynak parça; Konum (Unicode);
Alıntı SHA-256; Araştırma no
```

`data:text/csv;charset=utf-8,<BOM+içerik>` + `download` özniteliğiyle iner;
ayrıca "CSV'yi panoya kopyala" düğmesi vardır (indirme engellenirse yol açık
kalsın diye). **Tablo kaynağından koparılmış bir özet değildir**: her dolu
hücrenin `fileId` + parça kimliği + Unicode konumu + alıntı SHA-256'sı ayrı
sütundadır — rakibin tablosundan farkımız tam olarak budur.

### 2.2 Kabul kanıtı (tarayıcı, gerçek sunucu)

5 belge × 3 soru (SENTETİK probe belgeleri):

```
{ "rows": 5, "cols": 3, "empties": 0 }
```

hücre örnekleri (kısaltılmış):

```
probe_tebligat  × "Tebligat hangi tarihte…"  → dolu · kaynağa git — parça e1f67603-b9c2-… · konum 96–354
probe_tebligat  × "Aylık kira bedeli nedir?" → kapsanmadı — karşılığı bulunamayan sözcükler: aylık, kira
probe_makbuz    × "Aylık kira bedeli nedir?" → dolu · kaynağa git — parça 4e55d75e-a2a4-… · konum 78–263
```

6 belge × 3 soru turu: `"18/18 hücre tamam"`, `empties: 0`.

Hücre → belge çapası:

```
{ "hash": "#belge/84d808cef47e60b5",
  "hit": "parca-e1f67603-b9c2-48c2-b1bc-ec96ecb30f1c" }
```

CSV:

```
{ "csvHrefPrefix": "data:text/csv;charset=utf-8,%EF%BB%BF%22",
  "csvLen": 7998, "download": "izgara-2026-09-02.csv" }
```

### 2.3 Sapma (dürüstlük notu)

**DOCX dışa aktarımı YAPILMADI.** Konsolun bağımlılık disiplini (yeni npm
paketi yok, `package.json` donmuş) içinde tarayıcıda DOCX üretmenin yolu yok;
sunucu tarafı bir uç gerekir ve `server.ts` ile `src/drafting/**` bu hattın
dosyası değildir. Kalemin CSV yarısı indi, DOCX yarısı **inmedi** ve
`integrationRequests`e yazıldı. CSV Word'de açılır ama bu bir DOCX değildir;
öyle sunulmuyor.

---

## 3. B-22 — adlandırılmış iş kartları

### 3.1 Ne yapıldı

Araştır sekmesinin **en üstüne** "Ne yapmak istiyorsunuz?" şeridi eklendi
(`#workcards`). Her kart: ad · tek cümlelik sözleşme · "Çıktı: …" satırı.
Her kart **mevcut** bir uca sabit bir gövde gönderir; yeni uç yoktur.

| # | Kart | Ne yapar | Uç |
|---|---|---|---|
| 1 | Belgeyi özetle | sabit soruyu belge kapsamına yazar, belge seçtirir | `POST /v1/answer` (`filters.fileIds`) |
| 2 | Kronoloji çıkar | tarih/olay sorusunu belge kapsamında sorar | `POST /v1/answer` |
| 3 | Atıfları denetle | belge sayfasını açar; "Otomatik ön inceleme" her atfı korpusta doğrular | `GET /v1/files/{id}` + `POST /v1/answer` |
| 4 | Belge × soru ızgarası | `#izgara` görünümü (B-21) | `POST /v1/answer` × N |
| 5 | Hukukî soru sor | yerel korpus kapsamı + odak | `POST /v1/answer` |
| 6 | Karşıt içtihat tara | soruyu çalıştırır ve **doğrudan `#sec-karsit`e** kaydırır | `POST /v1/answer` |
| 7 | Canlı kaynaklarda araştır | canlı kapsam | `POST /v1/research/start` |
| 8 | Süre hesapla | süre modalı | `POST /v1/deadlines/compute` |
| 9 | Dilekçe taslağı hazırla | Taslak görünümü | `POST /v1/drafts` |
| 10 | Kayıtlı araştırmalarım | geçmiş listesi | `GET /v1/answers?limit=20` |

**Vaporware kapısı (§G.3.4).** Her kartın bir `blocked()` yordamı vardır;
bir cümle dönerse kart **devre dışı** çizilir ve nedeni kartın gövdesine
yazılır ("Canlı araştırma bu sunucuda kapalı — ColleX-Baslat.cmd ile
başlatın." / "Önce Belgeler'e bir belge yükleyin."). Bu dalgada **inmemiş**
işler (kontrol listesine göre inceleme B-24, duruşma hazırlık özeti B-17,
karar arama ekranı B-16, atıf denetim raporu B-13) **hiç kart olarak
görünmüyor** — testte de yokluk olarak sabitlendi.

**Boş soru kutusu (UXAUDIT P1-14).** `#q` artık boş başlar; demo sorusu
yalnız yeniden adlandırılan **"Örnek sorular"** şeridinde durur. Kutunun
`placeholder`ı aynı cümleyi taşır ama **değer değildir**, yani fark
edilmeden basıldığında bir kira dosyasına ceza hukuku araştırması
dosyalanmaz.

### 3.2 Kabul kanıtı

```
q: ""
workcards (belge yokken):
  Belgeyi özetle [devre dışı] · Kronoloji çıkar [devre dışı] ·
  Atıfları denetle [devre dışı] · Belge × soru ızgarası [devre dışı] ·
  Hukukî soru sor · Karşıt içtihat tara ·
  Canlı kaynaklarda araştır [devre dışı] · Süre hesapla ·
  Dilekçe taslağı hazırla · Kayıtlı araştırmalarım
workcards (5 belge yüklüyken): yalnız "Canlı kaynaklarda araştır" devre dışı
```

10 kart ≥ 8. Kart durumu sağlık ve belge listesi bilindikten sonra
kesinleşir (`ensureFilesIndex` her tazelemede `renderWorkCards()` çağırır).

---

## 4. B-27 — uyarı bütçesi, makine sözlüğü, tanımsız terimler

### 4.1 Yapı (COPY §4.2: 3 sabit + 1 koşullu)

| # | Blok | Sınıf | İçerik |
|---|---|---|---|
| 1 | Başlık | `.verdict.warnblock` | durum damgası + tek cümlelik anlamı + kesinleştirme cümlesi **aynı blokta** |
| 2 | Künye | `.card.answermeta.warnblock` | kapsam · soru kapsamı % · eksik sözcükler · üretim yolu · veri kaynağı (+ varsa şerit düşmesi, yalnız-yükleme) |
| 3 | Uyarılar | `.card.warnblock.warncard` | **katlanmış** `<details>`: bütçe taşması + işleyiş uyarıları + doğrulama gerekçeleri + ham kodlar |
| 4 | Çekimserlik | `.abstain-panel.warnblock` | yalnız ÇEKİMSER cevapta: nötr cümle + dört eylem |

Eski **tam genişlik "Kesinleştirilemez" bandı kaldırıldı** — kesinleştirme
cümlesinin ikinci kopyasıydı. Cümlesi ("Bu cevap KESİNLEŞTİRİLEMEZ: aşağıdaki
gerekçeleri okumadan kullanmayın.") artık **bir kez**, katlanmış Uyarılar
kartının içinde duruyor.

**Muhasebe mekanizması.** Görünür her uyarı cümlesi `noticeLine(box, cls, text)`
üzerinden yazılır:
- `WARN_BUDGET_SENTENCES = 8`, `WARN_BUDGET_BLOCKS = 4` (sabitler dosyada);
- **birebir aynı cümle asla iki kez yazılmaz** (normalize edilmiş dize sayacı);
- bütçe dolduğunda kalan cümleler `answerNotice.overflow`a düşer ve katlanmış
  kartta "Ekranda yer kalmayan notlar" başlığıyla görünür;
- her cümle `.warnline`, her kap `.warnblock` sınıfı taşır — ölçüm bunları sayar.

### 4.2 Makine kodları ana akıştan çıktı

- `warnGroupList(codes, opts)` ham kodu **yalnız `opts.raw === true`** iken
  yazar; iki çağrı da katlanmış Uyarılar kartının içindedir.
- `observedReasonTR(reason, withRaw)` aynı şekilde; karşıt otorite tablosunda
  ham kod yok, altında "Teknik ayrıntılar — ham kodlar" `<details>` var.
- Kanıt kapsamı satırından ham niyet kodu (`(APPLICATION)`) kalktı; kod aynı
  katlanmış kaba taşındı.
- "Reddedilen kanıt adayları" listesi (parça UUID'si + ham gerekçe) katlandı;
  ana akışta yalnız "N pasaj kanıt kümesine alınmadı." kaldı.
- **Belge sayfası:** her bölüm satırı artık yalnız "Bölüm n/N" der; "konum
  a–b (Unicode karakter sayımı) · `<UUID>`" tek anahtarla açılan
  `.chunkline .tech` içindedir ("Teknik ayrıntılar (parça kimliği ve Unicode
  konumu)"). UXAUDIT'in ölçtüğü 19 UUID + 19 konum satırı varsayılan olarak
  ekranda değil.
- `ANTHROPIC_API_KEY tanımlı değil — çip devre dışı.` ipucu → "Bulut yapay
  zekâ bu bilgisayarda kapalı — anahtar tanımlı değil; her şey yerel
  çalışıyor." (Env değişkeninin adı Ayarlar › Sistem durumu'nda ve
  `AI_DISABLED_HINT`te teknik satır olarak kaldı — LANG-7 testi onu pinliyor.)
- `--with-mcp` CLI bayrağı canlı-mod ipucundan kalktı.

### 4.3 Karşıt otorite tablosu belge bazında tekilleşti

`cov.observed` satırları `documentId` (yoksa başlık + E. + K.) ile
tekilleştirilir; kaç arama şeridinde bulunduğu **"Kaç aramada"** sütunudur.
UXAUDIT'in ölçtüğü "aynı Yargıtay kararı 3 kez, aynı kanun 4 kez" böylece
tek satıra iner.

### 4.4 Tanımlar

`TERM_TR` sözlüğü ve `defineTerm(node, key)` yardımcı işlevi; terim
kullanıldığı yerde tek cümlelik tanımını `title` olarak taşır:

| Terim | Nerede asılı |
|---|---|
| **aktif dosya** | üst çubuk seçicisi + dosya sayfasındaki "aktif dosya" çipi |
| **KAYNAKSIZ** | paragraf rozeti, editör sayacı çipi, AI analizi maddesi |
| **K-n** | paragraf atıf çipleri (`.evchip`) |
| **sürüm** | sözlükte tanımlı |
| **deneysel** | UDF düğmesinin etiketi |

### 4.5 Çekimserlik artık bir yol ayrımı

Eski metin ("en az bir doğrulama **başarısız**") çekimserlikte kullanılmıyor.
`ABSTAIN_NEUTRAL_TR = "Bu soru elinizdeki kaynaklarda karşılık bulmuyor —
aşağıdaki yollardan biriyle kaynağı genişletebilirsiniz."` ve dört eylem:
**Canlı kaynaklarda ara · Belge yükle · Soruyu daralt · Değerlendirme tarihini
değiştir.** `FINALIZE_TR.no` (KESİNLEŞTİRİLEMEZ… "başarısız") PARTIAL/ŞERHLİ
cevaplarda olduğu gibi duruyor — orada gerçekten bir doğrulama başarısızdır.

Ayrıca `(SENTETİK)` çipi → **"yerel korpus (SENTETİK) — örnek metin, gerçek
karar değil"** (TRMARKET). `RETRIEVAL_LANE_DEGRADED` katlanmış kartta
saklanmaz: künyede **görünür** satır olur (B-06 ile birlikte anlam kazanır).
Yüklenen belge feragati kartlara altı kez değil, künyeye **bir kez** yazılır.

### 4.6 Kabul kanıtı (tarayıcı ölçümü, gerçek cevaplar)

Ölçüm yöntemi: `#out` ağacında **görünür** (`hidden`/`display:none`/kapalı
`<details>` dışında) `.warnblock` ve `.warnline` düğümleri sayıldı; cümle
metinleri normalize edilip tekrar sayacı çalıştırıldı; ana akışın görünür
metni altı makine kodu için tarandı.

| Senaryo | Durum | Blok | Cümle | Tekrar | Görünür makine kodu |
|---|---|---|---|---|---|
| "Uzay hukukunda … tahkim usulü" | ÇEKİMSER | **4** | **5** | **0** | **0** |
| "TCK m. 157 … cezası" (2025-06-01) | TAM | **3** | **6** | **0** | **0** |
| "Araç satışında kapora …" (2026-06-01) | ŞERHLİ | **3** | **6** | **0** | **0** |
| 3 belge + korpus, kira/tahliye sorusu | TAM | **3** | **6** | **0** | **0** |

Tavan: 4 blok / 8 cümle. Ölçülen en yüksek: 4 blok, 6 cümle.
Aranan diziler: `NORM_CONTENT`, `AFFIRMATIVE`, `NEGATIVE`, `NEUTRAL`,
`EVIDENCE_CAP_APPLIED`, `QUESTION_NOT_COVERED` → **hepsi 0**.

Belge sayfası teknik anahtarı:

```
{ "mainLine": "Bölüm 1/3", "before": "none", "after": "inline",
  "techText": " · konum 0–60 (Unicode karakter sayımı) · c9e40a40-8053-…" }
```

### 4.7 Bağımlılık (dürüstlük notu)

B-27'nin iki bağımlılığı bu hatta değil: **B-06** (`RETRIEVAL_LANE_DEGRADED`
uyarısının gerçekten üretilmesi, L-ANSWER) ve **B-11** (yeni süre disclaimer
metni, L-LEGAL). Konsol tarafı ikisine de hazırdır: uyarı görünür künye satırı
olarak çizilir, disclaimer birebir sunucudan gelen metni basar. Uyarının
kendisi bu sunucuda hiç üretilmediği için **canlı görülmedi**; kod yolu
testle sabitlendi.

---

## 5. B-28 — erişilebilirlik P0 dörtlüsü + koyu tema kırıkları

### 5.1 Değişen tokenlar (DESIGN-SPEC §1.1/§1.2/§5.2 kadar ulaştığı yerde)

| Token | Açık | Koyu | Ne için |
|---|---|---|---|
| `--border` (yeni) | `#8e836a` | `#8d7d59` | **zorunlu denetim sınırı** — girdi kenarı artık `transparent` değil |
| `--on-seal` (yeni) | `#fdf9f0` | `#fdf3ee` | DOLU bordo yüzey üstündeki metin; **her iki temada açık** |
| `--scrim` (yeni) | `rgba(34,31,25,.55)` | `rgba(6,5,4,.70)` | modal perdesi (+ `backdrop-filter: blur(2px)`) |
| `--ring` | `0 0 0 2px var(--panel), 0 0 0 4px var(--seal)` | aynı | iki katmanlı odak halkası |

`:focus-visible` kuralı artık öğenin **kendi** yarıçapını korur (eski kural her
odakta `--r-sm`e zorluyor, hap butonda kare halka çiziyordu).
`--seal-ink`/`--btn-ink` yerine dolu bordo yüzeylerde `--on-seal` kullanılır;
`.viewtab.active`ın koyu temadaki jel parlaklığı (`rgba(255,255,255,.16)`)
kaldırıldı.

`.toast.bad`/`.toast.ok` ve `.days.late` içindeki **sabit `#fff` silindi**:
zemin `var(--ink)`, metin `var(--paper)`, anlam rengi yalnız 4 px sol kenar.
Yeni `.toast.warn` (B-10'un kısmî başarı tonu) aynı kalıpta.

### 5.2 Ölçülen oranlar

`tests/pipeline/console.test.ts` bu oranları **grep'lemez, hesaplar**: token
bloğunu dosyadan ayrıştırıp WCAG bağıl parlaklığından oranı üretir. Aynı
hesabın betikle alınan çıktısı:

| Ölçüm | Açık | Koyu | Eşik | Eski |
|---|---|---|---|---|
| Odak halkası (dış katman `--seal`) / `--panel` | **8,94** | **5,46** | ≥ 3 | 1,36 / 1,51 |
| Odak halkası / `--paper` | 8,35 | 5,80 | ≥ 3 | — |
| Odak halkası / `--panel-2` | 7,98 | **5,03** | ≥ 3 | — |
| Girdi sınırı `--border` / `--panel-2` (kendi dolgusu) | **3,21** | **3,91** | ≥ 3 | 1,12 / 1,08 |
| Girdi sınırı / `--panel` | 3,59 | 4,24 | ≥ 3 | — |
| `GECİKMİŞ` çipi ve toast (`--paper` / `--ink`) | **13,89** | **14,48** | ≥ 4,5 | 6,77 / **2,76** |
| `.viewtab.active` (`--on-seal` / `--btn`) | **8,10** | **7,01** | ≥ 4,5 | — / **2,45** |
| `.viewtab.active` (`--on-seal` / `--btn-deep`) | 11,08 | 10,88 | ≥ 4,5 | — |

`GECİKMİŞ` çipi artık **her iki temada aynı muameleyi** görür (dolu mürekkep
zemin + kırmızı 4 px kenar) — koyu temada açık renkli olması bilinçlidir ve
sayfanın en yüksek kontrastlı öğesidir; aciliyet artık tema değiştirince
tersine dönmüyor.

### 5.3 960 px ölü bölgesi

Yeni `@media (max-width: 1200px)` (DESIGN §1.5 `lg`): üst çubuk
`"brand matter theme" / "pills pills pills"` iki satıra iner, durum hapları
sarar. 960 px'te (1440 ekranda %150 yakınlaştırma) altı görünümde ölçüm:

```
#dosyalarim 945 ≤ 960 · #arastir 945 ≤ 960 · #belgeler 945 ≤ 960
#taslak     945 ≤ 960 · #ayarlar 945 ≤ 960 · #izgara   945 ≤ 960
```

(eski değer: `scrollWidth 1087 > 960`).

### 5.4 390 px'te "deneysel" etiketi

`@media (max-width: 480px)` içindeki `.edacts a.dl.udf .tag { display: none }`
**silindi**; düğme sarar, etiket ikinci satırda durur. 390 px'te editörde
ölçüldü:

```
{ "udfText": "UDF deneysel", "tagDisplay": "inline",
  "tagTitle": "Deneysel: bu çıktı biçimi üretiliyor ama hedef programda
               (UYAP Doküman Editörü) hiç açılmadı; açılana kadar bu etiket
               kalkmaz.",
  "innerW": 390, "scrollW": 375 }
```

### 5.5 Hareket

`prefers-reduced-motion` bloğu sekiz seçici yerine **tek evrensel sıfırlama**
oldu (`animation-duration/iteration-count/transition-duration: 1ms !important`
+ `html { scroll-behavior: auto }`). `.runbar .sweep`in sonsuz döngüsü ve 48
`transition` bildirimi artık kapsam içinde. **Not:** bu blok statik olarak
doğrulandı (test), medya emülasyonuyla tarayıcıda ölçülmedi — Playwright MCP
yüzeyinde `emulateMedia` yok.

### 5.6 Sapma

DESIGN-SPEC §5.2 odak kuralında `border-radius: inherit` istiyor. **Uygulanmadı:**
`inherit` bir kartın (16 px) içindeki `.tin`in (10 px) yarıçapını odakta
değiştirir ve halka öğenin şeklinden kopar. Bunun yerine kural yarıçapa hiç
dokunmuyor; sonuç istenen davranışın kendisidir (hap butonda hap halka,
dikdörtgen girdide dikdörtgen halka). Tam token göçü (26 → 21 token, boşluk /
tipografi ölçeği, bileşen şartnameleri) bu kalemin kapsamı değildir; §G.2
uyarınca **Faz B**'ye kalıyor.

---

## 6. Faz B için TAM UI SÖZLEŞMESİ

Bu dalgada L-CONSOLE **kendi** uçlarını bağladı; Faz B'de bağlanacak yeni
uçlar başka hatlarındır. Buradaki sözleşme, **bu hattın** Faz B'de
tamamlaması gereken parçalar içindir.

### 6.1 B-21 ızgara — DOCX dışa aktarımı (Faz B)

- **Uç (istenen, L-EVID/L-SAFE):** `POST /v1/exports/grid`
- **Gövde:**
  ```json
  { "title": "Belge × soru ızgarası",
    "matterId": "<uuid|null>",
    "questions": ["...", "..."],
    "rows": [ { "fileId": "<16 hex>", "fileName": "…",
                "cells": [ { "covered": true, "status": "COMPLETE",
                             "text": "…", "chunkId": "…",
                             "startChar": 96, "endChar": 354,
                             "quoteSha256": "…", "runId": "…" } ] } ],
    "format": "docx" }
  ```
- **Yanıt:** `200` + `Content-Disposition: attachment; filename*=UTF-8''…`
  (DOCX), ya da tipli `422 EXPORT_REFUSED` (doğrulanamayan hücre varsa).
- **Konsol tarafı:** `#gridcsv` yanına `Word (DOCX) indir` düğmesi; hata
  yolunda `errTR` ile Türkçe kart.

### 6.2 Faz B'de bu hattın bağlayacağı diğer uçlar (sahipleri Faz A'da teslim etti)

| Kalem | Uç | Konsolda yeri | Türkçe etiketler |
|---|---|---|---|
| B-13 | `/v1/contracts/*` (L-EVID) | Atıf Denetim Raporu tablosu + yeni iş kartı "Atıf denetim raporu" | "Atıf", "Durum", "Yürürlük", "Kaynak", "Rapor indir" |
| B-14 | `/v1/sources/*` (L-SOURCES) | yeni `#kapsam` sayfası + Ayarlar bağlantısı | "Neyi tarıyoruz", "Neyi taramıyoruz", "Son güncelleme" |
| B-16 | `/v1/sources/search` (L-SOURCES) | yeni `#karar-ara` görünümü + iş kartı "Karar ara" | "Daire", "Yıl", "Esas/Karar no", "Olumlu/olumsuz sözcük" |
| B-17 | takvim + `.ics` (L-MATTER) | Dosyalarım takvimi + iş kartı "Duruşma hazırlık özeti" | "Takvime ekle", "Duruşma", "Hatırlatma" |
| B-19 | klasör intake (L-SAFE) | Belgeler bırakma alanı | "Klasör bırakın", "N belge bulundu" |
| B-24 | kontrol listesi motoru (L-EVID) | iş kartı "Kontrol listesine göre incele" | "Madde", "Risk", "Gerekçe" |
| B-30 | `/original` (L-MATTER) | belge sayfası "Aslını indir" | "Aslını indir" |
| B-36 | doğrulama kontrol listesi (L-EVID) | editör alt şeridi | "Dosyalama öncesi kontrol" |

Her yeni kart, B-22'nin **vaporware kapısına** tabidir: ilgili uç bu sunucuda
`404` dönerse kart devre dışı çizilir ve nedeni yazılır.

### 6.3 Bu dalgada eklenen, Faz B'nin kullanabileceği kancalar

| Kanca | Ne işe yarar |
|---|---|
| `renderWorkCards()` + `WORK_CARDS` dizisi | yeni iş kartı = diziye bir nesne (`title`, `line`, `out`, `run`, `blocked`) |
| `noticeLine(box, cls, text)` | yeni bir uyarı cümlesi bütçeye tabi olarak eklenir; tekrar ve taşma otomatik |
| `defineTerm(node, "…")` + `TERM_TR` | yeni terimin tanımı tek yerde |
| `lockSubmit(key, button, busyText)` | yeni formlar için çift gönderim kilidi |
| `uploadFiles(files, {matterId, errorHost, onDone, onError})` | yeni bir görünümden yükleme; `errorHost` fonksiyon da olabilir |
| `gotoDocument(fileId, {focusChunk, focusAsk})` | herhangi bir yerden belgenin belirli parçasına çapa |
| `gridState` + `gridCsv()` | ızgaranın verisi; DOCX ucu bağlanınca aynı yapı gönderilir |
| `#izgara` görünümü ve `ARGLESS_HIDDEN` | argümansız gizli görünüm eklemenin kalıbı |

### 6.4 Depolama anahtarları

Değişmedi (`W12-UI1.md` §3). Yeni anahtar **eklenmedi**; ızgara durumu
bellekte tutulur (bilinçli: bir ızgara turu ucuz, kalıcı yapmak
`localStorage`e kaynak verisi yazmak demek olurdu).

---

## 7. `openapi.yaml` additive delta

**YOK.** Bu hat hiçbir yeni uç, alan ya da parametre eklemedi; B-21 motoru
mevcut `POST /v1/answer` sözleşmesini (`filters.fileIds`, `filters.includeCorpus`,
`matterId`) olduğu gibi kullanır. Faz B'de DOCX ucu inerse deltası
§6.1'dedir ve **o ucu ekleyen hattın** raporuna yazılmalıdır.

---

## 8. Entegrasyon istekleri (sahibi olmadığım dosyalar)

Aşağıdaki üç işi **yapmadım**; ilgili hatların dosyalarıdır.

1. **`control-plane/src/api/server.ts` (L-SAFE)** — hiçbir mount satırı
   gerekmiyor. Bu hat yeni router yaratmadı. (Kayda geçiyorum ki L-SAFE
   L-CONSOLE için bir satır aramasın.)
2. **`control-plane/src/drafting/**` veya yeni `src/exports/**` (L-EVID)** —
   B-21'in DOCX yarısı için §6.1'deki `POST /v1/exports/grid` ucu.
   Gerekçe: konsol yeni npm paketi alamaz, tarayıcıda DOCX üretilemez;
   `docx` üretimi zaten `export/`ve `src/drafting/`te var.
3. **`control-plane/src/pipeline/answerPipeline.ts` (L-ANSWER)** — B-06 ile
   birlikte `RETRIEVAL_LANE_DEGRADED` uyarısının gerçekten `warnings[]`e
   yazılması. Konsol onu artık görünür künye satırı olarak çizmeye hazır;
   uyarı üretilmediği sürece satır hiç görünmez.
4. **`docs/implementation/STATUS.md` (L-DOCS, Faz B)** — bu raporun §4.6 ve
   §5.2 tablolarındaki ölçümler yeni "Ölçülen sayılar" satırları olabilir
   (uyarı bloğu/cümlesi tavanı; dört erişilebilirlik oranı). Sayıları
   **yeniden ölçmeden** yazmayın; komutlar §9'da.

---

## 9. Koşulan komutlar ve gerçek çıktılar

```
$ node control-plane/scripts/demo.mjs
  S1..S6 → 6/6 senaryo PASS (collex_demo yeniden kuruldu)

$ node control-plane/scripts/serve.mjs --port 8946 --dsn …/collex_demo
  db ok · 11/11 migrasyon · mcp kapalı · ai kapalı · demoCorpus

$ cd control-plane && npx tsc --noEmit
  tests/drafting/contracts.test.ts(385,5): error TS2322: …
  → BAŞKA HATTIN dosyası (L-EVID). Benim dosyalarım (console.html,
    consolePage.ts, tests/pipeline/console.test.ts) temiz.

$ npx vitest run tests/pipeline/console.test.ts
  ✓ tests/pipeline/console.test.ts (110 tests) 91ms
  Test Files 1 passed (1) · Tests 110 passed (110)
  (W13 sonu: 74 test → bu dalgada +36)

$ npx vitest run tests/pipeline tests/api.test.ts
  Test Files 1 failed | 5 passed (6) · Tests 1 failed | 231 passed (232)
  Tek başarısız: tests/api.test.ts(117) deadlineRules 30 beklenirken 41 geldi
  → L-LEGAL'in B-11'i süre kurallarını 30'dan 41'e çıkarıyor; test dosyası
    L-SAFE'in, kural dosyası L-LEGAL'in. Benim değişikliğimle ilgisi yok.

$ node --check <console.html'in tek <script> gövdesi>
  temiz
```

Tarayıcı yürüyüşü: Playwright MCP, gerçek sunucu, her `console.html`
düzenlemesinden sonra **sunucu yeniden başlatıldı ve sayfa sert yenilendi**
(hash değişimi sayfayı yeniden yüklemediği için bir kez eski sayfayı ölçüp
yanlış sonuca vardım; yöntem düzeltildi).

**Konsol hataları:** JavaScript istisnası **0**. Oturum boyunca kaydedilen
tek hata satırı, kasten ürettiğim üç boş-dosya yüklemesine sunucunun verdiği
`400`ün tarayıcı tarafından basılan `Failed to load resource` kaydıdır
(konsol bu yanıtı doğru işliyor: `bad` tonlu bildirim + görünür hata kartı).
Son sayfa yüklemesinden sonraki tam yürüyüşte (8 görünüm, iki tema): **0**.

Ekran görüntüleri (scratchpad, depoya yazılmadı):
`…/scratchpad/w14-L-CONSOLE/screenshots/` — 01 Araştır 1440 açık ·
02 iş kartları 1440 açık · 03 ızgara 1440 açık · 04 ızgara 1440 koyu ·
05 editör 390 açık (UDF "deneysel") · 06 Dosyalarım 1440 koyu ·
07 odak halkası + toast + GECİKMİŞ çipi 1440 koyu.

---

## 10. Açık konular (dürüstçe)

1. **B-21 DOCX yok.** CSV var, DOCX yok; sunucu ucu gerekiyor (§6.1). Kalemin
   kabul ölçütünün "CSV/DOCX" yarısı karşılanmadı.
2. **`prefers-reduced-motion` tarayıcıda ölçülmedi.** Kural statik olarak
   doğrulandı; medya emülasyonu bu tarayıcı yüzeyinde yok. Faz B'de
   L-VERIFY `emulateMedia` ile teyit edebilir.
3. **Uyarı bütçesi PARTIAL durumunda canlı görülmedi.** Deneme korpusu bu
   dalgada TAM/ŞERHLİ/ÇEKİMSER üretti; PARTIAL yolu (OUT_OF_DATE_SOURCE,
   TIME_BUDGET_EXCEEDED) ölçülmedi. Tavan `noticeLine` içinde **yapısal**
   olarak zorlanıyor (cümle sayacı + taşma kabı), yani duruma bağlı değil;
   yine de "PARTIAL ekranında ölçtüm" demiyorum.
4. **B-27'nin iki bağımlılığı inmedi** (B-06 uyarısı, B-11 disclaimer metni) —
   konsol tarafı hazır, karşılığı henüz üretilmiyor.
5. **Karşıt otorite tekilleştirmesi gerçek çakışan veriyle görülmedi.**
   Deneme korpusunun `observed` listesi bu turda tekrar içermiyordu; kod
   yolu testle sabitlendi, UXAUDIT'in ölçtüğü 3×/4× tekrar yeniden
   üretilemedi.
6. **`#q` boş başlıyor ama `applyCorpusState` hâlâ `DEFAULT_QUESTION`
   sabitini taşıyor** (korpus boşsa kutuyu temizleyen eski yol). Zararsız ama
   ölü; Faz B'de temizlenebilir.
7. **Ekran görüntüleri workspace kökündeki `.playwright-mcp/` altına
   yazılmak zorunda kaldı** (Playwright MCP yalnız oraya yazabiliyor);
   scratchpad'e kopyalanıp oradan **silindiler**. Playwright'ın kendi
   `page-*.yml` / `console-*.log` artıkları o dizinde duruyor — onları bu
   hat üretmedi, silme yetkisi de bu hatta ait değil.
8. **collex_demo'da probe taslak ve cevap kayıtları kaldı.** Yüklemeler ve
   dava dosyaları silindi (`uploads: 0`, `matters: []`), taslak/cevap için
   silme ucu yok; `demo.mjs` bir sonraki koşuda veritabanını yeniden kurar
   ve **`--force-drop-uploads` gerekmez**.
