# Yedekleme ve geri yükleme (W21)

> **Durum (11.09.2026).** Windows araçları (`ColleX-Yedekle.cmd`,
> `ColleX-Geri-Yukle.cmd`, `control-plane/scripts/backup.mjs`) W14'ten beri var
> ve test ediliyor (`control-plane/tests/integration/backup.test.ts`, gerçek
> felaket tatbikatı `collex_safe_test` üzerinde). W21'de platform şeridi
> taşınabilir geri yüklemeyi ekledi: `backup.mjs --restore` (`runRestore`,
> `control-plane/src/backup/runner.ts`) ve macOS sarmalayıcıları
> `deploy/macos/collex-backup.sh`, `deploy/macos/collex-restore.sh`, takvim
> için `deploy/macos/launchd/com.collex.backup.plist`. Bu belge onları
> 11.09.2026'da okuyarak yazıldı. **macOS komutlarının hiçbiri FİZİKSEL
> MAC'TE DOĞRULANMADI.** Hiçbir süre veya boyut sayısı ölçülmedi.

İlgili: [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) (üretim tasarımı),
[WINDOWS-TO-MAC-MIGRATION.md](WINDOWS-TO-MAC-MIGRATION.md) (taşıma),
[RUNBOOK.md](RUNBOOK.md) §7.1 (yedek aracının tarihçesi).

## 1. Neyi korumak zorundayız

### 1.1 Yeri doldurulamayan veriler — mutlaka yedeklenir

| Veri | Nerede | Bugünkü yedekte | Neden yeri doldurulamaz |
|---|---|---|---|
| Ürün veritabanı `collex_local` | PostgreSQL | **evet** (`pg_dump -Fc`) | Dosyalar, cevaplar, her taslak sürümü, süreler ve duruşmalar, ayarlar, kişiler, bulut yapay zekâ defteri (`app_private.ai_calls`), inceleme tabloları, dosya incelemesi kayıtları, belge sürümleri ve göç defteri tek veritabanındadır |
| Yüklenen belge asılları | `<COLLEX_DATA_DIR>/uploads/<sha256><uzantı>` | **evet** (bayt kopyası + SHA-256) | Çoğu zaman avukattaki tek dijital kopyadır |
| Değişmez belge sürümleri | `legal.document_versions`, `legal.document_version_segments`, `legal.chunks` (veritabanında) | **evet** (döküm içinde) | Asıllardan yeniden üretilebilir görünür, ama yeniden alma yeni kimlikler üretir; taslaklardaki `K-n` atıfları, alıntılar ve inceleme bulguları bugünkü kimlikleri gösterir. Yeniden üretmek atıf zincirini koparır |
| Getirilen kararların kütüphanesi | `<COLLEX_DATA_DIR>/library/` ve `library/yayimlandi/` | **HAYIR — boşluk** | `ingestion/library.py`'ye göre `yayimlandi/` "avukatın getirdiği kararların kendi kopyası"dır; kaynak sonradan değişebilir ya da kalkabilir. Yayımlanan zarfların içeriği veritabanına da girer; yayımlanmamış olanlar yalnız bu klasördedir. Elle kopyalayın (§8, §9) |
| Gizli olmayan yapılandırma | ortam değişkeni ADLARI ve gizli olmayan değerleri (portlar, yollar, `COLLEX_AI_POLICY`, model adı), yer tutucuları doldurulmuş launchd plist'leri, PostgreSQL'de değiştirilmiş ayarlar, uygulama `VERSION`'ı ve kaynak commit'i, model dosyalarının adı ve SHA-256'sı | hayır | Geri yüklemeden sonra aynı davranışı kurmak için gerekir. **Gizli değerler (anahtar, parola) bu notun parçası değildir** ve yedek klasörüne yazılmaz |

### 1.2 Türetilmiş ve yeniden kurulabilir veriler

| Veri | Yeniden kurma yolu | Bedeli | Karar |
|---|---|---|---|
| Gömme vektörleri (`app_private.chunk_vectors`) | `EmbeddingWorker` eksik vektörleri kendiliğinden doldurur | tüm parçaların CPU'da yeniden gömülmesi (süre ölçülmedi); başka bir çalışma ortamında hesaplanırsa küçük sayısal farklar sıralamayı değiştirebilir | aynı veritabanında durduğu için dökümle zaten yedeklenir; öyle kalmalı |
| Yoğun (dense) arama dizini | ayrı bir dizin yoktur; arama `chunk_vectors` üzerinde tam kosinüs yapar | — | yukarıdaki satır |
| Dosya incelemesi (Matter Intelligence): `matter_analysis_runs/_tasks/_units`, `matter_intel_*`, `matter_observations` | incelemeyi yeniden çalıştırmak | **pahalı** (8 GB'ta süre ölçülmedi) ve **denetim açısından önemli**: sonuç modele bağlıdır ve deterministik değildir; kayıt, avukatın o gün gördüğü sonucu ve dondurulmuş model kimliğini tutar. Yeniden çalıştırmak aynı sonucu vermez | **yedeklenmeli**; dökümün içindedir |
| İnceleme tablosu hücreleri | yeniden çalıştırmak | yukarıdakiyle aynı gerekçe | yedeklenmeli; dökümün içindedir |
| Kamu korpusu (örnek/deneme korpusu) | `ingestion.cli` ile yeniden alma | düşük | dökümün içindedir; ayrıca gerekmez |
| E5 model dosyaları (`<repo>/var/models/multilingual-e5-small`) | `scripts/prepare_local_embeddings.py` (sabit sürüm, boyut ve SHA-256 denetimli indirme) | ağ bağlantısı gerekir | isteğe bağlı olarak şifreli diske kopyalanabilir |
| Yerel dil modeli dosyaları (GGUF / Ollama) | yeniden indirmek | büyük dosya, ağ gerekir | adını ve SHA-256'sını yapılandırma notuna yazın; isteğe bağlı kopya |
| `.venv`, `control-plane/node_modules`, `__pycache__`, `demo-output`, geliştirme raporları | yeniden kurulum | düşük | **yedeklenmez**; makineler arası kopyalanmaz |
| Günlükler | — | — | yedeklenmez; döndürülür |
| `collex.pid`, `collex-mcp.pid`, `collex.stop` | — | — | **asla** yedeklenmez |

## 2. Tutarlı veritabanı yedeği

- Yedek `pg_dump -Fc` ile alınır: tek bir tekrarlanabilir-okuma anlık görüntüsü,
  sıkıştırılmış özel biçim, seçmeli geri yüklenebilir. Ürün veritabanına
  **hiçbir şey yazılmaz** (`control-plane/src/backup/runner.ts`).
- **Canlı PostgreSQL veri dizini (`pgdata`) asla dosya olarak kopyalanmaz**
  (Time Machine, `cp`, `rsync`, `robocopy` ile de). Çalışan bir kümenin
  dosyaları yazma sürerken tutarsızdır; böyle bir kopya açılmayabilir ya da
  sessizce bozuk açılabilir. Mac'te `pgdata` Time Machine'den dışlanır:
  `tmutil addexclusion ~/ColleX/pgdata`.
- `pg_restore -l` dökümün okunabildiğini kanıtlar ve içindekiler listesini
  `icindekiler.txt`'ye yazar.
- `pg_dump` veritabanı başınadır; roller ve küme geneli ayarlar dökümde
  yoktur. ColleX'in göçleri `authenticated`/`anon` izinlerini yalnız bu roller
  varsa verir; Windows kümesinde bu roller yok (salt okunur sorgu,
  11.09.2026). Bu yüzden ayrı bir `pg_dumpall --globals-only` gerekmez; bir
  gün özel rol eklenirse bu karar yeniden açılır.
- Sıra: önce döküm, sonra belge asıllarının kopyası, sonra
  `icindekiler.txt`, **en son** `yedek.json`. Manifesti olmayan klasör yedek
  sayılmaz.
- Veritabanı–asıl tutarlılığı: döküm alındıktan sonra, asıllar kopyalanırken
  bir belge **silinirse**, dökümde kaydı olan ama kopyada dosyası olmayan bir
  belge oluşabilir (yeni eklenen dosya ise yalnız fazladan kopyalanır, zararsız).
  Bu yüzden takvimli yedek kimsenin belge silmediği saatte alınır; elle yedekte
  belge silme işlemi yapılmaz. Bu durum için otomatik denetim yoktur.

## 3. Belge yedeği ve SHA-256 manifesti

Bir yedek, zaman damgalı (`YYYYMMDD-HHMMSS`, yerel saat) tek bir klasördür:

| Parça | İçerik |
|---|---|
| `<veritabanı>.dump` | `pg_dump -Fc` (ürün veritabanı için `collex_local.dump`; ad manifestten okunur) |
| `uploads/` | belge asıllarının bayt kopyası |
| `icindekiler.txt` | `pg_restore -l` listesi |
| `yedek.json` | şema `collex.backup.manifest/v1`; `at`, `database`, `dump {path, sizeBytes, sha256}`, `files[] {path, sizeBytes, sha256}` (göreli POSIX yollar), `totalBytes`; W21'den beri ek alan `originals {uploadsDir, uploadsDirFound, inDatabase, notFound}` |

`--verify` manifestteki **her** dosyanın boyutunu ve SHA-256'sını yeniden
hesaplar; eksik ve bozuk dosyaları adıyla bildirir. Manifestte olmayan fazladan
dosyalara bakmaz. Konsol, 7 günden eski son yedeği "eski" gösterir.

**Manifest yalnız klasörün KENDİSİYLE tutarlı olduğunu kanıtlar (W21).** Yanlış
bir belge klasöründen alınmış bir yedek de kendi manifestiyle birebir tutar.
W21'den önce eksik bir `uploads` klasörü "hiç asıl yok" diye okunuyor; sıfır
asıllı, `--verify`'dan geçen ve konsolda "son yedek" görünen bir klasör
yazılıyordu (Mac'te elle çalıştırılan betikte `COLLEX_DATA_DIR` yokken tam
olarak bu olur). Şimdi:

- Yedek, belge asıllarını okuduğu klasörü ve kaynağını yazar
  (`belge asılları klasörü: … (COLLEX_DATA_DIR)` ya da `COLLEX_DATA_DIR ayarlı
  değil` uyarısı).
- Veritabanına tek bir salt-okur sorgu ile hangi asılları andığı sorulur
  (güncel yükleme sürümlerinin `sha256` değerleri — "Aslını indir"in
  sunduğu dosyalar).
- Klasör **yoksa** yedek reddedilir (`UPLOADS_MISSING`). Tek istisna,
  veritabanının hiç asıl anmamasıdır (yeni kurulum; konsoldaki düğme böylece
  çalışır). Veritabanına sorulamadıysa bu "sıfır" sayılmaz, yine reddedilir.
- Veritabanı cevap verebiliyorsa bu retler `pg_dump`'tan **önce** verilir; yedek
  kökünde müvekkil verisi taşıyan yarım bir döküm kalmaz. Yalnız dökümden sonra
  anlaşılabilen bir retde (veritabanına sorulamadı ve klasör yok) bu çalışmanın
  yazdığı döküm dosyası ve boş klasörleri silinir.
- Klasör var ama veritabanının andığı asıllardan **hiçbiri** yoksa yanlış
  klasör sayılır ve reddedilir (`UPLOADS_INCOMPLETE`).
- Bilerek asılsız yedek almak için `backup.mjs --allow-empty-uploads`
  (`collex-backup.sh --allow-empty-uploads`); o yedek de "EKSİK" diye yazılır.
- Asılların bir **kısmı** eksikse yedek alınır (elde olanın en iyi kopyasıdır)
  ama `yedek tamam` yerine `yedek alındı (EKSİK)` ve eksik sayısını söyleyen bir
  `UYARI` yazılır; sayı `yedek.json` `originals.notFound`'a ve son yedek
  özetine (`originalsNotFound`) girer.
- Klasör var ama **veritabanına sorulamadıysa** (ör. `psql -w` parola istedi)
  yedek alınır, ama "eksik değil" hiçbir zaman "eksiksiz" sayılmaz: başlık
  `yedek alındı (DENETLENMEDİ)` olur ve boş ya da yanlış bir klasör için de
  `UYARI` bunu söyler. Üç durum (`backupOriginalsState`): `COMPLETE`
  (veritabanına soruldu, hiçbir asıl eksik değil), `INCOMPLETE`, `UNVERIFIED`
  (sorulamadı ya da yedek bu denetimden önceki bir sürümle alındı — `originals`
  bloğu olmayan eski `yedek.json`'lar da böyledir). Yalnız `COMPLETE` "tamam" diye
  yazılır. Durum şuralarda taşınır: `POST /v1/backup` cevabı
  (`originalsState`, `originalsWarning`), son yedek özeti (`GET /v1/backup`;
  yalnız `COMPLETE` değilse `originalsState` ve `originalsWarning`),
  `--verify` (dosyalar eşleşiyorsa çıkış yine 0'dır ama cümle
  "…dosya yedek listesiyle birebir eşleşiyor — ama yedek eksiksiz sayılamaz
  (EKSİK|DENETLENMEDİ): …" olur, "tamamı eksiksiz" demez).
- Reddedilen bir yedeğin klasöründe `yedek.json` yoktur; son yedek listesinde
  görünmez.

Yedek klasörü **müvekkil verisi içerir** ve şifrelenmez: şifreli bir diskte
tutulmalıdır (Windows'ta BitLocker, Mac'te FileVault / şifreli APFS).
`collex-backup.sh` bunu FileVault diliyle söyler; yedek aracının kendi uyarı
metni (`BACKUP_CLIENT_DATA_WARNING_TR`) bugün yalnız BitLocker'ı anar (bilinen
boşluk).

## 4. Geri yüklemeyi doğrulama

Bir yedek, geri yüklenebildiği gösterilene kadar yalnız bir umuttur. Doğrulama
dört katmandır:

### 4.1 Manifest

```bash
node control-plane/scripts/backup.mjs --verify <yedek klasörü>
```

Çıkış 0 ve "yedek tarihi / veritabanı / arşiv dosyası" satırları. 1 ise yedek
bozuktur; o yedekle geri yükleme yapılmaz.

### 4.2 Geçici veritabanına deneme geri yüklemesi

Ürün veritabanına dokunmadan, ayrı bir geçici veritabanına geri yüklenir ve
sayımlar karşılaştırılır. Geçici ad: **`collex_restore_drill`** (yalnız bu iş
için; asla `collex_local` değil, asla başka bir testin veritabanı değil).
`backup.mjs --restore` belge asıllarını da `COLLEX_DATA_DIR`'a birleştirdiği
için bu tatbikat onunla değil, doğrudan `pg_restore` ile yapılır.

Önce aşağıdaki sayım sorgusunu depo dışında `sayim.sql` adıyla kaydedin
(Windows'ta ve Mac'te aynı dosya kullanılır):

```sql
select 'dosya='||(select count(*) from app_private.matters)
  ||'  cevap='||(select count(*) from app_private.answers)
  ||'  taslak='||(select count(*) from app_private.drafts)
  ||'  belge='||(select count(*) from legal.documents where scope='tenant')
  ||'  surum='||(select count(*) from legal.document_versions)
  ||'  parca='||(select count(*) from legal.chunks)
  ||'  vektor='||(select count(*) from app_private.chunk_vectors)
  ||'  inceleme='||(select count(*) from app_private.matter_analysis_runs)
  ||'  politika='||(select count(*) from pg_policies where schemaname in ('legal','app_private'))
  ||'  migrasyon='||(select count(*) from app_private.schema_migrations);
```

W20 öncesi bir yedekte `chunk_vectors` ve `matter_analysis_runs` tabloları
yoktur; o zaman bu iki satırı çıkarın. İlk satırlar `ColleX-Geri-Yukle.cmd`'nin
sonda bastığı sayımlarla aynıdır.

Komutlar: §9.1 (Windows), §9.2 (macOS). Sayımlar, yedeğin alındığı andaki
canlı veritabanıyla karşılaştırılır; yedekten sonra değişiklik yapıldıysa canlı
sayılar farklı olabilir — bu durumda karşılaştırma, yedek alınırken kaydedilen
sayımla yapılır (§6).

### 4.3 Belge asılları

Geri yüklenen ya da kopyalanan asılların manifestle **SHA-256 düzeyinde**
eşleştiği gösterilir. `backup.mjs --restore` bunu kendisi yapar (birleştirmeden
sonra her aslı yerinde yeniden hashler). Windows `.cmd`'si ve elle kopyalar
için bağımsız bir denetim gerekir; depoda bunun için bir betik yoktur.
Aşağıdaki parçayı depo dışında `asil_karsilastir.py` adıyla kaydedip projenin
Python'uyla çalıştırın. Hedef klasörde manifestte olmayan fazladan dosya
olabilir (geri yükleme birleştirir, silmez); o dosyalar sayılmaz.

```python
import hashlib, json, pathlib, sys

yedek, hedef = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
manifest = json.loads((yedek / "yedek.json").read_text(encoding="utf-8"))
uyumsuz = 0
for entry in manifest["files"]:
    ad = entry["path"].split("/", 1)[1]  # "uploads/<ad>" -> "<ad>"
    h = hashlib.sha256()
    try:
        with (hedef / ad).open("rb") as f:
            for blok in iter(lambda: f.read(1 << 20), b""):
                h.update(blok)
        esit = h.hexdigest() == entry["sha256"]
    except FileNotFoundError:
        esit = False
    if not esit:
        uyumsuz += 1
        print("UYUMSUZ:", ad)
print(f"dosya: {len(manifest['files'])}  uyumsuz: {uyumsuz}")
sys.exit(1 if uyumsuz else 0)
```

Beklenen: `uyumsuz: 0`, çıkış 0.

### 4.4 Uygulama

Geri yüklenen veritabanıyla açılan sunucuda `/v1/health`: `migrations` eksiksiz,
`rls` beklenen sayıda, `uploadsDir` doğru klasör; konsolda bir dosya ve bir
belge açılır, "Aslını indir" ile inen dosyanın SHA-256'sı manifestteki değerle
aynıdır.

## 5. Sürüm uyumluluğu

- **PostgreSQL ana sürümü.** Windows kümesi 18.1 (`show server_version`,
  `pg_dump --version`; 11.09.2026). Mac'te de 18 kullanılır. Geri yüklemede
  `pg_restore`, dökümü alan `pg_dump`'tan **eski olmamalıdır**; daha eski bir
  `pg_restore` dökümü okuyamaz. Farklı ana sürüme geçiş ayrı bir iştir ve bu
  belgenin konusu değildir.
- **Göç defteri** `app_private.schema_migrations` dökümün içindedir. Geri
  yüklemeden sonra `intake.cli --dsn <DSN> --ensure-db --list` çalışır (Mac'te
  `collex-start.sh` bunu her açılışta yapar): yalnız oluşturur, asla silmez;
  defterde eksik olan göçleri uygular. Bu, eski bir yedeği **daha yeni** koda
  ileriye doğru getirir. `backup.mjs --restore` göç çalıştırmaz.
- **Tersine uyumluluk yoktur.** Daha yeni kodla alınmış bir yedek daha eski
  koda geri yüklenmez: eski kod, defterinde tanımadığı göçleri bilmez. Kural:
  geri yükleyen kodun sürümü ≥ yedeği alan kodun sürümü.
- **Manifest sürüm bilgisi taşımaz** (PostgreSQL sürümü, `pg_dump` sürümü,
  uygulama `VERSION`'ı, commit, göç listesi). Bu bilinen boşluk kapanana kadar,
  her yedek klasörüne yanına bir sürüm notu yazılır (§9). Not manifestte
  değildir ve SHA-256'sı yoktur; `--verify` ona bakmaz.
- **Göç yönü:** göçler yalnız ileri gider. Bir göçü geri almak, göç öncesi
  yedeğe dönmek demektir.

## 6. Zamanlama

| Ne zaman | Nasıl |
|---|---|
| Her gün | Mac: `com.collex.backup` şablonu her gün **19.30**'da `collex-backup.sh`'yi çalıştırır; büro geç çalışıyorsa saat, kimsenin belge silmediği bir saate alınır (§2). Windows: otomatik zamanlama **yoktur**; konsoldaki "Yedek al" ya da `ColleX-Yedekle.cmd` elle |
| Her güncellemeden, göçten ve taşımadan önce | elle |
| Her geri yüklemeden önce | `backup.mjs --restore` mevcut veritabanının güvenlik dökümünü kendisi alır ve döküm başarısızsa **durur**. Windows `.cmd`'si aynı dökümü `%TEMP%`'e alır ama hatasını yutar (bilinen boşluk) |
| Üç ayda bir | §4.2 geri yükleme tatbikatı |

Takvimli yedek çalışırken Mac uyumamalıdır; uykuda kaçan iş uyanışta, kapalıyken
kaçan iş hiç çalışmaz ([MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §5.8–5.9).

Yedek alınırken sayım da kaydedilirse (§4.2'deki sorgu, çıktısı yedek
klasörünün yanına), sonraki tatbikatlar canlı veritabanı değişmiş olsa bile o
kayıtla karşılaştırılabilir.

## 7. Saklama

- Hiçbir araç eski yedekleri **otomatik silmez** (`runner.ts`'de silme yok;
  `collex-backup.sh` ve plist yorumu da "hiçbir eski yedek silinmez; yer açmak
  avukatın kararıdır" der). Yedek dizini büyür.
- Önerilen başlangıç kuralı (hukukî değerlendirme bekler): son 7 günlük, son
  4 haftalık, son 12 aylık yedek. Silme elle yapılır; **doğrulanmış en yeni
  yedek asla silinmez**. Geri yüklemenin güvenlik dökümleri
  (`<COLLEX_BACKUP_DIR>/geri-yukleme-oncesi/`) ve kenara alınmış eski
  veritabanları (`collex_local_eski_<tarih>`) da elle temizlenir.
- Müvekkil verisinin saklama süreleri `docs/legal/retention-matrix.yaml`
  taslağına bağlıdır. Bir yedeği tutmak da, silmek de bir saklama kararıdır:
  **HUKUKÇU İNCELEMESİ GEREKLİ**.

## 8. Makine dışı kopya (özel kalan)

- **Önerilen:** iki şifreli harici disk, sırayla kullanılır; biri büroda,
  biri başka bir güvenli yerde. Mac'te disk, Disk İzlencesi'nde "APFS
  (Şifreli)" biçimiyle hazırlanır; Windows'ta BitLocker To Go.
- Kopyadan sonra doğrulama **diskin üzerinde** yapılır; manifest göreli yollar
  kullandığı için aynı komut çalışır:

```bash
node control-plane/scripts/backup.mjs --verify "/Volumes/<disk>/ColleX-Yedek/<klasör>"
```

- Kütüphane kuyruğu (`<COLLEX_DATA_DIR>/library/`) yedeğin parçası olmadığı için
  aynı diske ayrıca kopyalanır (§9). SHA-256 manifesti yoktur; dosya sayısı
  karşılaştırılır.
- **Time Machine:** yedek klasörü şifreli bir Time Machine diskine alınabilir;
  `pgdata` dışlanır (§2).
- **Bulut eşitleme klasörleri** (iCloud Drive, OneDrive vb.) veriyi makineden
  çıkarır ve `LOCAL_ONLY` ilkesiyle çelişir. Varsayılan: kullanılmaz. Seçilirse
  istemci tarafı şifreleme ve avukatın açık kararı gerekir; KVKK açısından
  **HUKUKÇU İNCELEMESİ GEREKLİ**.

## 9. Komutlar

### 9.1 Windows (bugünkü araçlar)

PowerShell değişkenleri (kendi yollarınızı yazın):

```powershell
$PGROOT = "$env:USERPROFILE\scoop\apps\postgresql\current"
$PGBIN = "$PGROOT\bin"
```

Yedek (çift tık da olur; hedef verilmezse `%USERPROFILE%\ColleX-Yedek`). Veritabanı
çalışıyor olmalıdır:

```powershell
.\ColleX-Yedekle.cmd "E:\ColleX-Yedek"
```

Doğrulama:

```powershell
node control-plane\scripts\backup.mjs --verify "E:\ColleX-Yedek\<klasör>"
```

Geçici veritabanına deneme geri yüklemesi (§4.2):

```powershell
$DUMP = node control-plane\scripts\backup.mjs --dump-name "E:\ColleX-Yedek\<klasör>"
& "$PGBIN\createdb.exe" -h 127.0.0.1 -p 55432 -U postgres -T template0 -E UTF8 --locale=C collex_restore_drill
& "$PGBIN\pg_restore.exe" -h 127.0.0.1 -p 55432 -U postgres -d collex_restore_drill --no-owner --no-privileges --exit-on-error "E:\ColleX-Yedek\<klasör>\$DUMP"
& "$PGBIN\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d collex_restore_drill -At -f sayim.sql
& "$PGBIN\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d collex_local -At -f sayim.sql
& "$PGBIN\dropdb.exe" -h 127.0.0.1 -p 55432 -U postgres collex_restore_drill
```

Asılların karşılaştırılması (§4.3):

```powershell
.venv\Scripts\python.exe asil_karsilastir.py "E:\ColleX-Yedek\<klasör>" "var\uploads"
```

(`COLLEX_DATA_DIR` ayarlıysa `var\uploads` yerine `<COLLEX_DATA_DIR>\uploads`.)

Gerçek geri yükleme (yıkıcı; önce `ColleX-Durdur.cmd`, sonra yalnız veritabanını
açık bırakın; araç mevcut veritabanını `collex_local_eski_<tarih>` adıyla saklar,
`EVET` yazılmasını ister):

```powershell
.\ColleX-Geri-Yukle.cmd "E:\ColleX-Yedek\<klasör>"
```

Bilinen sınırlar (bu `.cmd` W21'de değişmedi): tarih damgası Windows yerel
ayarına bağlıdır; güvenlik ağı dökümünün hatası yutulur; asıllar `robocopy /E`
ile birleştirilir ve kopyadan sonra manifestle yeniden denetlenmez — bu yüzden
geri yüklemeden sonra §4.3 elle çalıştırılır. Taşınabilir
`node control-plane\scripts\backup.mjs --restore "<klasör>" --yes` Windows'ta da
çalışacak biçimde yazıldı (PostgreSQL araçlarını `COLLEX_PGBIN` ya da `PATH`'ten
bulur), ama bu belgenin şeridi onu Windows'ta çalıştırmadı.

Kütüphane kuyruğunun kopyası (manifest yok; sayı karşılaştırılır):

```powershell
robocopy "var\library" "E:\ColleX-Yedek\library" /E
(Get-ChildItem -Recurse -File "var\library").Count
(Get-ChildItem -Recurse -File "E:\ColleX-Yedek\library").Count
```

`robocopy` başarıda da 1 döndürür; 8 ve üstü hatadır.

### 9.2 macOS — FİZİKSEL MAC'TE DOĞRULANMADI

Değişkenler ([MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §6 yolları):

```bash
export APP="$HOME/ColleX/app"
export COLLEX_DATA_DIR="$HOME/ColleX/data"
export COLLEX_BACKUP_DIR="$HOME/ColleX-Yedek"
export COLLEX_PGBIN="$(brew --prefix postgresql@18)/bin"
export PATH="$COLLEX_PGBIN:/opt/homebrew/bin:$PATH"
```

`collex-backup.sh` ve `collex-restore.sh` belge asıllarını
`COLLEX_DATA_DIR/uploads`'tan okur ve oraya yazar. Elle açılan bir terminal
plist değerlerini görmez; bu yüzden aynı değerler **`~/.collex/collex.env`
dosyasına yazılır** (zorunlu; biçim ve kurallar
[MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md) §10). `collex-env.sh` bu
dosyayı hem launchd işlerinde hem elle çalıştırmada okur (ortamda zaten ayarlı
bir değer önceliklidir) ve okuyamadığı her satırda — boşluklu `KEY = değer`,
tırnaklı değer, girinti, `export`, `$HOME`/`~`, boş değer — dosya adını ve
satır numarasını yazıp **durur** (çıkış 64); Windows satır sonu (CR) atılır,
dosyadaki hiçbir şey komut olarak çalıştırılmaz. Şablondaki `__…__` yer
tutucusu kalmış bir değer varsa da betik hiçbir şey yapmadan durur.

Her iki betik belge asıllarının klasörünü ve kaynağını yazar
(`Belge asılları : … (COLLEX_DATA_DIR)`). Kurulu
`~/Library/LaunchAgents/com.collex.app.plist` başka bir `COLLEX_DATA_DIR`
gösteriyorsa (PlistBuddy ile yalnız okunur) hiçbir şey yapmadan durur
(çıkış 64). `COLLEX_DATA_DIR` hiç yoksa ColleX klasöründeki `var/` varsayılır ve
bu açıkça uyarılır; `backup.mjs` o klasör yoksa ya da veritabanının andığı
asıllardan hiçbirini taşımıyorsa yedeği reddeder (§3).

**Yedek.** Takvimli iş kendiliğinden çalışır (`com.collex.backup`, her gün
19.30). Hemen almak için işi tetikleyin ya da betiği elle çalıştırın
(veritabanı açık olmalı; hedef verilmezse `COLLEX_BACKUP_DIR`):

```bash
launchctl kickstart "gui/$(id -u)/com.collex.backup"
```

```bash
"$APP/deploy/macos/collex-backup.sh"
```

**Doğrulama:**

```bash
cd "$APP" && node control-plane/scripts/backup.mjs --verify "$COLLEX_BACKUP_DIR/<klasör>"
```

**Sürüm notu** (her yedeğin yanına; §5):

```bash
Y="$COLLEX_BACKUP_DIR/<klasör>"
{ date -u +%Y-%m-%dT%H:%M:%SZ; "$COLLEX_PGBIN/pg_dump" --version; psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atc "show server_version"; cat "$APP/VERSION"; git -C "$APP" rev-parse HEAD; psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -Atc "select filename from app_private.schema_migrations order by 1"; } > "$Y/surum-notu.txt"
```

**Geçici veritabanına deneme geri yüklemesi** (§4.2):

```bash
cd "$APP" && DUMP="$(node control-plane/scripts/backup.mjs --dump-name "$Y")"
createdb -h 127.0.0.1 -p 55432 -U postgres -T template0 -E UTF8 --locale=C collex_restore_drill
pg_restore -h 127.0.0.1 -p 55432 -U postgres -d collex_restore_drill --no-owner --no-privileges --exit-on-error "$Y/$DUMP"
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_restore_drill -At -f sayim.sql
psql -h 127.0.0.1 -p 55432 -U postgres -d collex_local -At -f sayim.sql
dropdb -h 127.0.0.1 -p 55432 -U postgres collex_restore_drill
```

**Bağımsız asıl karşılaştırması** (§4.3):

```bash
cd "$APP" && .venv/bin/python asil_karsilastir.py "$Y" "$COLLEX_DATA_DIR/uploads"
```

**Gerçek geri yükleme** (`collex-restore.sh` → `backup.mjs --restore`).
Önkoşullar: ColleX sunucusu **kapalı**, PostgreSQL **açık** (betik ikisini de
denetler ve uymuyorsa hiçbir şey yapmadan durur).

```bash
launchctl bootout "gui/$(id -u)/com.collex.app"
```

(launchd kullanılmıyorsa: `"$APP/deploy/macos/collex-stop.sh" --keep-db`.)

```bash
"$APP/deploy/macos/collex-restore.sh" "$Y"
```

Betik `EVET` yazılmasını ister (etkileşimsiz kullanımda `--yes` şarttır; onaysız
hiçbir şey değişmez). `runRestore` sırasıyla şunu yapar:

1. Yedeği doğrular; bozuksa hiçbir şeye dokunmaz.
2. Hedef adın düz bir tanımlayıcı olduğunu, belge asıllarının konacağı
   `<COLLEX_DATA_DIR>/uploads` klasörünün **var olduğunu** (W21; yoksa bu
   genellikle yanlış veri klasörüdür ve geri yükleme hiçbir şeyi değiştirmeden
   reddedilir — klasörü bilerek oluşturmak için `--create-uploads-dir`) ve
   `pg_dump`, `pg_restore`, `psql`'in çalıştığını denetler. Onay sorusu da bu
   klasörü yazar.
3. Mevcut veritabanı varsa güvenlik dökümünü
   `<COLLEX_BACKUP_DIR>/geri-yukleme-oncesi/collex_local_geri_yukleme_oncesi_<YYYYMMDD_HHMMSS>.dump`
   olarak alır; döküm başarısızsa **durur**.
4. Mevcut veritabanını `collex_local_eski_<YYYYMMDD_HHMMSS>` adıyla kenara alır
   (asla silmez) ve `template0`, `UTF8`, `locale 'C'` ile boş bir veritabanı açar.
5. `pg_restore --no-owner --no-privileges --exit-on-error`; başarısızsa eski
   veritabanının adını ve geri alma yolunu yazar.
6. Belge asıllarını `<COLLEX_DATA_DIR>/uploads`'a birleştirir: aynı içerikli dosya
   yerinde kalır; aynı adlı ama farklı içerikli yerel dosya
   `<ad>.eski-<damga>` olarak kenara alınır; hiçbir dosya silinmez ya da üzerine
   yazılmaz. Sonra manifestteki her aslı yerinde yeniden hashler.
7. Tablo sayısını yazar; sonra **geri yüklenen veritabanına** hangi belge
   asıllarını andığını sorar ve her birini klasörde arar (W21: yedek kendi
   manifestiyle tutsa da dökümün andığı bir aslı içermeyebilir; "Aslını indir"
   klasörde olanı sunar). Çıkış kodları:
   - **0** — asıllar yerinde doğrulandı ve veritabanının andığı her aslı
     klasörde; cümle `Geri yükleme tamam: … <N> belge aslının tamamı <klasör>
     içinde yerinde doğrulandı ve geri yüklenen veritabanının andığı <M> belge
     aslının hepsi orada.` Hiç asıl içermeyen bir yedek için "tamamı doğrulandı"
     demez, "bu yedek hiçbir belge aslı içermiyordu" der.
   - **1** — asıllardan biri doğrulanamadı ya da veritabanının andığı asıllardan
     bazıları klasörde yok (`Veritabanı geri yüklendi AMA belge asılları EKSİK: …
     <M> belge aslından <K> tanesi <klasör> içinde yok`). Veritabanı geri
     yüklenmiştir; eksik asılları başka bir yedekten koyun.
   - **3** — veritabanı geri yüklendi, ama veritabanına sorulamadığı (ya da
     klasör okunamadığı) için asılların eksiksiz olduğu **DENETLENEMEDİ**;
     yedek alınırken bilinen uyarı da yazılır. `collex-restore.sh` bu durumda
     "tamam" demez ve 3 ile çıkar.

Başarısız bir `pg_restore`'dan sonra elle geri alma (betiğin yazdığı adla):

```bash
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database collex_local;" -c "alter database collex_local_eski_<YYYYMMDD_HHMMSS> rename to collex_local;"
```

Başarılıysa uygulamayı açın; `collex-start.sh` açılışta `--ensure-db` çalıştırır:

```bash
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.collex.app.plist"
```

Sonra §4.2'deki sayım ve §4.4. Her şey yolundaysa eski veritabanı **elle** ve
ancak bir sonraki doğrulanmış yedekten sonra silinir:
`dropdb -h 127.0.0.1 -p 55432 -U postgres collex_local_eski_<YYYYMMDD_HHMMSS>`.

**Makine dışı kopya** (§8):

```bash
rsync -a "$COLLEX_BACKUP_DIR/<klasör>" "/Volumes/<disk>/ColleX-Yedek/"
rsync -a "$COLLEX_DATA_DIR/library/" "/Volumes/<disk>/ColleX-Yedek/library/"
find "$COLLEX_DATA_DIR/library" -type f | wc -l
find "/Volumes/<disk>/ColleX-Yedek/library" -type f | wc -l
```

## 10. Bilinen boşluklar

| Boşluk | Etkisi |
|---|---|
| Yedek manifesti sürüm bilgisi taşımıyor | sürüm notu elle yazılır (§5) |
| `var/library` yedekte yok | elle kopyalanır (§8, §9) |
| Otomatik saklama/silme yok | disk dolabilir; elle izlenir |
| Yedek şifrelenmiyor | şifreli disk zorunlu |
| Windows'ta zamanlama yok | Windows ara dönemdir; elle yedek |
| Windows `.cmd` geri yüklemesinde güvenlik ağı dökümü hatası yutuluyor, asıllar kopyadan sonra denetlenmiyor | §4.3 elle çalıştırılır; ya da taşınabilir `--restore` |
| Yedek düğmesi (`POST /v1/backup`) veritabanı sunucusu ve kullanıcısını vermiyor | `127.0.0.1` ve `postgres` varsayılır; Mac kümesi `initdb -U postgres` ile kurulmalı |
| Yedek aracının uyarı metni yalnız BitLocker'ı anıyor | Mac'te FileVault / şifreli APFS kastedilir |
| Döküm ile asıl kopyası arasında belge silinirse tutarsızlık | takvimli yedek boş saatte; W21'den beri veritabanının andığı asıllardan klasörde olmayanlar sayılıp yazılır, ama döküm ile sorgu aynı anlık görüntü değildir |
| Yedek düğmesi `--allow-empty-uploads` veremez | Konsol düğmesi asılları hiç olmayan yanlış klasörde reddedilir; bilerek asılsız yedek yalnız komut satırından alınır |
| Konsolun son yedek kartı `originalsNotFound` / `originalsState` / `originalsWarning`'i henüz göstermiyor; yedek düğmesinin başarı kartı `POST /v1/backup` cevabındaki `originalsState`'i okumuyor | alanlar API'de var; kart ilgili şeritte |
| Veritabanına sorulamayan bir yedek (klasör var, boş bile olsa) reddedilmez | `DENETLENMEDİ` diye işaretlenir, hiçbir yüzeyde "tamam" denmez; reddetmek sahte `psql` cevabıyla boş klasör kullanan mevcut bir testle çelişir |
| Windows `ColleX-Geri-Yukle.cmd` kendi geri yüklemesinden sonra veritabanının andığı asılları aramaz ve "Geri yukleme tamam" yazar | taşınabilir `backup.mjs --restore` bu denetimi yapar |
| macOS yedek/geri yükleme yolunun tamamı | FİZİKSEL MAC'TE DOĞRULANMADI |
