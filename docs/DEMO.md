# ColleX — Kanıt Zinciri Demosu ve Avukat Masası (konsol)

Son güncelleme: **03.09.2026** (**W14 Faz M kapanışı**). Sayılar bu dosyada
tekrar edilmez; hepsi `docs/implementation/STATUS.md` → **"Ölçülen sayılar
(03.09.2026, W14 Faz M kapanışı)"** tablosundadır (S1–S40).

> **W14 notu.** `demo.mjs`'in altı senaryosu değişmedi ve hâlâ 6/6 geçiyor
> (S7). W14'ün yeni yüzeyleri **demoya girmedi**, çünkü demo bir gösteri
> değil bir testtir ve her senaryosu bir kabul ölçütüne bağlıdır. Ama
> **konsolda artık çiziliyorlar**: Faz B2 altı yeni ekran ekledi (Karar ara,
> Atıf denetimi, Takvim, Kapsam, Harç, Sözleşme incelemesi) ve yedekleme
> kartı, klasör yükleme ve "Aslını indir" de indi — her biri **önce gerçek
> HTTP ile denenip sonra** çizildi (`W14-L-CONSOLE-B` §1). Ekranı hâlâ
> olmayanlar §9'da ad ad sayılıdır. Uçları elle denemek için §9.
>
> **Faz C notu (03.09.2026).** Demo yine 6/6 geçiyor (S7, bu turda yeniden
> koşuldu) ve senaryoları değişmedi. Konsolda değişen altı şey: "Karar
> ara" satırlarında **eşleşen cümle ya da "sağlanmadı" satırı** ve
> varsayılan **açık "tam ifade"** kutusu, cevap kartında **katlanan tespit
> kartları**, yeni açılan dosyanın **aktif dosya olması**, profil
> kaydında **sıfır yerleşim sıçraması**, ilk açılışta içeriğin **%24,4**'te
> başlaması ve Ayarlar'daki **"Verilerim nerede?"** metninin veri
> klasörünü doğru anlatması (S32″). Sunucu tarafında: yedek arşivi
> **yedeklediği veritabanının adını** taşıyor, her `.strict()` reddi
> **alanı adıyla** söylüyor, ve konu dışı bir soruda karşıt otorite
> taraması **hiç koşmuyor** (`contraryCoverage.skipped:true`).
>
> **Faz M notu (03.09.2026).** Demo yine **6/6** geçiyor (S7, bu turda
> yeniden koşuldu) ve senaryoları değişmedi. Konsolda değişen **tek büyük
> şey**: uzun süren her işte artık bir **ilerleme kartı** (evre cümlesi +
> tarayıcının kendi saatiyle ölçtüğü geçen süre, **yüzde YOK**) ve gerçekten
> çalışan bir **"Vazgeç"** var — cevap, belge sorusu, karar arama, belge
> yükleme, atıf denetimi ve canlı araştırma. **Yedeklemede "Vazgeç" yoktur
> ve sebebi kartın içinde yazılıdır**; **dışa aktarmada ilerleme çubuğu
> yoktur** çünkü `<a download>` bitişini bildirmez (bilerek dönüştürülmedi).
> Canlı araştırmadaki "Vazgeç" koşuyu değil **beklemeyi** durdurur ve bunu
> ekranda söyler. Ayrıca "Karar ara" artık kaynağın kendi kayıt sayısını
> yazıyor (S38; **`null` asla 0 diye yazılmaz**) ve Ayarlar › "Verilerim
> nerede?" veri klasörünün **yerini** yazıyor (S37). Sunucu tarafında iki
> **eklemeli** alan indi ve `openapi.yaml`'ın yol/işlem/şema sayıları
> **değişmedi** (S8). Ölçüm araçlarında: **N-8 kapandı** (süit üç ardışık
> koşuda da yeşil, S2/S39), **N-7 açık kaldı** — rapor artık bant basıyor ve
> kök neden bulundu, ama düzeltilmedi (S40).

> ## ⚠ SENTETİK TEST VERİSİ — GERÇEK İÇTİHAT DEĞİLDİR
>
> Bu demonun dayandığı korpus (`evals/fixtures/corpus/`) **gerçek Türk
> mevzuatı veya Yargıtay içtihadı değildir.** Sekiz dosyanın tamamı, sistemin
> mekanizmasını test etmek için elle yazılmış sentetik metinlerdir:
> gerçekmiş gibi görünen madde numaraları, esas/karar numaraları ve tarihler
> taşırlar ancak hiçbiri gerçek bir belgeye karşılık gelmez.
>
> Bu dosyadaki hiçbir sayı **hukukî kalite ölçüsü değildir.** Demo yalnızca
> şunu ölçer: kanıt zinciri uçtan uca çalışıyor mu, sistem kaynağı olmayan
> soruda çekimser kalıyor mu, çelişen otoriteyi gizliyor mu, tahrif edilmiş
> atfı yakalıyor mu, dava dosyasına bağlama çalışıyor mu.
>
> Bu çıktılar **hukukî işlem için kullanılamaz.**

---

## 1. Neyi kanıtlamaya çalışıyoruz

> **Her maddi hukukî tespit, belirli bir belge sürümünün doğrulanabilir bir
> pasajına bağlıdır; otorite, güncellik ve karşıt otorite kontrolleri
> yapılmıştır; sistem, kaynağı olmayan soruda tahmin etmek yerine ÇEKİMSER
> kalır; ve avukatın ürettiği her şey dava dosyasında kalıcıdır.**

Demo bu cümleyi çalıştırılabilir hâle getirir. **Altı senaryonun** her biri
cümlenin bir parçasını sınar ve beklenen duruma ulaşamazsa betik sıfır olmayan
çıkış kodu üretir. Bu bir slayt gösterisi değil, bir testtir.

---

## 2. Ön koşullar

| Gereksinim | Ayrıntı |
| --- | --- |
| Node | ≥ 22 |
| Python | Repo venv'i: `.venv/Scripts/python.exe` (Windows) / `.venv/bin/python` |
| Postgres | Yerel örnek, `127.0.0.1:55432`, kullanıcı `postgres`, parolasız (`ColleX-Baslat.cmd` başlatır) |
| Veritabanı | `collex_demo` — betik bunu kendisi oluşturur ve **yalnızca bu adı** düşürür |

`pgvector` bu ortamda **yok**; yoğun (dense) getirim şeridi atıldır. Demo
exact-pin + lexical + trigram + citator şeritlerini kullanır. Hiçbir uzak
servise (Supabase, Resend, sağlayıcı sunucuları) bağlanılmaz.

### `collex_local` ve `collex_demo` — iki veritabanı, iki amaç

| | `collex_local` | `collex_demo` |
|---|---|---|
| Ne | Avukatın **kalıcı ürün deposu** | Demo/probe deposu |
| Kim oluşturur | `intake.cli --ensure-db` (başlatıcı her açılışta; yalnız oluşturur, eksik migration uygular, **asla düşürmez**) | `demo.mjs` (her koşumda düşürüp yeniden kurar) |
| İçerik | Yalnız avukatın yüklediği belgeler, dosyaları, cevapları, taslakları, ayarları — **sentetik korpus yok** | Sentetik korpus (8 dosya) + betik/probe verisi |
| `serve.mjs` varsayılanı | evet (`--dsn` verilmezse) | `--dsn postgres://postgres@127.0.0.1:55432/collex_demo` |
| Test verisi | **asla** | serbest |

**Sonuç:** `collex_local` üzerinde "Yerel korpus" kapsamındaki bir soru
ÇEKİMSER kalır (kaynak yok — bu dürüst rapordur, hata değil); kaynaklı cevap
senaryoları `collex_demo` ile görülür. Avukatın günlük değeri **Yüklediğim
belgeler** kapsamı ve **Canlı kaynaklar** (`--with-mcp`) yoludur.

### `--force-drop-uploads`

`demo.mjs`, `collex_demo` içinde kiracı yüklemesi (`scope='tenant'`,
`source='UPLOAD'`) varsa veritabanını düşürmeyi **reddeder** (exit 3, Türkçe
"DURDURULDU: …" satırı ve `intake.cli --list/--delete` ipucu). Bunu yalnız
**kendi yaptığınız** probe yüklemelerini silmek için `--force-drop-uploads`
ile aşın; başkasının yüklemesini `intake.cli --delete <fileId>` ile o kişi
kaldırır. `collex_local` bu bayraktan hiçbir zaman etkilenmez.

---

## 3. Demoyu çalıştırma

Repo kökünden (`yargi-mcp-independent`):

```bash
node control-plane/scripts/demo.mjs
```

Betik sırayla: `collex_demo`'yu düşürüp yeniden kurar (yükleme koruması
hariç) → Python ingestion CLI'ını tek geçişte çağırır (her belgenin her
sürümü yürürlük sırasına göre; S4 bu yüzden anlamlıdır) → altı senaryoyu
gerçek HTTP yüzeyi üzerinden koşar → `demo-output/` altına senaryo başına
ham JSON + `report.md` + `summary.json` yazar → PASS/FAIL tablosu basar,
**herhangi bir senaryo düşerse 1 ile çıkar**. Beklenen: S9 (6/6).

```bash
node control-plane/scripts/demo.mjs --keep                 # veritabanını yeniden oluşturma
node control-plane/scripts/demo.mjs --skip-ingest          # mevcut korpusu kullan
node control-plane/scripts/demo.mjs --out /bir/dizin
node control-plane/scripts/demo.mjs --dsn postgres://postgres@127.0.0.1:55432/collex_demo
node control-plane/scripts/demo.mjs --force-drop-uploads   # yalnız KENDİ probe yüklemeleriniz için
```

---

## 4. Senaryolar — her biri ne kanıtlıyor

### S1 · KAYNAKLI CEVAP (`COMPLETE`)

**Soru:** *TCK m. 157 dolandırıcılık suçunun cezası nedir?* (`as_of` 2025-06-01)

Beklenen: `COMPLETE`, 5237 sayılı Kanun m. 157 alıntılanır ve 2005 sürümünün
cezasını içerir. **Her alıntı kanonik metinden yeniden üretilir**: betik
belge metnini kendisi SHA-256'lar, kaydedilen kod noktası aralığını kendisi
dilimler ve hash'ler. W12 sonrası kapsam kapısı "atıfla bypass" der
(`bypassed-by-reference`); atıf yapılan hüküm hakkıyla alınır, komşu hükümler
tek tek sınanır (P0-1).

*Kanıtladığı parça:* her tespit doğrulanabilir bir pasaja bağlıdır.

### S2 · ÇEKİMSER (`ABSTAIN`)

**Soru:** *Uzay hukukunda yörünge çarpışma sigortası için hangi tahkim usulü
uygulanır?* (`as_of` 2026-06-01)

Beklenen: `ABSTAIN`, **sıfır kaynak kartı**, sıfır tespit, boş kanıt paketi,
makine gerekçesi `NO_EVIDENCE`. W12'nin eklediği ikinci çekimserlik yolu
(demo dışında): korpus sözcük düzeyinde benziyor ama soruyu kapsamıyorsa
`QUESTION_NOT_COVERED` — pasajlar yalnız kimlikle listelenir, alıntısız
(denetim sorusu "kira sözleşmesinde depozito iadesi" böyle ÇEKİMSER kalır;
`W12-B` §1).

> **Korpusta bulunmayan** cevap `ABSTAIN`; **korpusa bakılamayan** cevap
> `PARTIAL` + `CORPUS_UNAVAILABLE` uyarısı. İkisi karıştırılmaz.

### S3 · ÇELİŞEN OTORİTE (`CONFLICTING_AUTHORITIES`)

**Soru:** *Araç satışında kapora alındıktan sonra teslim edilmemesi TCK m. 157
dolandırıcılık suçunu oluşturur mu?*

İki sentetik Yargıtay kararı tam bu meselede çelişir. Beklenen: **ikisi de
kanıt kümesinde**, olumsuz olan `contrary`, en az bir tespit
`CONFLICTING_AUTHORITIES`, cevap `QUALIFIED` (ŞERHLİ). Taslak v2 bu çelişkiyi
korur: destekleyen taraf "Doğrulanmış kaynak uyarınca — …" + "Aksi yönde karar
için DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT bölümüne bakınız." cümlesiyle
yazılır (`W12-C`).

### S4 · ZAMANSAL (aynı soru, iki tarih)

S1 sorusu `as_of` 2025-06-01 ve 2026-06-01. Sentetik 7999 sayılı torba kanun
15.01.2026'da m. 157/1'i değiştirir. Beklenen: iki cevap **farklı belge
sürümlerini** alıntılar, her biri kendi tarihinde `IN_FORCE`. (Yüklenen
belgede yürürlük **değerlendirilmez** — "yüklediğiniz belge — yürürlük
değerlendirilemez", `W12-B2`.)

### S5 · TAHRİFAT (tek karakter)

S1'in kanıtında tek karakter değiştirilir, doğrulayıcı yeniden koşar.
Beklenen: `QUOTE_OFFSET_MISMATCH`, tespit `unsupported`, cevap
kesinleştirilemez. Aynı doğrulama DOCX/UDF dışa aktarımında Python tarafında
yeniden yapılır ve tahrif edilmiş alıntıda dosya **yazılmaz** (exit 2).

### S6 · DOSYA BAĞI (W12, 10 kontrol)

Bir dava dosyası açılır (`POST /v1/matters`), S1 sorusu o dosya altında
sorulur, S1 koşusundan bir taslak üretilir; kontroller: cevap kaydı dosyada
(`kind:'answer'`, soru/durum/mod), taslak kaydı dosyada (`kind:'draft'`,
sürüm), `GET /v1/answers?matterId=` ve `GET /v1/drafts?matterId=` listeleri,
yanlış `matterId` → 404 `MATTER_NOT_FOUND` ve **hiç iş yapılmadan**
(pipeline 0, taslak 0), dosya silinince taslak **dosyasız kalır ama
kaybolmaz** (P0-2 sonrası `detachMatter`). Demo bellek içi depolarla koşar;
kalıcı (Pg) yol `W12-INTEGRATION` §6 probe transkripti ve gerçek-PG
`persistence.test.ts` ile ayrıca kanıtlıdır.

*Kanıtladığı parça:* avukatın ürettiği her şey dosyasında kalır; yanlış kimlik
sessiz öksüz kayıt üretmez.

---

## 5. Avukat masası — konsol

> **En kolay yol (Windows):** `yargi-mcp-independent\ColleX-Baslat.cmd`'ye
> çift tıklayın. Akış: PostgreSQL başlat → `intake.cli --ensure-db --list`
> (`collex_local`'ı yalnız oluşturur / eksik migration'ı uygular; çıktı
> `%TEMP%\collex-ensure-db.log`; **başarısızsa** Türkçe
> `STORE_UNAVAILABLE` / şema satırıyla DURUR, sunucu açılmaz — FIX-2 #7) →
> `serve.mjs --port 8787 --with-mcp` **ayrı pencerede** ("ColleX Sunucu";
> MCP token çocuğa ortamdan geçer, komut satırında görünmez — FIX-2 #6) →
> `/v1/health` 200'e kadar 60 s yoklama → tarayıcı `http://127.0.0.1:8787/`.
> Sunucu zaten çalışıyorsa yalnız tarayıcıyı açar. Kapatmak için
> `ColleX-Durdur.cmd`: pencere → pid dosyaları (yalnız komut satırı
> ColleX'e aitse) → komut satırında `serve.mjs` / `serve-mcp.mjs` /
> `uvicorn asgi_app` geçen süreçler → PG stop; **port dinleyen yabancı süreç
> kapatılmaz** (netstat/port bazlı kill yok). Avukat dilinde anlatım:
> **`docs/KULLANIM-ColleX.md`**.

Elle:

```bash
cd yargi-mcp-independent
node control-plane/scripts/serve.mjs                 # collex_local, 8787, canlı mod KAPALI, AI KAPALI
node control-plane/scripts/serve.mjs --with-mcp      # + gerçek MCP geçidi arka planda (canlı araştırma)
node control-plane/scripts/serve.mjs --port 8799 --dsn postgres://postgres@127.0.0.1:55432/collex_demo   # demo korpusuyla
```

Başlangıç satırları sırayla: veritabanı (DOWN → exit 1 Türkçe; MISSING →
`--ensure-db` ipucu), `konsol`, `health`, `korpus`, `db` ("Veritabanı
(collex_local) bağlı; 13/13 migrasyon uygulanmış." — sayı S12/S13), `kayıt` ("kalıcı" ya da
"bellek içi"), `ai` ("kapalı (ANTHROPIC_API_KEY yok)" ya da "açık (<model>)"),
`mcp` ("kapalı" / "başlıyor" / "ok"), `repo`, `pid`.

### 5.1 Beş sekme

**Dosyalarım.** Karşılama kartı (ilk açılışta), **"Yaklaşan ve geciken
süreler"** paneli (`Gecikmiş (N)` ve `Önümüzdeki 14 gün` ayrı; kırmızı ≤ 7
gün, turuncu ≤ 14), arama + durum süzgeci,
"+ Yeni dosya" (başlık, müvekkil, karşı taraf, mahkeme, esas no, tür). Satır
tıklayınca **dosya sayfası**: başlık, taraf çipleri, durum seçici, "Bu çalışma
alanı yereldir; UYAP ile eşitlenmez", "Belgeler bu bilgisayarda saklanır"
(veritabanının teknik adı **artık hiçbir avukat ekranında yok** — yalnız
Ayarlar › Sistem durumu'nda), hızlı işlemler
(Belge yükle / Bu dosyada araştır / Taslak oluştur / Not ekle / Süre ekle /
Dosyayı sil) ve altı sekme: **Belgeler · Araştırmalar · Taslaklar · Zaman
çizelgesi · Süreler · Notlar**. Bir dosyayı silmek taslakları silmez —
"dosyasız" kalırlar ve Taslak › Kayıtlı taslaklar'dan açılır.

**Araştır.** Kapsam: **Yerel korpus** (`POST /v1/answer`), **Canlı kaynaklar
— derin araştırma** (`POST /v1/research/start` → 202 → ilerleme paneli:
"Mevzuat aranıyor", "Yargıtay/Danıştay kararları aranıyor", "Belge çekiliyor
2/6"…; yalnız `--with-mcp` ile), **Yüklediğim belgeler** (belge seçici +
"korpusu da tara" kutusu). "Değerlendirme tarihi (hangi tarihteki hukuka
göre)" bugünle başlar. Sonuç: durum rozeti **TAM / ŞERHLİ / KISMİ / ÇEKİMSER**,
kesinleştirme satırı ("KESİNLEŞTİRİLEBİLİR — teknik kontroller tamamlandı;
nihai hukukî değerlendirme avukatındır." ya da "KESİNLEŞTİRİLEMEZ — …"),
KAPSAM satırı, "Soru kapsamı: %N — soru sözcüklerinin kaynaklarda karşılığı"
(+ "Kapsam kapısı: atıf yapılan hüküm doğrudan alındı; öteki pasajlar tek tek
soru sözcükleriyle sınandı"), "Karşılığı bulunamayan sözcükler", "Üretim:
Kural tabanlı — yerel", "Tespitler" (güven ölçekleri), numaralı kaynak
kartları (origin çipi: "yüklediğiniz belge" / "yerel korpus (SENTETİK)" /
"canlı resmî kaynak · alınma HH:MM"; 4 000 kod noktasını aşan pasajda
**"alıntı kısaltıldı"** çipi — gösterilen pencere soru sözcüklerine en yakın
bölümdür, ofset/hash o pencereye aittir), kenara alınan pasajlar (kimlikle),
işlem izi. **Süre bütçesi** (FIX-2 #3): 60 s aşılırsa tespit yazımı atlanır,
bulunan pasajlar gösterilir, durum **KISMİ** + "Cevap süre bütçesini (60 sn)
aştı…"; 5 MB üstü kaynak metni cevap kaydına yazılmaz (`STORED_WITHOUT_TEXTS`
uyarısı). Geçmiş veritabanından (`GET /v1/answers?limit=20`). **Bulut AI**
çipi: `ANTHROPIC_API_KEY` yoksa devre dışı + ipucu; varsa ilk açılışta
açıklama penceresi, çip açıkken "Bulut AI: açık — bu istek Anthropic'e gider".
Düzyazıda "bulut yapay zekâ (Bulut AI)" biçimi kullanılır (LANG-7).

**Belgeler.** Sürükle-bırak / seç (`POST /v1/files`, 25 MB), kuyruk
"3/7 yükleniyor", "zaten yüklüydü" rozeti (aynı bayt = aynı belge),
"N sayfa (M metinli)" ve **taranmış sayfa uyarısı** ("N sayfanın M tanesinde
metin yok — …"; tamamen taranmış PDF 422 ile reddedilir, Bulut OCR düğmesi
önerilir; `INTAKE_FAILED` gövdesi stderr yerine "kayıt no: <uuid>" taşır —
FIX-2 #5; 3 MB sentetik TXT: yükleme 8,7 s, "Belgeye sor" ~4 s — S21), ad
süzgeci, dosya süzgeci. Kart: **Belgeye sor / Tam metni aç /
Bu dosyayla araştır / Taslakta kullan / Dosyaya ekle ↔ Dosyadan çıkar / Sil**.
**Belge sayfası**: sol bölme bölüm önizlemeleri (çapalar, "Sonraki bölümler"),
sağda soru kutusu (Ctrl+Enter; kapsam: Bu belge / Bu dosyadaki tüm belgeler /
Belge + korpus), cevap kanıtları sol bölmede vurgulanır, "Bu belgeye sorulan
sorular" (DB'den), **Otomatik ön inceleme** kartı (atıf → "Korpusta doğrula";
tarih → "Süre başlat" / "Zaman çizelgesine ekle"; talep → "Taslağa talep olarak
aktar"; başlık "karşı tarafın talebi de burada görünebilir" der), AI analizi
ve Bulut OCR kancaları.

**Taslak.** Şablonlar iki grupta (Dilekçeler 7 / Sözleşmeler 6; toplam S11),
her kartta açıklama ve "Zorunlu: …". Form, `fieldGroups` sırasıyla
(Mahkeme ve dosya · Taraflar · Vekil · Olaylar · Talepler · Deliller · Ek
bilgiler); profil ve aktif dosyadan ön-dolum "otomatik — kontrol edin"
çipiyle (dosya başlığı hiçbir alana yazılmaz). Kanıt kaynağı: Son araştırma
(bu oturumda bir koşu varsa şablon seçiminde kendiliğinden işaretli —
`preselectLastRun`, FIX-2 #10) / Dosyadaki kayıtlı araştırma / Seçili
belgeler (yalnız Ek + olay önerisi) / kanıtsız. **Alaka kapısı** (ADR-022,
FIX-2 #1): şablonun `domain`'ine uymayan ya da matter metniyle örtüşmeyen
kanıt `unusedEvidence` + `unusedReason`'a gider; açıkça atıf yapılan kanıt
asla düşmez. "Taslağı oluştur" → **editör**: üstte başlık, tür, **KAYNAKSIZ:
n**, sürüm/kayıt notu, Kaydet (Ctrl+S) · DOCX · Markdown · **UDF
(deneysel)** · Sürümler · Yeniden oluştur; solda bölümler
(yeşil/kırmızı/sarı nokta); ortada paragraflar (Türkçe rol etiketi,
`⚠ KAYNAKSIZ`, `[K-n]` çipleri, Alıntı ekle, KAYNAKSIZ olarak bırak, Bu
paragrafı yaz (Bulut AI) — `ek-dogrulama` ve `karsi-ictihat` bölümlerine
yazamaz, 400 (FIX-2 #8) — Yukarı/Aşağı/Sil, + Paragraf ekle); sağda kanıt
kartları ("Dayanak olarak kullan" anahtarı; "Ek — yüklenen belge" kilitli;
**"Kullanılmayan kaynaklar (alakasız görünüyor)"** başlığı altında neden
çipi + **"Yine de dayanak olarak kullan"** → `evidenceUse:true`), Olay
önerileri ("Olaylara ekle"). Canlı linter: alıntıyı bozan düzenleme anında
`⚠ KAYNAKSIZ`. Kaydet: 200 → "Taslak kaydedildi — vN" (yazılamazsa "Taslak
veritabanına YAZILAMADI"); 409 → "Yeni sürümü yükle". Dışa aktarma dosya
adı **"<Belge> - <Dosya> - v<N>.<ext>"** (`filename=` ASCII + `filename*`
UTF-8), zaman damgaları yerel saat (FIX-2 #9). **Kayıtlı taslaklar** kartı
(20 en yeni, "dosyasız" çipi, Aç). Dosya sayfasında bir belge/cevap/taslak
kaydının `refId`'si değiştirilemez (400, çıkar + yeniden ekle — FIX-2 #8);
kayıt gövdesi 64 KB, JSON istek 1 MB üstü 413 (FIX-2 #4).

**Ayarlar.** Profil (Ad Soyad, Unvan, Baro, Baro sicil no, Adres, Telefon,
E-posta, UETS adresi, Vergi dairesi/no), Varsayılan şehir, Tema (Sistem /
Açık / Koyu), Demo senaryoları anahtarı; **Sistem durumu** (veritabanı adı +
migrasyon, canlı araştırma durumu + 54 araç, Bulut AI: yapılandırılmış mı /
model / "canlı sınanmadı", Bulut OCR, korpus sayıları + DENEME KORPUSU,
şablon sayısı, süre kuralı "N doğrulanmadı / N doğrulandı", sürüm, sunucu
saati); **"Verilerim nerede?"** kartı (makinede; iki istisna: canlı araştırma
→ resmî kaynak sunucuları, Bulut AI → Anthropic yalnız siz açarsanız).

### 5.2 Süre hesabı (modal)

Dosyalarım'da "Süre ekle" ya da belge sayfasında "Süre başlat": usule göre
gruplu kural listesi (`computable:false` olanlar devre dışı + notu katlanır),
özel süre, başlangıç tarihi, adli tatil kutusu kuraldan ön-dolu, kural notu +
**DOĞRULANMADI — madde metniyle kontrol edin** rozeti; sonuç: tarih + gün adı
büyük, adımlar, uyarılar, disclaimer birebir; "Dosyaya kaydet" → Süreler
sekmesi + Dosyalarım paneli.

### 5.3 `ANTHROPIC_API_KEY` yokken ve `--with-mcp` yokken ne görürsünüz

| Durum | Görünen |
|---|---|
| Anahtar yok (varsayılan) | Üst çubukta AI rozeti "kapalı"; Araştır'da Bulut AI çipi devre dışı + "ANTHROPIC_API_KEY tanımlı değil — Ayarlar › Sistem durumu"; belge sayfasında "Analiz et" devre dışı; editörde "Bu paragrafı yaz (Bulut AI)" ipucu; Bulut OCR düğmesi devre dışı. **Her şey kural tabanlı çalışır**; hiçbir veri makineden çıkmaz. Sunucu `503 AI_NOT_CONFIGURED` döner. |
| `--with-mcp` yok | MCP rozeti "kapalı"; "Canlı kaynaklar" seçilince "Canlı mod bu sunucuda kapalı — ColleX-Baslat.cmd canlı modu (--with-mcp) açar…"; `POST /v1/research/start` tipli 502. Yerel korpus + yüklenen belgeler çalışır. Başlatıcı `--with-mcp` ile açar; geçit ~5 s'de "ok" olur. |
| Veritabanı kapalı | Başlatıcı önce PG'yi başlatır; `--ensure-db` yine ulaşamazsa **başlatıcı durur** ("Yerel veritabanina ulasilamadi (STORE_UNAVAILABLE)…", günlük yolları, `exit /b 1`) ve sunucuyu açmaz (FIX-2 #7). Elle `serve.mjs` Türkçe teşhisle exit 1; çalışırken düşerse rozet kırmızı, "Sunucuya ulaşılamadı — ColleX kapalı görünüyor; ColleX-Baslat.cmd ile yeniden başlatın…" ve 5 s'de bir yeniden deneme. |

### 5.4 Konsolun güvenlik sözleşmesi

Sayfa hiçbir yerde **markup atamaz** (her değer `textContent`); bağlantı
öğesi yalnız sunucu URL'yi onayladığında (`sourceUrlAllowed`) oluşur; CSP
satır içi tek style/script'i SHA-256 ile sabitler, `default-src 'none'`,
`connect-src 'self'`; dosya LF-only; talimat biçimli pasaj **düzenlenmez,
etiketlenir**. `console.test.ts` bunları zorlar (S15).

---

## 6. Çıktılar

`demo-output/`: `report.md` (özet + senaryo başına kontrol tablosu),
`summary.json` (PASS/FAIL), `S1.json` … `S6.json` (ham `AnswerResult`, kanıt
paketi `texts` dahil, kontroller).

---

## 7. Kanıt paketi ve taslak dışa aktarımı

```bash
curl -s -X POST http://127.0.0.1:8787/v1/evidence-bundle -H 'content-type: application/json' \
  -d '{"question":"TCK m. 157 dolandırıcılık suçunun cezası nedir?","asOf":"2025-06-01","includeTexts":true}' > bundle.json
.venv/Scripts/python.exe -m export.cli --bundle bundle.json --out kanit-paketi.md --format md    # veya .docx --format docx
```

Taslak: `GET /v1/drafts/{id}/export?format=md|docx|udf|denetim-docx`
(konsoldaki düğmeler; `denetim-docx` = Atıf Denetim Raporu, düğmesi Faz
B'de). W14 iki additive anahtar ekledi: **`annex=full|none`** ve
**`marks=all|none`**; `annex=none&marks=none` **nihai (dosyalanabilir)**
kopyadır ve dosya adının sonunda `NİHAİ` yazar. **Doğrulama her modda aynı
koşar:** işaretleri kapatmak disiplini kapatmaz, ve alıntısı bozulmuş bir
taslak her üç biçimde de **409 `EXPORT_REFUSED` / `QUOTE_ALTERED`** ile
reddedilir — dışa aktarıcı süreç hiç başlatılmaz. `udf` cevabı `X-ColleX-Experimental: udf` başlığı taşır; dosya
imzasızdır, içinde "Bu UDF dosyası deneyseldir ve imzasızdır; UYAP Doküman
Editörü'nde açarak doğrulayın." satırı vardır ve **UYAP'ta hiç açılmadı**.
Dışa aktarıcı her alıntıyı yazmadan önce SHA-256 + kod noktası aralığıyla
yeniden doğrular; tek bir alıntı düşse hiçbir şey yazılmaz (exit 2).

---

## 8. Testler

```bash
cd control-plane && npx tsc --noEmit && npx vitest run      # S1, S2
.venv/Scripts/python.exe -m pytest tests evals/tests -q     # S3
node control-plane/scripts/demo.mjs                         # S9
```

`tests/integration/` mounted-app sözleşme testleri (sahte intake CLI ve
geçit) + korumalı GERÇEK süitler (`real-exec` `collex_intake_test`, `serve`,
`store/persistence` `collex_persist_test`, `drafting/real-export`); ortam
yoksa dürüst "environment unavailable" işaretleyicisi. Testler `collex_local`'a
asla dokunmaz.

---

## 9. W14 uçlarını elle denemek

Bu uçlar mount edildi ve gerçek HTTP üzerinde ölçüldü (`W14-L-FIX` §1.1,
`W14-L-CONSOLE-B` §1, `W14-F-API` §1–§3). **Çoğunun artık ekranı da var**;
aşağıdaki `curl`'ler ekranın arkasında ne olduğunu görmek içindir.

**Ekranı olan:** Karar ara (`#karar-ara`) · Atıf denetimi (`#denetim`) ·
Takvim (`#takvim`) · Kapsam (`#kapsam`) · Harç (`#harc`) · Sözleşme
incelemesi (`#sozlesme`) · Ayarlar'da yedekleme kartı · Belgeler'de klasör
seçme ve sürükleme · belge sayfasında "Aslını indir".

**Ekranı HÂLÂ olmayan** (uç çalışıyor, düğme yok — sessizce bozuk değil,
yok): dosya paketi indirme (`POST /v1/matters/{id}/package`), nihai kopya
indirme (`?annex=none&marks=none`), dilekçe öncesi üç doğrulama kutusu,
kişi kartları (`/v1/contacts`), genel arama kutusu (`/v1/search/all`),
"nerede kalmıştım" (`/v1/matters/{id}/activity`), toplu tarih aktarımı,
Bulut AI maskeleme önizlemesi ve kayıt defteri. Ayrıca `inceleme-docx` ve
ızgara DOCX'i için **HTTP ucu da yok**.

`node control-plane/scripts/serve.mjs --dsn …/collex_demo` çalışırken:

```bash
# Kapsam manifestosu — neyi tarıyoruz, neyi taramıyoruz (8 bilinen boşluk)
curl -s http://127.0.0.1:8787/v1/sources/manifest

# Arama formunun veri kaynağı (26 kaynak, 19 tam-metin türü)
curl -s http://127.0.0.1:8787/v1/sources/catalog

# Harç tarifesi — 20 kalem, 17'si amount:null (ColleX tutar uydurmaz)
curl -s "http://127.0.0.1:8787/v1/fees/tariffs?year=2026"

# Bir dava değeri için adım adım harç hesabı
curl -s -X POST http://127.0.0.1:8787/v1/fees/compute \
  -H 'content-type: application/json' \
  -d '{"year":2026,"kind":"dava-harci","davaDegeri":100000}'

# Karşı tarafın dilekçesindeki atıfların ön izlemesi (lookup harcamadan)
curl -s -X POST http://127.0.0.1:8787/v1/citation-audit/preview \
  -H 'content-type: application/json' \
  -d '{"text":"6098 sayılı Kanun m. 299 ve TCK m. 157 uyarınca…"}'

# Ve denetimin kendisi — asOf DİLEKÇENİN tarihidir, bugünün değil
curl -s -X POST http://127.0.0.1:8787/v1/citation-audit \
  -H 'content-type: application/json' \
  -d '{"text":"…","asOf":"2026-06-01"}'

# Takvim akışı (Outlook/Google Takvim biçimi; gerçek istemcide denenmedi)
curl -s http://127.0.0.1:8787/v1/matters/calendar.ics

# Sekiz gruplu tek arama kutusunun arkasındaki uç
curl -s "http://127.0.0.1:8787/v1/search/all?q=tahliye"

# Yedekleme (ürün veritabanına YAZMAZ; pg_dump tek anlık görüntü okur)
node control-plane/scripts/backup.mjs --database collex_local --out D:/ColleX-Yedek
node control-plane/scripts/backup.mjs --verify D:/ColleX-Yedek/<klasör>
```

`POST /v1/sources/search` ve `/fetch` yalnız `--with-mcp` ile başlatılmış
bir sunucuda anlamlıdır. **Faz F/C'de bu uçlar gerçek devlet sunucularına
karşı koştu** (yedi arama, üç tam metin — S34); geçit yoksa tipli
`502 UPSTREAM_UNAVAILABLE` döner ve "sunucuyu `--with-mcp` ile başlatın"
der, bütün kaynaklar düşerse `502 ALL_SOURCES_FAILED` + `failedSources[]`
gelir — asla boş bir liste sonuç gibi gösterilmez.

---

## 10. Bilinen sınırlar

* **Korpus sentetiktir.** `collex_local`'da sentetik korpus yoktur.
* **Dense şerit atıldır** (pgvector yok).
* **Kapsam kapısı sözcükseldir** (taban 0.4, gerçek hukukta ölçülmedi):
  iki anlamlı ortak sözcük taşıyan bir pasaj kapıyı geçebilir; "Soru
  kapsamı" yüzdesi ve eksik sözcük listesi okuyucunun savunmasıdır.
* **Taslak üreticisi kural tabanlıdır**; birleştirilmiş madde tespitleri
  entailment'ta mekanik nedenle düşebilir (KISMİ), `W12-B2` §3.3.
* **Sekiz yüzey doğrulanmadı** ve hepsi arayüzde öyle yazar: bulut AI canlı
  sınanmadı; UDF UYAP'ta açılmadı; 41 süre kuralının 25'i doğrulanmadı;
  20 harç kaleminin 17'sinde tutar yok; **karar aramanın isabeti ölçülmedi**
  (aşağıda); `.ics` gerçek bir takvim programında hiç açılmadı; yerel
  kütüphane `collex_local`'a hiçbir şey yazmıyor; atıf denetimi bugün
  "bulunamadı" diyemiyor (`STATUS.md`, "sekiz doğrulanmamış yüzey").
* **Karar arama artık çalışıyor; ölçülmeyen şey isabetidir.** Yedi gerçek
  arama gerçek künye döndürdü ve üç tam metin çekildi (S34) — yani
  "canlı upstream'e karşı hiç koşmadı" cümlesi artık **yanlıştır**. Ama
  sıralamayı **kaynak sunucu** yapıyor: tırnaksız bir sorgu kaynakta
  116 090 karara açılıp karar tarihine göre sıralanırken aynı sorgu tırnak
  içinde 758 karara düşüyor. ColleX yalnız **elindeki 20 satırlık sayfayı**
  yeniden dizer ve bunu ekranda yazar. **Faz M'den beri kaynağın kendi kayıt
  sayısı ekranda** ("Kaynakta 761 kayıt var — burada ilk 13 tanesi
  listeleniyor"; kaynak bildirmiyorsa "bildirmedi", **asla 0**, S38) — ama
  bu bir sayıdır, **ilgililik değildir**; sıralama hâlâ sunucu işidir.
* **Ölçek: ölçüldü, tam kapanmadı — ve en kötü hali yer değiştirdi.**
  20 000 parçalık ÜRETİLMİŞ bir probe korpusunda yaygın bir sözcükle
  sorulan korpus sorusu **≈3,8 sn** sürüyor ve **cevap dönüyor** (L-VERIFY
  turunda 47 sn ve cevap yoktu); buna karşılık **korpusta hiç geçmeyen bir
  ifade artık en yavaş sorudur: ≈7,5 sn ve ABSTAIN**, üç şerit de kendi
  2 500 ms bütçesiyle kesilerek. Belge kapsamlı soru **71–73 ms** ile
  etkilenmiyor (S25‴). **Faz M'den beri ekranda ilerleme kartı ve çalışan bir
  "Vazgeç" var** — bekleme **kısalmadı**, görünür ve durdurulabilir oldu. Bu
  sayılar sentetik bir korpusun **üst sınır** senaryosudur.
* **Trigram şeridinin plan davranışı korpusa bağlıdır.** Üç bağımsız probe
  üç farklı tablo verdi ve iki hat aynı sorguda **zıt** sonuç ölçtü
  (S26⁐). Bu belge setindeki hiçbir hızlanma sayısı `/v1/answer` için
  alıntılanamaz.
* **Ölçüm aracı çekincesi (N-7) — hâlâ açık.** `run_evals.py`'nin **sert
  kapıları** ve retrieval metrikleri **altı ardışık koşuda** rakam rakam aynı
  çıktı; **cevap katmanı metrikleri** ise oynadı (kesinleştirilebilir
  %85,7 ↔ %81,0, altı koşunun üçünde bir yanlış çekimserlik — hep aynı satır,
  `fx-amend-002`). Faz M raporu düzeltti (`--repeats N` **bant** basıyor ve
  "hiçbir tekrarda yanlış cevap olmasın" kapısı geldi; altı koşuda da 0) ve
  kök nedeni ölçerek buldu — ingest'te yeniden üretilen ilişki UUID'leri
  citator şeridinin tie-break'ini kaydırıyor — **ama düzeltmedi**. O satırlar
  **yalnız bant** olarak okunmalıdır (S6, S40). *(Kardeşi N-8 kapandı: süit
  bu turda üç koşuda da yeşil, S2/S39.)*
* **Canlı derin araştırma** resmî kaynakların o anki erişilebilirliğine
  bağlıdır.
* Cevap/taslak arka planda yazılır; sert kapatma son yazımı kaybedebilir
  (`persisted:false` uyarısı ekranda görünür).
* **Süre bütçesi aşamalar arasında** denetlenir; tek bir yavaş port çağrısı
  yarıda kesilmez (FIX-2 §4).
* **Taslak alaka kapısı** sözcüksel + üst veri tabanlıdır; kanun-numarası
  tabloları yaygın kodları kapsar, bilinmeyen numara "genel" sayılır; gerçek
  hukukta ölçülmedi (ADR-022, RISKS #18).
* Sunucu yalnız `127.0.0.1`, kimlik doğrulaması yok; tek worker.
