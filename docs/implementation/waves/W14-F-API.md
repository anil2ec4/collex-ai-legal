# W14 — F-API (Faz F): sunucu dikişleri ve API dürüstlüğü

**Tarih:** 02.09.2026 · **Tip:** DÜZELTME — `W14-L-VERIFY.md` §5'in V-3, V-4 ve
V-6 kalemleri.
**Portlar:** 8972 (sunucu) · 8982 (MCP geçidi) — **8787/8898'e hiç
dokunulmadı**.
**Veritabanı:** `collex_api_test` (bu hattın kendi probe'u; kuruldu, ölçüldü,
**düşürüldü**). `collex_local`'a **hiç bağlanılmadı**, hiç yazılmadı.
`collex_intake_test` **yoktu ve `intake.cli --ensure-db` ile oluşturuldu** —
`control-plane/tests/integration/serve.test.ts`'in ihtiyaç duyduğu ad; yalnız
oluşturma, hiçbir şey düşürülmedi.
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, MCP araç
yüzeyi (54) değişmedi.

> Bu raporda yazan her sayı **bu koşuda bu makinede ölçüldü**.

---

## 0. Özet

Üç kusur da **önce gerçek bir sunucuda yeniden üretildi**, sonra düzeltildi,
sonra aynı sunucuda yeniden ölçüldü. Her düzeltmenin **düzeltme olmadan
DÜŞEN** bir gerileme testi var; kusurları koda geri koyarak
**vakıasızlıklarını kanıtladım** (§4).

| # | Kusur | Önce | Sonra |
|---|---|---|---|
| V-3 | `POST /v1/sources/search`, `--with-mcp` açıkken | **502 `UPSTREAM_UNAVAILABLE`** ("sunucuyu `--with-mcp` ile başlatın") | **502 `ALL_SOURCES_FAILED`**, `Yargıtay: kaynak sunucuya ulaşılamadı (UNAVAILABLE)` — istek geçide **ulaştı** (`search_bedesten_unified`, 140 ms) |
| V-4 | `GET /v1/files/{id}/original`, `COLLEX_DATA_DIR` ayarlı | **404 `ORIGINAL_NOT_FOUND`** | **200**, 214 bayt, sha256 aslıyla **birebir aynı**; dosya paketi de aslı taşıyor |
| V-6 | `GET /v1/answers` süzgeçleri | `?q=zzzzunlikely` → **3 satır**, `?status=COMPLETE` → **ABSTAIN satırları**, `?bogus=1` → **200** | `?q=zzzzunlikely` → **0 satır**, `?status=COMPLETE` → **0 satır**, `?status=ABSTAIN` → 3 satır, `?bogus=1` → **tipli 400** |

---

## 1. V-3 — canlı MCP geçidi artık "Karar ara" ekranına da bağlı

### 1.1 Yeniden üretme (düzeltme öncesi, gerçek sunucu)

```
node control-plane/scripts/serve.mjs --port 8972 --mcp-port 8982 --with-mcp \
     --dsn postgres://postgres@127.0.0.1:55432/collex_api_test

GET  /v1/research/health -> {"gateway":"ok","toolCount":54,"state":"ok"}
GET  /v1/health          -> mcp:"ok"  db:"ok"  registeredToolCount:54
POST /v1/sources/search {"query":"tahliye taahhüdü","sources":["yargitay"]}
  -> 502 {"kind":"UPSTREAM_UNAVAILABLE",
          "message":"Resmî kaynak geçidi bu sunucuda yapılandırılmamış
                     (sunucuyu --with-mcp ile başlatın); …"}
```

Yani sunucu, avukata **zaten yaptığı şeyi** tavsiye ediyordu.

### 1.2 Kök neden ve düzeltme

`src/api/server.ts` canlı geçidi `deps.mcp`'den `researchGateway` olarak
kuruyor ve **yalnız** `createResearchRouter`'a veriyordu; `createSourcesRouter`
mount'u `deps.gateway`'i okuyordu ve `scripts/serve.mjs` onu **hiç
göndermiyor**. Aynı 54 aracı aynı oturum taşıyıcısı üzerinden çağıran iki
router artık **aynı geçidi** alıyor:

```ts
const sourcesGateway = gateway ?? researchGateway;
```

Açıkça verilen `deps.gateway` (testler, kendi sağlayıcısı olan korpus-yalnız
bir kurulum) önceliklidir; yoksa `--with-mcp`'nin zaten başlattığı canlı MCP
çocuğu kullanılır.

### 1.3 Düzeltme sonrası — GERÇEK `--with-mcp` koşusu

```
POST /v1/sources/search {"query":"tahliye taahhüdü","sources":["yargitay"]}
  -> 502 {"kind":"ALL_SOURCES_FAILED",
          "message":"Seçilen kaynakların hiçbirine ulaşılamadı;
                     sonuç listesi BOŞ DEĞİL, YOK.",
          "failedSources":[{"sourceId":"yargitay","sourceLabel":"Yargıtay",
                            "kind":"UNAVAILABLE",
                            "message":"Yargıtay: kaynak sunucuya ulaşılamadı
                                       (UNAVAILABLE). Bu kaynağın sonuçları
                                       listede YOK."}]}
  trace: [{tool:"search_bedesten_unified", ok:false, ms:140,
           errorKind:"UNAVAILABLE"}]
```

Hata **türü değişti**: "yapılandırılmamış" değil, **kaynak bazında
erişilemezlik**, ve erişilemeyen kaynak **adıyla** yazılıyor. Varsayılan
kaynak kümesiyle (2 kaynak) aynı sonuç, 6,65 sn.
`POST /v1/sources/fetch` de artık geçide ulaşıyor (`PARSER_ERROR`, yani belge
düzeyinde bir başarısızlık — `UPSTREAM_UNAVAILABLE` değil).

> **Ölçemediğim:** devlet upstream'lerine bu makineden erişilemiyor, bu yüzden
> "bağlansaydı künye döner miydi" sorusunun cevabı **ölçülmedi**. Ölçebildiğim,
> isteğin artık geçide **gerçekten ulaştığı** ve başarısızlığın **kaynağı
> adlandıran tipli bir başarısızlık** olduğudur. Sahte geçitli test gerçek
> satır döndürüyor (§4).

### 1.4 Hata metni

`src/sources/routes.ts::NO_GATEWAY_MESSAGE` artık **yalnız geçit gerçekten
yokken** görülür ve avukatın yapabileceği eylemle başlar:

> "Resmî kaynak geçidi bu sunucuda açık değil; kaynak araması yapılamaz.
> ColleX'i masaüstündeki başlatıcıyla açtığınızda geçit de açılır (sunucuyu
> elle başlatıyorsanız --with-mcp ekleyin)."

Operatör bayrağı cümlenin **sonunda**, avukatın okuduğu ilk talimat değil.

---

## 2. V-4 — `COLLEX_DATA_DIR` kurulumunda "Aslını indir"

### 2.1 Yeniden üretme (düzeltme öncesi)

`COLLEX_DATA_DIR=<scratch>` ile sunucu; bir `.txt` yüklendi. Asıl
`<COLLEX_DATA_DIR>/uploads/<sha256>.txt` olarak yazıldı (**diskte
doğrulandı**), depo içindeki `var/uploads` **boş kaldı**.
`GET /v1/files/4cbee18cee4c65b3/original` → **404 `ORIGINAL_NOT_FOUND`**.

### 2.2 Kök neden ve düzeltme

`files/routes.ts:450` ve `matters/packageRoutes.ts:151` `deps.uploadsDir ??
join(repoRoot,"var","uploads")` diyor; `createApp` **hiçbirine**
`uploadsDir` geçirmiyordu, `serve.mjs` ise `path.join(VAR_DIR,"uploads")`
değerini yalnız **yedekleme** portuna veriyordu.

* `ApiDependencies.uploadsDir` eklendi (ek alan, yokluğu eski davranış).
* `createApp` bunu **bir kez** çözüyor ve **hem** `createFilesRouter`'a **hem**
  `createMatterPackageRouter`'a veriyor.
* Yeni `envUploadsDir(env)`: `COLLEX_DATA_DIR` doluysa `<dir>/uploads`, boşsa
  `undefined` — `serve.mjs::resolveDataDir` ve `intake/ingest.py` ile aynı
  kural. Böylece süreç-içi `createApp` de dosyaları yazan süreçle **çelişemez**.
* `serve.mjs` değeri **açıkça** geçiyor (yedekleme portuyla **aynı ifade**).

### 2.3 Düzeltme sonrası (aynı sunucu, aynı belge)

```
GET /v1/files/4cbee18cee4c65b3/original -> 200
  content-length: 214 · content-type: text/plain
  content-disposition: attachment; filename="probe-belge.txt"; filename*=UTF-8''…
  sha256(indirilen) == sha256(<COLLEX_DATA_DIR>/uploads/<sha256>.txt)
                    == sha256(yüklenen dosya)   -> BİREBİR AYNI
```

Dosya paketi de düzeldi:
`POST /v1/matters/{id}/package` → ZIP içinde `belgeler/probe-belge.txt`
**214 bayt**, `MANIFEST.json` `entries[0].sha256` aslın sha256'sı. Düzeltmeden
önce paket "yalnız adı yazıldı" notuyla çıkardı.

---

## 3. V-6 — `GET /v1/answers` süzgeçleri gerçekten uygulanıyor

### 3.1 Yeniden üretme (düzeltme öncesi, `PgAnswerStore` ile)

Üç cevap üretildi (üçü de ABSTAIN, üç farklı soru):

| İstek | Ölçülen |
|---|---|
| `?q=zzzzunlikely&limit=5` | **3 satır** (süzgeçsizle aynı) |
| `?status=COMPLETE&limit=10` | **3 satır**, hepsi `ABSTAIN` |
| `?bogus=1` | **200** |
| `/v1/files?bogusparam=1` (karşılaştırma) | **400** |

### 3.2 Düzeltme

`src/api/server.ts` `GET /v1/answers` artık `q` ve `status`'ü okuyup
mağazaya geçiriyor (her iki mağaza da şeritleri zaten uyguluyordu) ve
`unknownQueryIssues` ile **tanınmayan sorgu parametresini** `/v1/files`'ın
verdiği **aynı tipli 400** ile reddediyor. `status` `ANSWER_STATUSES` dışıysa
400; `q` 200 kod noktasını aşarsa 400; **yalnız boşluktan ibaret `q` süzgeç
sayılmaz**.

### 3.3 Düzeltme sonrası (aynı sunucu, aynı üç cevap)

| İstek | Ölçülen |
|---|---|
| `?limit=10` | 3 satır |
| `?q=zzzzunlikely&limit=5` | **0 satır**, 200 |
| `?q=depozito` | **1 satır** (`depozito iadesi ne zaman yapilir`) |
| `?status=COMPLETE&limit=10` | **0 satır** |
| `?status=ABSTAIN&limit=10` | **3 satır**, hepsi `ABSTAIN` |
| `?bogus=1` | **400** · `{"path":"bogus","message":"Tanınmayan sorgu parametresi. Kullanılabilir: matterId, fileId, q, status, limit."}` |
| `?status=TAMAMLANDI` | **400** · `"Durum süzgeci şunlardan biri olmalı: COMPLETE, QUALIFIED, PARTIAL, ABSTAIN."` |
| `?matterId=&fileId=&q=&status=&limit=2` | **200** (boş değer = süzgeç yok, eski davranış) |

---

## 4. Gerileme testleri ve **vakıasızlık kanıtı**

Yeni testler (hepsi çevrimdışı, sahte geçit / sahte depo / geçici klasör):

| Dosya | Test | Neyi kanıtlıyor |
|---|---|---|
| `tests/api.test.ts` | V-6 · `?q=` süzüyor | 0 satır, büyük/küçük harf duyarsız isabet, boşluk süzgeç değil |
| `tests/api.test.ts` | V-6 · `?status=` | COMPLETE altında ABSTAIN satırı yok; `q` + `status` birlikte |
| `tests/api.test.ts` | V-6 · tanınmayan parametre / durum / uzun `q` | tipli 400, `/v1/files` deseni |
| `tests/api.test.ts` | V-3 · `researchGateway` ile gerçek satır | 1 künye satırı, `search_bedesten_unified` çağrıldı, `failedSources` boş |
| `tests/api.test.ts` | V-3 · `deps.gateway` önceliği + `fetch` dikişi | açık geçit kazanır; `fetch` de `UPSTREAM_UNAVAILABLE` demiyor |
| `tests/api.test.ts` | V-3 · geçit gerçekten yokken | 502, cümle avukat eylemiyle başlıyor, `--with-mcp` **sonda** |
| `tests/files/w14.test.ts` | V-4 · `COLLEX_DATA_DIR` ile indirme | 200 + bayt eşitliği |
| `tests/files/w14.test.ts` | V-4 · açık `uploadsDir` önceliği / `envUploadsDir` / gerçekten yoksa 404 | seam'in üç kenarı |
| `tests/integration/serve.test.ts` | V-4 · launcher yarısı | `serve.mjs` `createApp`'e `path.join(VAR_DIR,"uploads")` veriyor, yedekleyiciyle **aynı ifade** |

**Vakıasızlık:** üç kusur da koda geri kondu ve testler **düştü**:

```
V-6 (q/status/bilinmeyen parametre geri konunca)
  × ?q= …            expected [ {…}, {…} ] to deeply equal []
  × ?status= …       expected [ 'run-1','run-2' ] to deeply equal [ 'run-1' ]
  × bilinmeyen …     /v1/answers?bogus=1: expected 200 to be 400
V-3 (mount `deps.gateway`'e geri döndürülünce)
  × gerçek satır …   expected 502 to be 200
  × fetch dikişi …   expected 'UPSTREAM_UNAVAILABLE' not to be 'UPSTREAM_UNAVAILABLE'
V-3 (eski hata metni geri konunca)
  × dürüst ret …     expected 'Resmî kaynak geçidi bu sunucuda yapıl…'
                     to match /^Resmî kaynak geçidi bu sunucuda açı…/
V-4 (uploadsDir geçişi silinince)
  × COLLEX_DATA_DIR …           expected 404 to be 200
  × açık uploadsDir önceliği …  expected 404 to be 200
```

Her defasında kusur geri alındı ve süit yeşile döndü.
**Hiçbir test zayıflatılmadı, atlanmadı veya silinmedi.**

---

## 5. Ölçülen süit sayıları (bu koşu)

| Komut | Sonuç | Exit |
|---|---|---:|
| `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | 0 |
| `control-plane> npx vitest run tests/api.test.ts tests/files tests/matters tests/integration tests/research tests/capabilities tests/store tests/planner` (bu hattın dosyalarına dokunan süitler) | **33 dosya · 592 geçti · 0 DÜŞTÜ · 5 atlandı (597)** | 0 |
| `control-plane> npx vitest run` (tam süit) | **102 dosya · 2 053 geçti · 5 DÜŞTÜ · 6 atlandı (2 064)** | 1 |

**Düşen 5 testin beşi de `tests/pipeline/console.test.ts` içindedir ve
`control-plane/public/console.html`'in metnini sınar** — bu hattın
dokunmadığı, **eşzamanlı konsol hattının o sırada düzenlediği** dosya
(mtime 20:30:32, koşudan iki dakika önce). Düşen iddialar birebir:
`"Belge deposu:"` (V-16), `"ANTHROPIC_API_KEY tanımlı değil"` ve
`"ANTHROPIC_API_KEY tanımlı değil — Ayarlar …"` (V-18),
`classList.toggle("compact", !first)` ve LANG-7 adlandırma pini — yani
konsol hattının **tam da düzelttiği** kalemler. Bu hattın hiçbir dosyası
o testlerde geçmiyor; bu hattın dosyalarına dokunan 33 süitin **hepsi
yeşil**.

Ayrıca `tests/integration/serve.test.ts` ilk koşuda düştü çünkü
`collex_intake_test` **veritabanı makinede yoktu**; `intake.cli --ensure-db`
ile (yalnız oluşturma) kurulduktan sonra **5 geçti / 1 atlandı**.

---

## 6. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `control-plane/src/api/server.ts` | `sourcesGateway` (V-3) · `ApiDependencies.uploadsDir` + `envUploadsDir()` + iki router'a geçiş (V-4) · `GET /v1/answers` `q`/`status`/`ANSWER_LIST_QUERY_PARAMS`/`MAX_ANSWER_QUERY_CODE_POINTS` (V-6) |
| `control-plane/src/sources/routes.ts` | `NO_GATEWAY_MESSAGE` yeniden yazıldı (V-3) |
| `control-plane/scripts/serve.mjs` | `createApp({ …, uploadsDir: path.join(VAR_DIR,"uploads") })` (V-4) |
| `control-plane/tests/api.test.ts` | V-3 ve V-6 gerileme testleri (6 test) |
| `control-plane/tests/files/w14.test.ts` | V-4 seam testleri (4 test) |
| `control-plane/tests/integration/serve.test.ts` | V-4 launcher testi (1 test) |
| `docs/implementation/waves/W14-F-API.md` | bu rapor |

**API sözleşmesi:** `uploadsDir` ve `q`/`status` **eklemeli**. Tek davranış
değişikliği, `GET /v1/answers`'ın **tanınmayan** sorgu parametresini artık
reddetmesidir — bu, `/v1/files`'ın zaten uyguladığı sözleşmedir ve sessizce
düşürülen bir süzgecin yerine geçer. MCP araç yüzeyi **54**, değişmedi.

---

## 7. integrationRequests (başka hatların dosyaları)

1. **`control-plane/public/console.html` — "Karar ara" vaporware kapısı.**
   Geçit kapalıyken (`/v1/health.mcp !== "ok"` ya da
   `/v1/sources/manifest`'in `durumNotu`'su) ekran **devre dışı ve nedeni
   yazılı** çizilmeli. Ayrıca 502 `ALL_SOURCES_FAILED` gövdesindeki
   `failedSources[]` avukata **kaynak adıyla** gösterilmeli — bugün tek bir
   hata cümlesi çıkıyor. (V-3'ün arayüz yarısı; sunucu tarafı kapandı.)
2. **`control-plane/public/console.html` — cevap listesi süzgeçleri.**
   `GET /v1/answers` artık `q` ve `status`'ü uyguluyor; konsol bunları
   gönderebilir. Tanınmayan bir sorgu parametresi artık **400**, dolayısıyla
   konsol yalnız `matterId, fileId, q, status, limit` göndermeli. (V-6.)
3. **`control-plane/src/api/openapi.yaml`** — üç düzeltme: (a) `/v1/answers`
   `q`/`status` parametreleri ve tanınmayan parametre 400'ü; (b) satır ~2760
   `/v1/sources/search` 502 açıklaması artık "`--with-mcp` ile başlatın"
   demiyor — geçit bağlıyken `ALL_SOURCES_FAILED` döner; (c) satır ~3625/3652
   "`var/uploads/`" ifadesi `<COLLEX_DATA_DIR>/uploads` (varsayılan
   `var/uploads`) olmalı.
4. **`control-plane/src/matters/packageRoutes.ts` + `src/files/routes.ts` +
   `openapi.yaml` — "var/uploads klasöründe yok" metni.** Aynı cümle üç yerde
   duruyor ve `COLLEX_DATA_DIR` kurulumunda **yanlış klasörü** işaret ediyor;
   ayrıca avukatın önünde çıplak bir yol. Üçü **birlikte** değiştirilmeli
   (bu hat yalnız `files/routes.ts`'e sahip, yarım değiştirmek daha kötü).
5. **`docs/implementation/STATUS.md`** — bu koşuda ölçülen satırlar (§5) ve
   V-3/V-4/V-6'nın kapandığı; `S2` yeniden ölçülmeli (bu koşuda tam süit,
   eşzamanlı konsol hattı yüzünden, temsil edici değil).
6. **`control-plane/src/matters/routes.ts` gözlemi (bu hattın dosyası, ama
   V-19 kalemi):** `POST /v1/matters/{id}/items` `.strict()` reddinde
   `{"path":"","message":"Tanınmayan alan."}` çıkıyor — V-19'un
   `/v1/drafts`'ta bildirdiği kusurun aynısı. Tek elden (zod strict
   `issue.path` boş kalıyor) düzeltilmeli; bu hattın kapsamında değildi.

---

## 8. Hijyen

* Açtığım iki sunucu da **nazikçe** kapatıldı (`collex.stop`); `netstat`:
  **8972 ve 8982'de dinleyici yok**, **8787/8898'e hiç dokunulmadı**.
  Oluşturduğum pid dosyaları silindi; depo `var/*.pid` **yok**.
* `collex_api_test` kuruldu, ölçüldü ve koşu sonunda **düşürüldü**
  (`pg_database` listesiyle doğrulandı).
* `collex_local`'a **hiç bağlanılmadı**. Depo `var/uploads` koşu öncesi ve
  sonrası **0 dosya**.
* `collex_intake_test` yoktu; `intake.cli --ensure-db` ile **yalnız
  oluşturuldu** (13 migrasyon). Hiçbir veritabanı düşürülmedi, `collex_demo`
  yeniden kurulmadı (eşzamanlı hatlar kullanıyor olabilir).
* Bütün geçici dosyalar
  `…/scratchpad/w14f-F-API/` altında. Git işlemi yok, `.env` okunmadı,
  Supabase/Resend kullanılmadı. Devlet upstream'lerine giden tek istek
  §1.3'teki `search_bedesten_unified` çağrısıdır ve **ulaşamadı**.
