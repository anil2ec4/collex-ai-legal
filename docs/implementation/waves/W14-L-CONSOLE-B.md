# W14 — L-CONSOLE-B (Faz B2): yeni uçları avukatın gördüğü ekrana çevirmek

**Tarih:** 02.09.2026 · **Sahiplenilen dosyalar:** `control-plane/public/console.html`,
`control-plane/src/api/consolePage.ts` (değişmedi), `control-plane/tests/pipeline/console.test.ts`
· **Probe portu:** 8952 · **Probe veritabanı:** `collex_demo`
(`node control-plane/scripts/demo.mjs` ile yeniden kuruldu; koşu sonunda probe
kayıtları silindi)

Faz A yedi hattın uçlarını indirdi, Faz B1 hepsini mount edip bağladı — ama
**hiçbiri arayüzde çizili değildi** (`W14-L-FIX.md` §11.4). Bu hattın işi o
boşluk: altı yeni ekran, belge/taslak sayfasına dört yeni eylem, ve
DESIGN-SPEC'in tamamlanan parçaları.

Kural her ekranda aynıydı ve önce **ölçüldü**: bir uç bugün cevap vermiyorsa
kontrol çizilmez, nedeni Türkçe yazılır.

---

## 0. Özet — ölçülen sonuç

| Komut | Sonuç |
|---|---|
| `cd control-plane && npx tsc --noEmit` | **temiz** (çıktı yok, exit 0) |
| `cd control-plane && npx vitest run` | **102 dosya · 2047 geçti · 6 atlandı (2053)** |
| `cd control-plane && npx vitest run tests/pipeline/console.test.ts` | **129 geçti** |
| `.venv/Scripts/python.exe -m pytest tests/test_repo_hygiene.py -q` | **11 passed** |
| `node control-plane/scripts/demo.mjs` | **6/6 senaryo PASS** |

Faz B1 sonu → şimdi: vitest **2028** → **2047** (+19 test);
`console.test.ts` **110** → **129** (+19). Dosya sayısı değişmedi (102).
**Zayıflatılan, atlanan ya da silinen test yok** — §7'de üç mevcut iddianın
neden ve nasıl güncellendiği tek tek yazılı.

Tarayıcı yürüyüşü (Playwright MCP, gerçek sunucu, her düzenlemeden sonra
sunucu yeniden başlatıldı ve sayfa **sert yenilendi**):

| Kapı | Ölçüm |
|---|---|
| JavaScript istisnası | **0** (13 görünüm × 1440 px ve 390 px, iki tema) |
| 390 px'te yatay kayma | **yok** — 13 görünümün 13'ünde `scrollWidth ≤ innerWidth` |
| 960 px (= 1440 @ %150 yakınlaştırma) | **yok** — 13 görünümün 13'ünde `scrollWidth 945 < 960` |
| Yeni ekranların klavye erişimi | 6/6 — her birinin ilk odaklanabilir öğesi kendi `← geri` düğmesi |

Konsolda kaydedilen tek hata satırı, kasten ürettiğim
`POST /v1/sources/search` isteğine sunucunun verdiği `502`nin tarayıcı
tarafından basılan `Failed to load resource` kaydıdır; konsol o yanıtı doğru
işliyor (§1.1'deki tipli hata kartı).

---

## 1. Vaporware kapısı — her uç, UI'dan ÖNCE gerçek HTTP ile denendi

`node control-plane/scripts/serve.mjs --port 8952 --dsn …/collex_demo`
(db ok · 13/13 migrasyon · mcp kapalı · ai kapalı):

| Yöntem · yol | Kod | UI'da ne oldu |
|---|---:|---|
| `GET /v1/sources/catalog` | 200 | 26 kaynak, üç aile başlığı, süzgeç yetenekleri |
| `POST /v1/sources/search` | **502** `UPSTREAM_UNAVAILABLE` | tipli hata kartı (§1.1) |
| `POST /v1/sources/fetch` | 400 (şema) | kart yolu yalnız enjekte yanıtla çizildi (§8.1) |
| `GET /v1/sources/manifest` | 200 | `#kapsam` sayfası |
| `POST /v1/citation-audit/preview` | 200 | "N atıf bulundu, denetlensin mi?" |
| `POST /v1/citation-audit` | 200 | üç kovalı tablo |
| `GET /v1/drafts/{id}/export?format=denetim-docx` | **200**, 37 784 bayt, `filename*=UTF-8''…Atıf Denetim Raporu.docx` | "Raporu indir (DOCX)" |
| `GET /v1/matters/deadlines?from=&until=&include=computed` | 200 | ay takvimi |
| `GET /v1/matters/calendar.ics` | 200 `text/calendar` | "Takvime aktar (.ics)" |
| `GET /v1/matters/{id}/hearings/{itemId}/prep` | 200 | duruşma hazırlık kartı |
| `GET /v1/backup` · `POST /v1/backup` | 200 · 200 | Ayarlar › Yedekleme |
| `GET /v1/fees/tariffs` · `POST /v1/fees/compute` | 200 · 200 | harç hesabı |
| `GET /v1/contracts/checklists` · `PUT …/{id}` · `POST /v1/contracts/review` | 200 · 200 · 200 | sözleşme incelemesi |
| `GET /v1/files/{id}/original` | 200, 852 bayt | "Aslını indir" |
| `POST /v1/matters/{id}/package` | **200** (gerçek ZIP) | **kontrol ÇİZİLMEDİ** — §9(5) |

`POST /v1/exports/grid` ve `inceleme-docx` için HTTP ucu **yok**; ikisi için de
sayfada tek bir referans bile bulunmuyor ve bunu `console.test.ts`
(`expect(html).not.toContain("/v1/exports/grid")`) sabitliyor.

### 1.1 Ölçülen hata yolu (kaynaklar bu makineden erişilemez)

`POST /v1/sources/search` → `502`:

```
Sonuç satırı : "istek gönderildi, hiçbir kaynaktan künye gelmedi."
Kart başlığı : "Kaynaklara ulaşılamadı"
Kart gövdesi : "Resmî kaynak geçidi bu sunucuda yapılandırılmamış
                (sunucuyu --with-mcp ile başlatın); kaynak araması yapılamaz."
                "İstenen kaynaklar: Yargıtay. Hiçbirine ulaşılamadı."
                "(Teknik: UPSTREAM_UNAVAILABLE)"
                "Aramanız kaybolmadı: yukarıdaki alanlar dolu kalır …"
```

Boş liste **hiçbir yolda** çizilmiyor: 0 künye + 0 arıza → "Kaynaklar cevap
verdi; sonuç gerçekten boş."; 0 künye + arıza → "Ulaşılabilen kaynaklardan
künye gelmedi. … sonuç EKSİKTİR." İki cümle asla karışmıyor.

---

## 2. B-16 · `#karar-ara`

**Form** `GET /v1/sources/catalog`'tan çizilir: üç aile başlığı
(İçtihat 8 · Mevzuat 10 · Kurul kararları 8), sorgu kutusu, **tam ifade**,
**hariç tutulacak kelimeler** (virgülle, en fazla 10), **yıl aralığı**,
**daire**, **karar türü**, **kanun no**.

**Süzgeçler seçili kaynağa göre canlanır.** Hiçbir kaynak daire süzgecini
desteklemiyorsa kutu `disabled` gelir ve altında nedeni yazar
("Seçili kaynaklardan hiçbiri daire süzgecini desteklemiyor."). Aynısı kanun
no (yalnız mevzuat aileleri) ve karar türü (yalnız `kararTurleri` dolu
kaynaklar) için. Bu, vaporware kapısının süzgeç seviyesindeki hâlidir:
**gönderilemeyecek bir alan etkin bir kutu olarak durmaz.**

**İlerleme yüzde göstermez.** İstek öncesi: `Sorgulanan kaynaklar: Yargıtay ·
Danıştay` + `2 kaynak · 1 istek gönderildi, yanıt bekleniyor.` İstek sonrası:
`1 kaynak cevap verdi · 1 kaynak başarısız · 2 künye · 2 kaynak çağrısı ·
1840 ms`. Çağrı sayısı `trace[]` uzunluğundan gelir; hiçbir yerde üretilmiş
bir oran yok.

**Sonuçlar LİSTE.** Ölçülen satır yükseklikleri: **53 px** ve **96 px**
(ikincisi uyarı rozetli satır). Satır = künye (`mahkeme · E. … · K. … ·
GG.AA.YYYY`) + kaynak adı + tek satır eşleşen cümle (gri, italik) + dört
eylem. Liste üstünde birebir: *"Aşağıdaki satırlar KÜNYEDİR, kanıt değildir:
eşleşen cümle kaynağın kendi özetidir."*

**Arızalı kaynak her zaman adıyla yazılır** — mesaj birebir, makine kodu ve
`correlationId` parantez içinde, listenin ÜSTÜNDE.

**"Tam metni getir"** satırın altında yerinde açılır: `contentSha256`
(kopyalanabilir düğme), kod noktası sayısı, alınma zamanı, `kaynakEtiketi`
çipi, alıntılar ve konumları, katlanır tam metin. `sourceUrlAllowed:false`
ise bağlantı **tıklanabilir yapılmaz**; `library.action === "failed"`
sessiz kalmaz.

**Kayıtlı aramalar** `collex.console.savedsearches.v1` (localStorage, en fazla
20). Her kayıt bütün süzgeçleri geri yükler. Etikette "bu tarayıcıda saklanır"
yazıyor — çünkü sunucuda saklanmıyor.

---

## 3. B-13 · Atıf Denetim Raporu (`#denetim`)

Ürünün en keskin farkı; bu dalganın en çok emek verilen ekranı.

**Giriş yolları:** (a) belge sayfasında **"Bu belgedeki bütün atıfları
denetle"**, (b) taslak editöründe **"Atıfları denetle"**, (c) iş kartı
(yapıştırılan metin).

**`asOf` zorunludur ve konsol bugünün tarihini GÖNDERMEZ.** Alan boş başlar,
etiketi "Dilekçenin tarihi (zorunlu)", dolmadan "Denetimi çalıştır" açılmaz.
(L-EVID §8.5: yürürlük dilekçenin tarihine göre okunur.)

**Ön izleme** → **tam denetim** → tablo. Ölçülen gerçek çıktı
(`asOf=2026-06-02`, demo korpusu):

```
Bu belgedeki 6 atfın 3 tanesi kaynağında bulundu, 0 tanesi taradığımız
kaynaklarda bulunamadı, 3 tanesi ise kapsamımızın dışında kaldığı için
belirsizdir.
```

**Üç kova ayrı tutulur ve üçü de çizilir.** Her kovanın kendi başlık satırı
(`Bulundu (3)` · `Bulunamadı (0)` · `Belirsiz (3)`), kendi rengi (yeşil /
kırmızı / gri — ikisi asla aynı) ve **boş kova için kendi cümlesi** vardır:
*"Bu kovada satır yok — taradığımız kaynaklarda karşılığı bulunamayan atıf
çıkmadı."* Bu bilinçlidir: `0` sayısı tek başına "denetlenmedi" diye de
okunabilirdi.

**Çözülemeyen künye hücresi BOŞ.** `el("td", "kunye", r.kunye || "")` — asla
"?", "—", "bilinmiyor" ya da tahmin. Boşluğun nedeni hücreye değil `title`
ipucuna yazılır ("Künye çözümlenemedi — sistem künye uydurmaz.") ve hücre
çapraz taramayla **bilinçli boş** olduğunu gösterir. Kusur denetimi yapıldı:
`|| ""` yerine `|| "—"` kondu → yeni test **kırmızıya döndü**
(`expected … to contain 'var ck = el("td", "kunye", r.kunye ||…'`), geri
alındı → yeşil.

Sütunlar: **Atıf** (`(3×)` tekrar sayısıyla) · **Durum** (+ yalnız
belirsizde dolu gerekçe satırı) · **Künye** · **Yürürlük — 02.06.2026
tarihine göre** · **Alıntı** · **Aleyhe kayıt** · **Eylem**
(`href` boşsa bağlantı çizilmez; `review.reviewed:false` → "incelenmedi").
Başlıkta belge adı, yürürlük tarihi ve **denetim tarihi** (GG.AA.YYYY SS:DD),
altında `notices[]` birebir.

**"Raporu indir (DOCX)"** yalnız bir ColleX taslağı denetlendiğinde etkin
(gerçek 200 + 37 784 bayt DOCX ile doğrulandı). Yapıştırılan metinde düğme
**devre dışı ve nedeni yazılı** — dışa aktarım ucu taslak kapsamlıdır.

**Dürüstlük satırı (belge yolunda).** Belge sayfasının metni bölüm
önizlemelerinden derlenir ve önizleme bölüm başına 240 kod noktasıyla
sınırlıdır. Ekran bunu yüzünde söyler ve **sayıyla** söyler: ön inceleme tam
metinde kaç atıf saydıysa o sayı yazılır. Probe dilekçesinde ölçülen fark:
ingest tam metinde **4** referans buldu, önizlemeden derlenen denetim **2**
atıf saydı. Eksik metin atıfı **eksik** bildirir; var olan bir hükmü asla
uydurma göstermez.

---

## 4. B-17 · Takvim ve duruşma (`#takvim`)

Ay ızgarası (pazartesi başlangıçlı, önceki/sonraki ay + "Bugün"), tek
`GET /v1/matters/deadlines?from=&until=&include=computed` çağrısından çizilir.
Hücre öğeleri: süre (gecikmiş kırmızı, ≤7 gün turuncu) ve duruşma (bordo,
`SS:DD` önekli). Lejant dört renk. Bugünün hücresi mühür renginde çerçeveli.

**Duruşmaya tıklama** → `…/hearings/{itemId}/prep` → üç sütunlu kart:
"Açık süreler" (gecikmiş olan `GECİKMİŞ — N gün` rozetiyle), "Son belgeler"
(en fazla 3, belgeye götürür), "Dosya kronolojisi" + "Bu dosyanın takvimi
(.ics)".

**`.ics`** ekranın üstünde: *"Takvime aktar (.ics) — Outlook / Google
Takvim'de açılır."* Yanında dürüst not: dosya bir kez indirilir, sonradan
eklenen süre için yeniden indirmek gerekir (abonelik değil, dosya).

**`nextDeadline` gecikmiş/sonraki ayrımı** iki yerde düzeltildi:

1. **Dosya tablosu.** Hücre artık önce *"Sonraki süre"* mi *"En yakın
   GECİKMİŞ süre"* mi olduğunu söyler, `overdueCount` ayrı kırmızı çip olur,
   `nextHearing` ayrı satır alır. Gecikmiş bir tarihin "sonraki süre" diye
   okunması avukatı yanıltırdı.
2. **"Bugün / Bu hafta" paneli.** Panel BUGÜNDEN başlayan bir pencere
   sorguluyordu; **gecikmiş bir süre ana ekranda hiç görünmüyordu.** Pencere
   90 gün geriye açıldı, liste `Gecikmiş (N)` ve `Önümüzdeki 14 gün`
   başlıklarıyla ikiye ayrıldı, panel başlığı UXAUDIT P2-8'e göre
   **"Yaklaşan ve geciken süreler"** oldu. Ölçüldü: 25.08.2026 tarihli
   gecikmiş süre önce görünmüyordu, şimdi listenin başında
   `GECİKMİŞ — 8 gün` rozetiyle duruyor.

---

## 5. B-14 · Kapsam · B-03 · Yedekleme · B-35 · Harç · B-24 · Sözleşme · B-19 · Klasör · B-30 · Aslını indir

**`#kapsam`** (Ayarlar'dan ve Karar ara'dan): özet cümlesi, 26 kaynaklık
tablo (durum rozeti · son erişim · notlar), "Bilinen boşluklar", "Ölçülen
sayılar", katlanır araç envanteri (`NOT_YET_WIRED` üstte), en altta
`durustlukNotu` birebir. `sonErisim: null` → **"ölçülmedi"** (tire değil,
sıfır değil). 26 kaynağın hepsi aynı `durumNotu`yu taşıdığı için not
tabloda 26 kez değil, tablonun üstünde **bir kez** yazılıyor.

**Yedekleme** (Ayarlar): "Yedek al" → `POST /v1/backup`; durum satırı
(`null` → kırmızı *"Henüz hiç yedek alınmadı — verileriniz tek bir diskte."*,
`stale` → turuncu çip), yol, `warning` birebir, ve **geri yüklemenin Türkçe
anlatımı** (MANIFEST dosyası, ColleX'i kapat, klasörü sistemi kuran kişiye ver,
dosyaları tek tek kopyalama). Uç 404 verirse kart devre dışı ve
`ColleX-Yedekle.cmd`ye yönlendiriyor.

**Harç** (`#harc`): yıl/tür/dava değeri/mahkeme/kanun yolu → kalem kalem
tablo. **Bilinmeyen tutar uydurulmuyor**: hücre "tutar girilmeli" der,
altındaki "Eksik tutarları girin (N)" bloğu her kalem için tarifedeki
`nasilDogrulanir` cümlesiyle birlikte bir kutu açar, girilen değerler
`overrides` olarak geri gönderilir. `DOĞRULANMADI` çipi kalem bazında.
Toplam bilinmiyorsa **"eksik kalemler girilince hesaplanır"**.

**Sözleşme** (`#sozlesme`): kayıtlı liste seçimi ya da yeni liste kurma
(kimlik, ad, madde başlığı, aranacak ifadeler, zayıf ifadeler, not) →
`PUT /v1/contracts/checklists/{id}` → `POST /v1/contracts/review`. Bulgular
var/yok/belirsiz, "neden eşleşti" satırıyla; `sourced:false` gözlemler
kırmızı kenarlı ve **gözlem** olarak; `notices[]` birebir.

**Klasör bırakma** (Belgeler): "Klasör seç" düğmesi + gerçek klasör
sürükle-bırak (`webkitGetAsEntry` ile özyinelemeli gezinme — klasör
bırakıldığında `dataTransfer.files` boş gelir). Desteklenmeyen dosyalar
**adlarıyla listelenir**, sessizce düşürülmez; kabul edilenler mevcut
`uploadFiles` kuyruğundan tek tek geçer (HTTP'de toplu uç yok — L-SAFE §3.3).

**Belge sayfası** dört yeni eylem aldı: "Bu belgedeki bütün atıfları
denetle", "Kontrol listesine göre incele", **"Aslını indir"** (B-30) ve ön
incelemede **"Eşleşen atıflar" / "Belirsiz atıflar"** ayrımı (L-SAFE §3.5:
*"Kanun bağlamı bulunamadı — sözleşme madde numarası olabilir"*).

---

## 6. Tasarım sistemi — ölçülen düzeltmeler

**Aralık ve tip ölçeği** artık token (`--sp-1..7`, `--fs-xs..2xl`,
`--lh-tight/body`); yeni ekranların hiçbirinde serbest piksel değeri yok ve
hiçbir yeni yüzey 13 px'in altına inmiyor.

**390 px kabuğu.** Durum çipleri ve sekmeler **iki satıra sarıyordu**;
ikisi de tek satırlık, yatay kaydırılabilir şeride indi ve şeridin
kaydırılabilir olduğunu **sağ kenar solmasıyla** söylüyor (içerik
kırpılmıyor, maskeleniyor). Ölçüm: sekme şeridinin alt kenarı **148 px**
(844 px'lik ekranın %17,5'i). Öncesi sayısal olarak ölçülmedi; baseline
ekran görüntüsünde sekmeler iki satıra sarıyor ve "AYARLAR" ikinci satırda
kalıyor.

**Şablon seçici.** Kartlar metin duvarıydı (açıklama + monospace
"Zorunlu: …" bloğu). Artık **başlık + tek satır amaç + küçük künye**
(`Dilekçe · 3 zorunlu alan`); tam açıklama `title`'da, zorunlu alanların
tamamı grup altındaki katlanır satırda. Üstte **arama** (Türkçe İ/I duyarsız
`shadowFold`) ve tür süzgeci. 13 şablonun tamamı artık tek ekranda taranıyor.

**Karşılama kartı (SCR-14).** İlk cümle artık ürünün ne yaptığını söylüyor
(*"ColleX — hukukî sorularınızı kaynağına bağlar"*), gizlilik cümlesi karttan
çıkıp ait olduğu yere ("Verilerim nerede?") bırakıldı. Kontrol listesi
**canlı durumdan** çiziliyor: profil dolu mu, dosya var mı, belge var mı —
yapılan adım ✓ ile üstü çizili gelir ve düğmesi kaybolur. Nesir tek yerde
(`WELCOME_TITLE_TR` / `WELCOME_LEAD_TR` / `WELCOME_STEPS_TR`) ve testle
**≤ 90 sözcük**e bağlı; ölçülen: **48 sözcük, 8 satır**.

**Cevap kartı uzunluğu (UXAUDIT P1-6).** Aynı soru, aynı korpus, 1440×900:
**4 729 px (5,3 ekran) → 4 023 px (4,5 ekran)**. İki değişiklik:
(a) her kaynak kartında tekrar eden iki **sabit** cümle
("✓ Alıntı … karakteri karakterine doğrulandı", "Kanonik metinden birebir
alıntı") bölüm başında **bir kez** yazılıyor — cümleler kart başına hiçbir
şey söylemiyordu, bilgi kaybı yok; (b) ilk üç kaynak açık, kalanı
"Diğer N kaynağı göster" ile katlı — **hiçbiri atılmıyor**.

**SAYFA İÇİ ÇAPA KUSURU — ölçülen ve düzeltilen en ciddi kırık.**
Cevap kartındaki `[K-n]` bağlantısı `#kaynak-1`e gidiyor; `#kaynak-1` bir
görünüm adı değil, bu yüzden `parseHash` onu bilinmeyen sayıp
**`dosyalarim`a düşürüyordu**: avukat kendi cevabının kaynağına tıklıyor ve
**cevabın dışına atılıyordu**. Aynısı `#sec-*` içindekiler bağlantıları ve
`#parca-*` için geçerliydi. Ölçülen kanıt (düzeltmeden önce):

```
a.click() → hash "#kaynak-1" · view-arastir hidden=true · view-dosyalarim hidden=false
```

Düzeltmeden sonra, aynı ölçüm: `stayedInAnswer: true`, `k4Revealed: true`
(katlı kaynağa giden bağlantı kutuyu kendiliğinden açıyor). Bilinmeyen bir
hash hâlâ `dosyalarim`a düşüyor — çapa yalnız **var olan bir öğeyi**
gösterdiğinde görünüm korunuyor.

---

## 7. Güncellenen üç mevcut test — neden ve nasıl

Hiçbir iddia gevşetilmedi; üçü de **bu dalgada değişen gerçeği** kaydediyor.

1. **`HIDDEN_VIEWS` birebir eşleşmesi.** Harita altı yeni gizli görünümle
   genişledi. İddia birebir dizeden ızgaranın **kendi** üç girdisine
   daraltıldı (`dosya … belge … izgara` + `izgara: true`); ızgaranın
   sözleşmesi aynen korunuyor.
2. **`title: "Atıfları denetle"`.** Kart yeniden adlandırıldı
   (`Atıf Denetim Raporu`) çünkü artık belge sayfasına yönlendirmiyor, kendi
   ekranını açıyor. Liste 10 → 15 başlığa çıktı; eklenen beşinin her biri
   §1'de gerçek HTTP ile doğrulanmış bir uca bağlı.
3. **"bu dalgada inmemiş iş için kart YOK" iddiası.** Eski liste
   ("Kontrol listesine göre incele", "Duruşma hazırlık özeti", "Karar ara")
   artık **inen** işleri sayıyordu; negatif iddiayı isim üzerinden yürütmek
   yanlış eksendi. İddia **uca** çevrildi: sayfa `/v1/exports/grid` ve
   `inceleme-docx` için tek bir referans bile taşımıyor — ikisi de gerçekten
   yok (W14-L-FIX §11.6, W14-L-CONSOLE §10.1).

Ayrıca "Bugün / Bu hafta" iddiası **"Yaklaşan ve geciken süreler"** ile
değiştirildi; başlığın kendisi §4(2)'deki kusurun bir parçasıydı.

**Boşluk denetimi (yapıldı).** Yeni iddialardan biri kasten bozuldu
(`r.kunye || ""` → `r.kunye || "—"`): test **kırmızıya döndü**, kusur geri
alındı, süit yeşile döndü. Yeni testlerin bir kısmı yapısaldır (kaynak
dizesi araması); bunu dürüstçe kaydediyorum: bir dize aranıyorsa davranışın
kendisi değil, davranışı taşıyan satır sabitlenmiş oluyor.

---

## 8. Ölçülmeyenler ve enjekte edilen veri — dürüst kayıt

### 8.1 Karar ara sonuç listesi GERÇEK bir aramadan gelmedi

`mcp` kapalı ve devlet upstream'lerine bu makineden doğrudan erişim yok.
Gerçek sunucuya karşı **yalnız tipli hata yolu** koştu (§1.1). Satır listesi,
arıza şeridi ve künye satırının biçimi, tarayıcıda `window.fetch` geçici
olarak sarmalanıp **uydurma bir yanıt** verilerek çizildi ve ölçüldü
(satır yükseklikleri 53/96 px, ilerleme satırı, arıza bloğu).

**Bu bir arayüz çizim denetimidir, kaynak kalitesi ölçümü DEĞİLDİR.** O
ekran görüntülerindeki hiçbir künye gerçek bir karar değildir. "Tam metni
getir" kartı da aynı şekilde yalnız enjekte yanıtla görüldü; gerçek bir
resmî belge bu dalgada hiç getirilmedi.

### 8.2 Ölçülmeyen diğer yollar

- `failedSources` gerçek bir kısmi arızada görülmedi (yalnız enjekte).
- Manifestin `sonErisim` alanı bu sunucuda hep `null`; **dolu** hâli
  görülmedi ("ölçülmedi" yolu görüldü).
- `NOT_FOUND` kovası bugün ulaşılamaz (W14-L-FIX §11.3): tablo kovayı
  çiziyor ve boşluğunu açıklıyor, ama **dolu hâli görülmedi**.
- `409 BACKUP_IN_PROGRESS` ve `500 DUMP_FAILED` yolları görülmedi (kod yolu
  var, tetiklenmedi).
- `prefers-reduced-motion` yine tarayıcıda ölçülmedi (W14-L-CONSOLE §10.2
  hâlâ açık).
- Klasör **bırakma** (sürükle-bırak) gerçek bir klasörle denenmedi; kod yolu
  yazıldı ve testle sabitlendi. Altındaki uç (`POST /v1/files`) bu koşuda
  gerçek bir yüklemeyle doğrulandı.

---

## 9. Açık konular — dürüst liste

1. **"Taslakta kullan" kanıt bağı kurmuyor.** Canlı aramadan gelen bir künye
   taslağın kanıt kümesine giremez (taslak kanıtı `runId` / `fileIds`
   çözüyor). Düğme künyeyi taslak **talimatlarına NOT olarak** ekliyor ve
   bunu ekranda söylüyor. Gerçek bağ için getirilen belgenin dosyaya
   yüklenmesi gerekir; bu yol yok.
2. **"Etiketle" satır eylemi yapılmadı** (L-SOURCES §7.1'de listeliydi).
   Arkasında ne bir uç ne de yerel bir anlam var; çizilmedi.
3. **Belge yolunda denetim eksik metin üzerinde çalışıyor** — bölüm
   önizlemesi 240 kod noktasıyla sınırlı. Ölçülen fark: tam metinde 4 atıf,
   önizlemede 2. Ekran bunu sayıyla söylüyor ve tam metni yapıştırmayı
   öneriyor. Bir yüklemenin TAM metnini veren HTTP ucu yok; asıl çözüm o uç
   (§10.1).
4. **`NOT_FOUND` kovası bugün doldurulamıyor** (B-13'ün çözümleyicisi
   tamlık beyan edemiyor). Konsol tarafında yapılabilecek her şey yapıldı:
   kova çiziliyor ve `0`ın ne anlama geldiği yazılı.
5. **B-30 paket ucu bağlanmadı.** `POST /v1/matters/{id}/package` gerçek bir
   ZIP döndürdü (200) ama dosya sayfasına "Dosya paketini indir" düğmesi
   konmadı — öncelik listesinin sonuna yetişemedim. Uç çalışıyor, kontrol
   yok; sessizce bozuk değil, **yok**.
6. **Bu dalgada bağlanmayan diğer sözleşmeler:** B-36 üç doğrulama kutusu
   (L-EVID §8.4), B-02 "Nihai kopya indir" (§8.1), B-01 `409 EXPORT_REFUSED`
   ekran davranışı (§8.2), B-18 toplu tarih aktarımı, B-26 silme onayları ve
   sürüm gövdesi, B-29 genel arama, B-42 kişi kartları, B-43 "Nerede
   kalmıştım", B-23 maskeleme önizlemesi ve Bulut AI kayıt defteri, B-09
   `temporal` iki metin bloğu, B-08 `coverage.measuredOn` satırı, B-31
   `entailmentMeasured` ekseni, L-LEGAL §4.1/4.2 (süre kartı rozetleri ve
   "belirsiz" için iki tarih). Hepsinin uçları hazır; konsol tarafı **inmedi**.
7. **`RETRIEVAL_LANE_DEGRADED` canlı görülmedi.** Sözlük satırı yerinde ve
   `console.test.ts` onu sabitliyor, ama bu koşuda uyarı üretilmedi.
8. **Cevap kartının kalan uzunluğu.** 4,5 ekran hâlâ uzun. Karşıt otorite
   kartı tek başına 793 px ve **tespit kartları katlanmıyor** (P1-6'nın
   "tespitler varsayılan katlı gelmeli" yarısı yapılmadı).
9. **Kayıtlı aramalar yalnız bu tarayıcıda.** Sunucuda saklanmıyor; etikette
   yazılı ama gerçek bir kalıcılık değil.
10. **Çapa düzeltmesi ilk yüklemeyi kapsamıyor.** Yeni bir sekmede doğrudan
    `#kaynak-1` açılırsa hedef henüz yoktur ve sayfa `dosyalarim`a düşer.
11. **Bu ekranların hiçbiri gerçek bir avukat tarafından kullanılmadı.**
    Bütün ölçümler benim yürüyüşümde, SENTETİK demo korpusunda alındı;
    hiçbiri hukukî kalite göstergesi değildir.

---

## 10. Entegrasyon istekleri (sahibi olmadığım dosyalar)

1. **`control-plane/src/files/routes.ts` (L-MATTER)** — bir yüklemenin TAM
   kanonik metnini veren uç (`GET /v1/files/{id}/text` ya da mevcut detay
   ucuna `?full=1`). Atıf denetiminin belge yolu bugün 240 kod noktalık
   önizlemeler üzerinde çalışıyor ve bunu ekranda itiraf ediyor (§9.3).
   Kapsam: yalnız okuma, mevcut görünürlük yüklemiyle.
2. **`control-plane/src/contracts/routes.ts` (L-EVID)** — sözleşme
   incelemesi için DOCX dışa aktarım ucu (`export/review.py` hazır ve testli,
   HTTP yüzü yok — W14-L-FIX §11.6). Bu inince "Raporu indir (DOCX)" düğmesi
   sözleşme ekranına da konur.
3. **`control-plane/src/drafting/**` ya da yeni `src/exports/**` (L-EVID)** —
   `POST /v1/exports/grid` (W14-L-CONSOLE §6.1). Hâlâ yok; ızgarada CSV var,
   DOCX yok.
4. **`docs/implementation/STATUS.md` + `openapi.yaml` (L-DOCS)** — bu hat
   **hiçbir uç, alan ya da parametre eklemedi**; `openapi.yaml` deltası
   **YOK**. §0'daki sayılar (vitest 2047, console.test.ts 129) STATUS'a
   yazılacaksa yeniden ölçülmeli; komutlar §0'da.
5. **`docs/KULLANIM-ColleX.md` (L-DOCS)** — altı yeni ekranın Türkçe
   anlatımı: "Karar ara", "Atıf Denetim Raporu", "Takvim", "Kapsam",
   "Harç hesabı", "Kontrol listesine göre incele"; ayrıca "Bugün / Bu hafta"
   paneli **"Yaklaşan ve geciken süreler"** oldu (rehberin 120. satırı).

---

## 11. Değişen dosyalar

**Değişen:** `control-plane/public/console.html` ·
`control-plane/tests/pipeline/console.test.ts`
**Yeni:** `docs/implementation/waves/W14-L-CONSOLE-B.md` (bu dosya)

`consolePage.ts` **değişmedi** (CSP dosyadan türetiliyor). Konsol sözleşmesi
ölçüldü: CR sayısı **0**, `<style>` bloğu **1**, `<script>` bloğu **1**,
yasak biçimlendirme/kod-çalıştırma API'lerinin (markup atayan üç yöntem,
sanitizer setter'ı, `srcdoc`, dinamik değerlendirme, işlev kurucusu) sayısı
**0**, 127.0.0.1 dışı `http(s)://` **yok**, satır içi olay ya da `style`
özniteliği **yok**. `node --check` ile tek `<script>` gövdesi temiz.

## 12. Hijyen

`collex_demo` `demo.mjs` ile yeniden kuruldu; koşu sırasında açılan probe
dosyası, yüklemesi ve taslağı **silindi** (`/v1/matters` → `[]`,
`/v1/files` → `total: 0`, `var/uploads` → 0 dosya). 8952'de dinleyici yok,
`var/collex.pid` silindi, **8787/8898'e dokunulmadı**. Probe sırasında
`POST /v1/backup` iki gerçek yedek klasörü yazmıştı
(`C:\Users\anile\ColleX-Yedek\…`); ikisi de silindi ve klasör kaldırıldı.
Ekran görüntüleri Playwright'ın yazabildiği tek yere
(`<workspace>/.playwright-mcp/w14b/`) düştü, scratchpad'e kopyalandı ve
oradan **silindi** (23 dosya). `collex_local`'a dokunulmadı. Hiçbir git
işlemi yapılmadı. `.env` okunmadı. Hiçbir devlet upstream'ine bağlanılmadı.
MCP araç yüzeyi (54) ve `openapi.yaml` bu hatta hiç değişmedi.
