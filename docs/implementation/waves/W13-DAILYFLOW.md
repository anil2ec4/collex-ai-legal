# W13 — Hat DAILYFLOW: dört iş gününün uçtan uca simülasyonu

Tarih: 02.09.2026 · Hat: DAILYFLOW · Tip: **araştırma / denetim** (hiçbir depo
dosyası değiştirilmedi; yalnız bu rapor yazıldı, git işlemi yapılmadı).

Yöntem: sentetik Türk dava materyali (kira tahliye, iş davası, ticari alacak,
anlaşmalı boşanma — TXT/DOCX/PDF) üretildi ve **ürünün API'si avukatın
yazılımıymış gibi** sürüldü. Sunucu: `node control-plane/scripts/serve.mjs
--port 8935 --dsn …/collex_demo`. Tarayıcı kullanılmadı (bu hat BROWSER LANE
değil). Bütün istek gövdeleri UTF-8 dosyalara yazılıp `curl --data-binary
@dosya` / `urllib` ile gönderildi.

**Kurulum notu (dürüstlük).** `collex_demo` **yeniden kurulmadı**: hat
başladığında veritabanında bana ait olmayan bir kiracı yüklemesi vardı
(`ce5225bdd8554567 sentetik_dava_dilekcesi.docx`, 11:56'da yüklenmiş — aynı
anda koşan başka bir hat). `demo.mjs` bu yüzden düşmeyi reddetti ve
`--force-drop-uploads` **kullanılmadı** (CLAUDE.md: yalnız kendi
yüklemeleriniz için). Korpus zaten kuruluydu (`/v1/health` →
`publicDocuments: 6`, `migrations 11/11`), probe onun üzerinde koştu.
`collex_local`'a hiç dokunulmadı.

**Korpus uyarısı.** `collex_demo`'daki altı belge SENTETİK'tir (TCK v1/v2,
TBK, 7999 sayılı torba, KVKK kararı, iki Yargıtay kararı — hepsi kira/iş/aile
hukuku dışı). Aşağıdaki hiçbir sayı hukukî kalite ölçüsü değildir; ölçülen
şey **ürünün davranışı**dır, hukukun doğruluğu değil.

---

## 0. Yönetici özeti — bir avukat bu dört günü nasıl yaşar

Ürün **kalıcılık, süre hesabı ve belge soru-cevabı** tarafında gerçekten
çalışıyor: sunucuyu öldürüp yeniden başlattıktan sonra dosya, 14 cevap,
taslak v2 metni, sürüm listesi ve kanıt paketi eksiksiz geri geldi; süre
hesapları HMK m.92/2, adli tatil ve yıl geçişinde doğru sonuç verdi;
"belgeye sor" doğru pasajı birebir alıntıyla döndürdü. Alaka kapısı (ADR-022)
ceza hukuku araştırmasının iş davası cevap dilekçesine sızmasını
**gerçekten engelledi**.

Buna karşılık günü fiilen bozan dört şey var:

1. **Kısaltma yazınca çekimserlik bozuluyor.** "kira sozlesmesinde depozito
   iadesi ne zaman yapilir" → doğru şekilde **ÇEKİMSER**. Aynı soruya
   "**tbk ya gore**" eklenince → **KISMİ**, 8 kanıt, 6 tespit, 3'ü
   "DESTEKLENİYOR", hepsi haksız fiil/tazminat maddeleri, `soru kapsamı %0`.
   Aynısı "TCK bakımından işyerinde mobbing suç mudur?" için: 7 tespit, hepsi
   yağma/hırsızlık/dolandırıcılık. Türk avukatı **her cümlede** "TBK'ya göre",
   "HMK uyarınca" yazar. (P0-1)
2. **Soru uzadıkça cevap kötüleşiyor.** Kısa soru → 8 kaynak; aynı sorunun
   1 178 karakterlik gerçek olay örgüsü hâli → **1 kaynak, 0 içtihat**,
   korpusta cevabı olan iki Yargıtay kararı `QUESTION_NOT_COVERED:7` ile
   kenara atıldı. (P0-2)
3. **Zaman sorusu cevaplanmıyor ama TAM deniyor.** "2024'te işlenen suçta
   2026 öncesi mi sonrası mı uygulanır?" → yalnız 2024 metni, 7999 sayılı
   değişikliğe **hiç değinilmiyor**, durum **TAM + KESİNLEŞTİRİLEBİLİR**.
   (P0-3)
4. **Üretilen dilekçe dosyalanabilir değil.** Markdown çıktısının **%77'si**
   (13 207 baytın 10 162'si) gövdede hiç atıf yapılmayan 30 satırlık SHA-256
   eki; DOCX 236 paragrafın 189'u bu ek; sayfa boyutu **A4 değil Letter**;
   hiçbir paragrafta kalın/hizalama yok; her şablonun sonuna mahkemeye özgü
   "karar verilmesini saygıyla arz ve talep ederiz." cümlesi **ihtarnameye
   de** basılıyor; avukat HUKUKÎ SEBEPLER'i kendi eliyle yazdıktan sonra bile
   çıktıda cümlenin başına "**⚠ KAYNAKSIZ —**" ekleniyor ve API'den
   temizlenemiyor. (P0-4, P1-*)

Ve bir "haftaya dönüş" gerçeği: `GET /v1/matters` her dosya için
`nextDeadline` döndürüyor ama benim dosyamda bu **49 gün geçmiş** bir süreydi
(15.07.2026), asıl yaklaşan süre (08.09.2026, 6 gün) onun arkasında gizli
kaldı. Geçmiş/gelecek ayrımı yok.

---

## 1. Gün 1 — yeni dosya (kira tahliye)

**Yapılanlar:** 1 dosya açıldı, 4 belge yüklendi (TXT ×2, DOCX ×1, PDF ×1),
6 belge sorusu soruldu, 6 zaman çizelgesi olayı + 2 not girildi, 3 süre
hesaplandı ve 4 süre dosyaya işlendi.

### 1.1 Ne iyi çalıştı

| Yüzey | Kanıt |
|---|---|
| Yükleme | 4/4 `200`, 0,53–0,56 s; PDF metin katmanı kapısı `pages {pageCount:1, pagesWithText:1, emptyPages:[]}`; DOCX 12 parça, TXT 13 parça |
| Otomatik dosyalama | multipart `matterId` → dosyanın **Belgeler** sekmesinde 4 kayıt, tek istekle |
| Belgeye sor | 6/6 `200`, 0,03–0,14 s; doğru pasaj **birebir** döndü |
| Süre hesabı | `hmk-cevap` 25.08.2026 → **08.09.2026 Salı** (HMK m.92/2 hafta kuralı doğru); `iik-odeme-emri-itiraz` 20.07.2026 → 27.07.2026 (adli tatil uygulanmadı + "isterseniz `applyAdliTatil=true`" uyarısı); `hmk-istinaf` 30.12.2026 → **13.01.2027** (yıl geçişi doğru). Her cevapta `disclaimer` birebir, `verified.status: dogrulanmadi` |

### 1.2 Gün 1'in sürtünmeleri

**(a) Kapsam kaçağı — belge sorusunda alakasız pasajlar "tespit" oluyor.**

İstek: `POST /v1/answer {"question":"Kira bedeli her ayın kaçına kadar ödenir
ve yıllık artış oranı nasıl belirlenir?","filters":{"fileIds":["3b17…"],
"includeCorpus":false}}`

Cevap: `status COMPLETE, finalizable true, coverage.ratio 0.529`, **6 kanıt /
6 tespit, hepsi `SUPPORTED`**. Doğru olan yalnız 1'i (MADDE 2). Diğerleri:

- `"KONUT KİRA SÖZLEŞMESİ (SENTETİK BELGE — gerçek bir sözleşme değildir)"` (belgenin başlık satırı)
- `"KİRAYA VEREN: Ali Yılmaz, T.C. Kimlik No 12345678901 Adres: …"` (adres bloğu)
- `MADDE 6 - TAHLİYE TAAHHÜDÜ …`, `MADDE 1 - SÜRE …`, `MADDE 4 - KULLANIM …`

`admitUploadOnlyPassages` (W12-FIX P1-2) "hiçbir içerik sözcüğü paylaşmayan
pasaj" kuralıdır; "kira" kelimesini taşıyan her paragraf geçiyor. Dört belgeye
birden sorulan soruda aynı şey 8 tespide çıktı (`d1q6`, `EVIDENCE_CAP_APPLIED:5`
uyarısıyla — uyarı "5" diyor ama 8 kanıt döndü, sayı okunmuyor).

**(b) Ön inceleme (`analysis`) taraf çıkarımı zayıf ve çift kayıt üretiyor.**

- `kira_sozlesmesi.txt` → `parties: [{"Veli Kaya","kiracı"}]`. Belgede
  "KİRAYA VEREN: Ali Yılmaz" açıkça yazıyor; **müvekkil bulunamadı**.
- `ihtarname.docx` → `parties: [{"Av. Ayşe Demir — İzmir Barosu, Sicil No
  12345","vekil"}, {"Av. Ayşe Demir","vekil"}]` — **aynı kişi iki kez**
  (FIX-2 #10 tekilleştirmesi `references`/`dates`'e uygulandı, `parties`'e
  değil). "İHTAR EDEN"/"MUHATAP" hiç yakalanmadı.
- `references` = `[{"raw":"MADDE 1"},…,{"raw":"MADDE 7"}]` — sözleşmenin
  **kendi madde numaraları** hukukî referans sayılıyor.
- `dates[].context` hâlâ **kelime ortasından** kesiliyor:
  `"RE Kira süresi 1 (bir) yıldır…"`, `"AR: 1. Müvekkilim ile muhatap…"`.

**(c) Zaman çizelgesine tarih aktarımı = N+1, ve şekiller uyuşmuyor.**

`analysis.dates` şekli `{date, context, count}`; olay kaydının şeması
`{date, title, source, verified}`. `context` → `title` eşlemesi yok, toplu uç
yok: 4 belgenin 13 tarihi için **13 ayrı `POST /v1/matters/{id}/items`**
gerekir. Ölçülen: 6 olay = 6 istek, 287 ms.

**(d) Şema hataları avukatın diline yenik düşüyor.**

| Gönderilen | Sonuç |
|---|---|
| `payload.text` (olay) | `400 payload.title "Bu alan zorunludur."` — `types.ts` `title` diyor, ama `note` `text` kullanıyor; iki kayıt türü aynı kavram için farklı alan adı |
| `payload.source: "manuel"` | `400` — makine değeri **İngilizce** `manual`; Türkçe ürün, Türkçe yazan kullanıcı, İngilizce enum |
| `payload.computed: true` | `400 "Geçersiz değer türü."` — şema `z.record` (nesne) bekliyor; `types.ts` başlığı `computed?` diyor, tipini söylemiyor; hata mesajı **beklenen tipi söylemiyor** |
| `matter.davaDeğeri` (Türkçe ğ ile) | `400 { path:"matter", label:"Dosya bilgileri", message:"Tanınmayan alan." }` — **hangi alanın** tanınmadığı yazmıyor; 20+ alanlı bir formda arayüz kullanıcıyı hiçbir alana yönlendiremez |

**(e) Süre paneli gereksiz ağır ve ufuksuz.**

`GET /v1/matters/deadlines` her süre için **bütün `computed` bloğunu** döndürüyor
(kural notları, `verified.source` düzyazısı, `steps`, `warnings`). 4 süre =
**9 965 bayt**; panel yalnız başlık + tarih + kalan gün gösteriyor. Varsayılan
`until` yok: 2027'deki süre de geliyor. `?until=` çalışıyor (2026-07-20 → 456 B).

---

## 2. Gün 2 — araştırma (8 soru + 3 kontrol sorusu)

Her satır: soru şekli → durum → **avukat kabul eder mi**.

| # | Soru şekli | Durum | Kanıt | Avukat kararı |
|---|---|---|---|---|
| 1 | Norm içeriği — "TCK m.157'nin cezası nedir?" | **TAM**, kesinleştirilebilir | m.157 sabitli, **doğru değişik metin** ("üç yıldan yedi yıla"), `IN_FORCE` | **Kısmen kabul.** Cevap doğru; ama m.158, m.159, **m.168 (etkin pişmanlık)** de yeşil "tespit" olarak eklendi — soruyla ilgisi yok |
| 2 | Uygulama — "var olmayan aracı ilan edip kapora almak dolandırıcılık mı?" | **ŞERHLİ**, kesinleştirilebilir | Doğru karar (E. 2023/4521) bulundu | **Kabul, dikkatle.** Ama 6 tespidin 5'i `CONFLICTING_AUTHORITIES` etiketli |
| 3 | Zamansal — "2024'te işlenen suçta 2026 öncesi mi sonrası mı?" (`asOf 2024-06-01`) | **TAM**, kesinleştirilebilir | Yalnız v1 metni ("bir yıldan beş yıla") | **RED.** Soru "hangisi uygulanır" — cevapta 7999 sayılı değişiklikten, iki metnin karşılaştırmasından, lehe kanun ölçütünden **tek kelime yok**. Yine de TAM |
| 4 | Çelişen otorite — "kapora alıp teslim etmemek her hâlde dolandırıcılık mı?" | **ŞERHLİ**, kesinleştirilebilir | Her iki Yargıtay kararı da geldi | **Kısmen kabul.** İki karar **çelişik değil, ayrılabilir** (araç var/yok); ürün ikisini "destekleyen/karşıt" diye kutuplaştırdı ve **TCK m.168'i** de kapora kararıyla "çelişkili" ilan etti |
| 5 | Konu dışı — "en iyi balık restoranı" | **ÇEKİMSER**, 0 kanıt | — | **Kabul.** Doğru davranış |
| 6 | İçinde atıf var — "TBK m.49 uyarınca haksız fiil şartları" | **KISMİ**, kesinleştirilemez | m.49 sabitli + 7999 m.2 değişikliği bulundu | **Kısmen kabul.** Değişikliğin bulunması iyi; ama **birleşik metin** hiç gösterilmiyor, avukat kafasında birleştirecek. Ayrıca aynı şekildeki #1 TAM iken bu KISMİ — fark hukukî değil, sözcüksel gürültü |
| 7 | Çok uzun (1 178 karakter, gerçek olay örgüsü) | **KISMİ**, kesinleştirilemez | **1 kanıt** (TCK m.157), **0 içtihat** | **RED.** Aynı soruyu iki cümleye indirince (#2, #4) her iki karar da geliyordu. `QUESTION_NOT_COVERED:7`, `coverage.ratio 0.07` |
| 8 | Özensiz Türkçe, diakritiksiz — "kira sozlesmesinde depozito iadesi ne zaman yapilir **tbk ya gore**" | **KISMİ** | **8 kanıt, 6 tespit** — TBK m.2, m.12, m.49, m.50, m.51 | **RED — tehlikeli.** `coverage.ratio 0`, eksik sözcükler `kira, sozlesmesinde, depozito, iadesi, gore` — yani hiçbir şey karşılanmadı, ama ekranda 6 tespit var |

### 2.1 Kontrol soruları — mekanizma kanıtlandı

| Soru | Durum |
|---|---|
| "kira sozlesmesinde depozito iadesi ne zaman yapilir" (kısaltmasız) | **ÇEKİMSER**, 0 kanıt, `QUESTION_NOT_COVERED` |
| aynı soru + "tbk ya gore" | **KISMİ**, 8 kanıt, hepsi `pinned:true`, `lanes:["exact"]` |
| "HMK uyarınca tanık dinletme talebi ne zaman yapılır?" | **ÇEKİMSER** (6100 korpusta yok → sabitleme olmadı) |
| "TCK bakımından işyerinde mobbing suç mudur?" | **KISMİ**, 8 sabitli kanıt: m.141/2 (enerji hırsızlığı), m.148 (yağma), m.155, m.156, m.159 … **7 tespit**, mobbing hakkında sıfır |

Mekanizma `control-plane/src/store/chunkStore.ts::exactPinLookup` başlığında
zaten yazılı: *"legislation refs alone → all chunks of that legislation"*.
Madde numarası olmayan çıplak bir kanun atfı **bütün kanunu sabitliyor**;
`coverage.gate` `bypassed-by-reference` oluyor; `admitUnderReferenceBypass`
sabitli pasajı "hak olarak" kabul ediyor — ve burada **her pasaj sabitli**.
Yani P0-1'in pasaj pasaj kabul düzeltmesi tam bu senaryoda devre dışı kalıyor.

### 2.2 Avukatın gördüğü metin (birebir, `d2q8` markdown'ından)

```
Soru kapsamı: %0 — soru sözcüklerinin kaynaklarda karşılığı.
Karşılığı bulunamayan sözcükler: kira, sozlesmesinde, depozito, iadesi, gore.

### Tespit 2: DESTEKLENİYOR
> 6098 sayılı Türk Borçlar Kanunu (sentetik alıntı), m. 51: "MADDE 51 - (1)
> Hakim, tazminatın kapsamını ve ödenme biçimini …"
- Kaynak isabeti: %100   - Pasaj desteği: %100   - Otorite: %100
- Güncellik: %100        - Kapsam: %100          - Soru kapsamı: %0
```

Altı ölçekten beşi %100, biri %0. Ekranda baskın olan yeşil taraf.

### 2.3 Her soruda koşan gereksiz karşı-otorite taraması

`contraryCoverage.executed: true` **konu dışı soruda da, yüklenen belgeye
sorulan soruda da** koşuyor. Ürettiği sorgular:

- `ihtarname muhataba hangi tarihte tebliğ edilmiştir? "aksi yönde"`
- `izmir alsancak'ta akşam yemeği için en iyi balık restoranı hangisidir? "aksi yönde"`
- `kira "tahliye talebinin reddi"` — **müvekkilin kendi kira sözleşmesine karşı**

`issueLabel` bütün soru metni oluyor (konu çıkarımı düşünce). Avukatın kendi
yüklediği sözleşmede "karşıt otorite" aramak kavramsal olarak yanlış ve
ölçülebilir maliyeti var (her soruda 2–4 ek şerit sorgusu).

---

## 3. Gün 3 — dilekçe

Üretilenler: **dava dilekçesi** (kira tahliye, 4 yükleme kanıt),
**cevap dilekçesi** (iş davası, kanıt = 2. günün ceza hukuku araştırması —
alaka kapısı sınandı), **ihtarname** (ticari alacak, 1 yükleme).
Sonra `PUT` ile revizyon, sürüm listesi, DOCX/MD/UDF dışa aktarım ve
python-docx / zip+`intake/extract.py` ile **okuma**.

### 3.1 Alaka kapısı gerçekten çalıştı — ama uyarılar birbiriyle çelişti

İş davası cevap dilekçesine ceza hukuku araştırması bağlandı. Sonuç:
`evidence: 0`, `unusedEvidence: 8`, hepsi `DOMAIN_MISMATCH`; gövdede "5237"
geçmiyor. **Doğru davranış.** Ama aynı cevabın `warnings` dizisi şunu da
söylüyor (birebir):

> "6 hukukî değerlendirme için kaynaklar arasında çelişki bulundu: … E.
> 2023/4521 talebi destekler yönünde, E. 2023/7810 talebin aksi yönündedir.
> **Destekleyen taraf taslağa yazıldı ve her paragrafa karşı içtihat işareti
> eklendi; aksi yöndeki karar DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT
> bölümündedir**"

Belgede öyle bir bölüm **yok**, hiçbir paragrafa işaret eklenmedi,
`DAYANAK KAYNAKLARI` = *"(Bu taslağa bağlanmış doğrulanmış kaynak yoktur.)"*.
Avukat olmayan bir bölümü arayacak. Uyarı üretimi, alaka kapısının kararından
**önce** hesaplanıp sonra süzülmüyor.

### 3.2 Dilekçenin kendisi — dosyalanabilir mi?

**Hayır, ağır elle düzeltme olmadan.** Dava dilekçesi Markdown'ı 13 207 bayt;
**gerçek dilekçe metni 2 180 bayt (%17)**, `EK — DOĞRULAMA` + `DAYANAK
KAYNAKLARI` ekleri **10 162 bayt (%77)**. DOCX: **236 paragraf**, gövde 47,
ek 189. UDF: 247 paragraf, 12 284 kod noktası.

Elle düzeltilmesi zorunlu olanlar:

| # | Ne | Kanıt |
|---|---|---|
| 1 | **30 satırlık SHA-256 eki mahkemeye gidiyor.** `[K-1]…[K-30]` gövdede **hiçbir yerde** atıf yapılmıyor; ek yine de basılıyor. `ek-dogrulama` bölümü editörde salt okunur ve `PUT` ile göndermesem bile sunucu **yeniden üretiyor** (v2 dışa aktarımında geri geldi) → ColleX içinden silinemez, Word'de silinecek | `res/dava.md`, `res/dava-v2.md` |
| 2 | **Sayfa boyutu A4 değil.** `section.page_width = 7772400 EMU = 8,5 inç`, `page_height = 10058400 = 11 inç` → **US Letter**. UYAP/adliye A4 ister | python-docx |
| 3 | **DOCX'te hiç kalın ve hiç hizalama yok.** 236 paragrafın tamamı `bold=False`, `alignment=None`. Mahkeme hitabı ortalanmamış, imza bloğu sağa yaslanmamış, gövde iki yana yaslanmamış. Markdown'da `**…**` var, UDF'de `bold="true"` 47 paragrafta var — **üç çıktı üç farklı biçim sadakati** | python-docx / UDF `content.xml` |
| 4 | **Mahkemeye özgü kapanış her şablona basılıyor.** İhtarnamenin ortasında: `"karar verilmesini saygıyla arz ve talep ederiz."` — ihtarname mahkemeye hitap etmez, "karar" istemez. Aynı cümle dava ve cevap dilekçesinde de kullanıcının kendi "…talep ederiz." satırının **hemen ardına** ekleniyor → cümle tekrarı | `res/ihtar.md` satır ~62, `res/dava.md` |
| 5 | **Avukatın kendi yazdığı HUKUKÎ SEBEPLER'e "⚠ KAYNAKSIZ" damgası basılıyor.** `PUT` ile şunu yazdım: *"6098 sayılı TBK m.315, m.352; 6100 sayılı HMK m.119, m.316 vd.; 2004 sayılı İİK m.269…"*. v2 dışa aktarımı: `⚠ KAYNAKSIZ — 6098 sayılı Türk Borçlar Kanunu m.315, m.352; …` + alt satır `(KAYNAKSIZ — hukukî dayanak doğrulanmadı; avukat eklemeli)`. Yerel korpusta kira mevzuatı olmadığı için bu damga **hiçbir zaman** kalkmaz | `res/dava-v2.md` satır 58–61 |
| 6 | **Ek numaraları delil listesiyle uyuşmuyor.** HUKUKÎ DELİLLER: 1. Kira sözleşmesi, 2. İhtarname… ; ekler: `Ek-1: ihtarname.docx`, `Ek-2: kira_sozlesmesi.txt`. Türk dilekçesinde ek numarası delil sırasını izler | `res/dava.md` |
| 7 | **"kiracı yüklemesi" ibaresi.** `EK — DOĞRULAMA` her yüklemeyi *"Doğrulama: **kiracı** yüklemesi; hukukî dayanak değildir"* diye niteliyor. Yazılım anlamında "tenant"; hukukta "kiracı" karşı taraf. Kira dosyasında müvekkil **kiraya veren**; ticari alacak ihtarnamesinde ortada kiracı yok. Her dışa aktarılan belgede geçiyor | `res/dava.md`, `res/ihtar.md` |
| 8 | Gövdenin içinde editör notu: `Not: KAYNAKSIZ — hukukî dayanak doğrulanmadı; avukat eklemeli` (DOCX ¶25, ¶28) | python-docx |
| 9 | UDF gövdesinde: `Teknik künye: … sistem sürümü: ColleX export 1.0.0 (**collex.export.evidence-report/v1**)` — dilekçe belgesinde yanlış şema etiketi, hem de okunur metin olarak | UDF `content.xml` |
| 10 | İhtarnamede süre iki kez ve çelişik: talebimde "yedi gün içinde", şablon satırında `[Verilen süre (gün) — doldurun] gün içinde` | `res/ihtar.md` |

**Ne kadar hukuk yazdı?** Sıfır. Üç belgenin üçünde de HUKUKÎ SEBEPLER
KAYNAKSIZ. Yerel korpusta kira/iş/aile hukuku olmadığı için bu **dürüst** bir
sonuç — ama pratik anlamı şu: *korpus dışındaki her dosyada taslak modülü
biçimlendirme + Ek listesi + numaralandırmadan başka bir şey katmıyor.*

### 3.3 UDF — yapısal olarak sağlam

`format_id="1.8"`, tek `content.xml`, 247 `<paragraph>`; **247 ofsetin
247'si** UTF-16 dilimiyle birebir tutuyor (`startOffset+length` toplamı
12 284 = metnin UTF-16 birim sayısı); `intake/extract.py` ile geri okuma
12 283 karakter döndü (son satır sonu farkı). `bold` korunuyor,
`Alignment` **hepsinde 0** (sol). Sayfa/kenar boşluğu tanımı yok. Başlıkta
"deneysel ve imzasızdır" ibaresi var. UYAP'ta hiç açılmadı (bu makinede yok).

### 3.4 Revizyon döngüsü — çalışıyor

`PUT` v1→v2 `200`, `issues: []`, `persisted: true`; sürüm listesi `[1,2]`;
bayat `baseVersion: 1` ile ikinci `PUT` → **`409 VERSION_CONFLICT`** doğru
Türkçe mesajla. Kullanıcı `p-sonuc-28`'i (fazladan kapanış cümlesi) `PUT`'tan
çıkararak silebildi — yani **gövde** düzenlenebilir, **ek** düzenlenemez.

Dışa aktarım adları doğru: `Dava Dilekcesi - Yilmaz Kira tahliye - v2.md`
+ RFC 5987 `filename*`. UDF yanıtı `X-ColleX-Experimental: udf` taşıyor.

---

## 4. Gün 4 — takip, yeniden başlatma, "bir hafta sonra"

### 4.1 Kalıcılık: sunucu öldürüldü ve yeniden kaldırıldı

`Stop-Process -Id 21076 -Force` → `netstat` 8935 boş → yeniden `serve.mjs`.
Sonrası (hepsi `200`):

| Kontrol | Sonuç |
|---|---|
| `GET /v1/matters/{id}` | `{files:4, answers:14, drafts:1, notes:2, events:6, deadlines:4}` — eksiksiz |
| `GET /v1/drafts/{id}` | **v2**, HUKUKÎ SEBEPLER'de **benim yazdığım metin**, 9 bölüm, 30 kanıt |
| `GET /v1/drafts/{id}/versions` | `[1, 2]` |
| `GET /v1/answers?matterId=` | 14 |
| `GET /v1/answers/{runId}` (warm) | `200`, 59 935 B, 5 ms, `QUALIFIED`, 8 kanıt |
| `…/evidence-bundle?texts=true` | `200`, 24 325 B, `texts` dolu |

**Bu, ürünün en sağlam yeri.** W12-A'nın kalıcılık sözü tutuyor.

### 4.2 "Bir hafta sonra döndüm" — uygulama hatırlatıyor mu?

Dönüşte çekilmesi gereken uçlar ve boyutları:

```
/v1/health              200    542 B    30 ms
/v1/matters             200  3 022 B     5 ms
/v1/matters/deadlines   200 13 007 B     4 ms
/v1/answers?limit=20    200  7 784 B     5 ms
/v1/drafts?limit=20     200    998 B     3 ms
/v1/files               200  2 517 B    39 ms
/v1/settings            200    343 B     3 ms
```

Yedi istek, hızlı. Ama şunlar eksik:

1. **`nextDeadline` geçmişi ayırt etmiyor.** Dosyamın `nextDeadline`'ı
   `{"dueDate":"2026-07-15"}` — bugün **02.09.2026**. 49 gün geçmiş bir süre
   "sonraki süre" olarak gösteriliyor; 6 gün kalan gerçek süre (08.09.2026)
   görünmüyor. `daysLeft`/`overdue` alanı yok, istemci hesaplayacak.
2. **"Ne değişti / nerede kalmıştım" yok.** `lastActivityAt` var ama neyin
   değiştiği yok: son cevap mı, son taslak mı, yeni belge mi? Bir hafta sonra
   dönen avukat dört sekmeyi tek tek gezmek zorunda.
3. **Araştırma geçmişi temizlenemiyor.** `DELETE /v1/answers/{runId}` → **404
   (uç yok)**. Bu hattın 3 tanı sorusu ("HMK uyarınca tanık…", "TCK
   bakımından mobbing…") artık dosyada kalıcı. Aynı soruyu ikinci kez sormak
   **yeni bir satır** açıyor (tekilleştirme yok — ölçtüm: aynı soru 2 kayıt).
4. **Taslak silinemiyor** (`DELETE /v1/drafts/{id}` → 404) ve **eski sürüm
   metni okunamıyor** (`GET /v1/drafts/{id}/versions/1` → 404). Sürüm var,
   sürüme dönüş ve karşılaştırma yok.
5. **Süzgeçler sessizce yok sayılıyor** (en kötü hata biçimi — arayüz
   süzdüğünü sanır):

| İstek | Beklenen | Gerçek |
|---|---|---|
| `/v1/answers?q=depozito&limit=5` | süzülmüş | 5 satır, **`q` yok sayıldı** |
| `/v1/answers?status=ABSTAIN&limit=5` | süzülmüş | 5 satır, **`status` yok sayıldı** |
| `/v1/files?matterId=<uuid>` | dosyanın belgeleri | **9 belge (tümü)** |
| `/v1/drafts?q=kira` | süzülmüş | 4 taslak (tümü) |
| `/v1/matters?q=kira` | süzülmüş | ✔ çalışıyor (1 617 B) |
| `/v1/files?q=ihtar` | süzülmüş | ✔ çalışıyor (305 B) |
| `/v1/drafts?matterId=` | süzülmüş | ✔ çalışıyor |

`/v1/matters?q=depozito` → `{"matters":[]}`: arama **yalnız başlık/taraf**
üzerinde, not/olay/cevap içeriğinde arama yok. Bir avukatın "depozito
demiştim, hangi dosyaydı?" sorusunun cevabı yok.

6. **`GET /v1/drafts` satırında `updatedAt` yok** — yalnız `createdAt`. v2'ye
   yükselttiğim taslak listede hâlâ ilk oluşturma tarihiyle duruyor;
   "son düzenlenen" sıralaması imkânsız.
7. **`GET /v1/answers` satırında dosya adı yok** — yalnız `matterId` (UUID).
8. **`GET /v1/files` satırında `matterId` yok.** "Belgelerim" ekranında her
   belgenin hangi dosyaya ait olduğunu göstermek için **dosya sayısı kadar
   ek istek** gerekir (N+1).

### 4.3 Belge silme dosyayı bozuyor

`DELETE /v1/files/3b17…` → `204`. Sonrasında:

- `GET /v1/matters/{id}` → **`items.files` hâlâ `{refId:"3b17…", fileName:
  "kira_sozlesmesi.txt"}` içeriyor** (öksüz kayıt, uyarı yok). `DELETE
  /v1/matters/{id}` taslakları `detachMatter` ile temizliyor (W12-FIX P0-2);
  **ters yön yapılmamış**.
- Taslak hâlâ `Ek-2: kira_sozlesmesi.txt` diyor, dışa aktarımda adı **15 kez**
  geçiyor, 25 `[K-n]` kaydı silinmiş belgenin alıntı ve hash'lerini taşıyor —
  hiçbir uyarı yok.
- `POST /v1/answer {filters:{fileIds:["3b17…"]}}` → **`ABSTAIN` +
  `NO_EVIDENCE`**, `FILE_NOT_FOUND` değil. Silinmiş belgeye sorulan soru
  "çekimser kaldım" gibi görünüyor.

### 4.4 Küçük ama gerçek

- `var/collex.pid`: iki `serve.mjs` aynı anda koştuğunda **aynı dosyayı
  eziyor**. Bu koşuda dosya benim (artık ölü) 23788'imi gösterirken canlı
  başka bir sunucu 8931'de duruyordu. Tek kullanıcıda düşük etkili ama pid
  dosyası güvenilir bir tutamak değil.
- Not metni sınırı: `KULLANIM-ColleX.md` "64 KB"ı aşamaz" diyor; gerçek yanıt
  70 000 karakterlik notta `400 payload.text "En fazla 20.000 karakter."`.
  Belge ile davranış uyuşmuyor (413 değil 400, 64 KB değil 20 000 karakter).
- `EVIDENCE_CAP_APPLIED:5` uyarısı 8 kanıt döndüren cevapta çıktı; sayının
  neyi saydığı okunmuyor.

---

## 5. Sıralı ürün kusurları

### P0 — bir avukatı yanıltır ya da işi yaptırmaz

| # | Kusur | Kanıt | Nerede |
|---|---|---|---|
| **P0-1** | **Çıplak kanun kısaltması çekimserliği KISMİ cevaba çeviriyor.** Madde numarası olmayan atıf bütün kanunu sabitliyor → `bypassed-by-reference` → pasaj pasaj kabul devre dışı → alakasız maddeler "DESTEKLENİYOR" tespit oluyor. `coverage.ratio 0` iken bile | "…depozito iadesi…" ÇEKİMSER ↔ aynı soru + "tbk ya gore" KISMİ/8 kanıt; "TCK bakımından mobbing" → 7 tespit (yağma, hırsızlık, dolandırıcılık) | `store/chunkStore.ts::exactPinLookup` ("legislation refs alone → all chunks"), `answer/coverage.ts::admitUnderReferenceBypass` |
| **P0-2** | **Uzun/olgu içeren soruda retrieval çöküyor.** Kapsam kapısı bütün soru metnine karşı sözcüksel; 80 lexemeli olay örgüsünde hiçbir pasaj tabanı geçemiyor | 1 178 karakterlik soru → 1 kanıt, 0 içtihat, `QUESTION_NOT_COVERED:7`; aynı hukukî soru kısa hâliyle 8 kanıt | `pipeline/answerPipeline.ts`, `answer/coverage.ts` |
| **P0-3** | **Zamansal soru cevaplanmadan TAM ilan ediliyor.** `asOf` doğru sürümü getiriyor ama değişikliğin varlığı, iki metnin farkı ve lehe kanun sorusu hiç anılmıyor; durum TAM + KESİNLEŞTİRİLEBİLİR | `asOf 2024-06-01` + "2026 öncesi mi sonrası mı?" → yalnız v1 metni, 7999'a atıf yok, `status COMPLETE` | `answer/verifier.ts`, `pipeline/questionIntent.ts` |
| **P0-4** | **Dışa aktarılan dilekçe dosyalanabilir değil.** %77'si atıfsız SHA eki, sayfa Letter, biçimlendirme yok, ihtarnameye mahkeme kapanışı, avukatın kendi yazdığı metne "⚠ KAYNAKSIZ" damgası, ek ColleX'ten silinemiyor | §3.2 tablosu (10 kalem, dosya kanıtlı) | `export/petition.py`, `export/text.py`, `drafting/composer.ts`, `drafting/markdown.ts` |

### P1 — günü yavaşlatır, hataya davet çıkarır

| # | Kusur | Kanıt |
|---|---|---|
| P1-1 | Yüklenen belgeye sorulan soruda alakasız paragraflar "SUPPORTED tespit" oluyor (başlık satırı, adres bloğu) ve durum TAM | `d1q2`: 6/6 SUPPORTED, 5'i konu dışı |
| P1-2 | Belge silinince dosyanın `file` kaydı, taslağın `Ek-n` satırı ve 25 `[K-n]` kaydı öksüz kalıyor; uyarı yok; o belgeye sorulan soru `FILE_NOT_FOUND` yerine `ABSTAIN` dönüyor | §4.3 |
| P1-3 | `nextDeadline` geçmiş süreyi gösteriyor; `daysLeft`/`overdue` alanı yok; varsayılan ufuk yok | `nextDeadline.dueDate 2026-07-15`, bugün 02.09.2026 |
| P1-4 | Alaka kapısıyla düşürülen kanıtlar için "taslağa yazıldı, karşı içtihat bölümüne konuldu" uyarısı üretiliyor — belgede o bölüm yok | Cevap dilekçesi `warnings[4]` ↔ `evidence: 0` |
| P1-5 | `q` / `status` / `matterId` süzgeçleri bazı uçlarda **sessizce yok sayılıyor** (400 bile değil) | §4.2 tablosu |
| P1-6 | Cevap ve taslak **silinemiyor** (`DELETE` → 404); aynı soru tekrar sorulunca ikinci satır açılıyor; geçmiş kalıcı olarak kirleniyor | `DELETE /v1/answers/{id}` 404, tekrar soru → 2 kayıt |
| P1-7 | Eski taslak sürümünün metni okunamıyor (`/versions/{n}` yok) → sürümleme var, geri dönüş/karşılaştırma yok | 404 |
| P1-8 | Çelişen otorite etiketi ayrılabilir kararları çelişik gösteriyor ve konuyla ilgisiz maddeleri (TCK m.168 etkin pişmanlık) "karşıt otorite ile çelişkili" ilan ediyor; buna rağmen `finalizable: true` | `d2q4` `reasons` (6 × `CONFLICTING_AUTHORITIES`) |
| P1-9 | Ön inceleme: taraf çıkarımı müvekkili kaçırıyor, aynı vekili iki kez yazıyor, sözleşme madde numaralarını hukukî referans sayıyor, tarih bağlamları kelime ortasından kesiliyor | §1.2(b) |
| P1-10 | Süre paneli her kayıtta bütün `computed` bloğunu taşıyor (4 süre = 9 965 B); listede gösterilmeyen veri | `GET /v1/matters/deadlines` |

### P2 — cila, tutarlılık, belge

| # | Kusur |
|---|---|
| P2-1 | Olay kaydı `title`, not kaydı `text` — aynı kavram, iki alan adı |
| P2-2 | Türkçe üründe İngilizce enum değeri (`source: "manual"`); "manuel" yazan kullanıcı 400 alıyor |
| P2-3 | `payload.computed` tipi belgesiz (`types.ts` "computed?" der, şema nesne ister); hata mesajı beklenen tipi söylemiyor |
| P2-4 | `.strict()` reddi hangi alanın tanınmadığını söylemiyor (`path:"matter"`, "Tanınmayan alan.") |
| P2-5 | "kiracı yüklemesi" ibaresi her dışa aktarılan belgede; yazılım terimi hukukî anlam taşıyor |
| P2-6 | Üç dışa aktarım üç farklı biçim sadakati (MD kalın var, DOCX kalın yok, UDF kalın var; hizalama üçünde de yok) |
| P2-7 | `GET /v1/drafts` satırında `updatedAt` yok; `GET /v1/answers` satırında dosya başlığı yok; `GET /v1/files` satırında `matterId` yok |
| P2-8 | Konu dışı ve yükleme kapsamlı sorularda karşı-otorite taraması koşuyor; `issueLabel` bütün soru metni oluyor |
| P2-9 | `EVIDENCE_CAP_APPLIED:<n>` sayısı döndürülen kanıt sayısıyla uyuşmuyor |
| P2-10 | `KULLANIM-ColleX.md` "not 64 KB" der; gerçek sınır 20 000 karakter ve hata 400/`INVALID_REQUEST` |
| P2-11 | `var/collex.pid` tek isim; iki eşzamanlı `serve.mjs` birbirini eziyor |
| P2-12 | Süre kuralı listesinde kira/tahliye yok: TBK m.315 (30 günlük temerrüt ihtarı), TBK m.352 (tahliye taahhüdünden itibaren 1 ay), İİK m.269 (tahliye talepli takipte 7 günlük itiraz) — kira avukatının **haftalık** hesapladığı süreler elle giriliyor |

---

## 6. Bir iş gününü en çok iyileştirecek 10 API/UX değişikliği

1. **`bypassed-by-reference`'ı yalnız madde/karar düzeyi atfa bağla.** Çıplak
   kanun atfı (madde numarasız) sabitlensin ama pasajlar **yine de** pasaj
   pasaj kabulden geçsin; hiçbiri geçmezse `ABSTAIN`. Tek başına P0-1'i
   kapatır. (`chunkStore.ts::exactPinLookup` + `coverage.ts`)
2. **Kapsam kapısını sorunun *hukukî sorusuna* uygula, olay örgüsüne değil.**
   Uzun sorularda son cümle / soru işaretli cümle + atıflar ayrıştırılıp
   kapsam onun üzerinden ölçülsün; olay metni yalnız sıralama sinyali olsun.
   P0-2'yi kapatır.
3. **Zamansal niyeti ayrı bir cevap şekli yap.** `asOf` verilen ya da soruda
   "öncesi/sonrası/tarihinde" geçen sorularda: ilgili maddenin **bütün
   sürümlerini** ve değiştiren kanunu (`document_relations` zaten var) yan
   yana göster, karşılaştırma yapılamıyorsa `QUALIFIED` + yeni bir
   `TEMPORAL_COMPARISON_MISSING` gerekçesi ver — asla `COMPLETE` deme.
4. **Dışa aktarımda `?annex=none|full` (varsayılan `none`) ve `?format=docx`
   için A4 + biçim.** Gövde temiz gitsin; SHA eki isteğe bağlı ayrı belge
   olsun. A4 (`page_width 21 cm`), mahkeme hitabı ortalı, imza sağa yaslı,
   TARAFLAR etiketleri kalın, gövde iki yana yaslı. `⚠ KAYNAKSIZ` ve
   `Not: …` satırları **yalnız editör görünümünde** kalsın, dışa aktarımda
   `?marks=none` ile çıkarılabilsin.
5. **Kapanış cümlesini şablona bağla.** `ihtarname` için "…ihtaren
   bildiririz", dilekçeler için "…arz ve talep ederiz", ve kullanıcının
   talep metni zaten bir kapanış cümlesiyle bitiyorsa ekleme yapma.
6. **`POST /v1/matters/{id}/items:batch`** (≤50 kayıt, tek onay) + upload
   yanıtındaki `analysis.dates[]` için hazır `{date,title,source}` şekli.
   Bir belgenin tarihlerini zaman çizelgesine almak 13 istekten 1 isteğe iner.
7. **Süre panelini hafiflet ve ufuklandır.** `GET /v1/matters/deadlines`
   varsayılan `until = bugün + 30 gün`, `?include=computed` olmadıkça
   `computed` bloğu **gönderilmesin**, her satıra `daysLeft` ve `overdue`
   eklensin; `matters[].nextDeadline` geçmiş süreleri atlasın ve ayrı bir
   `overdueCount` alanı gelsin.
8. **Silme/temizleme uçları:** `DELETE /v1/answers/{runId}`,
   `DELETE /v1/drafts/{draftId}`, ve `DELETE /v1/files/{id}` matter
   kayıtlarını da düşürsün + o belgeye bağlı taslakları
   `EVIDENCE_FILE_DELETED` uyarısıyla işaretlesin. Silinmiş fileId'ye
   sorulan soru `404 FILE_NOT_FOUND` dönsün, `ABSTAIN` değil.
9. **Süzgeçleri gerçekten uygula ya da reddet.** `/v1/answers` için `q`
   (soru metninde), `status`, `from`/`to`; `/v1/files` için `matterId`;
   `/v1/drafts` için `q`. Tanınmayan sorgu parametresi **400** dönsün — sessiz
   yok sayma arayüzü yalancı yapıyor. Ayrıca `/v1/drafts` satırına
   `updatedAt`, `/v1/answers` satırına `matterTitle`, `/v1/files` satırına
   `matterId` eklensin (hepsi ek alan, kırıcı değil).
10. **"Nerede kalmıştım" ucu:** `GET /v1/matters/{id}/activity?since=` — son
    N kayıt (cevap/taslak/belge/not/olay/süre) tek listede, tür + başlık +
    zaman. Bir hafta sonra dönen avukatın ilk ekranı bu olmalı; bugün dört
    sekmeyi elle gezmek gerekiyor.

---

## 7. Ölçülen ham sayılar (bu koşu, 02.09.2026, port 8935, `collex_demo`)

| Ölçüm | Değer |
|---|---|
| `POST /v1/files` | 8/8 `200`, 0,53–0,56 s |
| `POST /v1/answer` (belge kapsamı) | 6/6 `200`, 0,030–0,140 s |
| `POST /v1/answer` (korpus) | 11/11 `200`, 0,135–0,540 s |
| `POST /v1/deadlines/compute` | 3/3 `200`; 25.08→08.09.2026 · 20.07→27.07.2026 · 30.12.2026→13.01.2027 |
| `POST /v1/drafts` | 3 başarılı (1'i ilk denemede `400`, sebep: kullanıcı yazım hatası, mesaj alanı göstermiyor) |
| `PUT /v1/drafts/{id}` | `200` v2, `issues: []`; bayat `baseVersion` → `409 VERSION_CONFLICT` |
| Dışa aktarım | md 13 207 B / 4 ms · docx 42 316 B / 643 ms · udf 6 236 B / 263 ms |
| Dava dilekçesi gövde/ek oranı | gövde 2 180 B (%17) · ek 10 162 B (%77) |
| DOCX | 236 paragraf (47 gövde / 189 ek), 1 tablo, Letter, `bold` 0, `alignment` 0 |
| UDF | 247 paragraf, 12 284 kod noktası, **247/247 UTF-16 ofset tutarlı**, `bold=true` 47 |
| Yeniden başlatma sonrası | dosya 4 belge/14 cevap/1 taslak/2 not/6 olay/4 süre; taslak v2 metni ve `[1,2]` sürümleri geri geldi |
| Dönüş ekranı | 7 istek, 27 213 B toplam, en yavaşı 39 ms |
| Gün 1 istek sayısı | 27 başarılı + 10 şema reddi (avukatın yazım/alan hataları) |

## 8. Temizlik

- **Kendi 8 yüklemem** `DELETE /v1/files/{id}` ile silindi (8 × `204`).
  Başka hatta ait `ce5225bdd8554567 sentetik_dava_dilekcesi.docx`'e
  **dokunulmadı**. `/v1/health` → `corpus {publicDocuments: 6, uploads: 1}`.
- **Kendi 4 dava dosyam** `DELETE /v1/matters/{id}` ile silindi (4 × `204`).
- **Dürüst not:** `app_private.answers` ve `app_private.drafts` satırlarım
  `collex_demo`'da kaldı — **cevap/taslak silme ucu yok** (P1-6). Dosya
  silindiği için taslaklar "dosyasız"a düştü. `collex_demo` bir sonraki
  `demo.mjs` yeniden kurulumunda (diğer hattın yüklemesi kalktığında)
  tamamen temizlenir.
- Sunucum (`8935`, pid 23788) `Stop-Process -Force` ile kapatıldı.
  `netstat`: **8935'te dinleyici yok**; **8787/8898'e hiç dokunulmadı**;
  8931 (başka hattın sunucusu) çalışır bırakıldı.
- `var/collex.pid` içinde artık ölü 23788 var (P2-11) — depo dosyası olduğu
  için **düzeltilmedi**, burada bildiriliyor.
- Bütün geçici dosyalar (`docs/`, `req/`, `res/`, `*.md`, `*.docx`, `*.udf`)
  scratchpad'de: `…/scratchpad/w13-DAILYFLOW/`. Depoya veya çalışma köküne
  hiçbir şey yazılmadı; `collex_local`'a hiç bağlanılmadı.
