# W14 — C-SRV (Faz C): sunucu, yedekleme ve dışa aktarma

**Tarih:** 03.09.2026 · **Tip:** DÜZELTME — W14-F-VERIFY'ın açık bıraktığı
üç P1 (V-14, V-19, V-21) ile üç ek kalem (N-1, N-2, N-3).
**Portlar:** bu hat kendi sunucusunu hiç açmadı; `serve.mjs` yalnız vitest'in
`integration/serve.test.ts` süiti tarafından, kendi geçici portunda
başlatılıp kapatıldı. **8975/8985'te dinleyici bırakılmadı; 8787/8898'e hiç
dokunulmadı** (koşu sonunda `netstat`: dördünde de dinleyici yok).
**Veritabanları:** `collex_srv_test` (bu hattın kendi probe'u — kuruldu,
ölçüldü, **düşürüldü**) · `collex_eval_test` (`run_evals.py`'nin kendi
veritabanı) · `collex_safe_test` / `collex_answer_test` /
`collex_persist_test` / `collex_intake_test` (vitest süitlerinin kendi
veritabanları; her biri kendi süiti tarafından düşürüldü).
**`collex_local`'a hiç bağlanılmadı, hiç yazılmadı. `collex_demo`'ya hiç
dokunulmadı** (§7).
Git işlemi yok, `.env` okunmadı, Supabase/Resend kullanılmadı, MCP yüzeyi
(54) değişmedi, API değişiklikleri **eklemeli**.

> Bu raporda yazan her sayı **bu koşuda bu makinede ölçüldü**. Ölçemediğim ya
> da yeniden üretemediğim yere bunu açıkça yazdım ve başka bir hattın sayısını
> kendi ölçümüm gibi göstermedim. Ölçek sayıları **SENTETİK** probe
> korpusundadır (200 sözcüklük bir dağarcıktan üretilmiştir); trigram ve
> sözcük çeşitliliği gerçek Türk hukuk metninin çeşitliliği **değildir** ve
> hiçbiri hukukî kalite ölçüsü değildir.

---

## 0. Yönetici özeti

| Kalem | Öncelik | Hüküm | Kanıt |
|---|---|---|---|
| **V-14** yedek arşivi her zaman `collex_local.dump` | P1 | **KAPANDI** | Arşiv artık `<veritabanı>.dump`; geri yükleyici adı `yedek.json`'dan okuyor. Uçtan uca kanıt: `collex_srv_test` → yedek → **düşür** → geri yükle → satır eşitliği (§1) |
| **V-19** `.strict()` reddinde boş `path`/`label` | P1 | **KAPANDI** | `POST /v1/drafts` → `{"path":"bogusAlan","label":"Fazladan alan (bogusAlan)","message":"Tanınmayan alan."}`; `POST /v1/matters/{id}/items` → `{"path":"bilinmeyenAlan",…}` (§2) |
| **V-21** konu dışı soruda karşıt otorite taraması koşuyor | P1 | **KAPANDI** | Aynı soruda korpus çağrısı **3 → 1**, `executed:false`, `skipped:true`, ekranda "tarama gerekmedi" (§3). Eval kapısındaki karşıt otorite recall'ü **1,0000** kaldı |
| **N-3** TASLAK DOCX'te çıplak kanıt kimliği | P2 | **KAPANDI** | `'ev-f4d6…' alıntısı …` → `bir kanıtın (kanıt kimliği: ev-f4d6…) alıntısı …`; NİHAİ kopya zaten temizdi ve öyle kaldı (§4) |
| **N-2** (sunucu yarısı) `var/uploads` metni | P2 | **KAPANDI** | Üç yüzey (rota, paket notu, `openapi.yaml`) aynı cümleyi taşıyor ve üçünü birden okuyan bir test var (§5). Konsol yarısı **zaten düzeltilmiş** durumda bulundu |
| **N-1** trigram eşiği yorumu + eşik kararı | P1 | **DÜZELTİLDİ + ÖLÇÜLDÜ, DEĞİŞİKLİK YOK** | Yorum artık hangi sayının hangi eşiğe ait olduğunu yazıyor. Eşiği 0,35 → 0,5 yapmak **ölçüldü ve geri alındı**: zaman kazancı yok, bir şerh kayboluyor (§6) |

**Tam ölçüm turu (§8): dört komutun dördü de exit 0.** `npx tsc --noEmit`
temiz · `npx vitest run` **103 dosya · 2 114 geçti · 0 DÜŞTÜ · 6 atlandı** ·
`pytest tests evals/tests -q` **1 347 passed** · `run_evals.py --run-date
2026-09-03` **RESULT: PASS** (altı sert kapının altısı).

**Her düzeltmenin bir gerileme testi var ve her testin boş olmadığı, kusuru
bir kez geri koyup düşüşü izleyerek kanıtlandı** (§9).

---

## 1. V-14 — arşiv, yedeklediği veritabanının adını taşıyor

### 1.1 Kusurun yeniden üretilmesi

`backup.mjs --database collex_srv_test` → arşiv dosyası **`collex_local.dump`**,
`yedek.json` ise `"database":"collex_srv_test"`. `ColleX-Geri-Yukle.cmd`
şu kontrolü yapıyordu:

```
if not exist "%SRC%\collex_local.dump" (...)
...
pg_restore ... "%SRC%\collex_local.dump"
```

Yani **geri yükleyeceği sabitin var olup olmadığını** kontrol ediyordu. Bu
kontrol bir uyuşmazlığı hiçbir zaman yakalayamazdı; yalnızca her yedek o tek
adla yazıldığı için **tesadüfen** çalışıyordu.

### 1.2 Düzeltme

* `control-plane/src/backup/runner.ts`: `BACKUP_DUMP_FILE` sabiti kalktı,
  yerine **`backupDumpFileName(database)`** geldi
  (`[A-Za-z0-9_.-]` dışındaki her karakter `_`, baştaki noktalar `_`, boş ad
  `veritabani`). Bir veritabanı adı **dosya adı** olduğu için türetiliyor,
  güvenilmiyor: hiçbir ad yol ayracı, üst dizin göndermesi ya da gizli dosya
  üretemez. Eski sabit `BACKUP_DUMP_FILE_LEGACY` olarak **yalnız eski
  yedekleri okumak için** duruyor.
* `BackupResult.dumpFile` ve `VerifyReport.dumpFile` **eklemeli** yeni
  alanlar; `verifyBackup` adı manifestten okur.
* `control-plane/scripts/backup.mjs`: yeni **`--dump-name <klasör>`** kipi
  arşivin adını `yedek.json`'dan okuyup **çıplak** olarak stdout'a basar
  (her tanı satırı stderr'e gider), ve hem yedekleme hem doğrulama çıktısına
  `arşiv dosyası:` satırı eklendi.
* `ColleX-Geri-Yukle.cmd`: `where node` kontrolü öne alındı, ardından
  `for /f … backup.mjs --dump-name "%SRC%" 2^>nul` ile ad okunuyor; ad boşsa
  betik **Türkçe bir cümleyle duruyor** ve hiçbir şeye dokunmuyor. Varlık
  kontrolü de, `pg_restore` de artık `%SRC%\%DUMPNAME%`.
* `ColleX-Yedekle.cmd`: başlıktaki açıklama düzeltildi.

### 1.3 Uçtan uca kanıt (kendi probe veritabanımda)

```
psql -d collex_srv_test -f seed.sql        -> 2 satır (Türkçe karakterli)
backup.mjs --database collex_srv_test      -> exit 0
                                              arşiv dosyası: collex_srv_test.dump
                                              1,8 KB · 1 belge aslı
yedek.json      "database": "collex_srv_test" · "path": "collex_srv_test.dump"
icindekiler.txt ";     dbname: collex_srv_test"
backup.mjs --dump-name <klasör>            -> "collex_srv_test.dump"   exit 0
backup.mjs --verify  <klasör>              -> "2 dosyanın tamamı eksiksiz."
                                              arşiv dosyası: collex_srv_test.dump   exit 0
drop database collex_srv_test / create     -> to_regclass('probe.matters') = null
pg_restore ... "<klasör>/collex_srv_test.dump"  -> exit 0
diff before.txt after.txt                  -> FARK YOK
                                              1|Kira — Yılmaz / Demir
                                              2|İş — Kaya / X A.Ş.
```

Manifesti olmayan bir klasörde `--dump-name` **exit 1** verir, stdout boş
kalır ve `.cmd` "Bu klasor bir ColleX yedegi degil" diyerek durur.

Gerçek `pg_dump`/`pg_restore` ile felaket tatbikatı
(`tests/integration/backup.test.ts`, `collex_safe_test`) de yeni adla geçti:
**873 ms**, satırlar birebir aynı.

### 1.4 Gerileme testleri

* `tests/integration/backup.test.ts` — iki yeni test: (a) adın veritabanından
  türediği, `pg_dump`'ın **o dosyaya** yazdığı, manifestin aynı adı yazdığı ve
  `collex_local` için adın **değişmediği**; (b) ad türetmesinin hiçbir girdide
  yol üretemediği. Tatbikat testi de artık `result.dumpFile` üzerinden geri
  yüklüyor ve `collex_local.dump` dosyasının **bulunmadığını** doğruluyor.
* `tests/integration/launcher.test.ts` — `.cmd`'nin `rem` dışı satırlarında
  `collex_local.dump` geçmediği, adın `--dump-name` ile okunduğu, önce
  okunup sonra kontrol edildiği ve boş ad hâlinde durduğu.

---

## 2. V-19 — reddedilen alanın adı söyleniyor

### 2.1 Kusur

zod, `unrecognized_keys` sorununu **kapsayan nesnenin** yolunda bildirir ve
adları `issue.keys` içine koyar. Gövdenin kendisi için bu yol **boş dizidir**,
`issue.path.join(".")` `""` olur:

```json
{"path":"","label":"","message":"Tanınmayan alan."}
```

Bu satırı hiçbir arayüz işaretleyemez. Ölçüldü: `POST /v1/drafts` (6 doğru
satırın yanında bu bir satır) ve `POST /v1/matters/{id}/items` (tek satır).

### 2.2 Düzeltme

Yeni ve tek bir yardımcı: **`control-plane/src/api/zodIssues.ts`**.
`fieldIssues(error, translate?, prefix?)` her fazladan alan için **ayrı bir
sorun satırı** üretir ve satırın `path`'i alanın kendi noktalı yoludur.
(Eski `ai/routes.ts` çözümü anahtarları tek bir noktalı dizeye birleştiriyordu
— iki fazladan alan `"a.b"` gibi, var olmayan bir iç içe yol gibi okunuyordu;
artık iki fazladan alan iki satırdır.)

`.strict()` kullanan **her** rota bu yardımcıya bağlandı:
`api/server.ts` (üç yer), `matters/routes.ts`, `matters/contactsRoutes.ts`,
`drafting/routes.ts` (iki yer), `settings/routes.ts`, `fees/routes.ts`,
`deadlines/routes.ts`, `contracts/routes.ts` (üç yer), `ai/routes.ts`,
`sources/routes.ts`, `research/routes.ts`.

Etiket tarafı: `drafting/routes.ts` içindeki `labeledIssues`, tanınmayan bir
alan için `labelForPath`'in çıplak anahtarı yankılamasına izin vermiyor;
**`Fazladan alan (<anahtar>)`** yazıyor (Türkçe önce, makine dizesi parantez
içinde). Mesaj metni değişmedi: alanı `path` adlandırıyor, cümle değil.

### 2.3 Ölçülen sonuç

```
POST /v1/drafts        {"template":"dava-dilekcesi","bogusAlan":1,...}
  öncesi: {"path":"",          "label":"",                        "message":"Tanınmayan alan."}
  sonrası:{"path":"bogusAlan", "label":"Fazladan alan (bogusAlan)","message":"Tanınmayan alan."}
POST /v1/matters/{id}/items {"kind":"note","payload":{"text":"a"},"bilinmeyenAlan":2}
  öncesi: {"path":"",               "message":"Tanınmayan alan."}
  sonrası:{"path":"bilinmeyenAlan", "message":"Tanınmayan alan."}
PUT /v1/settings       {"profile":{"imza":"x"},"preferences":{}}
  öncesi: {"path":"profile",       ...}   (sorunsuz olan nesneyi işaret ediyordu)
  sonrası:{"path":"profile.imza",  ...}
```

`tests/settings/routes.test.ts`'teki iddia **daraltıldı** (`profile` →
`profile.imza`); hiçbir test gevşetilmedi.

### 2.4 Gerileme testleri

`tests/api.test.ts` (üç test): yardımcının iki fazladan alanı iki satır
yaptığı ve önekin çalıştığı; `POST /v1/drafts`'ın alanı **ve** Türkçe
etiketini verdiği; `POST /v1/answer`'ın da adlandırdığı — üçünde de yanıttaki
**hiçbir** satırın `path`'i boş değil.
`tests/matters/routes.test.ts`: `/v1/matters` ve `/v1/matters/{id}/items`
için tam eşitlik (`toEqual`) iddiaları.

---

## 3. V-21 — gereksiz karşıt otorite taraması

### 3.1 Kusurun yeniden üretilmesi

`"en iyi balik restorani hangisi"` (boş dönen korpus):

```
corpus calls     : 3
queries          : ['en iyi balik restorani hangisi',
                    'en iyi balik restorani hangisi "aksi yönde"',
                    'en iyi balik restorani hangisi "karşı oy"']
contrary.executed: true
note             : 2 karşıt otorite sorgusu çalıştırıldı; karşıt otorite pasajı
                   bulunamadı; hiçbir tespitte çelişki tespit edilmedi.
```

İki gereksiz şerit sorgusu (her biri tam bir retrieval, trigram bütçesi
dâhil) ve **gerçek bir tarama yapılmış izlenimi** veren bir cümle.

### 3.2 Düzeltme ve kapının neden güvenli olduğu

`answerPipeline.ts`'in `retrieve` aşaması ikiye ayrıldı (aşama listesi —
konsolun çizdiği yayımlanmış sözleşme — **değişmedi**): önce birincil
şeritler, sonra karar, sonra karşıt şeritler. Atlama koşulu bilerek
**kanıtlanabilir biçimde dar** tutuldu:

* **hiçbir pasaj `pinned` değil** — sabitlenmiş bir pasaj, okurun metni adıyla
  istediği ve kapının **atlandığı** durumdur; ve
* `assessQuestionCoverage(...).bestPassageCovered === 0` — birincil şeritlerin
  getirdiği **hiçbir pasaj** hukukî soruyla tek bir içerik sözcüğü bile
  paylaşmıyor.

`decideCoverageGate`, `bestPassageCovered` soruyu çıpalayamadığında (≥ 2, ya
da tek sözcüklük soruda hepsi) **her hâlükârda** `failed` verir; kanıt
paketinin alıntıları bu pasajların **dilimleridir**, dolayısıyla sözcük
kümeleri ancak küçülebilir. Yani kapı **kesinlikle** düşecek, her pasaj
kenara alınacak ve cevap kanıtsız çekimser kalacaktır — bir karşıt şeridin
ekleyeceği şey de onunla birlikte kenara alınırdı.

**Tek bir pasaj soruyu çıpaladığı anda (ya da bir şey sabitlendiği anda)
bütün karşıt şeritler eskisi gibi koşar.** Bu, karşıt otorite güvencesini
**dayanağı olan** cevaplar için hiç daraltmaz.

`ContraryCoverage` **eklemeli** bir alan kazandı: `skipped: boolean`.
`executed:false` tek başına "bu soru için karşıt sorgu üretilemedi" ile
"üretildi ama gerekmediği için koşturulmadı" arasını ayıramıyordu ve
ekrandaki cümlenin hangisi olduğunu söylemesi gerekiyor.
(`research/researchService.ts` canlı araştırma hattı için `skipped:false`
yazar: orada planlanan şerit koşulur.)

### 3.3 Ölçülen sonuç

```
corpus calls     : 1
queries          : ['en iyi balik restorani hangisi']
contrary.executed: false     contrary.skipped: true     lanes: 0
note             : Bu soruda dayanak olabilecek pasaj bulunamadığı için karşıt
                   otorite taraması gerekmedi ve yapılmadı; hiçbir tespitte
                   çelişki tespit edilmedi.
markdown         : "Karşıt otorite taraması yapılmadı. Bu soruda dayanak olarak
                    kullanılabilecek hiçbir pasaj bulunamadı; çürütülecek bir
                    dayanak olmadığı için tarama gerekmedi. Dayanağı olan her
                    cevapta karşıt otorite taraması çalışır."
status           : ABSTAIN
```

Cümlede artık ne "çalıştırıldı" ne de "karşıt otorite pasajı bulunamadı"
geçiyor.

### 3.4 Güvencenin bozulmadığının kanıtı

* `run_evals.py --run-date 2026-09-03`: **karşıt otorite recall'ü 1,0000
  (n=3)**, şerit dağılımı `exact=36, lexical=67, trigram=5, dense=0,
  relation=17, citation=12` — F-VERIFY turuyla rakam rakam aynı; durum
  dağılımı da aynı (`ABSTAIN=13, COMPLETE=13, PARTIAL=3, QUALIFIED=5`).
* `tests/pipeline/answerPipeline.test.ts`, iki ayrı koruma testi: dayanağı
  olan bir cevapta `skipped:false` ve **birincil + her şerit** kadar korpus
  çağrısı; **sabitlenmiş** bir pasaj varken sözcük çıpası olmasa bile
  şeritlerin koştuğu.

---

## 4. N-3 — TASLAK kopyada çıplak kanıt kimliği

### 4.1 Ölçüm (python-docx ile açılarak)

TASLAK kopyanın gövdesinde:

```
Düzenleme uyarısı: 'ev-f4d62195ca825b82' alıntısı paragraf metninde birebir
bulunamadı: alıntı değiştirildi — kanıt bağı koptu (QUOTE_ALTERED). …
```

`ev-f4d62195ca825b82` avukata hiçbir şey söylemiyor ve **cümlenin ilk
kelimesi**. `(QUOTE_ALTERED)` zaten kuralın istediği gibi Türkçeden sonra
parantez içinde; NİHAİ kopyada ikisi de **yok**.

### 4.2 Düzeltme

`export/draft.py` içine **`presentable_warning(text, numbering)`** eklendi ve
`parse_draft` her uyarıyı bundan geçiriyor — yani `Draft` nesnesini okuyan
**her** dışa aktarıcı (`petition.py`, `udf.py`, paket) aynı disiplini
otomatik olarak alıyor, hiçbirinin bunu ayrıca hatırlaması gerekmiyor.
Kural: kimlik **silinmez**, parantezin içine taşınır ve cümle Türkçe bir
sözcükle başlar.

```
öncesi : Düzenleme uyarısı: 'ev-f4d62195ca825b82' alıntısı paragraf metninde …
sonrası: Düzenleme uyarısı: bir kanıtın (kanıt kimliği: ev-f4d62195ca825b82)
         alıntısı paragraf metninde …
K-n bilindiğinde: … K-1 numaralı kanıtın (kanıt kimliği: ev-tck157) alıntısı …
```

TASLAK gövdesinde parantez dışında duran **UPPER_SNAKE makine kodu sayısı:
0**. NİHAİ kopya ölçüldü ve **hâlâ tamamen temiz** (kanıt kimliği 0, makine
kodu 0).

**Bu hattın kapatmadığı bir kalem:** ekteki künye bloğunda
`Kanıt kimliği: ev-tck157` satırı duruyor. O satır `export/petition.py`'nin
(bu hattın dosyası değil) yazdığı **etiketli bir ek alanıdır**, Türkçe etiketi
önce gelir ve NİHAİ kopyada zaten yoktur; yine de parantez kuralına birebir
uymuyor — §10'da integrationRequest olarak bildirildi.

### 4.3 Gerileme testi

`tests/export/test_marked_copy_discipline.py` (yeni, 8 test): yardımcının beş
davranışı (kimliği parantezleyip cümleyi Türkçe başlatması, K-n'i kullanması,
zaten parantezli olanı bozmaması, akan metindeki çıplak kimliği taşıması,
kimliksiz uyarıyı **birebir** döndürmesi) ve üretilen DOCX'in üç özelliği
(TASLAK'ta çıplak kimlik yok, NİHAİ temiz, aynı disiplin CLI turunda da
geçerli).

---

## 5. N-2 (sunucu yarısı) — belge aslının yeri

`COLLEX_DATA_DIR` kurulu bir kurulumda asıl `<COLLEX_DATA_DIR>/uploads`
altına yazılır ve depodaki `var/uploads` **boş kalır**; üç yüzey buna rağmen
belgenin `var/uploads`'ta olmadığını söylüyordu — yani hiç bulunmadığı bir
klasörü adres gösteriyordu.

| Yüzey | Yeni cümle |
|---|---|
| `src/files/routes.ts :: ORIGINAL_MISSING_MESSAGE_TR` | "Bu belgenin aslı bilgisayarda bulunamadı — **veri klasörünüzdeki uploads klasöründe** yok (varsayılan: var/uploads); yalnız çıkarılan metin ve alıntılar elinizde." |
| `src/matters/packageRoutes.ts` (paket notu) | "… aslı bilgisayarda bulunamadı — **veri klasörünüzdeki uploads klasöründe** yok (varsayılan: var/uploads); pakete yalnız adı yazıldı." |
| `src/api/openapi.yaml` 404 açıklaması | Aynı cümle birebir; F-API §7.4'ün "hâlâ açık" notu, kapandığını söyleyen nota dönüştürüldü |

**Konsol yarısı zaten düzeltilmiş bulundu:** `control-plane/public/console.html`
Ayarlar › "Verilerim nerede?" kartı `<veri klasörü>/uploads (varsayılan:
var/uploads)` diyor ve `var/uploads klasöründe yok` kalıbı dosyada hiç
geçmiyor. Bu yüzden bir integrationRequest'e gerek kalmadı; yalnızca
uyumluluk notu §10'da.

**Gerileme testi:** `tests/files/dataFolderWording.test.ts` (yeni, 3 test) üç
kaynağı da **okur** — sabiti içeriden, diğer ikisini dosyadan — ve
`openapi.yaml`'ın rotanın gerçekten gönderdiği cümleyi (boşlukları
sadeleştirerek) taşıdığını doğrular. Bir yüzeyin sessizce geride kalması bu
kusurun bir dalga boyunca hayatta kalma biçimiydi.

---

## 6. N-1 — trigram eşiği: yorumun düzeltilmesi ve eşik kararı

### 6.1 Yorum düzeltmesi (yalnız yorum; ayar kaldırılmadı)

Depoda iki varsayılan var:

```
retrieval/hybrid.ts  :: DEFAULT_SEARCH_LIMITS.trigramMinSimilarity = 0.5
api/answerService.ts :: DEFAULT_ANSWER_LIMITS.trigramMinSimilarity = 0.35
```

`clampAnswerLimits` yalnız **yukarı** çekebildiği için `/v1/answer` şeridi
**0,35 ile koşar, 0,5 ile hiç koşmaz**. `chunkStore.ts`'in
`TRIGRAM_SEQSCAN_SETTING` bloğundaki bütün hızlanma sayıları (≈440×, L-ANSWER
≈9 700×, F-PERF 0,329 ms, L-FIX'in dört maddesi) **0,5'te** alınmıştı ve blok
bunu söylemiyordu. Blok artık:

* iki varsayılanı adıyla yazıyor ve `/v1/answer`'ın hangisini kullandığını
  söylüyor;
* eski sayıların **0,5'e ait** olduğunu her yerde işaretliyor;
* bu hattın kendi probe'unda ölçtüğü sekiz hücreyi (aşağıda) yazıyor;
* eşiğin neden 0,35 kaldığını **ölçümle** gerekçelendiriyor.

Ayar **kaldırılmadı**: 0,5'te ölçülmüş gerçek bir kazancı vardır ve kaldırmak
ölçülmüş bir vakayı geriletir.

### 6.2 Bu hattın kendi ölçümü

Probe `collex_srv_test`: 2 000 belge × 10 parça = **20 000 parça**, ortalama
`search_text` **5 749 kod noktası**, `legal.chunks` yığın **26 MB**, TOAST
dâhil **255 MB**, `chunks_search_trgm` **19 MB**, PostgreSQL 18, 03.09.2026.
SQL, `chunkStore.ts`'in kendi `trigramSelect` gövdesidir;
`EXPLAIN (ANALYZE, BUFFERS)`.

| Sorgu | eşik | `enable_seqscan` | Plan | Execution Time |
|---|---|---|---|---:|
| doymuş `depozito iadesi` | 0,35 | off | `Bitmap Index Scan on chunks_search_trgm rows=20000` | **38 343 ms** |
| aynı | 0,35 | on | aynı bitmap yolu | 38 435 ms |
| aynı | 0,50 | off | aynı bitmap yolu | 38 483 ms |
| aynı | 0,50 | on | aynı bitmap yolu | 38 408 ms |
| seçici `kuantum mekaniginde dalga fonksiyonu` | 0,35 | off | `Bitmap Index Scan rows=0` | **8 ms** |
| aynı | 0,35 | on | `Bitmap Index Scan rows=0` | 1 ms |
| aynı | 0,50 | off | `Bitmap Index Scan rows=0` | 1 ms |
| aynı | 0,50 | on | `Bitmap Index Scan rows=0` | 1 ms |

Gerçek şerit (ürünün ayarlarıyla, bütçe kapalı, n=3, p50): doymuş
**38 219 ms** (0,35) ↔ **38 394 ms** (0,5); seçici **3 ms** ↔ **3 ms**.

**Dürüst olumsuz sonuç:** F-VERIFY §2.3'ün "0,35'te seçici sorgu diye bir şey
yok, GIN her satırı aday yapıyor" bulgusunu **bu korpusta yeniden
üretemedim** — sekiz hücrenin sekizinde de plan aynıydı ve seçici sorgu her
iki eşikte de `rows=0` döndürdü. Aynı şekilde `enable_seqscan` bu korpusta
**hiçbir hücrede** ölçülebilir bir fark yaratmadı; planlayıcı bitmap yolunu
kendiliğinden seçti. F-VERIFY'ın sayısı kendi korpusunda doğrudur; benimki
kendi korpusumda doğrudur. **İkisinin birlikte söylediği şey şudur: hem
9 700× hem de "0,35'te seçicilik yok" ifadeleri, belirli bir korpusun belirli
bir sorguyla trigram örtüşmesinin özelliğidir — eşiğin ya da ayarın
özelliği değildir.** Hiçbiri ürün sayısı olarak alıntılanmamalıdır.

*Uyarı: bu ölçüm 200 sözcüklük (40 kök × 5 ek) sentetik bir dağarcıktan
üretilmiş korpustadır. Gerçek Türk hukuk metninde davranış farklı olabilir;
ölçmedim.*

### 6.3 Karar: eşik 0,35 kalıyor

`DEFAULT_ANSWER_LIMITS.trigramMinSimilarity` 0,5 yapıldı ve
`scripts/run_evals.py --run-date 2026-09-03` iki eşikte de koşuldu:

| Ölçüm | 0,35 | 0,50 |
|---|---|---|
| Altı sert kapı | PASS | PASS |
| Recall@5 / @10 / @20 | 0,9429 / 1,0000 / 1,0000 | **aynı** |
| Karşıt otorite recall (n=3) | 1,0000 | **aynı** |
| Şerit dağılımı | exact=36, lexical=67, **trigram=5**, dense=0, relation=17, citation=12 | **aynı** |
| Beklenen gold birimi atıfta | %95,2 | **aynı** |
| Kesinleştirilebilir | %85,7 (18/21) | **aynı** |
| Cevap düzeyi durumlar | ABSTAIN=13, **COMPLETE=13**, PARTIAL=3, **QUALIFIED=5** | ABSTAIN=13, **COMPLETE=14**, PARTIAL=3, **QUALIFIED=4** |

Kayan tek satır **`fx-amend-003`** (temporal_amendment): 0,5'te
`CONFLICTING_AUTHORITIES` gerekçelerini **kaybediyor** ve ŞERHLİ'den TAM'a
geçiyor. Yani yüksek eşik, okura verilen bir **şerhi** siliyor.

**Karar:** eşik yükseltilmedi. Gerekçe iki ölçüme dayanıyor: (1) §6.2'de bu
korpusta yükseltmenin **ölçülebilir bir zaman kazancı yok** (38 343 ↔
38 483 ms; 8 ↔ 1 ms), (2) §6.3'te **ölçülebilir bir dürüstlük kaybı var**.
İki varsayılanın farklı olması bu yüzden bir "uyuşmazlık" değil, cevap
yolunun bilerek daha geniş bulanık eşleşme almasıdır; maliyetini sınırlayan
şey eşik değil, **`DEFAULT_TRIGRAM_FALLBACK_MIN_HITS`** (şerit yalnız
birincil şeritler eli boş kaldığında koşar) ve **`DEFAULT_TRIGRAM_BUDGET_MS`**
(2 500 ms) kapısıdır.

### 6.4 Yorumun çürümesine karşı test

`tests/api.test.ts` (iki test): iki varsayılanın değeri ve kısıtlayıcının
yalnız yukarı çektiği; `chunkStore.ts`'in metninde iki varsayılanın adıyla
geçtiği ve eski sayıların **0,5'e ait** olduğunun yazılı olduğu.

---

## 7. Hijyen

* Bu hat **kendi sunucusunu hiç açmadı**. `serve.mjs` yalnız
  `tests/integration/serve.test.ts` süiti tarafından kendi geçici portunda
  başlatılıp kapatıldı. Koşu sonunda `netstat`: **8975, 8985, 8787 ve
  8898'de dinleyici yok**.
* `collex_srv_test` kuruldu, ölçüldü ve **düşürüldü**. `pg_database`
  listesinde geriye `collex_demo`, `collex_eval_test`, `collex_local`,
  `collex_mig_test`, `collex_quality_test`, `collex_retrieval_test` kaldı —
  yani koşu öncesiyle aynı küme.
* **`collex_local`'a hiç bağlanılmadı, hiç yazılmadı, düşürülmedi.**
  **`collex_demo`'ya hiç dokunulmadı** — `demo.mjs` bilerek **koşulmadı**
  (§8 notu).
* Depo `var/` altında **pid dosyası yok**, `var/uploads` koşu öncesi ve
  sonrası **0 dosya**.
* Dış ağa **hiçbir istek** yapılmadı. `.env` okunmadı, Supabase/Resend
  kullanılmadı, **hiçbir git işlemi yapılmadı**, MCP araç yüzeyi (54)
  değişmedi.
* Bütün geçici dosyalar `…/scratchpad/w14c-C-SRV/` altında.

---

## 8. Tam ölçüm turu

| # | Komut | Ölçülen çıktı | Exit |
|---|---|---|---:|
| 1 | `control-plane> npx tsc --noEmit` | **temiz** (çıktı yok) | 0 |
| 2 | `control-plane> npx vitest run` | **103 dosya · 2 114 geçti · 0 DÜŞTÜ · 6 atlandı (2 120)** · 21,88 sn | 0 |
| 3 | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | **1 347 passed** · 129,24 sn | 0 |
| 4 | `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-03` | **RESULT: PASS** (6/6 sert kapı) | 0 |

Komut 4'ün ayrıntısı: atıf çözülebilirliği **%100** (128 sıralı isabet),
alıntı/hash bütünlüğü **35/35**, uydurma kimlik **0**, kiracı sızıntısı
**0**, Recall@5 **0,9429**, karşıt otorite recall **1,0000 (n=3)**, retrieval
p50/p95 **8,0 / 19,4 ms**, kesinleştirilebilir **%85,7 (18/21)**, şerit
dağılımı `exact=36, lexical=67, trigram=5, dense=0, relation=17,
citation=12`.

**Sayıların okunması hakkında iki dürüstlük notu.**
(1) vitest'in 6 atlaması bilinen **ters işaretleyicilerdir**; gerçek süitler
(`matters/pg`, `drafting/real-export`, `store/persistence`,
`integration/{backup,real-exec,serve}`) koştu.
(2) Toplamlar, bu dalgada **paralel çalışan diğer hattın** aynı ağaçtaki
değişikliklerini de içerir. Bu hattın **kendi** eklediği testler:
vitest'te **14 test + 1 yeni dosya** (`tests/api.test.ts` +5,
`tests/pipeline/answerPipeline.test.ts` +3, `tests/integration/backup.test.ts`
+2, `tests/integration/launcher.test.ts` +1,
`tests/files/dataFolderWording.test.ts` +3 yeni),
pytest'te **8 test + 1 yeni dosya**
(`tests/export/test_marked_copy_discipline.py`); 1 339 → 1 347 farkı tam
olarak budur.

**`node control-plane/scripts/demo.mjs` bilerek koşulmadı.** `collex_demo`'yu
düşürüp yeniden kurar; bu dalgada paralel çalışan konsol hattının aynı
veritabanına bağlı bir sunucusu olabilir ve bir senaryo koşusu onun altından
veriyi çekerdi. Demo'nun karşıt otorite senaryosu (S3) dayanağı **olan** bir
soru üzerinde çalışır; V-21 kapısı oraya hiç girmez ve aynı davranış eval
kapısında (karşıt otorite recall 1,0000) ve iki koruma testinde ölçüldü.

---

## 9. Testlerin boş olmadığının kanıtı

Her gerileme testi için kusur **bir kez geri kondu**, süit koşuldu, düşüş
görüldü ve dosya geri alındı.

| Kusur geri konduğunda | Düşen testler |
|---|---|
| `backupDumpFileName` → `BACKUP_DUMP_FILE_LEGACY` döndürüldü | `backup.test.ts` **3 düştü** (iki V-14 testi + gerçek felaket tatbikatı) |
| `.cmd` yeniden `"%SRC%\collex_local.dump"` yaptırıldı | `launcher.test.ts` **1 düştü** |
| `fieldIssues` eski `issue.path.join(".")` haline döndürüldü | **6 düştü**: `api.test.ts` ×3, `matters/routes.test.ts` ×2, `settings/routes.test.ts` ×1 |
| V-21 atlama koşulu `false &&` ile kapatıldı | `answerPipeline.test.ts` **1 düştü** (diğer iki koruma testi doğru biçimde **geçmeye devam etti** — onlar atlamanın *olmamasını* ölçüyor) |
| `presentable_warning` `return text` yapıldı | `test_marked_copy_discipline.py` **5 düştü** |

Her turdan sonra dosya geri alındı ve süit yeniden yeşile döndü.

---

## 10. Diğer hatlara istekler (integrationRequests)

1. **`docs/implementation/STATUS.md`** — "Ölçülen sayılar" tablosu: S2 (103
   dosya / 2 114 geçti / 6 atlandı), S3 (1 347 passed), S6 (03.09.2026
   koşusu) güncellensin; "açık" satırındaki **V-14 · V-19 · V-21** kalemleri
   kapandı olarak işaretlensin; §6.2/§6.3'ün trigram ölçümleri için yeni bir
   satır açılsın (S26‴).
2. **`docs/implementation/TRACEABILITY.md`** — V-14 / V-19 / V-21 satırlarının
   dosya, test ve durum sütunları; N-1 / N-2 / N-3 için satır.
3. **`CLAUDE.md`** — "trigram şeridi" değişmezi, iki eşiğin (`0,5` retrieval /
   `0,35` cevap) farklı olduğunu ve `/v1/answer`'ın 0,35 ile koştuğunu
   söylesin; "9 700×" tarzı bir sayı `/v1/answer` için alıntılanmasın (§6).
4. **`docs/implementation/waves/W14-F-PERF.md` ve `W14-L-VERIFY.md`** —
   seçici-trigram sayılarının yanına ölçüldükleri eşik (`0,5`) yazılsın; bu
   hattın §6.2'deki karşı ölçümü referans verilsin.
5. **`export/petition.py`** (bu hattın dosyası değil) — ek künye bloğundaki
   `Kanıt kimliği: ev-…` satırı, N-3'ün kuralına birebir uyacak biçimde
   `Kanıt kimliği (ev-…)` ya da eşdeğeri olsun. Bugünkü hâli NİHAİ kopyada
   zaten yok ve Türkçe etiketi öndedir; sınırda bir kalemdir.
6. **`control-plane/public/console.html`** (konsol hattı) — karşıt otorite
   kartı artık `contraryCoverage.skipped === true` durumunu ayırt edebilir;
   bugün `cov.note` metnini olduğu gibi bastığı için ekranda **doğru cümle
   çıkıyor**, ama kartın kendi cümlesini yazmak isterse alan hazır. N-2'nin
   konsol yarısı **zaten doğru** bulundu (`<veri klasörü>/uploads (varsayılan:
   var/uploads)`); rota metniyle uyumlu kalması yeterlidir.

---

## 11. Değişen depo dosyaları

**Ürün**

```
control-plane/src/backup/runner.ts            V-14  (adı türeten fonksiyon, eklemeli dumpFile)
control-plane/scripts/backup.mjs              V-14  (--dump-name, arşiv adı satırı)
ColleX-Geri-Yukle.cmd                         V-14  (adı manifestten okur)
ColleX-Yedekle.cmd                            V-14  (açıklama)
control-plane/src/api/zodIssues.ts            V-19  YENİ (tek yardımcı)
control-plane/src/api/server.ts               V-19
control-plane/src/matters/routes.ts           V-19
control-plane/src/matters/contactsRoutes.ts   V-19
control-plane/src/drafting/routes.ts          V-19  (+ Türkçe etiket)
control-plane/src/settings/routes.ts          V-19
control-plane/src/fees/routes.ts              V-19
control-plane/src/deadlines/routes.ts         V-19
control-plane/src/contracts/routes.ts         V-19
control-plane/src/ai/routes.ts                V-19
control-plane/src/sources/routes.ts           V-19
control-plane/src/research/routes.ts          V-19
control-plane/src/pipeline/answerPipeline.ts  V-21
control-plane/src/pipeline/types.ts           V-21  (eklemeli `skipped`)
control-plane/src/research/researchService.ts V-21  (`skipped: false`)
control-plane/src/files/routes.ts             N-2
control-plane/src/matters/packageRoutes.ts    N-2
control-plane/src/api/openapi.yaml            N-2   (yalnız açıklama metni)
control-plane/src/store/chunkStore.ts         N-1   (YALNIZ YORUM)
export/draft.py                               N-3
```

**Testler**

```
control-plane/tests/api.test.ts                      V-19 (+3), N-1 (+2)
control-plane/tests/matters/routes.test.ts           V-19
control-plane/tests/integration/backup.test.ts       V-14 (+2)
control-plane/tests/integration/launcher.test.ts     V-14 (+1)
control-plane/tests/pipeline/answerPipeline.test.ts  V-21 (+3)
control-plane/tests/pipeline/console.test.ts         V-21 (fixture: `skipped: false`)
control-plane/tests/files/dataFolderWording.test.ts  N-2  YENİ (+3)
control-plane/tests/settings/routes.test.ts          V-19 (iddia DARALTILDI)
tests/export/test_marked_copy_discipline.py          N-3  YENİ (+8)
docs/implementation/waves/W14-C-SRV.md               bu rapor
evals/reports/fixture_baseline_2026-09-03.{json,md}  run_evals.py'nin KENDİ çıktısı
```

**Dosya sahipliği hakkında açık not.** Bu hatta verilen OWN listesi
`src/backup/runner.ts`, `src/pipeline/types.ts`, `src/{settings,fees,deadlines,
contracts,ai,sources,research,drafting}/routes.ts`, `src/matters/contactsRoutes.ts`,
`src/research/researchService.ts`, `src/api/openapi.yaml` ve
`tests/settings/routes.test.ts` dosyalarını saymıyordu. Bunların hepsine
dokunuldu, çünkü verilen üç görevin kendisi bunu gerektiriyordu: V-14'ün arşiv
adı yalnız `runner.ts`'te üretiliyor (TRACEABILITY V-14 satırı da bu üç dosyayı
sayar), V-19 "ve `.strict()` kullanan her rota" diyor, N-2 "openapi metni"
diyor. Hepsi sunucu tarafıdır; bu dalgada paralel çalışan hat konsol hattıdır
ve bu dosyaların hiçbirine dokunmaz. Yine de entegrasyonu yapan hattın bunu
bilerek okuması için buraya yazıldı.
