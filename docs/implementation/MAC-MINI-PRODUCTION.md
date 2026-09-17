# M2 Mac mini (8 GB) — tek makinede üretim tasarımı (W21)

> **Durum (11.09.2026): TASARIM. FİZİKSEL MAC'TE DOĞRULANMADI.**
> Bu belgedeki hiçbir komut bir Mac'te çalıştırılmadı; ColleX hiçbir Mac'te
> açılmadı. Bellek bölümündeki değerler **planlama tahminidir (tahmin,
> ölçülmedi)**. Hız, gecikme ya da kapasite sayısı bu belgede yoktur ve
> ölçülmeden yazılmayacaktır. Her tahminin yanında onu ölçen komut durur; bir
> değer ancak o komut gerçek Mac'te çalıştırıldıktan sonra
> `docs/implementation/STATUS.md`'ye "ölçüldü" diye yazılabilir.
>
> `deploy/macos/*` şablonları (`collex-env.sh`, `collex-start.sh`,
> `collex-stop.sh`, `collex-backup.sh`, `collex-restore.sh` ve
> `deploy/macos/launchd/` altındaki dört plist) aynı dalgada platform şeridi
> tarafından yazıldı. Bu belge onları 11.09.2026'da okuyarak yazıldı; onlar da
> kendi başlıklarında **UNVALIDATED ON PHYSICAL MAC** der. Şablon ile bu belge
> çelişirse şablon ve platform raporu esastır; bu belge düzeltilir.

İlgili belgeler: taşıma adımları [WINDOWS-TO-MAC-MIGRATION.md](WINDOWS-TO-MAC-MIGRATION.md),
yedek ve geri yükleme [BACKUP-RESTORE.md](BACKUP-RESTORE.md), yerel model
ayarları [LOCAL-GENERATION.md](LOCAL-GENERATION.md), OCR
[LOCAL-OCR.md](LOCAL-OCR.md), gömme [LOCAL-EMBEDDINGS.md](LOCAL-EMBEDDINGS.md).
[MAC-MINI-INFERENCE.md](MAC-MINI-INFERENCE.md) yalnız geliştirme dönemi için
bir **ara çözümdür** (Windows ana makine, ağdaki Mac yalnız model).

## 0. Karar: tek makine, bulut yok

- Nihai üretim makinesi **tek** bir Apple Mac mini M2'dir: 8 GB birleşik
  bellek, sürekli açık.
- Her şey onun üzerinde çalışır: konsol (arayüz), kontrol düzlemi
  (`serve.mjs`), PostgreSQL, Python MCP geçidi ve belge alma (`intake`),
  arka plan işçileri, dosya deposu, gömme (E5), yoğun (dense) arama, dosya
  incelemesi (Matter Intelligence), OCR ve yerel dil modeli.
- Bulut arka ucu yoktur. Windows bilgisayar üretimde **gerekmez**; yalnız
  taşımada kaynak olarak, taşımadan sonra da bir süre salt okunur geri dönüş
  olarak tutulur.
- Dil modeli aynı Mac'te `127.0.0.1`'e bağlanır (güven düzeyi
  `LOCAL_PROCESS`). Bu yerleşimde yerel ağ adresi, `COLLEX_TRUSTED_LOCAL_HOSTS`,
  `pf` kuralı ve ağ parolası gerekmez.
- Konsol yalnız `127.0.0.1:8787`'de dinler (`serve.mjs`, `hostname:
  "127.0.0.1"`). Avukat konsolu **aynı Mac'teki** tarayıcıdan açar. Başka bir
  cihazdan (dizüstü, telefon) erişim bu tasarımın **dışındadır** ve
  planlanmadı; açılması ayrı bir güvenlik kararıdır.
- Makineden dışarı çıkan tek trafik, canlı araştırmada MCP geçidinin kamu
  kaynaklarına (Yargıtay/Bedesten, mevzuat vb.) gönderdiği arama
  istekleridir. Bu istekler müvekkil belgesi taşımaz, ama avukatın yazdığı
  arama ifadesini taşır. Yapay zekâ trafiği `COLLEX_AI_POLICY=LOCAL_ONLY` ile
  makineden çıkmaz (`control-plane/src/llm/aiPolicy.ts`).

## 1. Hedef yerleşim

```
+-------- Apple Mac mini M2 · 8 GB birleşik bellek · macOS 13+ · FileVault açık --------+
|                                                                                      |
|  Tarayıcı (aynı Mac) --http--> 127.0.0.1:8787  node control-plane/scripts/serve.mjs  |
|                                  |  launchd: com.collex.app -> collex-start.sh        |
|                                  |- süreç içi: AnalysisWorker, EmbeddingWorker,      |
|                                  |             ReviewTableWorker (tek RequestGate)   |
|                                  |- çocuk: serve-mcp.mjs -> uvicorn asgi_app         |
|                                  |         127.0.0.1:8898                            |
|                                  |- çocuk: semantic_search.local_embedding_server    |
|                                  |         127.0.0.1:8899                            |
|                                  |- istek anında: python -m intake.cli               |
|                                  |         -> tesseract + pdftoppm (OCR)             |
|                                  |--sql--> PostgreSQL 18  127.0.0.1:55432            |
|                                  |         launchd: com.collex.postgres              |
|                                  +--http-> llama-server 127.0.0.1:8080               |
|                                            launchd: com.collex.llm                   |
|                                                                                      |
|  launchd: com.collex.backup (her gün 19.30) -> collex-backup.sh -> backup.mjs        |
|           -> ~/ColleX-Yedek/<YYYYMMDD-HHMMSS>/                                       |
|                                                                                      |
|  Disk: ~/ColleX/app (kod = COLLEX_HOME)   ~/ColleX/data (COLLEX_DATA_DIR)            |
|        ~/ColleX/pgdata (COLLEX_PGDATA)    ~/ColleX/models (model dosyaları)          |
|        ~/Library/Logs/ColleX (günlükler)  ~/ColleX-Yedek (yedekler)                  |
+--------------------------------------------+-----------------------------------------+
                                             | yalnız MCP canlı araştırma istekleri
                                             v
                          kamu kaynakları (müvekkil belgesi gitmez)

Makine dışı yedek kopyası: şifreli harici disk. Bulut değil.
```

`~/ColleX/...` yolları bu belgenin **önerisidir** (ASCII, kısa, ev dizini
içinde). Şablonlar yol dayatmaz: plist'lerdeki yer tutucular
(`__COLLEX_HOME__`, `__COLLEX_DATA_DIR__`, `__COLLEX_PGBIN__`,
`__COLLEX_PGDATA__`, `__USER_HOME__`, `__LLAMA_SERVER__`, `__MODEL_PATH__`)
bu yollarla doldurulur. launchd `~` ve değişken genişletmez; plist'e mutlak
yol (`/Users/<kullanıcı>/ColleX/...`) yazılır. `COLLEX_DATA_DIR` verilmezse
şablonlar da `serve.mjs` de `<COLLEX_HOME>/var`'ı kullanır.

## 2. Ne nerede çalışır

| Bileşen | Süreç / komut | Adres | Kim başlatır | Durum |
|---|---|---|---|---|
| Konsol + HTTP API | `node control-plane/scripts/serve.mjs --port 8787 --with-mcp --with-local-embeddings --local-embeddings-port 8899` | 127.0.0.1:8787 | `com.collex.app` → `deploy/macos/collex-start.sh` (`COLLEX_FOREGROUND=1`, `exec node …`) | kod ve şablon var; Mac'te doğrulanmadı |
| Şema + kütüphane yayımı | `.venv/bin/python -m intake.cli --dsn <DSN> --ensure-db --list`, sonra `.venv/bin/python -m ingestion.cli --dsn <DSN> --publish-library <veri>/library` | — | `collex-start.sh`, `serve.mjs`'ten **önce** | var. `ensure-db` başarısızsa başlatıcı **durur**; yayımlama başarısızsa durmaz. `serve.mjs` şema kurmaz, şema yoksa bellek içi kayıtla açılır |
| PostgreSQL 18 | ön planda `postgres -D <COLLEX_PGDATA> -p 55432 -c listen_addresses=127.0.0.1` | 127.0.0.1:55432 | `com.collex.postgres` (şablonda "isteğe bağlı") | şablon var; bu belge bu yolu önerir (§5.2) |
| MCP geçidi | `serve.mjs` çocuğu: `serve-mcp.mjs` → `uvicorn asgi_app` | 127.0.0.1:8898 (doluysa 20 portluk aralıkta boş port) | `serve.mjs` (`--with-mcp`) | kod var |
| Yerel E5 gömme | `serve.mjs` çocuğu: `python -m semantic_search.local_embedding_server --port 8899 --parent-stdin --collex-managed` | 127.0.0.1:8899 | `serve.mjs` (`--with-local-embeddings`) | kod var |
| Arka plan işçileri | süreç içi `AnalysisWorker`, `EmbeddingWorker`, `ReviewTableWorker` | — | `serve.mjs` | kod var. `scripts/analysis_worker.mjs` üretimde **ayrı süreç olarak çalıştırılmaz** (§4). W21 ikinci tur (R2-20): dosya incelemesi işçisi yalnız analiz şemasının **bütün** nesneleri varsa başlar (`control-plane/src/store/health.ts` `checkAnalysisSchema`: `matter_analysis_tasks`, çalışma kapsam sütunları, birim çıkarım sayaçları); eksikse işçi ve inceleme uçları kapalı kalır ve açılış günlüğü eksik nesneleri Türkçe yazar. `analysis_worker.mjs` aynı durumda başlamaz (çıkış 1) |
| Belge alma | istek anında `python -m intake.cli` (argüman listesiyle, kabuksuz) | — | `serve.mjs` | kod var |
| OCR | hizmet değildir; belge alma sırasında `PATH`'teki `tesseract` ve `pdftoppm` çağrılır | — | `intake` | kod var; Mac'te kurulmadı |
| Yerel dil modeli | `llama-server --model <GGUF> --host 127.0.0.1 --port 8080 --ctx-size 8192 --parallel 1` | 127.0.0.1:8080 | `com.collex.llm` (llama.cpp için şablon; Ollama için şablon yok) | şablon var |
| Takvimli yedek | `deploy/macos/collex-backup.sh` → `node control-plane/scripts/backup.mjs` | — | `com.collex.backup` (her gün 19.30) | şablon var |
| Durdurma | `launchctl bootout gui/$(id -u)/com.collex.app` ya da `deploy/macos/collex-stop.sh [--keep-db]` | — | elle | şablon var |
| Geri yükleme | `deploy/macos/collex-restore.sh "<yedek klasörü>" [--yes]` → `backup.mjs --restore` (`runRestore`, `control-plane/src/backup/runner.ts`) | — | elle | W21'de eklendi; Mac'te doğrulanmadı. Ayrıntı [BACKUP-RESTORE.md](BACKUP-RESTORE.md) §9.2 |

## 3. 8 GB bellek bütçesi — **tahmin, ölçülmedi**

Aşağıdaki her değer bir **planlama tahminidir**, ölçüm değildir. Dayanak
sütunu tahminin neye yaslandığını söyler; son sütun, gerçek değeri Mac'te
ölçen komuttur. Komutlar bash içindir ve §6'daki önerilen yolları varsayar.

| Bileşen | Planlama tahmini (tahmin, ölçülmedi) | Dayanak | Ölçüm komutu |
|---|---|---|---|
| macOS + oturum hizmetleri | 1,5–2,5 GB | genel bilgi; bu makinede ölçülmedi | `top -l 1 -o mem -stats pid,command,mem -n 20` (başlıktaki `PhysMem` satırı) |
| Tarayıcı (konsol sekmesi) | 0,3–0,8 GB | genel bilgi | Etkinlik İzleyici › Bellek, ya da yukarıdaki `top` |
| PostgreSQL 18 (varsayılan ayarlar, birkaç bağlantı) | 0,2–0,5 GB | varsayılan `shared_buffers`; ColleX tek kullanıcılıdır | `ps -axo pid,rss,command \| grep '[p]ostgres'` (paylaşılan bellek her süreçte sayılır, toplam şişkin görünür) ve `psql -h 127.0.0.1 -p 55432 -U postgres -Atc "show shared_buffers"` |
| `serve.mjs` (kontrol düzlemi + süreç içi işçiler) | 0,2–0,5 GB | saf JS bağımlılıklar (hono, postgres, zod) + TypeScript çalışma anı dönüştürücüsü | `ps -o rss=,command= -p "$(cat ~/ColleX/data/collex.pid)"` |
| MCP geçidi (uvicorn + fastmcp + 54 araç) | 0,2–0,4 GB | Python süreci, çok sayıda modül | `ps -o rss=,command= -p "$(cat ~/ColleX/data/collex-mcp.pid)"` |
| Yerel E5 gömme sunucusu | 0,3–0,6 GB | ONNX dosyası 118.346.824 bayt (`semantic_search/local_embedding_assets.py`), onnxruntime, 2 iş parçacığı | `ps -o rss=,command= -p "$(lsof -nP -iTCP:8899 -sTCP:LISTEN -t)"` |
| Belge alma + OCR (belge başına, kısa ömürlü tepe) | 0,2–0,6 GB | `pdftoppm` 300 dpi tek sayfa + `tesseract` | `/usr/bin/time -l .venv/bin/python -m intake.cli --dsn postgres://postgres@127.0.0.1:55432/collex_intake_test --ensure-db --store-dir "$(mktemp -d)" --file <örnek-taranmış.pdf>` → "maximum resident set size" (yaklaşık; müvekkil belgesi DEĞİL, örnek bir PDF; asla `collex_local` değil) |
| Güvenlik payı | 0,5–1,0 GB | macOS bellek sıkıştırması ve takas başlamadan önceki pay | `memory_pressure`, `sysctl vm.swapusage` |
| **Model hariç toplam** | **3,4–6,9 GB** | yukarıdaki satırların toplamı | satırların ölçülen toplamı |
| **Yerel dil modeline kalan** | **kabaca 1–4,5 GB** | 8 GB − model hariç toplam | model yüklüyken: llama.cpp başlangıç günlüğündeki (`~/Library/Logs/ColleX/collex-llm.err.log`) ağırlık, KV önbelleği ve Metal çalışma kümesi (`recommendedMaxWorkingSetSize`) satırları; `ps -o rss=,command= -p "$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t)"`; Ollama'da `ollama ps` |

Planlama sonucu (tahmin, ölçülmedi): modelin kullandığı bellek yaklaşık
**GGUF dosya boyutu + bağlam uzunluğuna bağlı KV önbelleği + hesaplama
tamponları**dır. Tahmine göre kalan pay dar olduğundan aday modeller dosyası
küçük, nicemlenmiş modellerle sınırlı düşünülmelidir. Seçimi tahmin değil,
`evals/bakeoff` ölçümü ve bu tablonun gerçek Mac'teki ölçümü verir. 128K
bağlam ilan eden bir model kartı, 8 GB'ta o bağlamın sığdığı anlamına
gelmez ([LOCAL-GENERATION.md](LOCAL-GENERATION.md)).

Genel bellek baskısı gözlemi (dosya incelemesi sürerken ayrı pencerelerde):

```bash
vm_stat 5
```

```bash
memory_pressure
```

```bash
sysctl vm.swapusage
```

macOS belleği sıkıştırır ve diske takas eder; süreçler çoğunlukla çökmez,
**yavaşlar**. Kabul ölçütü tahmin değil, gözlemdir: tipik bir dosya incelemesi
boyunca takas kullanımının sürekli büyümemesi ve `memory_pressure`'ın kritik
düzeyde kalmaması. Bu ölçüt de fiziksel Mac'te henüz sınanmadı.

## 4. Düşük bellek işletim profili

Amaç: aynı anda **tek** ağır iş, **tek** yüklü model, sınırlı boyutlu
partiler ve sıralı işlem. Ayarların hepsi başlangıçta ortamdan okunur.

### 4.1 Ortam değişkenleri

| Değişken | Üretim önerisi | Kod varsayılanı | Etkisi |
|---|---|---|---|
| `COLLEX_AI_POLICY` | `LOCAL_ONLY` | `LOCAL_PREFERRED` (`AUTO` eşanlamlı) | Yalnız bu Mac'teki (ya da kendi ağdaki) model; hiçbir istek dışarı gönderilmez. Tanınmayan değer `LOCAL_ONLY` sayılır. Diğer değerler: `LOCAL_PREFERRED`, `CLOUD_ALLOWED`, `DETERMINISTIC_ONLY`. `com.collex.app.plist` şablonu bunu **içermez**; eklenmezse varsayılan geçerlidir |
| `COLLEX_DATA_BOUNDARY` | `LOCAL_ONLY` | `ALLOW_CLOUD` | Politika ile birlikte **daha sıkı olan** geçerlidir |
| `COLLEX_LOCAL_LLM_BASE_URL` | `http://127.0.0.1:8080` | yok | Loopback → `LOCAL_PROCESS`; güvenilir adres listesi gerekmez. **Sonuna `/v1` eklemeyin:** bağdaştırıcı adrese kendisi `/v1/chat/completions` ekler (`localGenerationAdapter.ts`) ve ayar yalnız sondaki eğik çizgiyi siler (`localGenerationConfig.ts`). Sonuna `/v1` eklenirse istek `/v1/v1/chat/completions`'a gider; eski şablon yorumlarındaki bu hata W21'de düzeltildi (§13) |
| `COLLEX_LOCAL_LLM_MODEL` | tek model adı | yok (zorunlu) | Dört rolün hepsi bu modeli kullanır |
| `COLLEX_LOCAL_LLM_MODEL_ANSWER` / `_VERIFIER` / `_EXTRACTION` / `_SYNTHESIS` | **ayarlamayın** | boş | Rol başına farklı model, tek yüklü model sınırında her geçişte model değiştirme demektir (8 GB'ta yeniden yükleme) |
| `COLLEX_LOCAL_LLM_CONCURRENCY` | `1` | `1` | Bütün roller aynı `RequestGate` kuyruğunu paylaşır |
| `COLLEX_LOCAL_LLM_CONTEXT_TOKENS` | `8192` ile başlayın | `8192` | Model sunucusunun bağlamından (`--ctx-size`, şablonda 8192) büyük olmamalı |
| `COLLEX_LOCAL_LLM_MAX_OUTPUT_TOKENS` | `1024` | `1024` | |
| `COLLEX_LOCAL_LLM_TIMEOUT_MS` | `120000` | `120000` | Kuyrukta bekleme süresi bu sınıra dahil değildir (zaman aşımı sinyali işin içinde başlar) |
| `COLLEX_OCR` | `auto` | `auto` | `off` OCR'yi kapatır |

Dosya incelemesi aşama boyutları (`control-plane/src/exhaustive/stageTypes.ts`,
11.09.2026'da okunduğu hâliyle; orkestratör bu dosyayı bu dalgada
değiştiriyor, kullanmadan önce yeniden bakın). Aralık dışı ya da sayı olmayan
değer yok sayılır ve varsayılan kalır:

| Değişken | Varsayılan | İzinli aralık | Ne sınırlar |
|---|---|---|---|
| `COLLEX_ANALYSIS_WEIGH_BATCH` | 8 | 1–32 | bir tartma çağrısındaki iddia–delil eşleşmesi |
| `COLLEX_ANALYSIS_FULL_SEARCH_MAX_EVIDENCE` | 48 | 0–10000 | Delil sayısı bunu aşmıyorsa HER iddia HER delille karşılaştırılır ve "destek yok" bir bulgu olabilir; aşarsa yalnız aday kümesiyle karşılaştırılır ve sonuç "mevcut adaylarda destek bulunamadı" olarak kalır |
| `COLLEX_ANALYSIS_CANDIDATES_PER_CLAIM` | 24 | 1–500 | tam arama uygulanmadığında iddia başına aday delil |
| `COLLEX_ANALYSIS_CONTRADICTION_PAIRS_PER_CALL` | 10 | 1–40 | anlamsal çelişki çağrısı başına önerme çifti |
| `COLLEX_ANALYSIS_SYNTHESIS_ENTRIES_PER_CALL` | 24 | 2–120 | sentez çağrısında gösterilen bulgu |
| `COLLEX_ANALYSIS_POINTS_PER_CALL` | 16 | 1–64 | sentez çağrısı başına kabul edilen nokta; fazlası "kısaltıldı" olarak raporlanır |

Değerleri küçültmek çağrı başına bellek ve bağlam ihtiyacını azaltır, çağrı
sayısını artırır. Kapsam dürüstlüğü korunur: `FULL_SEARCH_MAX_EVIDENCE`
küçüldüğünde ürün "destek yok" demez, "mevcut adaylarda bulunamadı" der.
Hangi değerin 8 GB'ta uygun olduğu **ölçülmedi**.

### 4.2 Ortamdan ayarlanamayan sabitler (bugün)

| Sabit | Değer | Yer |
|---|---|---|
| Dosya incelemesi işçisi parti boyu | 4 birim | `control-plane/src/exhaustive/worker.ts` (`batchSize ?? 4`) |
| İnceleme tablosu işçisi parti boyu | 2 hücre | `control-plane/src/reviewTables/worker.ts` |
| Gömme işçisi istek başına metin | 16 (en çok 32) | `control-plane/src/embeddings/embeddingWorker.ts` |
| E5 sunucusu | istek başına en çok 41 metin, 16'lık iç partiler, aynı anda tek istek (ikinci istek 429), 2 iş parçacığı, 512 token | `semantic_search/local_embedding_server.py`, `local_embeddings.py` |
| OCR | sayfa sayfa, 300 dpi | `intake/ocr.py` |

Bunları ortam değişkeniyle ayarlanabilir kılmak **planlanmadı**; açık iştir.

### 4.3 İşletim kuralları

1. **Tek süreç, tek kapı.** `RequestGate` süreç içidir. `serve.mjs` dosya
   incelemesi işçisini kendi içinde çalıştırır, bu yüzden bütün model
   çağrıları tek kuyruktan geçer. `scripts/analysis_worker.mjs`,
   `scripts/bakeoff.mjs` ve `scripts/probe_local_generation.mjs` kendi
   kapılarını kurar; üretim açıkken çalıştırılırlarsa modele aynı anda iki
   istek gider. Bunları yalnız bakım penceresinde, uygulama durdurulmuşken
   ya da boştayken çalıştırın.
2. **Tek yüklü model.** llama.cpp tek model yükler (şablon: `--parallel 1`).
   Ollama kullanılırsa `OLLAMA_MAX_LOADED_MODELS=1` ve `OLLAMA_NUM_PARALLEL=1`.
3. **Sıralı işlem.** E5 sunucusu aynı anda tek istek alır; OCR sayfa sayfa
   ilerler; dosya incelemesi birimleri sırayla işlenir.
4. **Bakım işleri mesai dışında.** Testler, `demo.mjs`, `scripts/run_evals.py`,
   bake-off ve toplu yeniden gömme aynı PostgreSQL kümesinde kendi geçici
   veritabanlarını açar ve aynı belleği kullanır.
5. **Bellek baskısını izleyin** (§3 komutları). Takas kullanımı büyüyorsa
   önce model bağlamını ve aşama boyutlarını küçültün, sonra modeli.

## 5. Sürekli açık hizmet tasarımı (launchd)

### 5.1 Hizmetler ve şablonlar (11.09.2026'da okunduğu hâliyle)

Dört plist de kullanıcı oturumunda çalışan **LaunchAgent**'tır
(`~/Library/LaunchAgents`, `launchctl bootstrap gui/$(id -u) …`).

| launchd etiketi | Şablon | Ne yapar | Önemli anahtarlar |
|---|---|---|---|
| `com.collex.postgres` | `deploy/macos/launchd/com.collex.postgres.plist` | `postgres`'i doğrudan, **ön planda** çalıştırır (`pg_ctl` değil; launchd süreci izler) | `RunAtLoad`, `KeepAlive = true`, `ThrottleInterval = 30`. Şablon kendini "isteğe bağlı" sayar: Homebrew services aynı kümeyi yönetiyorsa kullanılmaz |
| `com.collex.llm` | `deploy/macos/launchd/com.collex.llm.plist` | `llama-server`'ı `127.0.0.1:8080`'de, `--ctx-size 8192 --parallel 1` ile | `RunAtLoad`, `KeepAlive = true`, `ThrottleInterval = 30`; parola yok (ağa açılmaz) |
| `com.collex.app` | `deploy/macos/launchd/com.collex.app.plist` → `collex-start.sh` | `COLLEX_FOREGROUND=1` ile: sağlık/pid denetimi, PostgreSQL denetimi, `ensure-db` (başarısızsa durur), kütüphane yayımı, sonra `exec node serve.mjs …` | `RunAtLoad`, `KeepAlive = { SuccessfulExit = false }`, `ThrottleInterval = 30`, `ProcessType = Interactive` |
| `com.collex.backup` | `deploy/macos/launchd/com.collex.backup.plist` → `collex-backup.sh` | `backup.mjs` ile yedek; eski yedek silmez; belge asıllarını okuduğu klasörü ve kaynağını yazar, kurulu `com.collex.app` başka bir veri klasörü kullanıyorsa durur (çıkış 64) | `StartCalendarInterval` = her gün **19.30**, `RunAtLoad = false` |
| — | `deploy/macos/collex-stop.sh [--keep-db]` | nazik durdurma (`collex.stop`), sonra yalnız ColleX'e ait süreçlere `SIGTERM`, 5 sn sonra hâlâ ColleX olana `SIGKILL`; `COLLEX_PGDATA` verilmişse `pg_ctl -m fast stop` | port dinleyen yabancı sürece dokunmaz |
| — | `deploy/macos/collex-restore.sh` | `backup.mjs --restore` sarmalayıcısı; `EVET` ister | [BACKUP-RESTORE.md](BACKUP-RESTORE.md) §9.2 |
| — | `deploy/macos/collex-env.sh` | yukarıdaki betiklerin ortak ayarları (`source` edilir; tek başına çalışmaz); `~/.collex/collex.env` dosyasını katı kurallarla okur (§10) | gizli bilgi tutmaz |

### 5.2 Açılışta başlama ve sıra

- Her hizmet oturum açıldığında (`RunAtLoad`) başlar. FileVault açıkken bu,
  açılıştaki kilit ekranında parola girildiği andır (§5.9).
- launchd hizmetler arası sıra tutmaz. Sıra şöyle sağlanır:
  `collex-start.sh` PostgreSQL'i hazır bulamazsa ve `COLLEX_PGDATA` verilmişse
  kümeyi `pg_ctl` ile kendisi açar; verilmemişse hata ile (çıkış 1) biter ve
  `KeepAlive = { SuccessfulExit = false }` onu 30 sn sonra yeniden başlatır.
  Bu belgenin önerisi: kümenin **tek sahibi `com.collex.postgres`** olsun ve
  `com.collex.app` ortamına `COLLEX_PGDATA` **yazılmasın**. Gerekçe (kod
  okumasından çıkarım, Mac'te gözlenmedi): `COLLEX_PGDATA` verilmişse ve
  PostgreSQL oturum açılışında henüz hazır değilse `collex-start.sh` kümeyi
  `pg_ctl` ile kendisi açar. Bu yarışı `pg_ctl` kazanırsa küme launchd'nin
  gözetimi dışında çalışır (çökerse kimse yeniden başlatmaz) ve
  `com.collex.postgres` her 30 sn'de bir "küme zaten açık" hatasıyla düşer.
  Bedeli: başlatıcının "55432'yi dinleyen küme bizim kümemiz mi?" denetimi
  (Windows'taki E18 denetiminin karşılığı) yapılmaz; tek amaçlı bir Mac'te bu
  risk düşüktür. Yarış platform şeridine bildirildi (§13).
- `brew services start postgresql@18` **önerilmez**: Homebrew'un kendi veri
  dizinini ve 5432 portunu kullanır; ColleX 55432 ve `postgres` kullanıcısını
  bekler.
- Model sunucusu hazır olmasa da uygulama açılır: cevaplar kural tabanlı olur
  ve bunu söyler; dosya incelemesinin model gerektiren işleri `MODEL_REQUIRED`
  döner.
- Şema adımı atlanamaz: `serve.mjs` şema kurmaz; şema eksikse kayıtları
  **bellek içinde** tutar ve yeniden başlatmada kaybeder.

### 5.3 Çökme sonrası yeniden başlama

- `com.collex.app`: `serve.mjs` nazik kapanışta `process.exit(0)` ile çıkar;
  `SuccessfulExit = false` sayesinde istenen durdurma kalıcıdır, çökme
  (sıfırdan farklı çıkış ya da sinyalle ölüm) 30 sn sonra yeniden başlatılır.
- `com.collex.postgres` ve `com.collex.llm`: `KeepAlive = true`, yani her
  çıkışta yeniden başlarlar — **istenen durdurmada da**. Bu yüzden bu iki
  hizmet `launchctl bootout` ile indirilir; `pg_ctl stop` ya da `kill` ile
  durdurulan süreç 30 sn sonra geri gelir.
- Yeniden başlayan uygulama yarım kalan dosya incelemesini sürdürür: işçi
  süresi dolmuş kiraları geri alır ve bir sonraki bitmemiş birimden devam eder
  (`control-plane/src/exhaustive/worker.ts`). Fiziksel Mac'te sınanmadı.
- W21 ikinci tur, aynı dosyada dört sınır daha (Windows'ta PostgreSQL ile
  sınandı; fiziksel Mac'te sınanmadı):
  - **Model sunucusu yeniden başlarken** (`com.collex.llm` çöküp 30 sn sonra
    geri gelirken ya da model yüklenirken HTTP 503 dönerken) sunucuya
    ulaşılamaması ve HTTP 429/502/503/504 yanıtları — **sunucunun hiçbir
    isteğe hizmet veremediğini** gösteren hatalar — birimin ya da görevin
    deneme hakkını **harcamaz**: iş 10 sn, 30 sn, 2 dk, 5 dk bekleyişlerle
    geri bırakılır ve bu sürede yalnız model gerektirmeyen okuma sürer.
    Kesinti kesintisiz 30 dakikayı aşarsa hatalar yeniden deneme hakkından
    düşer; iş başarısız sayılır ve inceleme **eksik** olarak kapanır
    (sessizce "tamamlandı" demez) (R2-19).
  - **Tek bir isteğin hatası** — zaman aşımı (örneğin
    `COLLEX_LOCAL_LLM_TIMEOUT_MS` sınırını her seferinde aşan büyük bir
    değerlendirme ya da sentez istemi) ve HTTP 408/500 gibi yanıtlar — model
    kesintisi sayılmaz ve **başka hiçbir işi durdurmaz**: yalnız o birim ya da
    görev kendi bekleyişiyle geri bırakılır, öteki incelemelerin model işleri
    sürer. Deneme hakkı yalnız kısa bir süre korunur: o işin ilk hatasından
    5 dakika sonra ya da arada başka bir model çağrısı yanıt aldıysa (model
    çalışıyor, sorun o istekte) her yeni hata bir deneme hakkı harcar ve üç denemeden sonra iş başarısız sayılır; inceleme **eksik**
    kapanır. Aynı ölçüt sunucu hatalarına da uygulanır: bir işin isteği her
    seferinde ulaşılamama ile düşerken başka çağrılar yanıt alıyorsa, o işin
    hatası kesinti sayılmaz ve deneme hakkı harcar. Böyle bir hata alan iş,
    sonraki partisinde öteki işlerin arkasına alınır; böylece modelin çalışıp
    çalışmadığı o iş yeniden denenmeden görülür (Windows'ta PostgreSQL ile
    sınandı: bu biçimde düşen bir değerlendirme 4 çağrıda başarısız sayılır,
    öteki değerlendirmeler beklemeden biter). Sınır: başka hiçbir model işi
    kalmamışken tek başına düşen istekte modelin mi isteğin mi sorunlu olduğu
    ayırt edilemez; zaman aşımında yaklaşık 15 dakika (3 bekleyiş, sonra 3
    deneme), ulaşılamamada 30 dakikalık kesinti penceresi boyunca yeniden
    denenir (§13).
  - **Süreci çökerten analiz aşaması** (örneğin planlama sırasında bellek
    tükenmesi) artık sayılır: `max_stage_attempts + 2` art arda yarıda kalan
    geçişten sonra inceleme ağır işe yeniden girmeden, kaynak kapsamıyla ve
    "art arda yarıda kaldı" gerekçesiyle **başarısız** kapanır; sunucu 15
    dakikada bir yeniden çökmeye devam etmez (R2-16).
  - **Güncellemeden sonra** eski bir analiz sürümüyle (zekâ katmanı, aşama
    şeması, model çıkarıcısı ya da kural tabanlı çıkarıcı sürümü) başlatılmış
    inceleme, işçinin ilk turunda, hiçbir birimi okunmadan "farklı bir
    sürümüyle başlatılmış" gerekçesiyle başarısız kapanır; yeni istenen
    inceleme onun arkasında beklemez (R2-17). Avukat incelemeyi yeniden
    başlatır.

### 5.4 Nazik kapatma

- `launchctl bootout gui/$(id -u)/com.collex.app` `SIGTERM` gönderir;
  `serve.mjs` `shutdown()` çalıştırır: HTTP'yi kapatır, işçileri durdurur,
  bekleyen cevap/taslak yazımlarını boşaltır (`flush()`), veritabanı
  bağlantısını kapatır; MCP ve E5 çocuklarına `SIGTERM`, 5 sn sonra `SIGKILL`
  gönderir; pid dosyalarını siler.
- Şablonlarda `ExitTimeOut` yoktur; launchd'nin sistem varsayılanı geçerlidir.
  Bu sürenin `shutdown()`'dan kısa olmadığı **ölçülmedi**; pid dosyasının
  bootout sonrasında kaybolması, kayıtların yazıldığının işaretidir.
- `collex-stop.sh`, `<veri>/collex.stop` nöbetçi dosyasını bırakıp pid
  dosyasının kaybolmasını en çok 6 sn bekler (`COLLEX_STOP_WAIT_S`); sonra
  kalan ColleX süreçlerine `SIGTERM` gönderir. launchd altında önce
  `launchctl bootout` önerilir (şablonun kendi notu).
- Sıra: önce uygulama, sonra veritabanı. PostgreSQL `SIGTERM`'de "smart"
  kapanışa girer ve istemcilerin çıkmasını bekler; süre aşımıyla `SIGKILL`
  alırsa bir sonraki açılışta çökme kurtarması yapar (güvenli, ama daha yavaş
  açılır). Sistem kapanışında launchd sıra garantisi vermez.

### 5.5 Sağlık denetimi

launchd yalnız **çıkan** süreci yeniden başlatır; askıda kalan (yanıt
vermeyen ama çıkmayan) bir süreci fark etmez. Otomatik bir bekçi
(watchdog) **yoktur ve planlanmadı**. İşletmeci denetimi:

```bash
curl -fsS http://127.0.0.1:8787/v1/health | ~/ColleX/app/.venv/bin/python -m json.tool
```

Beklenen alanlar: `status` = `"ok"`, `dbName` = `"collex_local"`, `db` hazır,
`migrations` eksiksiz, `rls` beklenen sayıda, `uploadsDir` =
`~/ColleX/data/uploads`'un mutlak yolu, `dense.state` = `"ACTIVE"`,
`localAi.state` = `"configured"` (çalışıyor demek DEĞİLDİR, `liveTested`
hep `false`), `aiPolicy.policy` = `"LOCAL_ONLY"`, `dataBoundary` =
`"LOCAL_ONLY"`, `backup` son yedeği gösterir (7 günden eskiyse konsol eski
sayar), `ocr.state` = `"OCR_READY"` ve `ocr.source` = `"probe"`.

`ocr` alanı (W21) `serve.mjs`'nin `python -m intake.ocr --status` yoklamasıdır
ve **hizmetin kendi ortamında** (launchd'nin `PATH`'i, plist değerleri)
çalışır; taranmış sayfaların hizmet altında okunup okunamayacağını gösteren
tek sinyal budur. Değerler:

- `ocr: null` — ilk yoklama henüz cevap vermedi (sağlık en çok 250 ms bekler).
  "Hazır" demek **değildir**; birkaç saniye sonra yeniden sorun.
- `ocr.source` = `"probe_failed"` (durum her zaman `OCR_FAILED`) — yoklama
  çalıştırılamadı ya da cevabı anlaşılmadı; taranmış sayfalar okunmaz.
- `OCR_READY` dışındaki her kod eksik parçayı adlandırır
  (`OCR_EXECUTABLE_MISSING`, `OCR_TURKISH_DATA_MISSING`,
  `OCR_RASTERIZER_MISSING`, `OCR_DISABLED`); kodların anlamı §8 ve
  [LOCAL-OCR.md](LOCAL-OCR.md).
- Yoklama **süreç başına bir kez** yapılır. `brew install tesseract
  tesseract-lang poppler` sonrasında sağlığın değişmesi için uygulama yeniden
  başlatılır:

```bash
launchctl kickstart -k "gui/$(id -u)/com.collex.app"
```

### 5.6 OCR ve PostgreSQL araçlarının hizmet ortamında görünmesi

launchd ile başlayan bir sürecin `PATH`'i kendiliğinden `/opt/homebrew/bin`'i
içermez. Şablonlar bunu karşılar: `com.collex.app.plist` ve
`com.collex.backup.plist` `PATH` = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
ve `COLLEX_PGBIN` verir; betikler ve `backup.mjs` PostgreSQL araçlarını
`COLLEX_PGBIN`, sonra `PATH`, sonra bilinen Homebrew/Postgres.app klasörlerinde
arar ve tahmini bir klasörü açıkça bildirir. Hizmet ortamındaki OCR'ın
denetimi `/v1/health` içindeki `ocr` alanıdır (§5.5): o yoklama launchd
altında, hizmetin kendi `PATH`'iyle çalışır. Uçtan uca denetim §11'deki
"taranmış örnek PDF" adımıdır. Bir terminalde `--status` çalıştırmak hizmetin
değil terminalin `PATH`'ini sınar; kurulumun kendisini denetlemek için
kullanılır, hizmet için değil.

### 5.7 Günlükler ve newsyslog

- Şablonlar günlükleri `~/Library/Logs/ColleX/` altına yazar
  (`COLLEX_LOG_DIR`): `collex-app.out.log` / `collex-app.err.log`,
  `collex-postgres.out.log` / `collex-postgres.log`, `collex-llm.out.log` /
  `collex-llm.err.log`, `collex-backup.out.log` / `collex-backup.err.log`,
  ayrıca başlatıcının `collex-ensure-db.log` ve `collex-library.log`
  dosyaları. `serve.mjs` belge metnini günlüğe yazmaz.
- Şablonlarda günlük döndürme **yoktur**. Önerilen: `newsyslog`. Örnek
  `/etc/newsyslog.d/collex.conf` (alanlar: dosya, sahip:grup, izin, kopya
  sayısı, KB boyut, zaman, bayraklar; `N` sinyal gönderme, `J` bzip2, `G`
  dosya adında joker):

```
/Users/<kullanıcı>/Library/Logs/ColleX/collex-*.log   <kullanıcı>:staff  640  7  10240  *  GNJ
```

- Kuru çalıştırma: `sudo newsyslog -nv`.
- Bilinen sınır (doğrulanmadı): newsyslog dosyayı yeniden adlandırır; launchd'nin
  açtığı dosya tanıtıcısı yeniden başlatmaya kadar eski (döndürülmüş) dosyaya
  yazmayı sürdürebilir. Döndürme bu yüzden boyutu ancak bir sonraki yeniden
  başlatmada gerçekten sınırlar.

### 5.8 Zamanlanmış veritabanı ve belge yedeği

- `com.collex.backup` her gün **19.30**'da `collex-backup.sh`'yi çalıştırır.
  Büro geç saate kadar çalışıyorsa `StartCalendarInterval` saati kimsenin
  belge silmediği bir saate alınmalıdır ([BACKUP-RESTORE.md](BACKUP-RESTORE.md) §2).
- Uyku sırasında kaçan takvim işi uyanışta çalışır; makine kapalıyken kaçan
  iş çalışmaz. Uyku bu yüzden kapatılır (§5.9).
- Yedek `pg_dump -Fc` + belge asıllarının SHA-256'lı kopyası + `yedek.json`
  manifestidir; hiçbir eski yedek silinmez. Ayrıntı, saklama ve makine dışı
  kopya: [BACKUP-RESTORE.md](BACKUP-RESTORE.md).
- **Belge asıllarının klasörü (W21).** `collex-backup.sh` ve
  `collex-restore.sh` belge asıllarını `COLLEX_DATA_DIR/uploads`'tan okur ve
  oraya yazar. Terminalde elle çalıştırılan bir betik plist değerlerini
  **görmez**; değer yoksa `<ColleX klasörü>/var/uploads` varsayılır ve bu Mac'te
  hizmetin klasörü değildir. Bu yüzden `~/.collex/collex.env` dosyası
  **zorunludur** (§10). Betikler her çalışmada klasörü ve nereden geldiğini
  yazar; kurulu `com.collex.app.plist` başka bir `COLLEX_DATA_DIR` gösteriyorsa
  hiçbir şey yapmadan durur (çıkış 64). `backup.mjs` ayrıca klasör yoksa ya da
  veritabanının andığı asıllardan hiçbirini taşımıyorsa yedeği reddeder
  (`UPLOADS_MISSING` / `UPLOADS_INCOMPLETE`); bir kısmı eksikse yedek alınır
  ama "EKSİK" diye yazılır ve eksik sayısı `yedek.json`'a girer. Veritabanına
  sorulamadıysa (ör. `psql -w` parola istedi) yedek "DENETLENMEDİ" diye
  yazılır; hiçbir çıktı onu "tamam" saymaz. `collex-restore.sh` geri yüklenen
  veritabanının andığı asılları klasörde arar: eksik varsa çıkış 1, denetim
  yapılamadıysa çıkış 3 (ayrıntı BACKUP-RESTORE §9.2).

### 5.9 Güç, uyku, FileVault ve gözetimsiz yeniden başlatma (doğrulanmadı)

```bash
sudo pmset -a sleep 0
```

```bash
sudo pmset -a autorestart 1
```

- `autorestart`, elektrik kesintisinden sonra Mac'in kendiliğinden açılmasını
  ister.
- **FileVault açık kalmalıdır** (müvekkil verisi). Bedeli: elektrik
  kesintisinden sonra Mac, parola girilene kadar kilit ekranında bekler; o
  ana kadar hiçbir ColleX hizmeti başlamaz. Bu bilinçli bir takastır:
  şifrelenmemiş disk yerine elle kilit açma.
- Planlı yeniden başlatmada `sudo fdesetup authrestart` bir kerelik kilit
  açmayla yeniden başlatır.
- Otomatik macOS güncellemelerinin gece yeniden başlatması aynı kilit
  ekranına düşer; güncellemeleri bakım penceresinde elle yapın.
- Kesintisiz güç kaynağı (UPS) önerilir; seçimi bu belgenin konusu değildir.

## 6. Depolama düzeni

| Konum | İçerik | Yedekte mi | Not |
|---|---|---|---|
| `~/ColleX/app` = `COLLEX_HOME` | kodun `collex/*-snapshot` dalından klonu; `.venv/`, `control-plane/node_modules/`, `var/models/multilingual-e5-small/` | hayır | Kod dalda durur; `.venv` ve `node_modules` Mac'te yeniden kurulur, **kopyalanmaz**. E5 modeli SHA-256 sabitli olarak yeniden indirilebilir |
| `~/ColleX/data` = `COLLEX_DATA_DIR` | `uploads/<sha256><uzantı>` (belge asılları), `library/` (getirilen kararların kuyruğu) ve `library/yayimlandi/` (yayımlanmış zarflar), `collex.pid`, `collex-mcp.pid`, `collex.stop` | `uploads/` **evet**; `library/` **hayır** (boşluk, [BACKUP-RESTORE.md](BACKUP-RESTORE.md) §1) | pid ve stop dosyaları asla yedeklenmez |
| `~/ColleX/pgdata` = `COLLEX_PGDATA` | PostgreSQL kümesi | canlı dizin **asla** kopyalanmaz; `pg_dump -Fc` ile | Time Machine'den dışlayın: `tmutil addexclusion ~/ColleX/pgdata` |
| `~/ColleX/models` | llama.cpp GGUF dosyaları | hayır | Yeniden indirilebilir; adını ve `shasum -a 256` değerini yapılandırma notuna yazın |
| `~/Library/Logs/ColleX` = `COLLEX_LOG_DIR` | günlükler | hayır | §5.7 |
| `~/ColleX-Yedek` = `COLLEX_BACKUP_DIR` | yedek klasörleri; geri yüklemenin güvenlik dökümleri `geri-yukleme-oncesi/` altında | kendisi yedektir | şifreli harici diske kopyalanır |

**Mantıksal kimlik, fiziksel yol değildir.** Veritabanı bir belge aslının
yolunu değil `sha256` değerini ve uzantısını tutar; dosya okuma anında
`uploadsDir` + ad ile bulunur. Yedek manifesti göreli POSIX yolları tutar.
Bu yüzden veri dizini Windows'taki `<repo>\var`'dan Mac'teki
`~/ColleX/data`'ya taşınırken veritabanında hiçbir yol yeniden yazılmaz
(denetim bulgusu; kütüphane kuyruğunun mutlak yolları yalnız API
yanıtlarında görüldü ve veritabanına yazıldığı bulunmadı — grep'e dayanır,
tam bir iz sürme değildir).

Diğer notlar:

- Dosya adları küçük harfli onaltılık + küçük harfli uzantıdır; APFS'nin büyük
  küçük harf duyarlılığı ve Unicode normalleştirmesi bu adları etkilemez.
- Uygulama yolu **ASCII** olmalıdır. Windows deposunun yolu ASCII dışı
  karakter içerir (`yargı-anıl`) ve orada `chcp 65001` gerekir; Mac'te bu
  risk yol seçimiyle ortadan kalkar.
- E5 model dizini `COLLEX_DATA_DIR`'ı **izlemez**: her zaman
  `<COLLEX_HOME>/var/models/multilingual-e5-small` (bilinen boşluk).

## 7. Apple Silicon ve yerel bağımlılık denetimi

Kaynak: W21 taşınabilirlik denetimi (salt okunur, 11.09.2026) ve depo
dosyaları. Hiçbiri Mac'te sınanmadı.

| Bağımlılık | Bulgu | Mac'te ne yapılmalı | Doğrulama |
|---|---|---|---|
| macOS sürümü | `onnxruntime 1.20.1` için `uv.lock`'ta yalnız `macosx_13_0_universal2` tekerleği var | macOS 13 (Ventura) ya da üstü | `sw_vers -productVersion` |
| İşlemci | Apple Silicon | — | `uname -m` → `arm64` |
| Node.js | `ts-loader.mjs` `node:module` `registerHooks` kullanır (22.15+ / 23.5+ olduğu bilinir, doğrulanmadı); `package.json` yalnız `>=22` der; Windows'ta 24.15.0 çalışıyor | Node 24 (ya da 22.15+) | `node --version`, `node -p process.arch` → `arm64`, sonra `serve.mjs` açılıyor mu |
| TypeScript | `ts-loader.mjs` `typescript`'i **çalışma anında** içe aktarır; paket yalnız `devDependencies`'te | `npm ci` **`--omit=dev` olmadan** | `node -e "import('typescript').then(()=>console.log('ok'))"` (`control-plane` içinde) |
| `control-plane/node_modules` | Windows'taki kopyada `@esbuild/win32-x64`, `@rollup/rollup-win32-x64-*` gibi yerel dosyalar var (yalnız test/geliştirme araçları) | **kopyalamayın**; Mac'te `npm ci` | `npm ci` çıkış kodu 0 |
| Python | `requires-python >=3.11,<3.14`; Windows'ta 3.13 | `uv` ile 3.13; `.venv` Mac'te yeniden kurulur (`.venv/bin/python`; şablonlar bu yolu bekler) | `.venv/bin/python -c "import platform,sys; print(sys.version, platform.machine())"` |
| `psycopg[binary]` | yalnız `[dependency-groups] dev`'de, ama çalışma anı kodu içe aktarır (`intake/ingest.py`, `ingestion/*`); `uv.lock`'ta `psycopg-binary 3.3.4` için `macosx_11_0_arm64` tekerleği var | `uv sync --group dev` | `.venv/bin/python -c "import psycopg; print(psycopg.__version__)"` |
| Ek paketler | `python-docx`, `defusedxml` (`intake`, `export`), `uvicorn` (`asgi`) | `--extra intake --extra export --extra asgi` | `.venv/bin/python -c "import docx, defusedxml, uvicorn"` |
| `tokenizers 0.23.2` | `uv.lock`'ta **yok**; `requirements-local-embeddings.txt` ile kurulur; arm64 tekerleği varlığı doğrulanmadı | `uv pip install --python .venv/bin/python -r requirements-local-embeddings.txt`; kaynaktan derlemeye düşmediğini çıktıdan görün | `.venv/bin/python -c "import tokenizers, onnxruntime; print(tokenizers.__version__, onnxruntime.__version__)"` |
| E5 model dosyası | `model_qint8_avx512_vnni.onnx` x86 **AVX512-VNNI** için nicemlenmiş bir türevdir; SHA-256 sabitli olduğundan başka dosya yüklenmez. Apple Silicon'da çalışıp çalışmadığı, doğruluğu ve hızı **ölçülmedi** | önce çalıştırıp ölçün; dosya değişecekse `local_embedding_assets.py`'de yeni dosya kaydı ve göç notuna göre **yeni bir profil anahtarı** gerekir (`e5-small-384-v1` değil) — bu bir mimari karardır | [WINDOWS-TO-MAC-MIGRATION.md](WINDOWS-TO-MAC-MIGRATION.md) adım 13 ve 20 |
| Gömme sayısal kayması | saklı `chunk_vectors` Windows x64'te hesaplandı; Mac'te sorgu vektörü arm64'te hesaplanacak. Tazelik vektöre değil **parça metninin** SHA-256'sına bakar; taşınan vektörler "taze" sayılır | taşı ya da yeniden hesapla kararı ölçüme bağlı | taşıma adımı 14 |
| `uvloop` | `uvicorn[standard]` macOS'ta `uvloop` kullanır (`uv.lock`'ta 0.22.1 universal2), Windows'ta kullanmaz | MCP geçidi ve E5 sunucusu için duman testi | taşıma adımı 17 |
| PostgreSQL | Windows kümesi 18.1 (`show server_version` ve `pg_dump --version`, 11.09.2026, salt okunur sorgu). Göçler `pg_trgm`, `pgcrypto`, `btree_gist` eklentilerini ve yerleşik `turkish` metin arama yapılandırmasını ister; pgvector yerelde gerekmez | Homebrew `postgresql@18` (eklentilerin pakette gelmesi beklenir, doğrulanmadı); `pg_restore` sürümü döküm alan `pg_dump`'tan eski olmamalı | taşıma adımı 3'teki SQL |
| Veritabanı rolleri | `authenticated`/`anon` izinleri göçlerde `if exists (… pg_roles …)` koşuluna bağlı; Windows kümesinde bu roller **yok** (11.09.2026, salt okunur sorgu) | ek rol oluşturmayın | `psql … -Atc "select rolname from pg_roles where rolname in ('authenticated','anon')"` → boş |
| Süper kullanıcı adı | kod ve şablonlar `postgres` kullanıcısını varsayar (`serve.mjs` varsayılan DSN, yedek düğmesi kullanıcı vermez, `collex-start.sh` küme denetimi `-U postgres`); Homebrew'un `initdb`'si varsayılanda oturum kullanıcısını süper kullanıcı yapar (çıkarım) | kümeyi `initdb -U postgres` ile kurun | taşıma adımı 3 |
| Veritabanı yerel ayarı | `intake.cli --ensure-db` ve `runRestore` veritabanını `template0`, `UTF8`, `locale 'C'` ile açar; sıralama işletim sisteminden bağımsız | — | taşıma adımı 7 |
| OCR ikilileri | `tesseract` (+ `tur` dil verisi) ve `pdftoppm` `shutil.which` ile `PATH`'ten bulunur | Homebrew `tesseract`, `tesseract-lang`, `poppler` | §8 |
| `playwright` | çekirdek bağımlılık; `uv.lock`'ta `macosx_11_0_arm64` tekerleği var | tarayıcı ikilisi gerektiren bir MCP yolu olup olmadığı bu belgede incelenmedi | duman testi |
| Avukatın gördüğü Windows metinleri | W21 ikinci tur (R2-36): `/v1/health` ve `GET /v1/backup` sunucunun `platform`'unu ve `operatorHints` adlarını (başlatma, durdurma, yedekleme, geri yükleme, Python yolu) döner; Ayarlar › Sistem durumu teknik kutusu ve yedek kartı bu adları kullanır (Mac'te `deploy/macos/collex-*.sh`, klasör için Finder › Git › Klasöre Git; masaüstü kısayolu yalnız Windows'ta anılır). `serve.mjs` açılış iletileri ("veritabanı: ÇALIŞMIYOR", port dolu, ikinci sunucu) de `control-plane/src/platform/operatorHints.ts`'ten geçer. Konsolun başka yerlerinde "ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın" cümlesi hâlâ geçiyor | kalan cümleler için kod değişikliği gerekir (bu belgenin sahibi olmadığı konsol bölümleri) | kısmen kapatıldı (§13) |

## 8. OCR kurulumu (macOS) — DOĞRULANMADI

```bash
brew install tesseract tesseract-lang poppler
```

```bash
tesseract --list-langs
```

Çıktıda `tur` satırı görünmelidir. Sonra ColleX'in kendi algılaması (tek JSON
nesnesi; araç ADLARI verir, yol vermez):

```bash
cd ~/ColleX/app && .venv/bin/python -m intake.ocr --status
```

Beklenen: `"state": "OCR_READY"`. Diğer durumlar: `OCR_DISABLED`
(`COLLEX_OCR=off`), `OCR_EXECUTABLE_MISSING` (tesseract yok),
`OCR_TURKISH_DATA_MISSING` (`tur` yok), `OCR_RASTERIZER_MISSING` (`pdftoppm`
yok), `OCR_FAILED` (algılamanın kendisi hata verdi). `OCR_READY` dışındaki
her durumda taranmış sayfa **OKUNAMADI** kalır ve dosya "tamamı okundu"
sayılmaz. Düşük güvenli OCR sayfası (< 0,60) `SPARSE` kaydedilir
([LOCAL-OCR.md](LOCAL-OCR.md)).

Bu komut terminalin ortamını sınar. Kurulumdan sonra uygulamayı yeniden
başlatın (`launchctl kickstart -k "gui/$(id -u)/com.collex.app"`) ve
**hizmetin** gördüğünü `/v1/health` içindeki `ocr.state` ile okuyun (§5.5).
Hizmet ortamında (launchd) görünürlük için §5.6.

W21'de OCR'ın sınırları (ayrıntı [LOCAL-OCR.md](LOCAL-OCR.md)):

- **Süre.** Bir dosyanın bütün OCR'ı en çok 90 sn sürer (yükleme 180 sn'de
  kesilir); bir sayfa için görüntüye çevirme ve okuma birlikte en çok 120 sn.
  Süreye yetişmeyen sayfalar okunmamış sayılır ve belge uyarısında
  `OCR_BUDGET_EXCEEDED:<n>` görünür; yükleme yine de tamamlanır. 8 GB'lık
  Mac'te sayfa başına gerçek OCR süresi **ölçülmedi**; uzun taranmış ekleri
  parçalara bölerek yükleyin.
- **Görüntü sayfası.** Bir sayfanın en az yarısını birlikte kaplayan
  görüntüler (tek bir tarama ya da şeritlere/karolara bölünmüş bir tarama)
  ve 400 karakterden kısa bir metin katmanı (ör. e-imza doğrulama
  satırı, damga) varsa sayfa metin katmanıyla "okunmuş" sayılmaz: OCR'a
  gönderilir; OCR yoksa `SPARSE` kaydedilir ve `IMAGE_TEXT_PAGES:<n>`
  uyarısı çıkar. Küçük bir logo taşıyan normal sayfalar etkilenmez.
- **Kapalı başarısızlık kodları.** Hiçbir sayfası okunamayan taranmış PDF
  422 ile reddedilir; nedeni `error.warnings` içindeki tek koddur:
  `SCANNED_PDF_NO_OCR` (bu bilgisayarda yerel OCR yok ya da kapalı),
  `SCANNED_PDF_OCR_FAILED` (yerel OCR denendi, hiçbir sayfayı okuyamadı ya da
  süresi yetmedi), `SCANNED_PDF_OCR_NOT_APPLIED` (sayfalarda yalnız birkaç
  karakterlik metin katmanı var; OCR uygulanmadı).

## 9. Yerel model sunucusu (aynı Mac, localhost) — DOĞRULANMADI

Model adı kodda sabit değildir; seçim `evals/bakeoff` ölçümüne bırakılır.
Model dosyasını kendiniz indirip SHA-256 değerini not edin.

**A — llama.cpp `llama-server`** (şablonu olan yol: `com.collex.llm.plist`)

```bash
brew install llama.cpp
```

Elle deneme (launchd'den önce):

```bash
llama-server --model ~/ColleX/models/<model>.gguf --host 127.0.0.1 --port 8080 --ctx-size 8192 --parallel 1
```

**B — Ollama** (şablon yok; kullanılırsa launchd kaydı elle yazılır)

```bash
brew install ollama
```

```bash
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 ollama serve
```

```bash
ollama pull <model>
```

Notlar:

- Sunucu **yalnız `127.0.0.1`**'e bağlanır. `0.0.0.0` ya da yerel ağ adresi
  kullanılmaz. Denetim: `lsof -nP -iTCP:8080 -sTCP:LISTEN` çıktısında adres
  `127.0.0.1:8080` olmalı, `*:8080` olmamalı.
- Loopback güven düzeyi `LOCAL_PROCESS`'tir: `COLLEX_TRUSTED_LOCAL_HOSTS` ve
  `COLLEX_LOCAL_LLM_API_KEY` gerekmez.
- ColleX ayarları (`com.collex.app.plist` `EnvironmentVariables`):
  `COLLEX_LOCAL_LLM_BASE_URL=http://127.0.0.1:8080` (Ollama için
  `http://127.0.0.1:11434`) — **sonunda `/v1` olmadan** (§4.1),
  `COLLEX_LOCAL_LLM_MODEL=<ad>`, `COLLEX_AI_POLICY=LOCAL_ONLY`,
  `COLLEX_DATA_BOUNDARY=LOCAL_ONLY`.
- Model sunucusu hazır mı: `curl -s http://127.0.0.1:8080/v1/models`
  (Ollama: `curl -s http://127.0.0.1:11434/api/ps`).
- Ölçüm (bakım penceresinde, uygulama boştayken; §4.3 kural 1):

```bash
cd ~/ColleX/app && node control-plane/scripts/probe_local_generation.mjs --base-url http://127.0.0.1:8080 --model <model> --runs 20
```

- Sağlıkta beklenen: `aiPolicy.localModel.trust` = `"LOCAL_PROCESS"`,
  `aiPolicy.localModel.usableForMatterAnalysis` = `true`,
  `localAi.liveTested` = `false`.
- Model ulaşılamazsa buluta **düşülmez**: cevap kural tabanlıdır ve bunu söyler;
  dosya incelemesinin model gerektiren işleri yapılmaz ve kapsam eksik
  görünür.

## 10. Ortam değişkenleri ve gizli bilgiler

- `serve.mjs` `.env` okumaz; `collex-env.sh` `COLLEX_NO_DOTENV=1` koyar
  (Windows başlatıcısıyla aynı). launchd işlerinin değerleri plist'lerin
  `EnvironmentVariables` bölümünden gelir; `collex-env.sh` yalnız
  varsayılanları taşır ve gizli bilgi tutmaz.
- **`~/.collex/collex.env` zorunludur (W21).** Terminalde elle çalıştırılan
  `collex-backup.sh`, `collex-restore.sh`, `collex-stop.sh` plist değerlerini
  görmez; `collex-env.sh` aynı değerleri bu dosyadan okur (ortamda zaten
  ayarlı bir değer, ör. plist'inki, önceliklidir). Dosyaya en az
  `com.collex.app.plist`'teki `COLLEX_HOME`, `COLLEX_DATA_DIR`,
  `COLLEX_PGBIN`, `COLLEX_BACKUP_DIR` ve `COLLEX_LOG_DIR` değerleri **aynen**
  yazılır. Kurallar — uyulmayan her satırda betik dosya adını, satır
  numarasını ve nedeni yazıp **durur** (çıkış 64; değeri yazmaz):
  - satır başında `COLLEX_` ile başlayan, yalnız büyük harf, rakam ve alt
    çizgiden oluşan bir ad, `=`, değer (`KEY=değer`); `=` çevresinde boşluk,
    girinti, `export` yok;
  - değer boş olamaz, tırnak içinde yazılmaz, başında/sonunda boşluk olmaz;
    `~` ve `$` açılmaz, **tam yol** yazılır;
  - boş satırlar ve `#` ile başlayan satırlar atlanır; Windows'ta kaydedilmiş
    bir dosyanın satır sonu (CR) atılır;
  - dosyadaki hiçbir şey komut olarak çalıştırılmaz.

```
COLLEX_HOME=/Users/<kullanıcı>/ColleX/app
COLLEX_DATA_DIR=/Users/<kullanıcı>/ColleX/data
COLLEX_PGBIN=/opt/homebrew/opt/postgresql@18/bin
COLLEX_BACKUP_DIR=/Users/<kullanıcı>/ColleX-Yedek
COLLEX_LOG_DIR=/Users/<kullanıcı>/Library/Logs/ColleX
```

  Denetim: `chmod 600 ~/.collex/collex.env`, sonra
  `~/ColleX/app/deploy/macos/collex-backup.sh` çıktısındaki
  "Belge asılları : …/ColleX/data/uploads (COLLEX_DATA_DIR)" satırı.
- Şablonun `com.collex.app.plist` ortamı: `COLLEX_FOREGROUND=1`,
  `COLLEX_HOME`, `COLLEX_DATA_DIR`, `COLLEX_PGBIN`, `COLLEX_PGPORT=55432`,
  `COLLEX_DB_URL`, `COLLEX_BACKUP_DIR`, `COLLEX_LOG_DIR`, `COLLEX_NO_DOTENV=1`,
  `PATH`, `LANG=tr_TR.UTF-8`. Bu belgenin **eklenmesini önerdiği** değerler
  (`COLLEX_PGDATA` bilerek yok; §5.2):

```
COLLEX_AI_POLICY=LOCAL_ONLY
COLLEX_DATA_BOUNDARY=LOCAL_ONLY
COLLEX_LOCAL_LLM_BASE_URL=http://127.0.0.1:8080
COLLEX_LOCAL_LLM_MODEL=<model adı>
COLLEX_LOCAL_LLM_CONCURRENCY=1
COLLEX_OCR=auto
```

- `LOCAL_ONLY` ve loopback model altında yapay zekâ için gizli anahtar
  gerekmez. Bir gizli değer (ör. MCP kaynaklarının isteğe bağlı anahtarları)
  plist'e yazılırsa dosya `chmod 600` yapılır; yedek klasörüne ve günlüklere
  girmez. `docs/security/incident-2026-08-26-embedded-tokens.md` hâlâ açıktır.
- `launchctl print` bir işin ortamını ekrana basar; gizli değer içeren bir
  işte çıktıyı paylaşmayın. Durum için `launchctl list | grep com.collex`
  yeterlidir.

## 11. İşletmecinin düzenli denetimi

1. Sağlık: §5.5 komutu ve beklenen alanlar.
2. Hizmetler: `launchctl list | grep com.collex` — her satırda bir pid ya da
   son çıkış kodu görünür.
3. Veritabanı: `pg_isready -h 127.0.0.1 -p 55432`.
4. Model: `curl -s http://127.0.0.1:8080/v1/models`.
5. OCR hizmet ortamında: önce `/v1/health` → `ocr.state` = `"OCR_READY"`,
   `ocr.source` = `"probe"` (§5.5). Sonra müvekkil belgesi olmayan, taranmış bir
   örnek PDF'yi konsoldan yükleyin; belge uyarılarında `OCR_PAGES:<n>`
   görünmeli, `SCANNED_PDF_NO_OCR` ve "taranmış PDF — OCR bu modda devre dışı"
   görünmemeli; dosyanın `extraction.ocr` değeri `true` olmalı.
6. Yedek: konsolda son yedek tarihi; `node control-plane/scripts/backup.mjs --verify <son klasör>`;
   `~/Library/Logs/ColleX/collex-backup.out.log`'da "Belge asılları : …
   (COLLEX_DATA_DIR)" satırı ve "yedek tamam" (EKSİK ya da DENETLENMEDİ değil);
   `~/Library/Logs/ColleX/collex-backup.err.log`'da `UYARI` satırı olmamalı.
7. Bellek: §3'teki `memory_pressure` ve `sysctl vm.swapusage`.
8. Disk: `df -h ~` — yedekler ve günlükler büyür; otomatik silme yoktur.

## 12. Fiziksel Mac'te doğrulanması gerekenler

Her madde bir komutla kapanır; komut, çıktısı ve tarihi kaydedilmeden madde
kapanmış sayılmaz.

- [ ] `sw_vers -productVersion` ≥ 13 ve `uname -m` = `arm64`.
- [ ] `node --version` ≥ 22.15 (hedef 24) ve `serve.mjs` `registerHooks` ile açılıyor.
- [ ] `npm ci` (`--omit=dev` olmadan) başarılı; `typescript` çalışma anında yükleniyor.
- [ ] `uv sync --python 3.13 --group dev --extra intake --extra export --extra asgi` başarılı; `psycopg`, `docx`, `defusedxml`, `uvicorn` içe aktarılıyor.
- [ ] `tokenizers 0.23.2` hazır arm64 tekerleğiyle kuruldu (kaynaktan derleme yok).
- [ ] `onnxruntime 1.20.1` universal2 tekerleği yüklendi ve çalışıyor.
- [ ] E5 AVX512-VNNI türevi Apple Silicon'da yükleniyor; `probe-local-embedding-port.mjs` `PASS` veriyor; aynı betiğin Windows ve Mac çıktılarındaki benzerlik değerleri kaydedildi ve karşılaştırıldı.
- [ ] Taşınan `chunk_vectors` için karar (taşı ya da yeniden hesapla) verildi ve gerekçesi yazıldı.
- [ ] PostgreSQL 18 `initdb -U postgres -E UTF8 --locale=C` ile kuruldu; `pg_trgm`, `pgcrypto`, `btree_gist` ve `turkish` yapılandırması mevcut.
- [ ] Windows `pg_dump -Fc` dökümü Mac'te `collex-restore.sh` / `backup.mjs --restore` ile hatasız döndü; sayımlar birebir eşit.
- [ ] Belge asılları manifestle SHA-256 düzeyinde eşleşiyor (0 uyumsuz).
- [ ] `intake.cli --ensure-db --list` çıkış 0; göç defteri beklenen dosyaları içeriyor.
- [ ] `/v1/health` §5.5'teki beklenen değerleri veriyor (`ocr.state` = `OCR_READY`, `ocr.source` = `probe` dahil).
- [ ] `scripts/smoke_check.py` 54 aracı doğruluyor; MCP geçidi ve E5 sunucusu `uvloop` altında çalışıyor.
- [ ] Köken (provenance) testleri Mac'te geçti.
- [ ] `brew install tesseract tesseract-lang poppler` sonrası `python -m intake.ocr --status` → `OCR_READY`; `launchctl kickstart -k` sonrası `/v1/health` `ocr.state` → `OCR_READY`; hizmet ortamında taranmış örnek PDF OCR'lanıyor ve bir sayfanın gerçek OCR süresi ölçülüp kaydedildi (90 sn dosya bütçesine kaç sayfa sığdığı).
- [ ] `~/.collex/collex.env` yazıldı; elle `collex-backup.sh` hizmetin `uploads` klasörünü "(COLLEX_DATA_DIR)" olarak yazıyor; dosya silinip betik çalıştırılınca plist farkı yüzünden çıkış 64 ile duruyor.
- [ ] Yerel model yalnız `127.0.0.1`'de dinliyor; `COLLEX_LOCAL_LLM_BASE_URL` sonunda `/v1` yok; `probe_local_generation.mjs` çalıştı ve sonuçları kaydedildi.
- [ ] §3 bellek tablosunun her satırı ölçüldü; model yüklüyken ve tipik bir dosya incelemesi sürerken takas büyümüyor.
- [ ] Bake-off alt kümesi çalıştı (sentetik; hukukî kalite iddiası değildir).
- [ ] launchd: dört plist yer tutucuları doldurularak kuruldu, `plutil -lint` temiz, oturum açılınca başlıyor.
- [ ] `kill -9` ile öldürülen `serve.mjs` 30 sn içinde yeniden başlıyor; yarım dosya incelemesi kaldığı birimden sürüyor.
- [ ] `launchctl bootout gui/$(id -u)/com.collex.app` sonrası pid dosyaları yok (kayıtlar yazıldı).
- [ ] `KeepAlive = true` olan PostgreSQL ve model hizmetleri yalnız `bootout` ile duruyor; `pg_ctl stop` sonrası geri geldikleri gözlendi.
- [ ] Yeniden başlatma (ve FileVault kilidi açıldıktan sonra) bütün hizmetler kendiliğinden geliyor.
- [ ] 19.30 takvimli yedek çalıştı; `--verify` geçti; `collex_restore_drill`'e deneme geri yüklemesi yapıldı.
- [ ] `collex-restore.sh` tatbikatla sınandı (eski veritabanı `<ad>_eski_<tarih>` olarak kaldı, güvenlik dökümü yazıldı, asıllar yerinde yeniden doğrulandı).
- [ ] Yedek şifreli harici diske kopyalandı ve orada `--verify` geçti.
- [ ] newsyslog kuralı yüklü (`sudo newsyslog -nv`); döndürme sonrası davranış gözlendi.
- [ ] Depo yolu ASCII; hiçbir betik ASCII dışı yol yüzünden bozulmuyor.
- [ ] Oturum açılışında PostgreSQL'i yalnız `com.collex.postgres` açıyor (`ps -axo pid,ppid,command | grep '[p]ostgres -D'` çıktısındaki ana sürecin üst süreci `launchd`, yani ppid 1); `com.collex.postgres` 30 sn'de bir düşmüyor.

## 13. Bilinen boşluklar ve bulgular

| Konu | Durum |
|---|---|
| **Küme sahipliği yarışı** | `com.collex.app.plist`'e `COLLEX_PGDATA` yazılırsa, oturum açılışında `collex-start.sh` kümeyi `pg_ctl` ile `com.collex.postgres`'ten önce açabilir; küme gözetimsiz kalır, launchd işi her 30 sn düşer (kod okumasından çıkarım, gözlenmedi). Bu belge `COLLEX_PGDATA`'yı app plist'ine yazmamayı önerir (§5.2). W21'de platform şeridine/orkestratöre bildirildi |
| **Şablon yorumlarındaki model adresi** | `com.collex.app.plist` ve `com.collex.llm.plist` yorumları `COLLEX_LOCAL_LLM_BASE_URL = http://127.0.0.1:8080/v1` der; kod bu adrese `/v1/chat/completions` eklediği için istek `/v1/v1/chat/completions`'a gider. Doğru değer `http://127.0.0.1:8080`. W21'de düzeltildi: iki şablonun yorumu artık `http://127.0.0.1:8080` der (sonunda `/v1` yok) |
| Askıda kalan süreç için bekçi | yok, planlanmadı |
| `/v1/health`'te OCR bloğu | W21'de bağlı: `serve.mjs` açılışta `createOcrStatusProbe` ile yoklar, `control-plane/src/api/server.ts` `ocr` alanında döner; süreç başına bir yoklama (§5.5). Mac'te gözlenmedi |
| Elle çalıştırılan yedek/geri yüklemenin veri klasörü | W21'de kapatıldı: `~/.collex/collex.env` zorunlu (§10), betikler klasörü yazar ve plist farkında durur, `backup.mjs` eksik/yanlış klasörü reddeder |
| OCR'ın gerçek sayfa süresi (M2, 8 GB) | ölçülmedi; dosya başına 90 sn bütçe tahmine dayanır (§8) |
| Şablonlarda `ExitTimeOut` ve günlük döndürme | yok; §5.4, §5.7 |
| Ollama için launchd şablonu | yok; yalnız llama.cpp |
| İşçi parti boyları için ortam değişkeni | yok, planlanmadı (§4.2) |
| E5 model dizininin `COLLEX_DATA_DIR`'ı izlemesi | yok |
| Yedek düğmesinin veritabanı sunucusu ve kullanıcısını ayarlaması | `serve.mjs` yedek portu `host`/`user` vermez → `127.0.0.1` ve `postgres` |
| Yedek manifestinde PostgreSQL sürümü, göç defteri, uygulama `VERSION`'ı | yok ([BACKUP-RESTORE.md](BACKUP-RESTORE.md) §5'te elle not) |
| `var/library` kuyruğunun yedeklenmesi | yok ([BACKUP-RESTORE.md](BACKUP-RESTORE.md) §1) |
| Model eşzamanlılık sınırının süreçler arası geçerliliği | yok; sınır süreç içidir (§4.3) |
| Tek başına kalan ve her seferinde düşen model isteği | W21 ikinci turda sınırlandı, kapatılmadı (§5.3): başka model işi yokken modelin mi isteğin mi sorunlu olduğu ayırt edilemez; zaman aşımında yaklaşık 15 dakika, ulaşılamamada 30 dakikalık kesinti penceresi boyunca yeniden denenir, sonra iş başarısız sayılır ve inceleme eksik kapanır. İşin geçmişi süreç belleğindedir; yeniden başlayan süreçte o iş bir kez daha bekletilir. Model sunucusunun sağlık yoklaması bu kararda kullanılmıyor |
| Avukatın gördüğü Windows'a özgü metinler | W21 ikinci turda sistem durumu, yedek kartı ve `serve.mjs` açılış iletileri platforma göre yazılıyor (§7). Konsolun hata ve rozet cümlelerindeki "masaüstündeki ColleX simgesine yeniden çift tıklayın" önerisi duruyor |
