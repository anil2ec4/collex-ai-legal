# ColleX / Bağımsız Yargı MCP — Claude devir belgesi

**Tarih:** 11 Eylül 2026 (W19 kapanışı)  
**Amaç:** Bu belgeyi Claude’a verip projeyi kaldığı yerden güvenli biçimde
devam ettirmek.

## Claude’a doğrudan talimat

Bu depoda çalışmaya başlamadan önce bu belgeyi, `CLAUDE.md` dosyasını,
`docs/implementation/STATUS.md` dosyasını ve
`docs/implementation/RUNBOOK.md` dosyasını oku. `CLAUDE.md` içindeki kurallar
bağlayıcıdır. Kullanıcının ana hedefi, Türk hukuk pazarında avukatın günlük
araştırma, dosya, belge, süre ve taslak işlerini tek yerel uygulamada güvenilir
şekilde yapabilmesidir.

Kullanıcı özellikle şunları istiyor:

- Uygulama çalışır, eksiksiz ve rakip ürünlere denk olmalı.
- Kullanıcı arayüzü modern, premium, sakin ve tutarlı olmalı.
- Apple benzeri kalite hissi, iyi tipografi, net hiyerarşi ve kusursuz hizalama
  bekleniyor.
- Hiçbir öğe üst üste binmemeli; özellikle üst bar, sekmeler, durum rozetleri,
  formlar ve mobil görünüm gerçek tarayıcıda kontrol edilmeli.
- Anlatımlar avukatın anlayacağı açık Türkçe ile yazılmalı.
- Kullanıcı, son UI denemelerinden memnun kalmadı ve **son üç UI değişikliğinin
  geri alınmasını istedi**. Bu nedenle mevcut UI artık modern liquid-glass
  denemesinden önceki hale döndürülmüştür. Yeni UI çalışmasına başlamadan önce
  kullanıcıdan gelen son görsel geri bildirimi ve gerçek ekran görüntüsünü
  referans al; büyük bir tasarım yönünü varsayarak değiştirme.

İşlevsel kodu, kullanıcı istemedikçe geri alma. Çalışma ağacı zaten çok sayıda
önceki değişiklik içeriyor; `git reset`, `git checkout`, `git clean`, geniş
`stash` veya toplu silme kullanma.

## Proje kimliği ve dizin

- Kök: `C:\Users\anile\Desktop\yargı-anıl\yargi-mcp-independent`
- Python paketi: `yargi-mevzuat-mcp-independent` 1.0.0
- Node kontrol düzlemi: `control-plane/`
- Avukat konsolu: `control-plane/public/console.html`
- Python MCP sunucusu: `mcp_server_main.py`, `asgi_app.py`, `app.py`
- Yerel veriler: `var/` veya `COLLEX_DATA_DIR`
- Yerel PostgreSQL: `127.0.0.1:55432`
- Varsayılan uygulama: `http://127.0.0.1:8787/`
- Varsayılan sağlık adresi: `http://127.0.0.1:8787/v1/health`

Bu depo bağımsız yerel üründür. Sibling checkout’lar (`../yargi-mcp` ve
`../mevzuat-mcp`) eski referanslardır; oradan dosya kopyalama veya deploy etme.

## Mimariyi doğru anla

### Python MCP katmanı

Python FastMCP sunucusu Türk hukuk kaynaklarını tek MCP bağlantısında toplar.
Yargıtay, Danıştay, Bedesten, AYM, Emsal/UYAP, Uyuşmazlık Mahkemesi,
Sayıştay, KİK, Rekabet Kurumu, KVKK, BDDK, BTK, GİB ve Sigorta Tahkim
istemcileri burada bulunur. Offline sözleşme **54 araçtır**; embedding sağlayıcısı
ayrıca yapılandırılırsa koşullu 55. araç eklenebilir. Araç adı, parametre ve
temel yanıt sözleşmeleri additive-only kurala tabidir.

### TypeScript control-plane

`control-plane/src/` Hono tabanlı API, capability registry, arama/kanıt
doğrulaması, answer pipeline, bounded research, dosya intake, matter/dava
dosyaları, süreler, harç, taslak ve sözleşme inceleme akışlarını yürütür.
Provider trafiği doğrudan TypeScript’ten dış hukuk sitesine gitmez; Python
FastMCP gateway üzerinden geçer.

Başlıca yüzeyler:

- `/v1/health`
- `/v1/files`
- `/v1/matters`
- `/v1/answer`
- `/v1/research` ve araştırma başlatma/ilerleme rotaları
- `/v1/drafts`
- `/v1/contracts/checklists`
- `/v1/contracts/review`
- `/v1/contracts/review/export` — DOCX sözleşme inceleme raporu
- `/v1/deadlines`
- `/v1/fees`
- `/v1/settings`
- `/v1/backup`

OpenAPI kaynağı: `control-plane/src/api/openapi.yaml`.

### Konsol

Konsol tek dosyalı, inline CSS ve inline JavaScript kullanan
`control-plane/public/console.html` sayfasıdır. Sayfa CSP hash’leriyle korunur
ve `src/api/consolePage.ts` tarafından okunup bellekte cache edilir. Bu nedenle
HTML/CSS düzenlendikten sonra çalışan `serve.mjs` süreci mutlaka yeniden
başlatılmalıdır; yalnızca tarayıcı yenilemek bazen yetmez.

Konsol sekmeleri:

1. Dosyalarım
2. Araştır
3. Belgeler
4. Taslak
5. Ayarlar

İç ekranlar arasında dosya sayfası, belge sayfası, süreler, karar/mevzuat
arama, atıf denetimi, harç/gider, takvim, sözleşme kontrol listesi, yardım ve
sözlük bulunur.

## Çalıştırma

### Kullanıcı için önerilen Windows akışı

1. `ColleX-Baslat.cmd` dosyasını çift tıkla.
2. Siyah **ColleX Sunucu** penceresini kapatma.
3. Tarayıcı açılmazsa `http://127.0.0.1:8787/` adresini aç.
4. İş bitince `ColleX-Durdur.cmd` dosyasını çalıştır.

Başlatıcı PostgreSQL’i kontrol eder, `collex_local` veritabanını hazırlar,
migrasyonları uygular, gerekirse MCP ve yerel embedding süreçlerini açar.
Yerel model başlatma opsiyonu `--with-local-embeddings` ile yönetilir.

### Manuel uygulama

Windows PowerShell’de kök dizinde:

```powershell
$env:COLLEX_NO_DOTENV='1'
node control-plane/scripts/serve.mjs --port 8787 --with-mcp --with-local-embeddings --local-embeddings-port 8899
```

MCP’siz hızlı yerel çalışma:

```powershell
$env:COLLEX_NO_DOTENV='1'
node control-plane/scripts/serve.mjs --port 8787
```

`COLLEX_NO_DOTENV=1` test/araç çıktısına `.env` sızmasını önlemek için tercih
edilir. `.env` dosyasını asla yazdırma, commit etme veya araç çıktısına koyma.

Python stdio MCP:

```powershell
.\.venv\Scripts\python.exe mcp_server_main.py
```

Node geliştirici sunucusu:

```powershell
cd control-plane
npm ci
npm run typecheck
npm run dev
```

Gerekli ortam:

- Node.js >= 22
- Python 3.11–3.13; 3.14 kullanma
- Repo `.venv`
- Yerel PostgreSQL 18/scratch cluster, port 55432
- DOCX/intake testleri için `python-docx` ve `defusedxml`

## Test ve doğrulama komutları

Python’ı her zaman repo sanal ortamıyla çağır:

```powershell
$env:COLLEX_NO_DOTENV='1'
.\.venv\Scripts\python.exe scripts\smoke_check.py
.\.venv\Scripts\python.exe scripts\db_local_check.py
.\.venv\Scripts\python.exe -m pytest tests evals/tests -q
```

TypeScript:

```powershell
cd control-plane
npm run typecheck
npm exec vitest run
cd ..
```

Diğer doğrulamalar:

```powershell
node control-plane/scripts/demo.mjs --keep --out var/acceptance/demo
.\.venv\Scripts\python.exe scripts\run_evals.py --repeats 4
```

Bu devir sırasında gözlenen sonuçlar:

- `npm run typecheck`: geçti.
- Python smoke: 54 araç ve auth kontrolleri geçti.
- Yerel DB denetimi: 19/19 geçti.
- Repo hijyeni: 11/11 geçti; build sonrası oluşan `control-plane/dist`
  testten sonra `var/acceptance-20260910/compiled-build` içine taşındı.
- Demo: 6/6 geçti.
- Önceki tam Vitest çalışması: 2569 geçti, 6 skip. Sonrasında konsoldaki
  mühendislik sözcüğü kilidi düzeltildi; tam tekrar Windows esbuild `spawn
  EPERM`/kullanım limiti nedeniyle yeniden koşturulamadı.
- Sentetik eval hard gate’leri geçti; answer-level rapor katmanı sentetik
  corpus üzerinde kararlı hukukî kalite ölçümü değildir.

Test sayıları başka dokümanlara kopyalanmamalıdır. Güncel ölçüm için
`docs/implementation/STATUS.md` içindeki **Ölçülen sayılar** tablosunu esas al.

## Son tamamlanan işler

- PDF sayfa istatistikleri ve sparse page uyarıları TypeScript/Python/API/OpenAPI
  boyunca taşınıyor.
- Intake’in özgün `sizeBytes` bilgisi dosya listesi ve detayına aktarılıyor.
- Yerel E5 modelinin port, child process, cleanup ve fallback yaşam döngüsü
  `serve.mjs`/launcher tarafından yönetiliyor.
- Yerel semantik yeniden sıralama yalnız fetched full text üzerinde ve açık
  opt-in ile çalışıyor.
- Stok olumlu karar paragrafları, sorgu açıkça istemedikçe sonuçlara
  karıştırılmıyor.
- `POST /v1/contracts/review/export` gerçek DOCX döndürüyor; export başarısızsa
  typed error + correlation id veriyor.
- Sözleşme inceleme konsolu seçili checklist’in tam snapshot’ını review/export
  gövdesine taşıyor; böylece inceleme ile indirilen rapor arasında drift olmaz.
- Launcher eksik `.venv`/Node durumunda yarım uygulama başlatmıyor.
- Kullanıcı rehberi `docs/KULLANIM-ColleX.md` içinde ilk açılış, dosya,
  belge, araştırma, taslak, DOCX indirme ve sorun giderme akışlarını anlatıyor.

## Açık sınırlar; bunları kapatılmış gibi yazma

Mevcut genel durum **PARTIAL**’dır. “Rakipleri tamamen gereksiz kıldı” veya
“hukukî olarak kusursuz” iddiası kullanma.

- Canlı upstream resmî kaynak erişimi bu makinede sürekli doğrulanmış değildir;
  outage typed olarak gösterilir.
- `ANTHROPIC_API_KEY` yoksa bulut yapay zekâ kapalıdır. Bu arıza değildir;
  yerel dosya/arama/taslak akışları çalışır.
- UDF çıktısı deneysel kabul edilir ve gerçek UYAP Editörü’nde açılmamıştır;
  DOCX güvenli varsayılan yoldur.
- ColleX UYAP/UETS’ye bağlanmaz, tebligat almaz ve kullanıcının adına belge
  göndermez.
- Takvim dosyası gerçek Outlook/Google Takvim istemcisinde doğrulanmamıştır.
- Süre kurallarının tamamı resmî metinle doğrulanmış değildir; kritik süreyi
  avukat resmî kaynakla kontrol eder.
- Hukuk kütüphanesi boş olabilir. `evals/fixtures/corpus/` sentetik test
  verisidir; gerçek Türk hukuku veya kalite benchmark’ı değildir.
- Arama isabeti ve canlı upstream relevansı tam ürün garantisi değildir.
- Görsel tarayıcı doğrulaması bu çalışma oturumunda kullanım limiti nedeniyle
  tamamlanamadı; UI değişikliği yapan Claude gerçek tarayıcıda kontrol etmeli.

## Değişiklik ve güvenlik kuralları

1. Supabase, Resend veya başka remote MCP/managed servis kullanma.
2. `supabase/migrations/20260826080000_*` ve
   `20260826090000_*` pgvector migrasyonlarını çalıştırma; yalnız pglast ile
   syntax doğrulanır.
3. `.env` içeriğini hiçbir çıktıda gösterme.
4. 54 offline MCP araç sözleşmesini silme, yeniden adlandırma veya parametre
   kırma.
5. Yanıt sözleşmeleri additive-only ilerlemeli.
6. Unicode offset politikası: NFC metinde Unicode code point offset; UTF-16
   index kullanma.
7. Hash: UTF-8 üstünde SHA-256 hex.
8. `STATUS.md` dışına ölçülmemiş sayısal başarı iddiası yazma.
9. Uncommitted çalışma ağacını resetleme veya geniş kapsamlı temizleme.
10. Canlı hukuk sonucu, doğrulanmamış mevzuat veya sentetik eval sonucu için
    pazarlama cümlesi üretme.

## W20 durumu (11.09.2026) — dosya incelemesi kalıcı, yerel model hattı bağlı, özel anlamsal şerit çalışıyor

W19'un "yalnız API'de, senkron, modelsiz" bıraktığı dosya incelemesi bu
dalgada **gerçek bir iş sistemi** oldu. Özet (ayrıntı ve ölçümler:
`docs/implementation/STATUS.md` W20 bölümü, kararlar: ADR-034..039):

- **Kalıcı inceleme (ADR-034).** `POST /v1/matters/{id}/analysis` artık
  **202** döner ve yalnız kimliği dondurup birimleri sayar; işi bir işçi
  yapar (sunucunun içinde ya da `node control-plane/scripts/analysis_worker.mjs`).
  Birimler kira (lease) ile alınır, gözlemler ve "bitti" işareti **tek
  işlemde** yazılır, süresi dolan kira geri alınır, 3 denemeden sonra birim
  kalıcı olarak "incelenemedi" sayılır, iptal ve ilerleme var. **Gerçek bir
  süreç SIGKILL ile öldürülüp ikinci süreç koşuyu bitirdi** — sonuç kesintisiz
  koşuyla aynı.
- **Dondurulmuş kimlik ve sürüm anlık görüntüsü.** Koşu hangi dosya
  sürümlerini okuduğunu saklar; belge değişirse koşu `stale` görünür ve
  çözüm yeni koşudur. Eski koşu yeni metinle sessizce yeniden yazılmaz.
- **Model önerir, uygulama yerini bulur (ADR-035).** Model alıntısı yalnız
  bölümde **tam bir kez, birebir** geçiyorsa saklanır (çıkarıcı `mx-v2`);
  ofsetleri uygulama hesaplar ve SHA-256 ile doğrular. Dosya zekâsı
  (iddia, savunma, delil, olay, çelişki, açık soru…) ilişkisel tablolarda
  durur ve **kaynağı olmayan kayıt veritabanına giremez** (tetikleyici).
- **Görev dürüstlüğü.** Çelişkiler ve kronoloji modelsiz çalışır. "Dosyanın
  tamamını incele", "İddia ve delilleri eşleştir", "Karşı tarafın gözüyle
  incele" yerel model ister; model yoksa `409 MODEL_REQUIRED` ve konsolda
  düğme değil açıklama görünür.
- **Yerel model hattı (ADR-037).** Tek sağlayıcı fabrikası, roller (cevap,
  denetim, çıkarım, değerlendirme), model adı kodda yok. Yerel taslakçı
  **mevcut** cevap hattına bağlandı (paralel motor yok). `LOCAL_ONLY` artık
  her yapay zekâ girişinde zorlanıyor; **yerelden buluta geri düşüş yok**.
- **Özel anlamsal şerit (ADR-036).** Yüklenen belgelerin vektörleri yerel
  E5 ile PostgreSQL'e (`app_private.chunk_vectors`) yazılıyor; arama dosya
  kapsamında tam kosinüs. **pgvector gerekmez; kamu külliyatında ANN araması
  DEĞİLDİR.** Gerçek E5 modeliyle anlamsal-yalnız bir isabet ölçüldü.
- **Yerel OCR sınırı (ADR-038).** Tesseract + Poppler `PATH` üzerindeyse
  kullanılır; hiçbir şey indirilmez. **Bu makinede kurulu değil** — taranmış
  sayfa hâlâ "okunamadı" ve kapsam eksik.
- **İnceleme tablosu kalıcı (ADR-039).** Mevcut tablo ekranı sunucuya
  yazıyor; hücre bazında yeniden deneme, CSV aynen.
- **Konsol.** Dosya sayfasına **"Dosya incelemesi"** sekmesi eklendi
  (ilerleme, kapsam, okunamayan yerler, çelişkiler, kronoloji, kaynağa
  giden atıflar). 1280/1024/820/640/390 px, açık/koyu temada DOM ölçümüyle
  doğrulandı.
- **Model karşılaştırma düzeneği** (`control-plane/scripts/bakeoff.mjs`,
  `evals/bakeoff/`) ve **Mac mini rehberi**
  (`docs/implementation/MAC-MINI-INFERENCE.md`).

### W20'de yeni değişmezler (bunları bozma)

- Birim gözlemleri ve "bitti" işareti yalnız `completeUnit` içinde, kira
  denetimiyle, tek işlemde yazılır.
- Bir üreticinin davranışı değişirse sürüm sabiti artırılır
  (`EXTRACTOR_VERSION`, `DETECTOR_VERSION`, `MODEL_EXTRACTOR_VERSION`,
  `INTEL_VERSION`) — sürüm koşu kimliğinin parçasıdır.
- Model alıntısında bulanık eşleştirme YOK; iki kez geçen alıntı reddedilir.
- Kaynaksız dosya zekâsı kaydı yok; tetikleyiciyi kapatma.
- Model gerektiren görev modelsiz yarım yapılmaz, adıyla reddedilir.
- Özel anlamsal şeridi "kamu külliyatında anlamsal arama" diye anlatma.

### W20'de AÇIK kalanlar — kapatılmış gibi yazma

- **Hiçbir gerçek dil modeli çağrılmadı.** Bütün model yolları betikli test
  çiftleriyle sınandı. Hız, bellek, kalite sayısı YOK.
- **M2 Mac mini ölçülmedi**; rehberdeki komutlar Mac'te çalıştırılmadı.
- **Yerel OCR çalışma zamanı yok** (tesseract/pdftoppm kurulu değil); gerçek
  OCR sınaması "atlandı" olarak raporlanır.
- **Avukat etiketli altın vakalar yok**; bake-off yalnız sentetik vakalarla
  düzenek denetimi yaptı.
- **Konu anahtarı hâlâ sezgisel** (sentetik çiftlerde 10/11; bilinen bir
  kaçırma `it.fails` ile sabit).
- **W20 migrasyonları `collex_local`'a uygulanmadı.** `ColleX-Baslat.cmd`
  bir sonraki açılışta `intake.cli --ensure-db` ile üçünü de ekler
  (eklemeli, defter korumalı).

## W19 durumu (11.09.2026) — kanıt düzeyinde dosya zekâsı

`STATUS.md` "W19" bölümü esas alınır; sayılar yalnız oradadır.

Bu dalgada ürünün iddiası değişti: artık **ne okunduğu ve ne okunamadığı**
kanıtlanabiliyor. Beş yüzey indi, hepsi eklemeli:

1. **Fiziksel kaynak izi.** Kanonik kod noktası aralığı → **PDF sayfası**
   (DOCX'te paragraf). Yeni tablo `legal.document_version_segments`,
   yeni modüller `ingestion/locators.py` ve `ingestion/segments.py`.
   NFC artık **aralıklar ölçülmeden önce, blok blok** uygulanıyor; oluşturucu
   her yüklemede haritayı doğruluyor ve doğrulayamazsa **hiç harita
   üretmiyor**. Okunamayan sayfa **boş aralıklı satır** olarak duruyor.
2. **Dosya arama kapsamı.** Cevap isteğine eklemeli `scope` alanı;
   `src/matters/scope.ts` üyeliği **sunucuda** çözüyor. Kapsam asla
   genişlemiyor; dışarıdaki belge **adıyla** reddediliyor.
3. **Anlamsal şerit adayı.** `chunkProvenanceByIds` ile yalnız anlamsal
   şeridin bulduğu parçalar artık düşürülmüyor. Hidrasyon **görünürlük
   filtresini yeniden uyguluyor** — vektör indeksi güvenilmez girdidir.
4. **Kapsamlı dosya incelemesi.** `control-plane/src/exhaustive/`,
   4 yeni tablo, `POST/GET /v1/matters/{id}/analysis`.
   **`processingCoverage.complete` TÜRETİLİR**; hiçbir model onu etkileyemez.
5. **Yerel üretim sağlayıcısı + `LOCAL_ONLY`.** Üç güven düzeyi, listelenmemiş
   LAN adresi reddedilir, buluta **geri düşüş yok**, sınır her çağrıda
   denetlenir. Model adı koda gömülmedi.

### Yeni değişmezler (bunları bozma)

- `processingCoverage` ile `coverage` **AYRI KAVRAMLARDIR**.
  `answer/coverage.ts` SORU kapsamını ölçer ve çekimserliği kapılar; anlamı
  testlerle kilitlidir, **değiştirme**. `processingCoverage` seçilen
  KAPSAMIN ne kadarının okunduğunu ölçer.
- `complete` yalnız `deriveCoverage` içinde üretilir. Başka hiçbir yerde
  hesaplama, modele sorma, "büyük ihtimalle tamam" yazma.
- "Dosyanın tamamını inceledim" / "tüm çelişkiler" gibi bir cümleyi
  yazmadan önce **`refuseExhaustiveClaim`** çağrılır.
- Devam anahtarı `unitNo + sourceSha256`'dır. **Yalnız hash yeterli
  değildir** — tekrarlayan matbu paragraf iki birimde aynı hash'i üretir ve
  yalnız hash'e bakmak ikinci birimi hiç okumadan "okundu" sayar. Bu kusur
  W19'da ölçülerek bulundu ve kapatıldı.
- Fark otomatik olarak çelişki değildir: `CONTRADICTION / TENSION /
  CORROBORATION / INDEPENDENT / INSUFFICIENT_EVIDENCE` sözlüğünü daraltma.
- `security/urlPolicy.ts` ile `llm/endpointTrust.ts` **ters politikalardır**
  (biri için loopback saldırı, diğeri için en güvenli hâl). Birleştirme.
- Yeni migrasyon eklerken: `-- [LEDGER SENTINEL]` probe'ları gerekir,
  **son** `create` ifadesinin ürettiği nesne mutlaka ilan edilmelidir,
  `policy:` probe'u üç parçalıdır (`şema.tablo.ad`). RLS politikası
  eklenirse `EXPECTED_RLS_POLICIES` (şu an **23**) ve iki Python testindeki
  sayı birlikte güncellenir.
- Yeni bir test süiti kendi scratch veritabanını ister:
  `scratchDatabase("collex_<lane>_test")`. vitest dosyaları paralel koşar;
  aynı adı iki süitin sıfırlaması birbirini düşürür.

### W19'da AÇIK kalanlar — kapatılmış gibi yazma

- **OCR yok.** Sayfa modeli `ocr` yöntemini ve `pagesOcr` sayacını taşıyor
  ama sağlayıcı indirilmedi; bu makinede yerel OCR çalışma zamanı da yok.
  Taranmış sayfa bugün `UNREADABLE` kalır ve kapsamı `complete` olmaktan
  çıkarır — doğru davranış, ama **Senaryo C ölçülemedi**.
- **Anlamsal şerit varsayılan olarak KAPALI.** Kusur düzeltildi, gerçek bir
  şerit artık aday üretebilir, ama gömme işçisi, yerel vektör indeksi ve
  profil/boyut migrasyonu **yapılmadı**. `legal.embedding_profiles` hâlâ
  `check (dimensions = 1024)` taşıyor; yerel E5 **384** üretir. Bu çelişki
  **açıktır** ve dense şeridi üretime almadan önce kapatılmalıdır.
- **Yerel model hiç çağrılmadı.** Sınır ve bağdaştırıcı testli, ama gerçek
  bir modele karşı ölçüm yok. M2 Mac mini bu ortamdan ölçülemez.
  `control-plane/scripts/probe_local_generation.mjs` ölçen betiktir;
  **koşturulmadan hiçbir hız sayısı yazılamaz**.
- **Konsol yüzeyi eklenmedi.** Kapsamlı inceleme bugün yalnız API'dedir.
  Ekranda "Tam dosya incelemesi" düğmesi **yoktur**.
- **Kapsamlı inceleme senkron koşar**; uzun model destekli koşu için arka
  plan işçisi ve ilerleme akışı yok.
- Önerme çıkarımı üç değer türüyle sınırlı (tarih, tutar, oran); konu
  anahtarı ölçülmemiş bir sezgiseldir.

## W18 durumu (10.09.2026, ikinci oturum)

STATUS.md "W18" bölümü esas alınır. Yeni yüzeyler: komut paleti (Ctrl+K),
kısayollar (`?`), son açılanlar, dosya paketi, Kişiler/çıkar çatışması, bulut
yapay zekâ defteri, kütüphane kartı; korpus şeridinde IDF/genişletme/ağırlıklı
füzyon; canlı aramada puanlı sıralama; cevap başına kaynak uyarısı
(`corpusProvenance`). Sıralama ağırlıkları ölçülmemiş seçimlerdir; ilk gerçek
ölçüm için avukat etiketli bir altın küme gerekir.

## UI durumu (10.09.2026 güncellemesi)

Konsol, "Sessiz Danışman" tasarım diliyle yeniden yazıldı: `console.html`
içindeki `<style>` bloğu baştan yazıldı, HTML'de yalnız `.tools` (yardım +
tema) ve `.brandline` (ilk açılış marka satırı) sarmalayıcıları eklendi,
JavaScript değişmedi. Testlerin birebir kilitlediği CSS dizeleri korunduğu için
`tests/pipeline/console.test.ts` (243 test) değiştirilmeden geçer. Yeni bir
UI değişikliği yaparken: (1) `console.html` gitignore'dadır, önce kopya al;
(2) jeton adlarını ve kilitli satırları değiştirme, jeton DEĞERLERİYLE ve
bileşen kurallarıyla çalış; (3) `serve.mjs`'i yeniden başlat ve tarayıcıda
gerçek yeniden yükleme yap (yalnız hash değişimi eski CSS'i tutar);
(4) 1280 / 1024 / 820 / 640 / 390 px ve iki temayı ekran görüntüsüyle kontrol et.

## UI için özel devam talimatı

Kullanıcı mevcut UI’ın amatör göründüğünü ve üst üste binen öğeleri istemediğini
belirtti; ardından son üç UI değişikliğinin geri alınmasını istedi. Şu anda
`control-plane/public/console.html` modern liquid-glass denemesinden önceki
durumdadır. Bu dosya `.gitignore` içindeki `*.html` kuralı nedeniyle Git’te
izlenmiyor olabilir; yine de çalışma zamanında gerçek dosyadır.

Yeni UI yapılacaksa:

- Önce gerçek çalışan URL’yi ve cache durumunu doğrula.
- `loadConsolePage()` cache’lediği için her UI değişiminden sonra server’ı
  yeniden başlat.
- Marka kopyasını iki kez gösterme.
- Üst bar için tek bir layout sistemi kullan; eski grid ve yeni flex kurallarını
  üst üste bırakma.
- Her kırılımda 1024, 820, 640 ve 390 px genişliklerini kontrol et.
- Metinleri sans/system font ile, uzun hukuk metinlerini ayrı belge fontuyla
  ele al.
- Görsel düzeni ekran görüntüsüyle doğrula; yalnız HTTP 200 veya CSS string
  kontrolü yeterli değildir.
- Kullanıcı “geri al” derse yalnız son UI patch’ini değil, hangi tasarım
  durumuna dönüleceğini netleştirip değişiklikleri küçük ve geri alınabilir
  patch’ler halinde yap.

## Claude’ın ilk yapması gerekenler

1. `CLAUDE.md`, bu belge, `docs/implementation/STATUS.md`,
   `docs/implementation/RUNBOOK.md` ve `docs/README.md` oku.
2. Çalışan süreçleri ve portları kontrol et; eski `serve.mjs` süreci varsa
   kullanıcıya görünen cache sorununu teşhis et.
3. `http://127.0.0.1:8787/v1/health` ve konsol HTML başlığını doğrula.
4. Kullanıcı UI istiyorsa önce `console.html`’in mevcut görünümünü gerçek
   tarayıcıda açıp ekran görüntüsü al.
5. İşlevsel testleri bozmadan küçük bir UI patch’i uygula; server’ı yeniden
   başlat; masaüstü ve mobil kırılımları tekrar kontrol et.
6. Sonuçları kullanıcıya açıkça raporla: ne değişti, hangi test geçti, hangi
   sınır hâlâ açık.

## Başvurulacak dosyalar

- [CLAUDE.md](CLAUDE.md): bağlayıcı çalışma sözleşmesi ve mimari invariants
- [docs/implementation/STATUS.md](docs/implementation/STATUS.md): ölçülen tek
  güncel durum tablosu ve açık sınırlar
- [docs/implementation/RUNBOOK.md](docs/implementation/RUNBOOK.md): kurulum,
  server, test, PostgreSQL, backup ve launcher prosedürleri
- [docs/README.md](docs/README.md): dokümantasyon haritası
- [docs/KULLANIM-ColleX.md](docs/KULLANIM-ColleX.md): avukatın günlük kullanım
  rehberi
- [control-plane/src/api/openapi.yaml](control-plane/src/api/openapi.yaml): API
  sözleşmesi
- [control-plane/public/console.html](control-plane/public/console.html):
  self-contained UI
- [docs/COMPETITIVE.md](docs/COMPETITIVE.md): rakip karşılaştırması ve
  doğrulanmamış iddialar

Bu belge Claude’a verilecek bağlamdır; ölçülmemiş bir “tamamlandı” iddiası
olarak değil, projeyi güvenli biçimde devralma ve devam ettirme talimatı olarak
kullanılmalıdır.
