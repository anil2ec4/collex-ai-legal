# W14 — Hat L-SAFE: platform, veri güvenliği ve dayanıklılık

**Tarih:** 02.09.2026 · **Hat:** L-SAFE (Faz A) · **Kalemler:** B-03, B-04,
B-05, B-12, B-19 (intake tarafı), B-23, B-32 (migration + metadata), B-33,
B-34, B-37, B-44, B-45

> Bu rapor yalnızca **ölçtüğüm** şeyleri söyler. Ölçmediğim hiçbir sayı
> burada yoktur; inmeyen her kalem "inmedi" olarak, gerekçesiyle yazılıdır.
> Hükümet siteleri bu makineden erişilemez; bu hattın hiçbir kalemi canlı
> upstream gerektirmiyor.

---

## 0. Kapı 1 önce indi

Dalga planı (W13-BACKLOG §G.3) B-04, B-06 ve B-12'yi Kapı 1 saydı. Bu hattın
ikisi — **B-04 (`localGuard`) ve B-12 (CI'da PostgreSQL + venv)** — diğer her
şeyden önce, ilk iki iş olarak indi ve bu raporun geri kalanı onların
üstüne kuruldu. B-06 L-ANSWER'ın kalemidir.

---

## 1. Kalem kalem: ne yapıldı, kanıtı ne

### B-04 · `localGuard` — CSRF + `Host` denetimi + güvenlik başlıkları · **İNDİ**

**Ne yapıldı.** Yeni `control-plane/src/api/localGuard.ts`, `createApp`'te
**ilk** `app.use("*", …)` olarak kuruldu — gövde sınırlayıcıdan da önce, ki
reddedilen bir istek ne pipeline'a, ne intake sürecine, ne modele ulaşsın.

Üç savunma:

1. **`Host` beyaz listesi** (DNS rebinding → *okuma*). `127.0.0.1`,
   `localhost`, `::1` dışında bir `Host` → **421**. ENGRISK'in en ağır
   bulduğu delik buydu: yabancı bir sayfa `/v1/answers?texts=true` ve
   `/v1/settings`'i okuyabiliyordu.
2. **Durum değiştiren metotlarda `Origin` / `Sec-Fetch-Site`.** Yabancı
   `Origin` **veya** `same-origin|none` olmayan `Sec-Fetch-Site` → tipli
   **403 `FORBIDDEN_ORIGIN`**. `text/plain` ve `multipart/form-data`
   CORS-safelisted olduğu için tarayıcı preflight yapmıyor; ölçülen 201 ve
   200 tam olarak bu yoldan geliyordu. `/v1/ai/*` de aynı kapının
   arkasında: ADR-018'in "istek başına onayı" gövdedeki bir alan, yani
   saldırgan onu kendisi yazabiliyordu.
3. **`/v1/*` güvenlik başlıkları**: `cache-control: no-store`,
   `x-content-type-options: nosniff`, `referrer-policy: no-referrer`.

**Bozulmayanlar (test edildi).** `Origin` göndermeyen yerel betikler
(curl, `demo.mjs`, CLI probe'ları) etkilenmez; konsol same-origin olduğu
için çalışmaya devam eder; konsolun hash-sabitli CSP'sine dokunulmadı.

**KABUL kanıtı** — `control-plane/tests/api.test.ts`, `describe("B-04 localGuard")`:

```
npx vitest run tests/api.test.ts
 ✓ tests/api.test.ts (46 tests) 214ms
   Tests  46 passed (46)
```

Testler tek tek: yabancı `Host` → 421 (dört ad denendi, `/v1/answers`,
`/v1/settings`, `/v1/health` dahil); yabancı `Origin` + POST → 403 **ve
sahte pipeline çağrı sayacı 0**; `/v1/ai/analyze-document` de 403;
`Sec-Fetch-Site: cross-site` → 403; `Origin`'siz POST → 400 (yani route
koştu, kapı karışmadı); `GET /v1/answers/{runId}/evidence-bundle?texts=true`
üç başlığı da taşıyor. `console.test.ts` yeşil kaldı (tam süit 100/100
dosya geçti).

---

### B-12 · CI'ya PostgreSQL 18 + venv · **İNDİ**

**Ne yapıldı.** `.github/workflows/ci.yml` `control-plane` işi yeniden
yazıldı:

- `services: postgres:18`, `POSTGRES_HOST_AUTH_METHOD: trust`, runner'da
  **port 55432** (süitlerin varsayılanı; tek geçersiz kılma yolu
  `COLLEX_TEST_DB_HOSTPORT`), healthcheck;
- `astral-sh/setup-uv@v5` + `uv venv .venv` + `uv pip install --python
  .venv/bin/python -e ".[intake,export]"` + `psycopg[binary]` — dört gerçek
  süit interpreter'ı **depo kökünde `.venv/bin/python`** olarak çözdüğü için
  venv'in tam olarak o adla var olması gerekiyor;
- kümenin `pg_trgm`/`pgcrypto`/`btree_gist` **ve** `turkish` metin arama
  yapılandırmasını taşıdığını doğrulayan bir adım (yoksa FTS migration'ı
  düşer ve her store süiti yanlış sebeple kırmızı olur);
- `npm test -- --reporter=verbose`;
- **son adım: dört gerçek süitin atlanmadığını iddia eder.** Atlama
  işaretleyicilerinden biri koşarsa iş kırmızı olur — ortam gerilerse
  kalıcılık katmanı yeniden testsiz kalır ve bunun sessiz olmaması gerekir.

`ci.yml` **tamamen offline** kaldı: tek ağ ucu loopback servis konteyneri,
sağlayıcı anahtarları iş akışı düzeyinde boş.

**KABUL kanıtı.** CI bu makineden koşturulamaz (GitHub Actions). Doğrulanan:
YAML ayrıştırılıyor ve iş yapısı beklenen şekilde (`services: [postgres]`,
9 adım). **Yerelde eşdeğer ortamla** dört süitin gerçekten koştuğu
ölçüldü — tam vitest turunda 6 atlamanın **hepsi** "environment
unavailable" ters-işaretleyicileri, yani gerçek testler koştu:

```
tests/matters/pg.test.ts       > W14 stores (environment unavailable)      ↓
tests/store/persistence.test.ts> persistence stores (environment unavail.) ↓
tests/drafting/real-export.ts  > SKIPPED: repo venv interpreter not found  ↓
tests/integration/backup.test  > B-03 disaster drill (environment unavail.)↓
tests/integration/real-exec    > real-exec integration (environment unav.) ↓
tests/integration/serve.test   > serve.mjs lifecycle (environment unavail.)↓
```

**Dürüstlük notu:** CI'nın kendisi bu dalgada koşmadı; kanıt "YAML doğru +
aynı ortam yerelde dört süiti koşturuyor"dur, "CI yeşil" değildir.

---

### B-05 · Ledger: çoklu sentinel + `policy:` kind + `/v1/health rls` + advisory lock · **İNDİ**

**Ne yapıldı.**

(a) `ingestion/migrations.py`: `ledger_sentinel` → **`ledger_sentinels()`**
(liste). Bootstrap bir dosyayı ancak **bütün** probe'ları çözülürse kaydeder.
`ledger_sentinel` geriye dönük uyumluluk için ilk probe'u döndürür.

(b) İki yeni kind: **`policy:<schema.table>.<name>`** (`pg_policy`) ve
**`type:<schema.name>`** (`to_regtype`). İkisi de SQL CASE'e eklendi ve
**iki runtime'da birden** (`ingestion/migrations.py` ve
`control-plane/src/store/health.ts` aynı CASE'i çözüyor;
`persistence.test.ts` Python kaynağını okuyup cümleleri karşılaştırıyor).

(c) **On bir runnable dosyanın hepsi** ilk ve son yarattığı nesne için birer
probe ilan ediyor (`20260826070000` ve `20260827120000` tek nesne yarattığı
için tek probe). `20260826010000`'in probe'u paylaşımlı `extension:btree_gist`
olmaktan çıkıp dosyanın **son** nesnesini de adlandırıyor
(`type:legal.relation_kind`).

(d) `/v1/health` additive **`rls: { expected, present }`**. Tam bir
veritabanında **18** (12 `20260826060000_rls.sql` + 5 matters + 1 W14 AI
kayıt defteri). ENGRISK W14 migration'ı yokken 17 ölçmüştü; sayı **yeniden
ölçüldü**, iki runtime'da da 18'e sabitlendi.

(e) `apply_missing_migrations` başında **oturum düzeyinde
`pg_advisory_lock(hashtext('collex.migrations'))`**, `finally` bloğunda
unlock.

**KABUL kanıtı** — `tests/ingestion/test_migrations_ledger.py` (17 test,
gerçek PostgreSQL 18):

```
.venv/Scripts/python.exe -m pytest tests/ingestion/test_migrations_ledger.py -q
17 passed in 6.57s
```

Üç kabul ölçütü tek tek:

1. **"Her dosyanın probe'larından en az biri dosyanın SON yarattığı nesneyi
   adlandırır."** `test_every_runnable_file_probes_the_object_it_creates_LAST`
   her dosyayı ayrıştırıyor: sütun-0'daki son `create …` ifadesinden nesne
   adını çıkarıp probe hedeflerinin son kimlik parçalarıyla karşılaştırıyor.
   `test_multi_object_files_also_probe_their_FIRST_object` ilk nesneyi de
   sabitliyor.
2. **Yarım uygulanmış `20260902120000` senaryosu.**
   `test_half_applied_matters_migration_is_NOT_bootstrapped_and_gets_applied`
   ENGRISK'in senaryosunu birebir kuruyor: bütün önceki migration'lar +
   matters dosyasının RLS bloğuna kadar olan kısmı. Ön koşul iddia ediliyor
   (`app_private.settings` **var**, `settings_tenant` politikası **yok**,
   beş tablonun politika sayısı **0**), sonra `apply_missing_migrations`
   çağrılıyor: dosya bootstrapped listesinde **değil**, applied listesinde
   **var**, ve sonrasında politika sayısı **5**.
3. **Eşzamanlı iki `--ensure-db`.**
   `test_two_concurrent_apply_passes_on_an_empty_database_both_succeed` boş
   bir veritabanında iki bağımsız bağlantıyla iki paralel geçiş koşuyor;
   ikisi de istisnasız bitiyor, dosyaların her biri **tam bir kez**
   uygulanmış oluyor.
   *Kapsam dürüstlüğü:* bu iki **iş parçacığı**, iki işletim sistemi süreci
   değil. Kilit sunucu tarafında ve oturum başına olduğu için sınanan
   mekanizma aynı; iki süreç yalnızca süreç doğurma maliyeti eklerdi.
   `test_advisory_lock_is_released_even_when_a_migration_fails` kilidin
   başarısız geçişte de bırakıldığını doğruluyor (bırakılmasaydı bir sonraki
   çalıştırma asılırdı).

`persistence.test.ts` gerçek PG ile: `rls.present == rls.expected == 18`,
çoklu probe listesi, `policy:`/`type:` kindlerinin gerçekten kullanıldığı,
ve **saf** bir "yarım uygulanmış dosya eksik sayılır" testi.

---

### B-03 · Yedekleme ve geri yükleme · **İNDİ (felaket tatbikatı dahil koşuldu)**

Başlangıç noktası ölçülüydü: `pg_dump`/`yedek`/`backup` ürün kodunda **sıfır**
kez geçiyordu.

**Ne teslim edildi.**

| Parça | Dosya |
|---|---|
| Yedek/doğrulama motoru | `control-plane/src/backup/runner.ts` (yeni) |
| Uç | `control-plane/src/backup/routes.ts` (yeni) — `POST /v1/backup`, `GET /v1/backup` |
| CLI | `control-plane/scripts/backup.mjs` (yeni) — `--database/--out` ve `--verify` |
| Avukatın çift tıkladığı | `ColleX-Yedekle.cmd`, `ColleX-Geri-Yukle.cmd` (yeni, depo kökü) |
| Sağlık | `/v1/health` additive `backup: {path,lastAt,sizeBytes,files,stale} \| null` |

**Bir yedek üç parçadır** — ikisi bir yedek değildir:
`collex_local.dump` (`pg_dump -Fc`), `uploads/` (asıl baytlar) ve
**`yedek.json`** (şema kimliği, tarih, veritabanı, **her dosyanın boyutu ve
SHA-256'sı**). Manifest geri yüklemeyi *doğrulanabilir* yapan şeydir.

**Pazarlık edilmeyen kararlar (kodda ve testte sabit).**
Yedek alırken ürün veritabanına **yazılmaz** (`pg_dump` tek anlık görüntü
okur). `execFile` + **argüman dizisi**, shell yok. Geri yükleme **asla
`drop database` ile başlamaz**: mevcut veritabanı `collex_local_eski_<tarih>`
adına *yeniden adlandırılır*. `pg_restore --exit-on-error`. `robocopy /E`
asılları **birleştirir**, silmez (`/MIR`/`/PURGE` testle yasak). Doğrulama
satırı `pg_policies` sayısını da basar — B-05'e emniyet ağı.
Manifestsiz bir klasör yedek **sayılmaz** (`readLastBackup` atlar).

**Felaket tatbikatı — gerçekten koşuldu.**
`control-plane/tests/integration/backup.test.ts`, `collex_safe_test`
(bu hattın probe veritabanı; başka hiçbir ad yaratılmadı/silinmedi):

> veri yarat (2 satır + 1 asıl belge) → **gerçek `pg_dump`** ile yedekle →
> manifest'i doğrula → **veritabanını yok et** (`drop … with (force)`;
> `to_regclass` ile boş olduğu iddia edilir) → **gerçek `pg_restore
> --exit-on-error`** ile geri yükle → satırların **birebir eşit** döndüğünü
> kanıtla (Türkçe karakterler dahil: `Kira — Yılmaz / Demir`,
> `İş — Kaya / X A.Ş.`) → asıl belgenin baytının da aynı olduğunu kanıtla.

```
npx vitest run tests/integration/backup.test.ts
 ✓ tests/integration/backup.test.ts (11 tests | 1 skipped) 1323ms
   ✓ B-03 disaster drill (collex_safe_test) > create data -> back up ->
     DESTROY the database -> restore -> prove equality  888ms
   Tests  10 passed | 1 skipped (11)
```

`collex_local` tatbikatın yıkıcı yarısına **hiç** girmedi; sınıf sabiti
`DRILL_DB !== "collex_safe_test"` olduğunda `resetDrillDb` istisna atıyor.
Tatbikat sonrası `pg_database` listesi kontrol edildi: `collex_safe_test`
yok.

Doğrulama testleri ayrıca **kesilmiş** ve **aynı boyutta değiştirilmiş**
(yani boyut kontrolünün yakalayamayacağı) bir dosyayı ada göre yakalıyor;
eksik dosyayı ada göre bildiriyor; yabancı bir klasörü tipli
`VERIFY_FAILED` ile reddediyor.

**Uyarı metni her yerde:** *"Bu klasör müvekkil verisi içerir — şifreli bir
diske veya BitLocker'lı bir klasöre koyun."* — `POST /v1/backup` cevabında,
`.cmd` çıktısında, ve `readLastBackup` sonucunda (`stale`).

**Yapılmayanlar (bilinçli, ENGRISK §3.5):** PITR/WAL arşivleme,
`pg_basebackup`, otomatik zamanlanmış görev, şifreleme.

**KABUL ölçütünün tam olarak karşılanmayan yarısı — dürüstçe:**
kabul metni "1 dosya + 1 belge + 1 taslak (v2) + 1 süre içeren
`collex_local` yedeklenir; küme sıfırdan kurulur" diyor. **`collex_local`'a
test verisi yazmak yasak** ve **kümeyi sıfırdan kurmak** bütün hatların
paylaştığı PostgreSQL'i yok etmek demek. Tatbikat bu yüzden aynı mekanizmayı
`collex_safe_test` üzerinde, gerçek `pg_dump`/`pg_restore` ile koştu.
"Küme sıfırdan" yerine "veritabanı sıfırdan" yapıldı; kümeyi yeniden kurma
adımı **yapılmadı** ve bunu ölçülmüş saymıyorum.

---

### B-33 · Intake sınırları: PDF sayfa tavanı, atomik yazma, yazma sırası · **İNDİ**

Üç kusur, üçünün de avukat tarafında bir hikâyesi var:

1. **`PDF_MAX_PAGES = 600`** (`intake/extract.py`). Sayfa sayısı PDF
   başlığından, **tek bir sayfa çıkarılmadan önce** okunuyor; aşımda tipli
   `EXTRACTION_FAILED` + *"Belge N sayfa; en fazla 600 sayfa işlenebilir —
   belgeyi bölün."* Eskiden 3 000 sayfalık bir tarama 180 sn bütçeyi aşıp
   504 dönüyordu: üç dakika kayıp, sıfır bilgi.
2. **Yazma sırası ters çevrildi** (`intake/ingest.py`): asıl baytlar artık
   `Pipeline(...).run()`'dan **önce** yazılıyor. Kötü hâl artık "diskte asıl
   var, DB'de kayıt yok" — yeniden yükleme temizler. Önceki kötü hâl
   "DB'de kayıt var, asıl yok" idi ve aynı baytları tekrar yüklemek
   *"Bu belge zaten yüklüydü"* diyordu: kullanıcı doğru hareketiyle bile
   ilerleyemiyordu.
3. **Atomik yazma + onarım**: `.part` → `fsync` → `os.replace`; mevcut dosya
   yalnızca boyutu doğrulanan boyuta eşitse "sağlam" sayılıyor, değilse
   **yeniden yazılıyor**. Eskiden kesilmiş bir dosya sonsuza kadar kalıyordu
   ve **adı içeriğin sha256'sıydı**, yani dosya adı yalan söylüyordu.

**KABUL kanıtı** — `tests/intake/test_intake_limits.py` (yeni, 9 test) +
`tests/intake/test_process.py`:

```
.venv/Scripts/python.exe -m pytest tests/intake/test_intake_limits.py tests/intake/test_process.py -q
20 passed in 23.57s
```

Sayfa sınırını aşan PDF **20 sn'den kısa sürede** (ölçülen: saniyenin altı)
tipli hata döndürüyor; kesilmiş bir asıl yeniden yüklemede **onarılıyor**;
`.part` artığı kalmıyor; sağlam bir asıl **yeniden yazılmıyor** (mtime
değişmiyor); yazma sırası hem davranışla (ölü veritabanına karşı: asıl
diskte, sha256 içerikle uyuşuyor, DB'de satır yok) hem kaynak düzeyinde
sabitlendi.

---

### B-37 · Belge ön incelemesinin kalitesi · **İNDİ**

İki hattın ölçtüğü dört kusurun dördü de kapandı (`intake/analysis.py`).

| Kusur | Önce | Sonra |
|---|---|---|
| "KİRAYA VEREN: Ali Yılmaz" → müvekkil bulunamıyor | rol etiketi **iki kelime**, desen yalnız tek kelimelik etiketleri tanıyordu | çok kelimeli rol tablosu (`KİRAYA VEREN`, `İHTAR EDEN`, `MUHATAP`, …) |
| Aynı vekil iki satır | tekilleştirme anahtarı `(ad, rol)` idi | anahtar **normalize edilmiş ad** ("Av." unvanı düşürülür); farklı rol `alsoRoles` olarak eklenir |
| Bağlam kelime ortasından kesiliyor (7/7) | ham `±40` karakter | `context_window()` kenarları **kelime sınırına** çeker, kırpılan kenara `…` koyar |
| Sözleşmenin kendi "Madde 3"ü kanun maddesi gibi | her `article` referansı listede | **üç kova**: `references` (eşleşti) / `referencesAmbiguous` (belirsiz) / ikisi de boş (bulunamadı) |
| `TBK m.315` ile `m.315` iki satır | — | bağlamdan çözülür (aynı paragraf, ≤400 kod noktası), **tek satırda birleşir** (`count: 2`) |
| Numaralı SONUÇ VE İSTEM maddeleri kaçıyor | cümle bölücü bloğu tek "talep" olarak yutuyordu | `extract_demand_items()` numaralı maddeleri sırasıyla çıkarır (`ordinal`, `fromDemandBlock`) |

**Ölçülen önce/sonra** (aynı sentetik kira sözleşmesi + dilekçe):

```
ÖNCE  parties: [Mehmet Demir(kiracı), Av. Ayşe Kaya(vekil)]        ← kiraya veren YOK
      references: [Madde 1, Madde 3, Madde 315, TBK m.315]         ← 3 sözleşme maddesi
      dates[0].context: "…uygulanır. Sözleşme 12.05.2024 … SONUÇ VE İSTE"  ← kelime ortası
      claims: 1 tane, 155 karakterlik blok

SONRA parties: [Ali Yılmaz(kiralayan), Mehmet Demir(kiracı), Av. Ayşe Kaya(vekil)]
      references: [TBK m.315 (6098), m.316 (6098, resolvedFromContext)]
      referencesAmbiguous: [Madde 1, Madde 3]
      dates[0].context: "… hükmü de değerlendirilmiştir. Sözleşme 12.05.2024 tarihinde imzalanmıştır. SONUÇ VE …"
      claims: [1) Kira sözleşmesinin feshine, 2) Taşınmazın tahliyesine,
               3) 148.500 TL kira alacağının davalıdan tahsiline …]
```

**KABUL kanıtı** — `tests/intake/test_analysis.py` (yeni, 17 test):

```
.venv/Scripts/python.exe -m pytest tests/intake/test_analysis.py -q
17 passed in 0.12s
```

`analysis` sözlüğü **additive** büyüdü (`referencesAmbiguous`);
`tests/intake/test_process.py` bunu additive olarak sabitliyor.

---

### B-19 · Klasör / toplu intake · **KISMEN İNDİ (intake tarafı indi, iki parça devredildi)**

**İNEN (intake tarafı, tamamen bu hattın dosyalarında).**
`intake/cli.py` `--dir <klasör>`: klasörü **özyinelemeli** tarar, sıralı
işler, `.pdf/.docx/.txt/.udf` dışını *skipped* sayar (UYAP indirmeleri
`.html`/`.xml` yan dosyalarla dolu; onlara "hata" demek üç gerçek sorunu
gürültüye gömer). **Yeni intake yolu yoktur**: her dosya aynı
`process_file`'dan geçer, yani karantina, magic-byte denetimi, ZIP-bomba
kapıları ve yeni sayfa tavanı **değişmeden** uygulanır — bunu bir test
kaynak düzeyinde sabitliyor. Başarısız dosya **adı ve tipli nedeniyle**
raporlanır ve **partiyi düşürmez**; hepsi başarısızsa çıkış kodu 2.
`BATCH_MAX_FILES = 200` **önden** reddeder (yanlışlıkla bırakılan devasa bir
ağaç saatlerce koşmasın).

```
.venv/Scripts/python.exe -m pytest tests/intake/test_batch_intake.py -q
7 passed in 1.81s
```

20 dosyalık gerçek bir klasör yerine 5 belgelik gerçekçi bir UYAP klasörü
kuruldu (nested klasör, iki yan dosya, bir taranmış PDF): `total=5, ok=4,
failed=1`, başarısız dosya adı+`EXTRACTION_FAILED`+Türkçe mesajla listelendi;
tekrar çalıştırma `already-existed` verdi.

**İNMEYEN (dosya sahipliği gereği devredildi).**

1. **`UPLOAD_CAP_MIB` 25 → 40.** Değerin **üç** kaynağı var:
   `intake/quarantine.py` (benim), `control-plane/src/files/routes.ts`
   (L-MATTER) ve `control-plane/tests/files/uploadCap.test.ts` (L-MATTER,
   Python satırını **ve** "Why 25 and not 100" cümlesini parse ediyor).
   CLAUDE.md invaryantı "ikisini birden ya da hiçbirini" der; yalnız
   birini değiştirmek invaryantı **kırardı**. Teknik engel kalktı (B-33'ün
   sayfa tavanı, 25 MB sınırının vekil olarak yaptığı işi doğru yerde
   yapıyor) ve gerekçe `quarantine.py`'ye yazıldı; değişiklik
   **integrationRequests**'e devredildi.
2. **`MAX_CONCURRENT_INTAKE = 2` semaforu.** API tarafında eşzamanlılık
   sınırı yok ve bu `control-plane/src/files/routes.ts`'in işi (L-MATTER).
   Devredildi.
3. **Konsolda klasör sürükle-bırak + ilerleme kanalı.** Faz B, L-CONSOLE.
   UI sözleşmesi §3'te.

---

### B-23 · Bulut AI: maskeleme + kayıt defteri + hız/maliyet tavanı · **İNDİ**

**(a) Maskeleme** — `control-plane/src/ai/masking.ts` (yeni). Saf, kural
tabanlı, **yerel**; bulut gerektirmez (bulut gerektiren bir maskeleme kendi
kendini yer). TCKN (11 hane), VKN (10), IBAN (TR+24), telefon ve matter'daki
taraf adları → `[TCKN]`, `[VKN]`, `[IBAN]`, `[TELEFON]`, `[MÜVEKKİL]`,
`[KARŞI TARAF]`.

> Bir tuzak gerçekten yakalandı: JavaScript'in `/i` bayrağı Türkçe için
> **yetmiyor**. Unicode katlaması `i`↔`I` eşler, `ı`'nın ASCII karşılığı
> yoktur; yani "Ali Yılmaz" bir dilekçe başlığında **"ALİ YILMAZ"** yazıldığında
> `/i` ile **hiç eşleşmiyordu** ve ad maskelenmeden modele giderdi. Desen
> artık harf harf Türkçe büyük/küçük çiftlerinden kuruluyor
> (`[iİ]`, `[ıI]`, `[şŞ]`, …) ve `i` bayrağı kullanılmıyor. Bir test bunu
> sabitler.

**Gönderim kararı zorunlu, varsayılan yok.** `POST /v1/ai/analyze-document`
artık `maskMode` alanı olmadan çağrılamaz:
`preview` (maskele, **gönderme**, metni geri döndür) · `mask` (maskele ve
gönder) · `as-is` (maskelemeden gönder). Metnin gösterilmeden gittiği bir
yol yok. `as-is` seçildiğinde cevap bir uyarı taşır: *"Bu belge
MASKELENMEDEN gönderildi…"*. Doğrulama (birebir alıntı denetimi)
**gönderilen** maskelenmiş parçalara karşı koşar — orijinale karşı koşsaydı
modelin hiç görmediği metin için "doğrulandı" derdi.

**(b) Kayıt defteri** — `control-plane/src/ai/ledger.ts` (yeni) +
`supabase/migrations/20260903100000_ai_audit_and_scale_indexes.sql` (yeni
tablo `app_private.ai_calls`, RLS + politika). Kaydedilen: tarih, uç, model,
**karakter sayısı**, yaklaşık jeton, dosya/matter/taslak/bölüm kimliği,
maskelenip maskelenmediği. **Kaydedilmeyen: metnin kendisi** — istem yok,
belge gövdesi yok, model çıktısı yok. Bir test satırı fixture cümleleri için
arıyor. Yeni uç: `GET /v1/ai/ledger`.

**(c) Tavan** — `AI_MAX_CALLS_PER_HOUR = 60`,
`AI_MAX_INPUT_TOKENS_PER_DAY = 400 000`; aşımda tipli **429
`AI_RATE_LIMITED`** + Türkçe mesaj + `limits`/`usage`. Üç bulut ucunun
**üçünde de** model çağrısından önce kontrol edilir.
`GET /v1/ai/status` additive `limits`, `today: {callsLastHour,
inputTokensToday}` ve `masking` bloğu döner.

**ADR-018 gevşetilmedi:** varsayılan KAPALI, istek başına onay, hatırlanan
onay yok, `liveTested:false` duruyor (test ediyor).

**KABUL kanıtı** — `control-plane/tests/ai/masking.test.ts` (yeni, 17 test):

```
npx vitest run tests/ai
 ✓ tests/ai/masking.test.ts (17 tests) 57ms
 ✓ tests/ai/routes.test.ts (24 tests) 163ms
   Tests  83 passed (83)
```

Kabul ölçütleri tek tek: maskelenmiş metinde **11 haneli hiçbir sayı**
kalmıyor (`/(?<!\d)\d{11}(?!\d)/` ile aranıyor); TCKN/VKN/IBAN/telefon ve
matter taraf adları maskeleniyor; `maskMode` olmadan çağrı **400** ve
`issues` `maskMode`'u adlandırıyor; **61. çağrı 429 `AI_RATE_LIMITED`**;
kayıt defteri satırında belge metni **yok** (test dizeleri arıyor).

**Kapsam dürüstlüğü.** `maskMode` **`/v1/ai/analyze-document`** için
zorunlu — belge metnini gönderen uç odur. `/v1/ai/ocr` PDF'in **kendisini**
gönderir (bir görüntüde maskelenecek metin yoktur) ve
`/v1/ai/draft-paragraph` hash'e bağlı kanıt alıntıları gönderir
(maskelemek bu ürünün üzerine kurulu olduğu birebir doğrulamayı kırardı);
ikisi de tavana ve kayıt defterine tabidir ve kayıt defteri
`masked: false` yazar — gizlemek yerine söyler. **(d) İlk açılış
bilgilendirme ekranı** konsol işidir (Faz B, L-CONSOLE); sunucu tarafı
`/v1/ai/status.masking` ile hazır.

---

### B-34 · Veri dizini, sürüm, tek örnek kilidi, nazik durdurma · **İNDİ (bir parçası bilinçle ertelendi)**

**Tek `COLLEX_DATA_DIR` çözücüsü.** `serve.mjs::resolveDataDir()` ve
`intake/ingest.py::resolve_data_dir()` **aynı** değişkeni okuyor; pid
dosyaları, durdurma sentinel'i ve `uploads/` hep birlikte taşınıyor. İki
`.cmd` de aynı değişkeni kullanıyor.
**Varsayılan bilinçle `<repo>/var` kaldı**: `%LOCALAPPDATA%\ColleX\data`'ya
geçmek mevcut bir kurulumun asıllarını **taşımak** demektir ve avukatın tek
kopyasını başka bir işin yan etkisi olarak taşımak doğru değildir. Ön koşul
indi; varsayılanın çevrilmesi + taşıma kendi başına bir adımdır.

**Tek `VERSION` dosyası** (depo kökü, `1.0.0`). `API_VERSION` artık oradan
okunuyor (elle düzenlenen `"1.0.0-w12"` sabiti gitti) ve iki test
`VERSION == pyproject.toml [project].version` eşitliğini sabitliyor.
`/v1/health.version` bu yüzden `1.0.0-w12` yerine **`1.0.0`** dönüyor
(additive delta §4).

**Tek örnek kilidi.** `serve.mjs` açılışta DSN kapsamlı
`pg_try_advisory_lock` alıyor; tutuluysa Türkçe mesaj + exit 1.
*Ölçülen bir tuzak:* kilit ilk hâlinde **testleri kırdı** — sert
öldürülmüş bir sürecin backend'i bir an daha yaşıyor ve "durdur, hemen
başlat" çalışmıyordu. Bu, önlediği sorundan **daha kötü** bir arıza olurdu.
Çözüm: ~2 sn'lik sınırlı yeniden deneme + `pg_stat_activity`'de
`application_name = 'collex-serve'` taşıyan **başka canlı bir backend var mı**
kontrolü. Yoksa açılışa devam edilir ve uyarı basılır.

**Nazik durdurma.** `serve.mjs` `<veri>/collex.stop` dosyasını 500 ms'de bir
yokluyor; `ColleX-Durdur.cmd` **önce** o dosyayı bırakıyor ve pid dosyasının
kaybolmasını 6 sn bekliyor, sonra sert kapatmaya geçiyor. `serve.mjs` pid'i
ancak `flush()` + `sql.end()` bittikten sonra sildiği için **pid'in gitmesi
"kayıtlar yazıldı" demektir**. Bugüne kadar `taskkill /F` yüzünden
`shutdown()` yolu **üründe hiç koşmamıştı**. `pg_ctl -m fast -w stop`
korundu; `-m immediate` testle yasak.

**Başlatıcı çift tık (E12b).** Adım 1'deki `taskkill` artık canlılık
kontrolünün **arkasında**: pid dosyası varsa ve o pid gerçekten bir
`serve.mjs` ise hiçbir şey öldürülmüyor, doğrudan beklemeye geçiliyor.

**KABUL kanıtı** — `control-plane/tests/integration/launcher.test.ts`
(7 → **20** test):

```
npx vitest run tests/integration/launcher.test.ts tests/integration/serve.test.ts
 ✓ tests/integration/launcher.test.ts (20 tests) 14ms
 ✓ tests/integration/serve.test.ts (5 tests | 1 skipped) 13718ms
   Tests  23 passed | 1 skipped (24)
```

Testler: nazik durdurma yolu `flush()`/`removePid`/`sql.end()`'e **bağlanıyor**
ve pid dosyasının kaybolmasını bekliyor; ikinci başlatıcı tıkı öldürmüyor;
kilit veritabanı **adından** türetiliyor (DSN'den değil — DSN kimlik
taşıyabilir) ve bayat kilit ürünü kilitlemiyor; `VERSION` ↔ `pyproject.toml`
eşit; `COLLEX_DATA_DIR` her iki runtime ve her iki `.cmd` tarafından
okunuyor; port bazlı kill geri gelmedi.

**Kalan KABUL parçası — dürüstçe:** *"`COLLEX_DATA_DIR` ayarlıyken hiçbir
bayt repo klasörüne yazılmaz"* şu an **kaynak düzeyinde** sabitlendi (her
iki runtime da tek çözücüyü kullanıyor), uçtan uca bir dosya sistemi
gözlemiyle değil. Ayrıca **mevcut `var/uploads` içeriğinin ilk açılışta
taşınması yapılmadı** — yukarıdaki gerekçeyle.

---

### B-32 · Liste uçlarının ölçek performansı (migration + metadata payı) · **İNDİ**

Bu kalem paylaşımlı: L-MATTER `files`/`answers` sorgularını, L-SAFE
migration'ı ve intake metadata'sını taşıyor.

- **`answers_filescope_gin`** — `supabase/migrations/20260903100000_…sql`.
  `(result -> 'fileScope') jsonb_path_ops` üzerinde GIN. Yorum, predikatın
  **birebir** `result -> 'fileScope' @> '["<id>"]'::jsonb` yazılması
  gerektiğini söylüyor (mantıken eşdeğer ama farklı biçimli bir ifade
  indeksi **kullanmaz**).
- **`chars` metadata'ya yazılıyor** — `intake/ingest.py`,
  `meta.upload.chars = len(canonical)`. `GET /v1/files` artık her satır için
  `length(v.canonical_text)` hesaplamak zorunda değil (ENGRISK: sorgu
  süresinin **%91'i** yalnız TOAST'tan kanonik metni açmak, 148,9 ms →
  12,4 ms).
- **`ai_calls_tenant_time_idx`** — kayıt defterinin iki sorusu için.

**Ölçüm dürüstlüğü:** 2 000 belgelik probe veritabanı bu hatta **kurulmadı**;
"<60 ms / <5 ms / planda indeks görünür" kabul ölçütü L-MATTER'ın sorgu
değişikliğiyle birlikte ölçülmelidir (L-VERIFY, Faz B). Bu hattın payı
şema + metadata; ikisi de yerinde ve migration gerçek PostgreSQL'de
uygulanıp geri alınabilir olduğu doğrulandı.

---

### B-45 · Küçük dayanıklılık kalemleri · **KISMEN İNDİ (4/7)**

| Kalem | Durum |
|---|---|
| **E15** — ledger'da olup diskte olmayan migration | **İNDİ.** `MigrationHealth.unknown: string[]` (additive) + Türkçe uyarı: *"Veritabanı bu sürümden daha yeni (N bilinmeyen migrasyon) — ColleX'i güncelleyin."* Saf test var. |
| **E18** — başlatıcı kümenin ColleX'in veri dizini olduğunu doğrulasın | **İNDİ.** `ColleX-Baslat.cmd :checkcluster` `show data_directory` çıktısını `%PGDATA_DIR%` ile karşılaştırır; uymuyorsa Türkçe açıklar ve **durur** (*"Dosyalariniz duruyor"*). Testli. |
| **`mcpState` 60 sn sonra `down`** | **İNDİ.** `MCP_START_DEADLINE_MS = 60_000`; süre dolunca `mcpState = "down"` ve *"canlı araştırma için sunucuyu yeniden başlatın"*. |
| **E19** — `filehistory` en yeni 100 fileId | **İNMEDİ** — `console.html`, L-CONSOLE. Devredildi. |
| **E20** — saat sapması > 24 saat uyarısı | **İNMEDİ** — `console.html`, L-CONSOLE. Sunucu tarafı zaten hazır (`/v1/health.time`). Devredildi. |
| **E21** — `GET /v1/files/{id}` parça önizlemeleri enjeksiyon taramasından geçsin | **İNMEDİ** — `control-plane/src/files/**`, L-MATTER. Devredildi. |
| **E22** — cevap önbelleği tavanı RUNBOOK §7'ye | **İNMEDİ** — `docs/**`, L-DOCS (Faz B). §4'te delta olarak yazılı. |

---

### B-44 · Depo temizliği ve okunabilirlik borcu · **KISMEN İNDİ**

**Silinen upstream artıkları** (toplam ~**415 KB**, ölçüldü):

| Dosya | Boyut | Neden artık |
|---|---|---|
| `example_fastapi_app.py` | 80 102 B | Bu fork'ta olmayan bir dağıtım sözleşmesinin FastAPI SaaS demosu |
| `redis_session_store.py` | 17 787 B | Upstash/Redis oturum deposu; bu fork'ta Redis yok, hiçbir şey referans vermiyor |
| `migration_app.py` | 2 226 B | Tek seferlik upstream yardımcı; referansı yok |
| `Dockerfile` | 2 182 B | Konteyner dağıtımı; ürün avukatın kendi makinesinde koşuyor |
| `railway.json` | 466 B | Railway dağıtım manifesti; barındırılan dağıtım yok |
| `control-plane/dist/` | 231 KB | Bayat kısmi yapı; `ts-loader.mjs` `src/` okuyor, `dist/`'i **hiç** okumuyor |
| `control-plane/test/` | 81 KB | `tests/`'in dört hiç koşmamış kopyası (vitest yalnız `tests/**`) |

`tests/test_pydantic_clean.py`'deki `example_fastapi_app` testi dosyayla
birlikte kaldırıldı (silinen dosyayı koruyan bir test artıktır).
`npm run dev` `dist/`'i zaten `npm run build`'den sonra kullanıyor, yani
silme onu bozmuyor.

**Yeni gerileme testi** `tests/test_repo_hygiene.py` (yeni): yedi artığın
geri gelmediğini, silinen modüllerin hiçbir yerde import edilmediğini,
kaynak dosyalarda ham NUL baytı olmadığını ve `VERSION == pyproject`
eşitliğini sabitliyor.

**NUL baytı (ARCH S11).** Üç dosyada ham NUL baytı ölçüldü. Benim olan
(`control-plane/tests/ai/ocr.test.ts`) kaçış dizisine çevrildi. Diğer ikisi
başka hatların dosyaları — açık bir **allowlist**'e alındı, sahipleri ve tek
karakterlik düzeltmeleri yazıldı, ve ikinci bir test allowlist'in
bayatlamasını engelliyor (girişi kalkan dosya listeden çıkmak zorunda).

**İNMEYENLER (dosya sahipliği):**
- `src/format/date.ts` birleştirmesi (GG.AA.YYYY TS'te dört, Python'da bir
  kez) — tarih biçimleyicileri başka hatların dosyalarında; devredildi.
- `coverage.ts` (~120 durak sözcük + stemmer) ↔ `lexicalEntailment.ts`
  (22 durak sözcük, stemmer yok) ilişkisinin bir testle sabitlenmesi —
  ikisi de L-ANSWER'ın; devredildi.

```
.venv/Scripts/python.exe -m pytest tests/test_repo_hygiene.py tests/test_pydantic_clean.py -q
27 passed in 3.57s
```

---

## 2. `server.ts` mount toplama (bu hattın sözleşme borcu)

Dalga sonunda diskte olan router dosyaları kontrol edildi ve **üçü de**
mount edildi (hepsi tamamen isteğe bağlı bağımlılık alıyor, yani koşulsuz
mount doğru: yapılandırılmamış bir uç 404 yerine **nedenini Türkçe söyler**):

| Yol | Router | Hat |
|---|---|---|
| `/v1/sources/*` | `createSourcesRouter` (`src/sources/routes.ts`) | L-SOURCES |
| `/v1/citation-audit`, `/v1/contracts/*` | `createContractsRouter` (`src/contracts/routes.ts`) | L-EVID |
| `/v1/fees/*` | `createFeesRouter` (`src/fees/routes.ts`) | L-LEGAL |
| `/v1/backup` | `createBackupRouter` (`src/backup/routes.ts`) | L-SAFE (B-03) |

`createSourcesRouter`'a `gateway` (varsa) veriliyor; `createContractsRouter`'a
`now`. **Eksik kalan yok:** dalga başında bildirilen üç yolun üçü de diskte
mevcuttu ve mount edildi. `src/matters/{contactsRoutes,recordsRoutes}.ts`
L-MATTER'ın kendi router'ından mount ediliyor; `server.ts`'e mount satırı
gerekmedi.

---

## 3. UI sözleşmesi (Faz B, L-CONSOLE)

### 3.1 Yedekleme (B-03) — Ayarlar sekmesi

- **`POST /v1/backup`** · gövde yok · 200:
  `{path, sizeBytes, files, at, database, warning}`.
  409 `BACKUP_IN_PROGRESS` (bir yedek sürerken), 500 `{kind, message}`
  (`DUMP_FAILED` / `COPY_FAILED` / `VERIFY_FAILED`).
- **`GET /v1/backup`** → `{backup: {path, lastAt, sizeBytes, files, stale} | null}`.
- **`GET /v1/health`** additive `backup` (aynı şekil, `null` = hiç yedek yok).
- Etiketler: düğme **"Yedek al"**; satır **"Son yedek: GG.AA.YYYY HH:MM"**.
  `backup === null` → **kırmızı**, metin: *"Henüz hiç yedek alınmadı —
  verileriniz tek bir diskte."* · `stale === true` (>7 gün) → **turuncu**.
  Yedek alındıktan sonra **her zaman** gösterilecek uyarı, cevaptaki
  `warning` alanından birebir: *"Bu klasör müvekkil verisi içerir — şifreli
  bir diske veya BitLocker'lı bir klasöre koyun."*
- Uç mount edilmemişse (`GET /v1/backup` 404) → kart *"Yedekleme bu sunucuda
  yapılandırılmadı — ColleX-Yedekle.cmd dosyasını kullanın."*

### 3.2 Bulut AI maskeleme + kayıt defteri (B-23)

- **Önizleme:** `POST /v1/ai/analyze-document`
  `{fileId, useCloudAi: true, maskMode: "preview", matterId?}` → 200
  `{schema:"collex.ai.mask-preview/v1", fileId, fileName, maskMode, masked:
  [{kind,label,count}], clean, summary, chunksAnalyzed, chunksTotal,
  preview: [{chunkId, text}], sent: false}`. **Hiçbir şey gönderilmedi.**
  Ekran: `summary` başlık satırı, `preview[].text` tam metin, `masked`
  listesi rozet olarak.
- **İki düğme:** *"Maskele ve gönder"* → aynı istek `maskMode: "mask"`;
  *"Maskelemeden gönder"* → `maskMode: "as-is"` (ikinci düğme ikincil stil;
  cevaptaki `warnings` içinde maskelenmeden gönderildiği yazar).
- `maskMode` **yoksa** 400 `INVALID_REQUEST`, `issues[].path === "maskMode"`.
- **Tavan:** 429 `AI_RATE_LIMITED`, gövde
  `{error:{kind, message, limits:{callsPerHour, inputTokensPerDay}, usage:{callsLastHour, inputTokensToday}}}`.
- **Sistem durumu satırı:** `GET /v1/ai/status` → `today.callsLastHour`,
  `today.inputTokensToday`, `limits`. Metin: **"Bugün: N çağrı / ~M jeton
  (sınır: 60 çağrı/saat, 400.000 jeton/gün)"**.
- **Ayarlar › "Bulut AI kayıt defteri":** `GET /v1/ai/ledger?limit=50` →
  `{schema:"collex.ai.ledger/v1", entries:[{at, route, model, chars,
  inputTokens, fileId?, matterId?, draftId?, sectionId?, masked}], today,
  limits, note}`. Tablo başlıkları: **Tarih · İşlem · Belge · Karakter ·
  Model · Maskelendi**. `note` satırı aynen gösterilir (*"…Belge metni, istem
  ve model çıktısı SAKLANMAZ."*). Tarihler **GG.AA.YYYY SS:DD**.

### 3.3 Klasör intake (B-19)

Sunucu tarafı bu dalgada **CLI**'da: `python -m intake.cli --dsn <dsn>
--dir <klasör> --json` → `{batch:{directory, total, ok, failed,
files:[{path, name, status:"ok"|"error", result?|kind+message}]}}`.
Konsolun klasör bırakma ekranı Faz B'de dosyaları tek tek mevcut
`POST /v1/files` yolundan geçirmelidir (HTTP tarafında toplu uç **yok**).
Başarısız dosya listesi için `name` + `message` gösterilir (B-10).

### 3.4 Sağlık ekranı additive alanları

- `rls: {expected: 18, present: N}` — `present < expected` ise **kırmızı**:
  *"Satır güvenliği eksik: N/18 politika — intake.cli --ensure-db ile
  tamamlayın."*
- `migrations.unknown: string[]` — boş değilse **turuncu**: *"Veritabanı bu
  sürümden daha yeni (N bilinmeyen migrasyon) — ColleX'i güncelleyin."*
- `version` artık `1.0.0` (dalga eki yok).

### 3.5 Belge ön incelemesi (B-37)

`analysis` sözlüğü additive `referencesAmbiguous` taşıyor. Konsol
**ATIFLAR**'ı ikiye ayırmalı: **"Eşleşen atıflar"** (`references`) ve
**"Belirsiz"** (`referencesAmbiguous`, açıklama: *"Kanun bağlamı bulunamadı —
sözleşme madde numarası olabilir"*). `claims` girdileri `ordinal` ve
`fromDemandBlock` taşıyabilir; numaralı olanlar **"SONUÇ VE İSTEM"** başlığı
altında sırasıyla gösterilmeli. `dates[].context` artık `…` ile kırpılmış
olabilir.

---

## 4. `openapi.yaml` additive deltası (L-DOCS, Faz B)

Faz A'da `openapi.yaml`'a **dokunulmadı**. Eklenecekler:

**Yeni yollar (5):**
1. `POST /v1/backup` → `BackupResult {path, sizeBytes, files, at, database, warning}`; 409 `BACKUP_IN_PROGRESS`, 500 `ApiError`.
2. `GET /v1/backup` → `{backup: BackupSummary | null}`.
3. `GET /v1/ai/ledger` (`?limit=1..200`) → `AiLedgerBody`.
4. `/v1/sources/*`, `/v1/contracts/*`, `/v1/citation-audit`, `/v1/fees/*` — **ilgili hatların** deltaları; bu hat yalnız **mount** etti.

**Additive alanlar:**
- `HealthResponse.rls: {expected: integer, present: integer} | null`
- `HealthResponse.backup: BackupSummary | null`
- `HealthResponse.version` — açıklama: depo kökündeki `VERSION` dosyası
  (örnek `1.0.0-w12` → **`1.0.0`**)
- `MigrationHealth.unknown: string[]`
- `AiStatus.limits {callsPerHour, inputTokensPerDay}`, `AiStatus.today {callsLastHour, inputTokensToday}`, `AiStatus.masking {required, modes, note}`
- `DocumentAnalysisBody.maskMode: "mask"|"as-is"`, `DocumentAnalysisBody.masked: [{kind,label,count}]`
- `AnalyzeDocumentRequest.maskMode` (**zorunlu**), `AnalyzeDocumentRequest.matterId` (isteğe bağlı)
- Yeni cevap: `MaskPreview` (`collex.ai.mask-preview/v1`)
- Yeni hata: **429 `AI_RATE_LIMITED`** (`limits` + `usage` taşır)
- Yeni hatalar: **421 `FOREIGN_HOST`**, **403 `FORBIDDEN_ORIGIN`** (her yol)
- Intake `analysis` şeması: additive `referencesAmbiguous`; `claims[]`
  additive `ordinal`, `fromDemandBlock`; `references[]` additive
  `resolvedFromContext`
- `IntakeResult` metadata: `upload.chars`

**Diğer belge deltaları (L-DOCS):**
- `CLAUDE.md` — ledger invaryantı artık **"her dosya ilk ve SON yarattığı
  nesne için probe ilan eder; bootstrap hepsi çözülürse kaydeder"** ve
  kindler `regclass · regprocedure · extension · type · column · trigger ·
  policy`. Yeni `.cmd` dosyaları (`ColleX-Yedekle.cmd`,
  `ColleX-Geri-Yukle.cmd`) ve `VERSION` directory map'e girer. `dist/`,
  `test/`, `example_fastapi_app.py` satırları **silinir**. Migration sayısı
  **11 → 12**.
- `RUNBOOK.md §7` — cevap önbelleği tavanı (32 × 5 MiB ≈ 160 MB teorik;
  ENGRISK 250 cevap sonrası 181,6 MB WS ölçtü, sızıntı yok);
  `AI_MAX_CALLS_PER_HOUR = 60`, `AI_MAX_INPUT_TOKENS_PER_DAY = 400 000`;
  `PDF_MAX_PAGES = 600`; `BATCH_MAX_FILES = 200`; yedek/geri yükleme
  komutları.
- `KULLANIM-ColleX.md` — "verileriniz bu bilgisayarda" cümlesi **yedek
  düğmesiyle** tamamlanır; `ColleX-Yedekle.cmd`/`ColleX-Geri-Yukle.cmd`
  anlatılır; Bulut AI bölümüne maskeleme önizlemesi + kayıt defteri girer.
- `STATUS.md` — "Ölçülen sayılar": RLS politika sayısı **17 → 18**,
  runnable migration **11 → 12**, `/v1/health.version` **1.0.0**.
  "Kalıcılık sözü · Çekince 1" ENGRISK E10 tablosuyla düzeltilmeli.
  "Known risks"e yedeğin **artık var olduğu** yazılmalı.
- `ADRS.md` — iki yeni ADR önerisi: (1) çoklu sentinel ledger kuralı,
  (2) bulut AI maskeleme + kayıt defteri (metin saklanmaz).

---

## 5. Ölçümler (bu makine, 02.09.2026)

```
cd control-plane && npx tsc --noEmit
  (çıktı yok — TEMİZ)

cd control-plane && npx vitest run
  Test Files  100 passed (100)
  Tests       1993 passed | 6 skipped (1999)
  Duration    26.38s
  → 6 atlamanın hepsi "environment unavailable" TERS işaretleyicileri;
    dört gerçek süit (persistence, serve, real-exec, real-export) + yeni
    backup disaster drill KOŞTU.

.venv/Scripts/python.exe -m pytest tests evals/tests -q
  1327 passed in 123.22s

# Bu hattın dosyaları, ayrı ayrı
npx vitest run tests/api.test.ts tests/store/persistence.test.ts tests/integration tests/ai
  Tests  221 passed | 4 skipped (225)

.venv/Scripts/python.exe -m pytest tests/ingestion tests/intake tests/test_repo_hygiene.py tests/test_pydantic_clean.py -q
  209 passed in 102.51s

.venv/Scripts/python.exe scripts/smoke_check.py
  offline smoke checks passed: 54 tools, court inventory, shared limiter,
  disabled-key errors, HTTP auth        (exit 0)

.venv/Scripts/python.exe scripts/db_local_check.py
  18/18 checks passed
  RESULT: PASS

node control-plane/scripts/demo.mjs
  S1..S6 hepsi PASS; SONUÇ: 6/6 senaryo beklenen duruma ulaştı.
```

**Temizlik.** Bu hat hiçbir sunucu bırakmadı: `var/*.pid` boş, 8787/8898
portlarına dokunulmadı, probe veritabanı `collex_safe_test` tatbikat
sonunda düşürüldü (`pg_database` listesiyle doğrulandı), `collex_local`'a
**tek satır yazılmadı**. Geçici dosyalar yalnız scratchpad'de.

---

## 6. Açık sorunlar ve dürüstlük notları

1. **CI bu dalgada koşmadı.** `ci.yml` düzeltildi ve YAML'ı doğrulandı;
   "dört atlama dörde koşuya döner" iddiası **yerelde eşdeğer ortamla**
   kanıtlandı, GitHub Actions üzerinde değil.
2. **Paylaşılan PostgreSQL çekişmesi.** Dalga sırasında `tests/ingestion`
   süiti üç kez rastgele farklı testlerde `AdminShutdown` /
   *"database … does not exist"* ile düştü ve dosyalar tek başına
   koşturulduğunda hep geçti. Kümede o anda başka hatların testleri de
   koşuyordu (paralel yedi hat, tek PostgreSQL 18 kümesi). Sonrasında art
   arda **4 temiz tur** ölçüldü. Bunu kendi değişikliklerime bağlı bir
   kırılganlık olarak **göremedim**, ama ölçüm olarak da gizlemiyorum:
   L-VERIFY'ın turu tek başına koşmalıdır.
3. **B-03'ün "küme sıfırdan kurulur" adımı yapılmadı** (§B-03). Tatbikat
   veritabanı düzeyinde koştu.
4. **B-32'nin 2 000 belgelik ölçümü yapılmadı** (bu hattın payı şema +
   metadata; sorgu değişikliği L-MATTER'da).
5. **`UPLOAD_CAP_MIB` 25'te kaldı** — üç kaynaklı invaryant, ikisi başka
   hatta (§B-19, integrationRequests).
6. **`COLLEX_DATA_DIR` varsayılanı `<repo>/var`** ve `var/uploads` taşıma
   yapılmadı (§B-34, bilinçli).
7. **B-23 `maskMode` yalnız `analyze-document`'te zorunlu.** OCR ve
   draft-paragraph gerekçeleriyle kapsam dışı (§B-23); ikisi de tavana ve
   kayıt defterine tabi.
8. **Bulut AI hâlâ canlı sınanmadı** — `liveTested:false` duruyor, bu
   dalgada tek bir gerçek Anthropic çağrısı yapılmadı.
9. **`control-plane/package.json` sürümü hâlâ `0.1.0`** — dosya bu hatta
   yasak (integrationRequests).
10. **İki dosyada ham NUL baytı duruyor** (allowlist'te, sahipleriyle).
11. `intake/analysis.py` hâlâ **sezgisel v1**'dir. B-37 ölçülen kusurları
    kapattı; bu bir **kalite artışı değil, kusur giderme**dir ve çıktı
    hâlâ `source: "heuristic"` taşır, delil değildir.
