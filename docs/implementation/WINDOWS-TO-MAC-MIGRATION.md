# Windows'tan Mac mini'ye taşıma — 26 adım (W21)

> **Durum (11.09.2026): FİZİKSEL MAC'TE DOĞRULANMADI.** Bu yol haritasının
> hiçbir Mac adımı çalıştırılmadı. Windows adımları bugünkü araçları kullanır.
> Hiçbir süre, hız veya bellek sayısı yazılmadı; ölçen adımlar sonucu
> kaydeder, sonuç `docs/implementation/STATUS.md`'ye ancak ölçüldükten sonra
> girer. Mac adımları platform şeridinin W21'de yazdığı `deploy/macos/*`
> şablonlarını ve `backup.mjs --restore`'u kullanır; bu belge onları
> 11.09.2026'da okuyarak yazıldı ve onlar da doğrulanmadı.

Hedef tasarım: [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md). Yedek ve geri
yükleme ayrıntısı: [BACKUP-RESTORE.md](BACKUP-RESTORE.md).

## Nasıl kullanılır

- **Önce prova, sonra kesinti.** 1–25. adımlar önce bir **prova** olarak
  yapılır; avukat bu sırada Windows'u kullanmaya devam eder. Prova temiz
  bittikten sonra **kesinti günü** 7, 8, 14, 15, 16, 17, 21.1 ve 25. adımlar taze bir
  yedekle yeniden yapılır (provada Mac'te oluşan `collex_local` önce
  kaldırılır: `dropdb -h 127.0.0.1 -p 55432 -U postgres collex_local`; içinde
  yalnız prova verisi vardır). 26. adım yalnız kesintiden sonra.
- Her adımın **Doğrulama** satırı geçmeden bir sonraki adıma geçilmez.
  Komut, çıktı ve tarih bir taşıma günlüğüne yazılır (müvekkil adı ve belge
  içeriği yazılmaz; sayımlar ve hash'ler yeterlidir).
- **Geri alma** satırı o adımı nasıl geri alacağınızı söyler. Windows,
  26. adıma kadar gerçek verinin tek sahibidir; hiçbir adım Windows'taki
  veriyi değiştirmez.
- Mac komutları bash (zsh) içindir; Windows komutları PowerShell içindir.

### Değişkenler

Mac (her yeni terminalde; `COLLEX_*` adları şablonların okuduğu adlardır):

```bash
export APP="$HOME/ColleX/app"
export COLLEX_HOME="$APP"
export COLLEX_DATA_DIR="$HOME/ColleX/data"
export COLLEX_PGDATA="$HOME/ColleX/pgdata"
export COLLEX_BACKUP_DIR="$HOME/ColleX-Yedek"
export COLLEX_LOG_DIR="$HOME/Library/Logs/ColleX"
export COLLEX_PGBIN="$(brew --prefix postgresql@18)/bin"
export PATH="$COLLEX_PGBIN:/opt/homebrew/bin:$PATH"
export DSN="postgres://postgres@127.0.0.1:55432/collex_local"
export TASIMA="/Volumes/<şifreli-disk>/ColleX-Tasima"
```

(`brew` 2. adımdan, `postgresql@18` 3. adımdan sonra vardır; o adımlara kadar
yalnız ilgili satırları kullanın. 7. adımda tanımlanan `Y` ve `DUMP`
8. ve 14. adımlarda da kullanılır; yeni bir terminalde yeniden tanımlayın.
Dil modeli ve politika değişkenleri 9. adımda eklenir.)

Windows:

```powershell
$REPO = "<depo yolu>"          # yargi-mcp-independent klasörü
$PGROOT = "$env:USERPROFILE\scoop\apps\postgresql\current"
$PGBIN = "$PGROOT\bin"
$TASIMA = "E:\ColleX-Tasima"    # şifreli harici disk (BitLocker To Go)
```

Sayım sorgusu `sayim.sql`: [BACKUP-RESTORE.md](BACKUP-RESTORE.md) §4.2'deki
metni `$TASIMA\sayim.sql` olarak kaydedin. Asıl karşılaştırma parçası
`asil_karsilastir.py`: aynı belgenin §4.3'ündeki metni `$TASIMA` içine kaydedin.

---

## 1. Temiz kaynak anlık görüntüsünü doğrula

**Amaç:** Mac'e giden kodun bilinen, sabit bir commit olması; içinde gizli bilgi
ve veri olmaması. Uygulama ana dalın çalışma kopyasında izlenmez; kaynak
`collex/*-snapshot` dallarındadır (bugün en yenisi `collex/w20-snapshot`; W21
kapanışında yenisini almak orkestratörün işidir — üretim için **en yeni**
anlık görüntü kullanılır; `deploy/macos/` ve `backup.mjs --restore` W21'e
aittir, W20 anlık görüntüsünde yoktur).

**Komut (Windows):**

```powershell
git -C $REPO branch --list "collex/*"
git -C $REPO log -1 --format="%H %ci %s" collex/<dal>
git -C $REPO ls-tree -r --name-only collex/<dal> | Select-String -Pattern '(^|/)\.env$|^var/|(^|/)\.venv/|node_modules/'
git -C $REPO ls-tree -r --name-only collex/<dal> | Select-String -Pattern '^deploy/macos/'
git -C $REPO bundle create "$TASIMA\collex-kaynak.bundle" collex/<dal>
git -C $REPO bundle verify "$TASIMA\collex-kaynak.bundle"
git -C $REPO rev-parse collex/<dal> | Out-File -Encoding ascii "$TASIMA\kaynak-commit.txt"
Get-FileHash -Algorithm SHA256 "$TASIMA\collex-kaynak.bundle"
```

**Komut (Mac):**

```bash
shasum -a 256 "$TASIMA/collex-kaynak.bundle"
mkdir -p "$HOME/ColleX"
git clone --branch collex/<dal> "$TASIMA/collex-kaynak.bundle" "$APP"
git -C "$APP" rev-parse HEAD
tr -d '\r' < "$TASIMA/kaynak-commit.txt"
```

**Doğrulama:** ilk `Select-String` satırı **boş** (dalda `.env`, `var/`,
`.venv/`, `node_modules/` yok; `collex/w20-snapshot` için 11.09.2026'da boş
çıktı); ikincisi `deploy/macos/` dosyalarını listeler (listelemiyorsa bu dal
Mac için yeterli değildir); `bundle verify` "okay" der; iki SHA-256 aynı;
Mac'teki `HEAD` = `kaynak-commit.txt`. `control-plane/package-lock.json` dalda
bulunur (`npm ci` için gerekli).

**Geri alma:** Windows'ta değişen bir şey yok. Mac'te `rm -rf "$APP"`.

## 2. Apple Silicon temel bağımlılıkları

**Amaç:** Doğru makine ve temel araçlar.

**Komut (Mac):**

```bash
sw_vers -productVersion
uname -m
xcode-select --install
fdesetup status
```

Homebrew'u [brew.sh](https://brew.sh) sayfasındaki resmi komutla kurun, sonra:

```bash
brew --prefix
```

Güç ayarları: [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §5.9
(`pmset`).

**Doğrulama:** macOS ≥ 13 (`onnxruntime 1.20.1` tekerleği `macosx_13_0`);
`arm64`; `FileVault is On.`; `brew --prefix` → `/opt/homebrew`.

**Geri alma:** gerekmez (Homebrew kaldırılabilir; veri yok).

## 3. PostgreSQL

**Amaç:** Windows'la aynı ana sürümde (18), aynı portta (55432), yalnız
loopback'te, süper kullanıcısı `postgres` olan bir küme. `brew services start
postgresql@18` **kullanılmaz**: o, Homebrew'un kendi veri dizinini, 5432
portunu ve oturum kullanıcısını kullanır. launchd kaydı 23. adımda; o zamana
kadar küme elle açılır.

**Komut (Mac):**

```bash
brew install postgresql@18
"$COLLEX_PGBIN/postgres" --version
mkdir -p "$COLLEX_LOG_DIR"
"$COLLEX_PGBIN/initdb" -D "$COLLEX_PGDATA" -U postgres -E UTF8 --locale=C
"$COLLEX_PGBIN/pg_ctl" -D "$COLLEX_PGDATA" -o "-p 55432 -c listen_addresses=127.0.0.1" -l "$COLLEX_LOG_DIR/collex-postgres.log" -w start
```

**Doğrulama:**

```bash
pg_isready -h 127.0.0.1 -p 55432
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atc "show server_version"
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atc "select name from pg_available_extensions where name in ('pg_trgm','pgcrypto','btree_gist') order by 1"
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atc "select cfgname from pg_ts_config where cfgname = 'turkish'"
lsof -nP -iTCP:55432 -sTCP:LISTEN
```

Beklenen: `accepting connections`; sürüm 18.x ve Windows'taki 18.1'den eski
değil; üç eklenti adı; `turkish`; dinleyen adres `127.0.0.1:55432`.

Not: `initdb`'nin varsayılanı yerel bağlantılara parolasız (trust) izin
verir; Windows kurulumu da parolasızdır (RUNBOOK §4.1). Bu, Mac'teki her
yerel sürecin veritabanına bağlanabileceği anlamına gelir. Parolayla
sertleştirme planlanmadı ve kodun ve şablonların bağlantı dizeleri
parolasızdır.

**Geri alma:** `pg_ctl -D "$COLLEX_PGDATA" stop`, sonra `rm -rf "$COLLEX_PGDATA"`
(yalnız bu adımda, küme boşken).

## 4. Node.js

**Amaç:** `registerHooks` destekleyen Node ve çalışma anında gereken
`typescript` dahil bağımlılıklar.

**Komut (Mac):** Node 24 LTS'i nodejs.org'un macOS kurulum paketiyle (ya da
Homebrew'dan 24 serisiyle) kurun, sonra:

```bash
node --version
node -p process.arch
cd "$APP/control-plane" && npm ci
node -e "import('typescript').then(() => console.log('typescript: ok'))"
```

`npm ci --omit=dev` **kullanılmaz**: `ts-loader.mjs` `typescript`'i çalışma
anında içe aktarır. Şablonlar `node`'u `COLLEX_NODE`, `PATH`, sonra
`/opt/homebrew/bin/node` ve `/usr/local/bin/node` sırasıyla arar.

**Doğrulama:** sürüm ≥ 22.15 (hedef 24); `arm64`; `npm ci` çıkış 0;
`typescript: ok`.

**Geri alma:** `rm -rf "$APP/control-plane/node_modules"`.

## 5. Python ve uv

**Amaç:** Mac'te sıfırdan kurulmuş `.venv` (Windows'taki kopyalanmaz). Şablonlar
yorumlayıcıyı `<COLLEX_HOME>/.venv/bin/python` olarak bekler.

**Komut (Mac):**

```bash
brew install uv
uv python install 3.13
cd "$APP" && uv sync --python 3.13 --group dev --extra intake --extra export --extra asgi
cd "$APP" && uv pip install --python .venv/bin/python -r requirements-local-embeddings.txt
```

`--group dev` şarttır: `psycopg[binary]` yalnız o grupta ama çalışma anı kodu
onu kullanır. Kurulumdan sonra yorumlayıcıyı doğrudan çağırın
(`.venv/bin/python`); `uv run` paketleri yeniden eşitleyip kaldırabilir
(RUNBOOK §1).

**Doğrulama:**

```bash
cd "$APP" && .venv/bin/python -c "import platform, sys, psycopg, docx, defusedxml, uvicorn, onnxruntime, tokenizers; print(sys.version.split()[0], platform.machine(), onnxruntime.__version__, tokenizers.__version__)"
```

Beklenen: `3.13.x arm64 1.20.1 0.23.2`. `uv pip install` çıktısında
`tokenizers`'ın kaynaktan derlendiğine dair bir satır olmamalı (arm64 tekerleği
doğrulanmadı).

**Geri alma:** `rm -rf "$APP/.venv"`.

## 6. Veri dizinleri

**Amaç:** [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §6 düzeni.

**Komut (Mac):**

```bash
mkdir -p "$COLLEX_DATA_DIR/uploads" "$COLLEX_DATA_DIR/library" "$HOME/ColleX/models" "$COLLEX_LOG_DIR" "$COLLEX_BACKUP_DIR"
chmod 700 "$HOME/ColleX" "$COLLEX_BACKUP_DIR"
tmutil addexclusion "$COLLEX_PGDATA"
```

**Doğrulama:** `ls -la "$HOME/ColleX"` (sahibi siz, izin `drwx------`);
`tmutil isexcluded "$COLLEX_PGDATA"` → `[Excluded]`.

**Geri alma:** boş dizinleri silin.

## 7. PostgreSQL verisini taşı (`pg_dump` / `pg_restore`)

**Amaç:** Windows'taki `collex_local`'ın tutarlı dökümünü Mac'e hatasız ve
eksiksiz geri yüklemek.

**Komut (Windows):**

1. Avukata bildirin: bu andan sonra Windows'ta ColleX'e **yazılmaz** (dondurma).
   Provada bu gerekmez; kesinti gününde gerekir.
2. `ColleX-Durdur.cmd`'yi çalıştırın (uygulamayı nazikçe, sonra veritabanını durdurur).
3. Yalnız veritabanını açın:

```powershell
& "$PGBIN\pg_ctl.exe" -D "$PGROOT\data" -o "-p 55432 -c listen_addresses=127.0.0.1" -l "$env:TEMP\collex-postgres.log" -w start
```

4. Yedek, doğrulama ve kaynak kayıtları:

```powershell
cd $REPO
.\ColleX-Yedekle.cmd "$TASIMA\yedek"
node control-plane\scripts\backup.mjs --verify "$TASIMA\yedek\<klasör>"
& "$PGBIN\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d collex_local -At -f "$TASIMA\sayim.sql" | Out-File -Encoding ascii "$TASIMA\kaynak-sayim.txt"
& "$PGBIN\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d collex_local -Atc "select filename from app_private.schema_migrations order by 1" | Out-File -Encoding ascii "$TASIMA\kaynak-migrasyon.txt"
& "$PGBIN\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d collex_local -Atc "select profile_key, count(*) from app_private.chunk_vectors group by 1 order by 1" | Out-File -Encoding ascii "$TASIMA\kaynak-vektor.txt"
& "$PGBIN\pg_dump.exe" --version | Out-File -Encoding ascii "$TASIMA\kaynak-surum.txt"
& "$PGBIN\pg_ctl.exe" -D "$PGROOT\data" -m fast -w stop
```

**Komut (Mac):** ColleX sunucusu henüz hiç çalışmadı, PostgreSQL 3. adımdan
beri açık — `collex-restore.sh`'nin iki önkoşulu karşılanıyor. Mac'te henüz
`collex_local` olmadığı için güvenlik dökümü ve kenara alma adımları atlanır.

```bash
Y="$TASIMA/yedek/<klasör>"
cd "$APP" && node control-plane/scripts/backup.mjs --verify "$Y"
DUMP="$(node control-plane/scripts/backup.mjs --dump-name "$Y")"
pg_restore --version
"$APP/deploy/macos/collex-restore.sh" "$Y"
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -At -f "$TASIMA/sayim.sql" > "$TASIMA/hedef-sayim.txt"
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -Atc "select filename from app_private.schema_migrations order by 1" > "$TASIMA/hedef-migrasyon.txt"
tr -d '\r' < "$TASIMA/kaynak-sayim.txt" | diff - "$TASIMA/hedef-sayim.txt" && echo "SAYIMLAR ESIT"
tr -d '\r' < "$TASIMA/kaynak-migrasyon.txt" | diff - "$TASIMA/hedef-migrasyon.txt" && echo "DEFTER ESIT"
```

`collex-restore.sh` `EVET` yazılmasını ister; `backup.mjs --restore`'u çağırır:
yedeği yeniden doğrular, `template0`/`UTF8`/`locale 'C'` ile boş
`collex_local` açar, `pg_restore --no-owner --no-privileges --exit-on-error`
çalıştırır, belge asıllarını `COLLEX_DATA_DIR/uploads`'a birleştirir ve her
aslı yerinde yeniden doğrular. Sarmalayıcı çalışmazsa elle eşdeğer:
`createdb -h 127.0.0.1 -p 55432 -U postgres -T template0 -E UTF8 --locale=C collex_local`
ve `pg_restore -h 127.0.0.1 -p 55432 -U postgres -d collex_local --no-owner --no-privileges --exit-on-error "$Y/$DUMP"`
(o zaman asılları 8. adımda `rsync -a --ignore-existing "$Y/uploads/" "$COLLEX_DATA_DIR/uploads/"` ile kopyalayın).

`collex-restore.sh` önce belge asıllarının klasörünü yazar
(`Belge asılları : <COLLEX_DATA_DIR>/uploads (COLLEX_DATA_DIR)`); 6. adımda
açılan `$COLLEX_DATA_DIR/uploads` yoksa geri yükleme hiçbir şeyi değiştirmeden
reddedilir (W21: yanlış veri klasörü belirtisi). Kurulu bir
`com.collex.app.plist` başka bir veri klasörü gösteriyorsa betik durur
(çıkış 64).

**Doğrulama:** iki `--verify` de çıkış 0 ve cümleleri
`Yedek doğrulandı: <N> dosyanın tamamı eksiksiz.` (W21: "…eksiksiz sayılamaz
(EKSİK|DENETLENMEDİ)" diyorsa yedek bütün asılları içermiyor ya da
veritabanına karşı denetlenmemiş demektir — taşımayı durdurup Windows'ta yeni
bir yedek alın); `pg_restore --version` ≥ `kaynak-surum.txt`'deki sürüm;
`collex-restore.sh` çıkış 0, çıktısında
`Belge asılları : …/ColleX/data/uploads (COLLEX_DATA_DIR)`,
`veritabanının andığı belge aslı: <M> (klasörde olmayan: 0)` ve
`Geri yükleme tamam: collex_local yedekten geri yüklendi; <N> belge aslının
tamamı <$COLLEX_DATA_DIR/uploads> içinde yerinde doğrulandı ve geri yüklenen
veritabanının andığı <M> belge aslının hepsi orada.` satırları var ve son
satırı `Geri yükleme tamam. collex-start.sh ile açıp kontrol edin.`;
`SAYIMLAR ESIT` ve `DEFTER ESIT`. `collex-restore.sh` çıkış 1 (asıllar EKSİK)
ya da 3 (asıllar DENETLENEMEDİ) verirse veritabanı geri yüklenmiş olsa bile
taşıma başarılı sayılmaz.

**Geri alma:** Mac'te `dropdb -h 127.0.0.1 -p 55432 -U postgres collex_local`
ve `COLLEX_DATA_DIR/uploads` içeriğini silin (bu adımdan önce boştu).
Windows'ta hiçbir şey değişmedi; `ColleX-Baslat.cmd` ile kullanıma dönülür
(kesinti gününde bu, dondurmanın kalkması demektir).

## 8. Belge asıllarını bütünlük denetimiyle kopyala

**Amaç:** Asılların Mac'teki veri dizinine SHA-256 düzeyinde eksiksiz geldiğini
geri yükleme aracından **bağımsız** bir denetimle göstermek; yedeğin parçası
olmayan kütüphane kuyruğunu taşımak.

**Komut (Windows)** — kütüphane kuyruğu (`COLLEX_DATA_DIR` ayarlıysa `var`
yerine o):

```powershell
robocopy "$REPO\var\library" "$TASIMA\library" /E
(Get-ChildItem -Recurse -File "$REPO\var\library").Count
```

**Komut (Mac):**

```bash
cd "$APP" && .venv/bin/python "$TASIMA/asil_karsilastir.py" "$Y" "$COLLEX_DATA_DIR/uploads"
rsync -a --ignore-existing "$TASIMA/library/" "$COLLEX_DATA_DIR/library/"
find "$COLLEX_DATA_DIR/library" -type f | wc -l
```

**Doğrulama:** `uyumsuz: 0`, çıkış 0; kütüphane dosya sayısı Windows'takiyle
aynı (kütüphanenin SHA-256 manifesti yoktur — bilinen boşluk).

**Geri alma:** Mac'te `$COLLEX_DATA_DIR/library` içeriğini silin (hedef bu
adımdan önce boştu).

## 9. Ortam değişkenleri ve gizli bilgiler

**Amaç:** Mac'te ColleX'in doğru ayarlarla açılması; gizli değerlerin hiçbir
yere basılmaması.

**Komut:** Elle adımlar (10–22) için aynı terminalde, "Değişkenler"deki
satırlara ek olarak:

```bash
export COLLEX_AI_POLICY=LOCAL_ONLY
export COLLEX_DATA_BOUNDARY=LOCAL_ONLY
export COLLEX_LOCAL_LLM_BASE_URL=http://127.0.0.1:8080
export COLLEX_LOCAL_LLM_MODEL=<model adı>
export COLLEX_LOCAL_LLM_CONCURRENCY=1
export COLLEX_OCR=auto
```

`COLLEX_LOCAL_LLM_BASE_URL` **sonunda `/v1` olmadan** yazılır: bağdaştırıcı
`/v1/chat/completions`'ı kendisi ekler. Şablon yorumlarındaki
`http://127.0.0.1:8080/v1` biçimi çift `/v1` üretir
([MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §13). Aynı değerler 23.
adımda `com.collex.app.plist`'in `EnvironmentVariables` bölümüne girer.
Windows'taki `.env` **olduğu gibi kopyalanmaz** (ColleX onu okumaz);
gerekiyorsa `.env.example`'daki ADLARA bakarak tek tek, ekrana basmadan yazın.
Gizli bir değeri sohbet, e-posta ya da ekran görüntüsüyle taşımayın. Plist'e
gizli değer yazılırsa dosyayı `chmod 600` yapın.

**Doğrulama:** 16. adımda `/v1/health` (`aiPolicy.policy`, `dataBoundary`,
`localAi.state`, `uploadsDir`). `launchctl print` ya da `env` çıktısını
paylaşmayın; gizli değer basar.

**Geri alma:** değişkenleri kaldırın (`unset`).

## 10. Yerel çıkarım çalışma ortamı

**Amaç:** Model sunucusunun (şablonu olan yol: llama.cpp) kurulması.

**Komut (Mac):**

```bash
brew install llama.cpp
llama-server --version
echo "$(brew --prefix llama.cpp)/bin/llama-server"
```

Son satır, 23. adımda `com.collex.llm.plist`'teki `__LLAMA_SERVER__` yer
tutucusunun değeridir.

**Doğrulama:** sürüm satırı basılıyor. Dinleme adresi 11. adımda denetlenir.

**Geri alma:** `brew uninstall llama.cpp`.

## 11. Model

**Amaç:** Bake-off'ta aday olan modelin Mac'e bilinen bir dosya olarak gelmesi.
Model seçimi bu belgenin işi değildir (`evals/bakeoff`); 8 GB bütçesi için
[MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §3.

**Komut (Mac):** GGUF dosyasını kendiniz indirip `~/ColleX/models/` altına
koyun, sonra (şablonla aynı bayraklarla, elle):

```bash
shasum -a 256 "$HOME/ColleX/models/<model>.gguf"
llama-server --model "$HOME/ColleX/models/<model>.gguf" --host 127.0.0.1 --port 8080 --ctx-size 8192 --parallel 1
```

İkinci terminalde:

```bash
curl -s http://127.0.0.1:8080/v1/models
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

**Doğrulama:** SHA-256 yayıncının değeriyle aynı ve yapılandırma notuna yazıldı;
`/v1/models` modeli listeliyor ve oradaki model adı `COLLEX_LOCAL_LLM_MODEL`
ile aynı; dinleyen adres `127.0.0.1:8080` (asla `*:8080`); llama.cpp başlangıç
çıktısındaki bellek satırları kaydedildi (ölçüm; tahmin değil).

**Geri alma:** sunucuyu Ctrl+C ile durdurun, dosyayı silin.

## 12. OCR ve Türkçe dil verisi

**Komut (Mac):**

```bash
brew install tesseract tesseract-lang poppler
tesseract --list-langs
pdftoppm -v
```

**Doğrulama:** dil listesinde `tur`; `pdftoppm` sürüm satırı basıyor. ColleX'in
kendi algılaması 21. adımda.

**Geri alma:** `brew uninstall tesseract-lang tesseract poppler`.

## 13. Gömme çalışma ortamı denetimi

**Amaç:** E5 modelinin (x86 AVX512-VNNI türevi) Apple Silicon'da yüklenip
sözleşmeyi karşılaması ve Windows ile karşılaştırmalı bir kayıt.

**Komut (Mac):** modeli indirin (boyut ve SHA-256 denetimli; ağ gerekir) ya da
Windows'taki `var\models\multilingual-e5-small` klasörünü kopyalayın (dosyalar
açılırken yine SHA-256 ile denetlenir):

```bash
cd "$APP" && .venv/bin/python scripts/prepare_local_embeddings.py
cd "$APP" && .venv/bin/python -m semantic_search.local_embedding_server --port 8898
```

İkinci terminalde (uygulama henüz çalışmıyor, 8898 boş olmalı; betik bu portu
sabit kullanır):

```bash
curl -s http://127.0.0.1:8898/health
cd "$APP" && node control-plane/scripts/probe-local-embedding-port.mjs
```

**Komut (Windows, karşılaştırma için; ColleX durdurulmuşken):**

```powershell
.venv\Scripts\python.exe -m semantic_search.local_embedding_server --port 8898
node control-plane\scripts\probe-local-embedding-port.mjs
```

**Doğrulama:** `/health` → `status: ready`, `dimension: 384`, `local: true`;
betik `"status":"PASS"` basıyor. İki makinedeki `similarities` değerleri
yan yana kaydedildi. Kabul eşiği **belirlenmedi**; fark 14. adımdaki kararın
girdisidir.

**Geri alma:** sunucuyu Ctrl+C ile durdurun; `rm -rf "$APP/var/models/multilingual-e5-small"`.

## 14. Yoğun (dense) dizin: taşı ya da yeniden hesapla

**Amaç:** `chunk_vectors` için bilinçli bir karar. Vektörler 7. adımda dökümle
geldi. Tazelik parça metninin SHA-256'sına bakar, vektörün kendisine bakmaz;
Windows'ta hesaplanmış vektörler Mac'te "taze" sayılır, ama sorgu vektörü artık
arm64'te hesaplanır.

**Öneri:** 13. adım `PASS` verdiyse **yeniden hesaplayın**; böylece dizin ve
sorgu aynı çalışma ortamından gelir ve belirsiz bir karışım sessizce
kesinliğe dönüşmez. Bedeli CPU süresidir (ölçülmedi); bakım penceresinde
yapın. Taşımayı seçerseniz gerekçesini ve 13. adımdaki karşılaştırmayı taşıma
günlüğüne yazın.

**Komut (Mac, yeniden hesaplama):**

```bash
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -Atc "select profile_key, count(*) from app_private.chunk_vectors group by 1 order by 1"
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -c "delete from app_private.chunk_vectors where profile_key = 'e5-small-384-v1';"
```

Uygulama 16. adımda açıldığında `EmbeddingWorker` eksik vektörleri kendiliğinden
doldurur (eksik olanı veritabanından okur; yeniden başlatmaya dayanıklıdır).

**Doğrulama:** ilk sorgu `kaynak-vektor.txt` ile aynı (taşıma doğru geldi);
yeniden hesaplamadan sonra 20. adımda `dense.state` = `ACTIVE` ve vektör sayısı
yeniden kaynak sayısına ulaştı.

**Geri alma (sınanmadı):** kısmi vektörleri yeniden silip dökümden yalnız bu
tablonun verisini geri yükleyin:

```bash
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -c "delete from app_private.chunk_vectors where profile_key = 'e5-small-384-v1';"
pg_restore -h 127.0.0.1 -p 55432 -U postgres -d collex_local --data-only --schema=app_private --table=chunk_vectors --exit-on-error "$Y/$DUMP"
```

## 15. Veritabanı göçleri (`intake.cli --ensure-db`)

**Amaç:** Anlık görüntüdeki kodun beklediği bütün göçlerin uygulanmış olması;
getirilen kararların yayımlanması. (`collex-start.sh` ikisini her açılışta da
yapar; burada ayrı çalıştırılır ki sonuç ayrı görülsün.)

**Komut (Mac):**

```bash
cd "$APP" && .venv/bin/python -m intake.cli --dsn "$DSN" --ensure-db --list
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -Atc "select filename from app_private.schema_migrations order by 1" > "$TASIMA/hedef-migrasyon-2.txt"
diff "$TASIMA/hedef-migrasyon.txt" "$TASIMA/hedef-migrasyon-2.txt"
ls "$APP/supabase/migrations"
cd "$APP" && .venv/bin/python -m ingestion.cli --dsn "$DSN" --publish-library "$COLLEX_DATA_DIR/library"
```

`--list` yüklü belgelerin adlarını terminale basar; çıktıyı paylaşmayın.

**Doğrulama:** `--ensure-db` çıkış 0 (yalnız oluşturur, asla silmez);
`diff` yalnız **eklenen** satırlar gösterir (anlık görüntü Windows verisinden
yeniyse uygulanan göçler), silinen satır göstermez; defterdeki her dosya
`supabase/migrations` içinde var (pgvector göçleri yerelde bilerek
uygulanmaz); yayımlama çıkış 0.

**Geri alma:** göçler yalnız ileri gider. Geri almak için `dropdb` ve 7. adımı
yeniden yapın.

## 16. Sağlık

**Komut (Mac):** 9. adımdaki değişkenler `export` edilmişken ürünün kendi
başlatıcısıyla (arka planda açar, sağlık 200 olana kadar en çok 60 sn bekler,
tarayıcıyı açar):

```bash
"$APP/deploy/macos/collex-start.sh"
curl -fsS http://127.0.0.1:8787/v1/health | "$APP/.venv/bin/python" -m json.tool
```

**Doğrulama:** başlatıcı "Hazır." yazar; [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md)
§5.5'teki beklenen değerler; özellikle `dbName` = `collex_local`, `migrations`
eksiksiz, `rls` beklenen sayıda, `uploadsDir` = `$COLLEX_DATA_DIR/uploads`,
`aiPolicy.policy` = `LOCAL_ONLY`, `dataBoundary` = `LOCAL_ONLY`,
`localAi.state` = `configured` ve güveni `LOCAL_PROCESS`.
`$COLLEX_LOG_DIR/collex-server.log` içinde `kayıt  : kalıcı` satırı (bellek içi
değil).

**Geri alma:** `"$APP/deploy/macos/collex-stop.sh" --keep-db` (nazik durdurma;
veritabanı açık kalır; pid dosyaları silinir).

## 17. Duman testi

**Komut (Mac):** uygulama 16. adımdan beri açık.

```bash
cd "$APP" && .venv/bin/python scripts/smoke_check.py
```

Konsolda (aynı Mac'teki tarayıcı, `http://127.0.0.1:8787/`): dosya listesi,
bir dosya, bir belge; "Aslını indir" ile inen dosyanın SHA-256'sı:

```bash
shasum -a 256 "$HOME/Downloads/<inen dosya>"
```

Değer, `yedek.json`'daki o belgenin `sha256` alanıyla aynı olmalıdır.
Uçtan uca demo isteğe bağlıdır ve kendi veritabanını (`collex_demo`) kullanır,
`collex_local`'a dokunmaz:

```bash
cd "$APP" && node control-plane/scripts/demo.mjs
```

**Doğrulama:** `smoke_check.py` çıkış 0 (54 araç; STATUS S4); konsol sayfaları
açılıyor; SHA-256 eşit; demo çalıştırıldıysa çıkış 0. MCP geçidi ve E5 sunucusu
burada `uvloop` altında ilk kez çalışmış olur.

**Geri alma:** gerekmez (`dropdb -h 127.0.0.1 -p 55432 -U postgres collex_demo`
isteğe bağlı).

## 18. Köken (provenance) testleri

**Amaç:** Alıntının ve sayfa konumunun belgeye bağlılığını sınayan testlerin
Mac'te geçmesi. Testler kendi geçici veritabanlarını açar; `collex_local`'ı
reddeder. Bakım penceresinde çalıştırın.

**Komut (Mac):**

```bash
cd "$APP/control-plane" && npx vitest run tests/pipeline/retrievalProvenance.test.ts
cd "$APP" && .venv/bin/python -m pytest tests/intake/test_locators.py tests/intake/test_locators_db.py -q
```

`tests/intake/conftest.py` bu testlerde `COLLEX_OCR=off`'u sabitler; Mac'te
kurulu OCR bu testleri değiştirmez.

**Doğrulama:** ikisi de çıkış 0; atlanan test "geçti" sayılmaz, adıyla kaydedilir.

**Geri alma:** gerekmez.

## 19. Yerel model yoklaması

**Amaç:** Tek çağrı gecikmesi ve JSON geçerliliğinin gerçek Mac'te ölçülmesi.
Yoklama kendi istek kapısını kurar; önce uygulamayı durdurun
([MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §4.3):

```bash
"$APP/deploy/macos/collex-stop.sh" --keep-db
```

**Komut (Mac):** model sunucusu 11. adımdaki gibi açıkken:

```bash
cd "$APP" && node control-plane/scripts/probe_local_generation.mjs --base-url http://127.0.0.1:8080 --model <model> --runs 20
```

Aynı sırada ayrı pencerelerde:

```bash
vm_stat 2 > "$COLLEX_LOG_DIR/vmstat-probe.txt"
```

```bash
memory_pressure
```

**Doğrulama:** betik "measured" bölümünü basıyor; çıktı, komut ve tarih
kaydedildi. Kabul eşiği bu belgede yoktur; sonuçlar STATUS'a ölçüm olarak girer.

**Geri alma:** gerekmez.

## 20. Gömme yoklaması (ürün yolu)

**Amaç:** Yoğun şeridin uygulamanın içinden çalıştığını ve (14. adımda
yeniden hesaplandıysa) dolduğunu görmek.

**Komut (Mac):**

```bash
"$APP/deploy/macos/collex-start.sh"
curl -fsS http://127.0.0.1:8787/v1/health | "$APP/.venv/bin/python" -m json.tool
cd "$APP/control-plane" && npx vitest run tests/embeddings/realE5.test.ts
```

`realE5.test.ts` gömme sunucusunu **ayrı bir süreç** olarak başlatır (yaklaşık
0,5 GB ek bellek, ölçüm Windows'ta): 8 GB'lık üretim makinesinde yalnız bakım
penceresinde, avukat çalışmıyorken ve dosya incelemesi koşmuyorken çalıştırın.

**Doğrulama:** `dense.state` = `ACTIVE` (sorgu gömülebiliyor) ve vektör/iş
istatistikleri ilerliyor; `realE5.test.ts` geçti. Model dosyası ya da `.venv`
yoksa test "ENVIRONMENT BLOCKER" yazıp **atlanır** — atlama geçme değildir.

**Geri alma:** gerekmez.

## 21. OCR yoklaması

**Komut (Mac):**

```bash
cd "$APP" && .venv/bin/python -m intake.ocr --status
cd "$APP" && .venv/bin/python -m pytest tests/intake/test_ocr.py tests/intake/test_ocr_status.py -q
```

Sonra konsoldan, **müvekkil belgesi olmayan** taranmış bir örnek PDF yükleyin
(provada; kesintiden sonra yapılacaksa bir deneme dosyasında yapıp belgeyi
`intake.cli --delete <FILEID>` ile kaldırın).

**Doğrulama:** `"state": "OCR_READY"`; pytest çıkış 0 (gerçek motorla yapılan
tek sayfa sınaması motor bulunduğunda çalışır, bulunmazsa atlanır — atlama
kaydedilir); yüklenen belgenin uyarılarında `OCR_PAGES:<n>` var ve sayfalar
"s. N" konumlarıyla okunuyor. Hizmet (launchd) ortamındaki görünürlük 24. adımda
yeniden sınanır.

**Geri alma:** gerekmez.

### 21.1 Taşınan belgelerin sayfa durumlarını yeniden değerlendir (R2-34)

**Amaç:** Windows'ta W21 düzeltmelerinden önce yüklenen belgelerin sayfa
kayıtları eski çıkarıcının kararını taşır: yalnız e-imza satırı olan taranmış
bir sayfa `EXTRACTED` kayıtlıdır ve dosya incelemesi dosyayı "tamamı okundu"
sayabilir. Kimse "Analizi yenile"ye basmadıkça bu kendiliğinden düzelmez.
Kesinti günü, 14–16. adımlardan sonra, avukat çalışmaya başlamadan yapılır.

**Komut (Mac):** Windows'ta OCR yoktu (`OCR_EXECUTABLE_MISSING`), taşınan
metinler OCR'sız okunmuştur; `--no-ocr` onları aynı biçimde ve hızlıca yeniden
değerlendirir. Önce kuru çalıştırma, sonra uygulama:

```bash
cd "$APP" && .venv/bin/python -m scripts.backfill_locators --dsn "$DSN" --reclassify --no-ocr > "$TASIMA/reclassify-kuru.json"
cd "$APP" && .venv/bin/python -m scripts.backfill_locators --dsn "$DSN" --reclassify --no-ocr --apply > "$TASIMA/reclassify.json"
cd "$APP" && .venv/bin/python -m scripts.backfill_locators --dsn "$DSN" --reclassify --no-ocr
```

Çıktı yalnız belge kimliklerini (`fileId`) ve sayıları yazar, belge adı
yazmaz. Asılları 8. adımda kopyalanan `$COLLEX_DATA_DIR/uploads`'tan okur.

**Doğrulama:** ikinci komut çıkış 0 ve `"applied": true`; `missingOriginal`
boş (8. adım eksiksizse); `refused` ve `skipped` boş, değilse her kimlik
günlüğe yazılır ve o belgede "Analizi yenile" denenir; `needsReanalysis`
altındaki her belge için konsolda "Analizi yenile"ye basılır (yeni sürüm oluşur;
bu belgelerin eski dosya incelemeleri "eski" görünür). Üçüncü (kuru) komutta
`pagesUpdated` = 0. `pagesDowngraded` sayısı taşıma günlüğüne yazılır: o kadar
sayfa artık tamamı okunmuş sayılmıyor. Yerel OCR hazırsa (21. adım) seyrek ya da
okunamayan sayfaları olan belgelerde "Analizi yenile" o sayfaları OCR ile okur.
Bu okuma W21 R2-32 kurallarıyla yapılır: OCR'ın metin katmanını yeniden okuyan
satırları eklenmez, metin katmanındaki bir değere yalnız çok benzeyen satırlar da
eklenmez ve sayfa `OCR_WITHHELD_LINES_PAGES` uyarısıyla seyrek kalır; bu
sayfalarda "Analizi yenile" sonrası da `sparsePages` boşalmayabilir — bu bir
taşıma hatası değildir, uyarının gösterdiği satırlar belgenin aslıyla
karşılaştırılır (docs/implementation/LOCAL-OCR.md). Mac'te bu sürümden önce
yerel OCR ile yüklenmiş bir belge varsa yukarıdaki `--no-ocr` komutu onun
metnini yeniden üretemez (OCR satır kuralı da değişti); belge
`needsReanalysis` altında çıkar ve "Analizi yenile" ile yeni sürüm alır.

**Geri alma:** sayfa durumları ve `page_stats` türetilmiş veridir; özgün
dosyalar, kanonik metin ve parçalar değişmez. Geri almak gerekirse 7. adım
(veritabanı geri yükleme) yeniden yapılır.

## 22. Değerlendirme ve bake-off alt kümesi

**Amaç:** Deterministik ölçümün Mac'te Windows'la aynı sonucu verdiğini ve
modelin ürün yolundan geçtiğini görmek. Bakım penceresinde, uygulama
durdurulmuşken (`collex-stop.sh --keep-db`).

**Komut (Mac):**

```bash
cd "$APP" && .venv/bin/python scripts/run_evals.py --fixture-only
cd "$APP" && .venv/bin/python scripts/run_evals.py
cd "$APP" && node control-plane/scripts/bakeoff.mjs --models <model> --dry-run
cd "$APP" && node control-plane/scripts/bakeoff.mjs --models <model> --cases evals/bakeoff/cases.synthetic.jsonl
```

`run_evals.py` kendi geçici veritabanını (`collex_eval_test`) yeniden kurar ve
`evals/reports/fixture_baseline_<tarih>.{json,md}` yazar. Bake-off, model
adresini ürünle aynı ortam değişkenlerinden okur ve
`evals/reports/bakeoff-<tarih>.{json,md}` yazar.

**Doğrulama:** `--fixture-only` çıkış 0; tam koşunun ölçütleri Windows'taki en
yeni `fixture_baseline_<tarih>.json` ile **aynı** (sözcüksel ölçüm
deterministiktir; fark bir taşınabilirlik bulgusudur ve kapatılmadan üretim
ilan edilmez); bake-off raporu yazıldı. Sentetik vakalar hukukî kalite ölçümü
değildir ve rapor kazanan seçmez.

**Geri alma:** gerekmez.

## 23. launchd

**Amaç:** Hizmetlerin oturum açılınca başlaması, çökmede yeniden başlaması,
nazik durması ve takvimli yedek. Şablonlar: `deploy/macos/launchd/com.collex.postgres.plist`,
`com.collex.llm.plist`, `com.collex.app.plist`, `com.collex.backup.plist`
(her birinin başındaki yorum kendi kurulum adımlarını söyler).

**Komut (Mac):** önce elle çalışan her şeyi durdurun:

```bash
"$APP/deploy/macos/collex-stop.sh" --keep-db
"$COLLEX_PGBIN/pg_ctl" -D "$COLLEX_PGDATA" -m fast -w stop
```

(Model sunucusunu da Ctrl+C ile durdurun.) Yer tutucuları doldurarak kopyalayın
(launchd `~` ve değişken genişletmez; yollar ASCII olmalı):

```bash
mkdir -p "$COLLEX_LOG_DIR" "$HOME/Library/LaunchAgents"
LLAMA="$(brew --prefix llama.cpp)/bin/llama-server"
MODEL="$HOME/ColleX/models/<model>.gguf"
for f in "$APP"/deploy/macos/launchd/com.collex.*.plist; do
  sed -e "s|__COLLEX_HOME__|$APP|g" -e "s|__COLLEX_DATA_DIR__|$COLLEX_DATA_DIR|g" \
      -e "s|__COLLEX_PGBIN__|$COLLEX_PGBIN|g" -e "s|__COLLEX_PGDATA__|$COLLEX_PGDATA|g" \
      -e "s|__USER_HOME__|$HOME|g" -e "s|__LLAMA_SERVER__|$LLAMA|g" -e "s|__MODEL_PATH__|$MODEL|g" \
      "$f" > "$HOME/Library/LaunchAgents/$(basename "$f")"
done
grep -l "__" "$HOME"/Library/LaunchAgents/com.collex.*.plist
```

`com.collex.app.plist`'e şablonda olmayan değerleri ekleyin (9. adım; model
adresi **`/v1` olmadan**):

`COLLEX_PGDATA` app plist'ine **eklenmez**: küme `com.collex.postgres`'e aittir
ve başlatıcının kümeyi `pg_ctl` ile ikinci kez açmaya çalışması istenmez
([MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §5.2). Bu adımdan sonra
terminalde de `unset COLLEX_PGDATA` yapın ya da `collex-stop.sh`'yi yalnız
`--keep-db` ile çalıştırın; aksi hâlde betik kümeyi `pg_ctl` ile durdurur ve
launchd onu 30 sn sonra yeniden açar.

```bash
P="$HOME/Library/LaunchAgents/com.collex.app.plist"
plutil -insert EnvironmentVariables.COLLEX_AI_POLICY -string LOCAL_ONLY "$P"
plutil -insert EnvironmentVariables.COLLEX_DATA_BOUNDARY -string LOCAL_ONLY "$P"
plutil -insert EnvironmentVariables.COLLEX_LOCAL_LLM_BASE_URL -string http://127.0.0.1:8080 "$P"
plutil -insert EnvironmentVariables.COLLEX_LOCAL_LLM_MODEL -string "<model adı>" "$P"
plutil -insert EnvironmentVariables.COLLEX_LOCAL_LLM_CONCURRENCY -string 1 "$P"
plutil -lint "$HOME"/Library/LaunchAgents/com.collex.*.plist
```

Elle çalıştırılan betikler (`collex-backup.sh`, `collex-restore.sh`,
`collex-stop.sh`) plist değerlerini görmez. Aynı değerler
`~/.collex/collex.env` dosyasına yazılır (W21, zorunlu; kurallar
[MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §10). `COLLEX_PGDATA` buraya da
yazılmaz. Bu dosya yoksa ya da plist'ten farklı bir `COLLEX_DATA_DIR` verirse
yedek ve geri yükleme betikleri hiçbir şey yapmadan durur (çıkış 64):

```bash
mkdir -p "$HOME/.collex"
printf '%s\n' "COLLEX_HOME=$APP" "COLLEX_DATA_DIR=$COLLEX_DATA_DIR" "COLLEX_PGBIN=$COLLEX_PGBIN" \
  "COLLEX_BACKUP_DIR=$COLLEX_BACKUP_DIR" "COLLEX_LOG_DIR=$COLLEX_LOG_DIR" > "$HOME/.collex/collex.env"
chmod 600 "$HOME/.collex/collex.env"
```

Kayıt (sıra: veritabanı, model, uygulama, yedek):

```bash
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.postgres.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.llm.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.app.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.backup.plist"
launchctl list | grep com.collex
```

Günlük döndürme: [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §5.7'deki
satırı `/etc/newsyslog.d/collex.conf`'a yazın, sonra `sudo newsyslog -nv`.

Çökme ve durdurma sınaması:

```bash
kill -9 "$(cat "$COLLEX_DATA_DIR/collex.pid")"
sleep 45
curl -fsS http://127.0.0.1:8787/v1/health > /dev/null && echo "yeniden ayakta"
launchctl bootout "gui/$(id -u)/com.collex.app"
ls "$COLLEX_DATA_DIR"/collex*.pid
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.app.plist"
```

**Doğrulama:** `grep -l "__"` hiçbir dosya listelemiyor (doldurulmamış yer tutucu
yok); `plutil -lint` her dosya için "OK"; dört etiket listede; sağlık 200;
`kill -9` sonrası `yeniden ayakta` (`ThrottleInterval` 30 sn); `bootout` sonrası
pid dosyası yok (kayıtlar yazıldı); yeniden `bootstrap` sonrası sağlık 200;
`sudo newsyslog -nv` kuralı gösteriyor. Uygulama ayağa kalkmazsa
`$COLLEX_LOG_DIR/collex-app.err.log` ve `collex-ensure-db.log` okunur.

**Geri alma:** `launchctl bootout "gui/$(id -u)/com.collex.app"` (ve
`com.collex.backup`, `com.collex.llm`, `com.collex.postgres`), plist dosyalarını
`~/Library/LaunchAgents`'tan kaldırın. `KeepAlive = true` olan veritabanı ve
model hizmetleri yalnız `bootout` ile durur.

## 24. Yeniden başlat ve toparlanmayı doğrula

**Komut (Mac):** planlı yeniden başlatma (FileVault kilidini bir kez açarak):

```bash
sudo fdesetup authrestart
```

Oturum açıldıktan sonra:

```bash
launchctl list | grep com.collex
pg_isready -h 127.0.0.1 -p 55432
curl -s http://127.0.0.1:8080/v1/models
curl -fsS http://127.0.0.1:8787/v1/health | "$HOME/ColleX/app/.venv/bin/python" -m json.tool
```

Hizmet ortamında OCR: taranmış örnek PDF'yi konsoldan yeniden yükleyin.
Dayanıklılık: bir deneme dosyasında dosya incelemesi başlatın, sürerken
`kill -9 "$(cat "$HOME/ColleX/data/collex.pid")"`, sonra incelemenin kaldığı
birimden sürdüğünü inceleme kaydında görün.

İsteğe bağlı elektrik kesintisi sınaması: `pmset autorestart` açıkken Mac'in
kendiliğinden açıldığını ve **FileVault kilit ekranında beklediğini** gözleyin;
kilit açılana kadar hizmetlerin başlamaması beklenen davranıştır.

**Doğrulama:** her şey kullanıcı müdahalesi olmadan (kilit açma dışında) ayağa
kalktı; sağlık 16. adımdakiyle aynı; OCR hizmet ortamında `OCR_PAGES:<n>`
üretti; inceleme sürdü.

**Geri alma:** gerekmez.

## 25. Yedek ve geri yüklemeyi doğrula

**Komut (Mac):** takvimli işi hemen tetikleyin:

```bash
launchctl kickstart "gui/$(id -u)/com.collex.backup"
ls -t "$COLLEX_BACKUP_DIR" | head -1
cat "$COLLEX_LOG_DIR/collex-backup.err.log"
```

Sonra [BACKUP-RESTORE.md](BACKUP-RESTORE.md) §9.2: `--verify`, sürüm notu,
`collex_restore_drill`'e deneme geri yüklemesi ve sayım karşılaştırması,
bağımsız asıl karşılaştırması, şifreli harici diske kopya ve diskte `--verify`.
Gerçek felaket tatbikatı testi (kendi veritabanı `collex_safe_test`):

```bash
cd "$APP/control-plane" && COLLEX_PGBIN="$COLLEX_PGBIN" npx vitest run tests/integration/backup.test.ts
```

Provada tam geri yükleme bir kez `collex_local` üzerinde de yapılır: provada
kaybedilecek bir şey yoktur (Windows hâlâ gerçek kaynaktır) ve bu kez araç
mevcut veritabanının güvenlik dökümünü alıp onu kenara alır:

```bash
launchctl bootout "gui/$(id -u)/com.collex.backup"
launchctl bootout "gui/$(id -u)/com.collex.app"
"$APP/deploy/macos/collex-restore.sh" "$COLLEX_BACKUP_DIR/<son klasör>"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.app.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.backup.plist"
```

Takvimli yedek işi de durdurulur: geri yükleme sürerken 19.30'da başlayan bir
yedek, yarım bir veritabanını "yedek" diye kaydederdi. İş yeniden yüklendikten
sonra `launchctl print "gui/$(id -u)/com.collex.backup"` işi göstermelidir.

**Doğrulama:** yedek klasörü var, `collex-backup.err.log` hata içermiyor,
`--verify` çıkış 0; deneme geri yüklemesinin sayımları yedek anındaki sayımla
eşit; `uyumsuz: 0`; harici diskte `--verify` çıkış 0; `backup.test.ts` geçti
(atlanırsa kaydedilir, geçmiş sayılmaz); tam geri yüklemede güvenlik dökümü
`$COLLEX_BACKUP_DIR/geri-yukleme-oncesi/` altında, eski veritabanı
`collex_local_eski_<tarih>` adıyla duruyor, asıllar yerinde doğrulandı; sonra
sağlık ve sayımlar doğru.

**Geri alma:** `dropdb … collex_restore_drill`; tam geri yüklemeden sonra bir
sorun varsa `collex_local_eski_<tarih>` geri adlandırılır
([BACKUP-RESTORE.md](BACKUP-RESTORE.md) §9.2).

## 26. Ancak şimdi üretim ilan et

**Ölçüt:** kesinti gününde 7, 8, 14, 15, 16, 17, 21.1 ve 25. adımlar taze yedekle
yeniden geçti; 1–25'in her doğrulaması komut, çıktı ve tarihle taşıma
günlüğünde; [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §12 listesi
kapandı ya da açık kalan her madde sahibi (kullanıcı) tarafından adıyla kabul
edildi; §3 bellek tablosu ölçüldü.

**Yapılacaklar:**

- Avukat Mac'i kullanmaya başlar; Windows'ta ColleX **bir daha başlatılmaz**
  (iki yerde yazmak iki ayrı gerçeklik üretir). Windows verisi ve taşıma
  yedeği, kullanıcının belirlediği bir geri dönüş süresi boyunca **silinmez**.
- Ölçülen sayılar STATUS'a (orkestratör) yazılır.
- Geri dönüş süresi bitmeden ve Mac'te birkaç doğrulanmış, harici diske
  kopyalanmış yedek birikmeden Windows verisi emekliye ayrılmaz; emekliye
  ayırma kullanıcının kararıdır.

**Geri alma:** geri dönüş süresi içinde engelleyici bir sorun çıkarsa Mac
durdurulur. Windows verisi dondurma anındadır; Mac'te sonradan girilen veri
Mac'te alınan bir yedekle Windows'a taşınır (`ColleX-Geri-Yukle.cmd`; manifest
göreli yollar kullandığı için Mac yedeği okunabilir olmalıdır — bu yön
**sınanmadı**; iki tarafta PostgreSQL ana sürümü aynı kalmalıdır).
