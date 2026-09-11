# W13 — Hat ENGRISK: mühendislik dayanıklılığı, veri güvenliği ve performans denetimi

Tarih: 02.09.2026 · Hat: ENGRISK (araştırma/denetim; hiçbir ürün dosyası
değiştirilmedi) · Probe portu: 8934 · Durum: **teslim edildi**

Bu rapor yeni gözle bir saldırı denetimidir. Varsayım: bu uygulama **gerçek
bir avukatın gerçek dosyalarını** tutacak ve hiçbirini kaybetmemeli,
bozmamalı. Aşağıdaki her bulgu ya bu makinede ölçülmüş ya da kod satırıyla
gösterilmiştir; ölçülmemiş hiçbir sayı yoktur.

## 0. Yöntem, kanıt ve temizlik beyanı

**Ne yapıldı.** Kod okuma (`server.ts`, `consolePage.ts`, `chunkStore.ts`,
`files/{routes,store}.ts`, `store/{answerStore,draftStore,health,db}.ts`,
`intake/{ingest,quarantine,extract}.py`, `ingestion/migrations.py`,
`ColleX-*.cmd`, `ci.yml`) + canlı ölçüm.

**Ölçüm ortamı.** Üç geçici sorgu veritabanı kuruldu ve **hepsi silindi**:

| DB | Ne için | Nasıl kuruldu |
|---|---|---|
| `collex_engrisk_probe` | Ölçek ölçümü: **2000 belge / 2008 sürüm / 20 055 parça / 200 dosya / 2000 cevap**, 136 MB | `create database … template collex_demo` + sentetik `insert` |
| `collex_restore_probe` | `pg_dump`/`pg_restore` gidiş-dönüş kanıtı | `pg_restore` |
| `collex_ledger_probe` | Yarım uygulanmış migration senaryosu (§4) | migration dosyaları psql ile |

**Temizlik (doğrulandı).**
`psql -Atc "select datname from pg_database"` → yalnız
`collex_demo, collex_eval_test, collex_local, collex_mig_test,
collex_quality_test, collex_retrieval_test, postgres, template*`;
üç probe DB'si de yok. `netstat` → 8934/8787/8898'de **dinleyici yok**.
`var/collex.pid` silindi. **`collex_local`'a hiçbir şey yazılmadı**
(`0/0/0 matters/answers/documents`, denetim öncesi ve sonrası aynı).
`collex_demo` üzerinde açtığım 253 cevap + 2 `CSRF-PROBE` dosyası + 2 sorgu
yüklemesi **tek tek silindi**; paralel çalışan başka bir hattın 4 cevabı, 2
dosyası ve yüklemeleri **korundu** (bu yüzden `demo.mjs` ile yeniden kurma
YAPILMADI — o hattın verisini yok ederdi). `.env` okunmadı, git işlemi
yapılmadı, Supabase/Resend'e dokunulmadı.

**Sınır.** Sentetik korpus homojendir (her parça aynı sözcükleri taşır); bu
retrieval için **en kötü durum**dur. Bir avukatın kendi yüklemeleri (hepsi
kira dosyası) buna yakındır, karışık bir korpus değildir. Nerede önemliyse
ayrıca söylenmiştir.

---

## 1. Sıralı bulgular

Sıra: veri kaybı riski × olasılık × düzeltme maliyeti.

| # | Bulgu | Sev | Tek cümle |
|---|---|---|---|
| **E1** | Hiçbir yedekleme/geri yükleme yolu yok | **P0** | Tek disk, tek küme; kaybolursa her şey gider |
| **E2** | `/v1/answer` 20 000 parçada **45,8 sn** sürüyor ve trigram şeridi sessizce ölüyor | **P0** | Ölçüldü; `<%` operatörüne geçmek 17 146 ms → 1,56 ms |
| **E3** | Ledger sentinel'i "dosya BAŞLADI" der, "BİTTİ" demez | **P0** | Kanıtlandı: RLS'siz beş `app_private` tablosu 11/11 sayılıyor |
| **E4** | CSRF: durum değiştiren POST'lar `Origin` denetlemiyor | **P1** | Yabancı bir sayfa dosya açabiliyor, belge yükleyebiliyor, Bulut AI harcatabiliyor |
| **E5** | `Host` başlığı denetlenmiyor → DNS rebinding | **P1** | Yabancı bir sayfa müvekkil verisini **okuyabilir** |
| **E6** | `var/uploads/` yazılıyor ama **hiç okunmuyor**, repo içinde, yedeksiz, onarılamaz | **P1** | Asıl PDF/DOCX'ler sessizce kaybolabilir |
| **E7** | `/v1/files` her çağrıda tüm `canonical_text`'leri detoast ediyor, sayfalama yok | **P1** | 149 ms'nin 136 ms'si (%91) sadece karakter sayımı |
| **E8** | `GET /v1/answers?fileId=` jsonb üzerinde seq scan | **P1** | 15,5 ms → 0,13 ms (tek GIN indeksi) |
| **E9** | `control-plane` CI işi, kurmadığı bir PostgreSQL'i **zorunlu** kılan süitleri koşuyor | **P1** | Kalıcılık/ledger/başlatıcı katmanının CI sinyali yok |
| **E10** | Durdurucu sert kill yapıyor → belgelenen `flush()` yolu **hiç çalışmıyor** | **P1** | "Temiz kapanışta flush" sözü ürünün kendi durdurucusuyla erişilemez |
| **E11** | Asıl bayt DB commit'inden SONRA yazılıyor | **P2** | Disk dolarsa: DB'de belge var, diskte asıl yok, kullanıcı 500 görüyor |
| **E12** | `--ensure-db` için advisory lock yok; başlatıcı çift tıkta yarışıyor | **P2** | İki `create type` çakışır; ikinci tık ilk sunucuyu öldürür |
| **E13** | `/v1/ai/*` için kümülatif maliyet/hız sınırı yok | **P2** | E4 ile birleşince sınırsız ücretli çağrı |
| **E14** | `/v1/*` cevapları güvenlik başlığı taşımıyor | **P2** | Müvekkil verisi tarayıcı disk önbelleğine yazılabiliyor |
| **E15** | Ledger, diskte olmayan satırları görmezden geliyor | **P2** | Sürüm geri alınırsa yeni şema sessizce kullanılır |
| **E16** | Sözcüksel kapsam şeridinde aday sınırı yok | **P2** | 20 000 parçada 1,55 sn (ölçüldü) |
| **E17** | `extract_pdf`'te sayfa sınırı yok (OCR'de 100 var) | **P2** | 5000 sayfalık PDF 180 sn bütçesini yakar |
| **E18** | Başlatıcı, 55432'deki PG'nin ColleX'in kümesi olduğunu doğrulamıyor | **P3** | Yanlış kümede "verilerim gitti" paniği |
| **E19** | `collex.console.filehistory.v1` sınırsız büyüyor | **P3** | Kota dolunca geçmiş sessizce durur |
| **E20** | Tarayıcı ↔ sunucu saat sapması denetlenmiyor | **P3** | Yanlış saatli makinede yanlış "değerlendirme tarihi" |
| **E21** | `/v1/files/{id}` parça önizlemeleri enjeksiyon taramasından geçmiyor | **P3** | Cevapta işaretlenen yük, belge sayfasında işaretsiz |
| **E22** | Cevap önbelleği tavanı 32 × 5 MiB = 160 MB | **P3** | Sızıntı yok (ölçüldü) ama tavan belgesiz |

---

### E1 (P0) — Hiçbir yedekleme/geri yükleme yolu yok

**Kanıt.** Depo genelinde `pg_dump` / `pg_restore` / "yedek" araması ürün
kodunda **sıfır** sonuç verir; yalnız `PLAN.md` Faz 9 ("backups, DR —
**NOT STARTED**") ve `RUNBOOK.md` §11 (kirli çalışma ağacı yedeği, ürün
verisiyle ilgisi yok) geçer. [ölçüldü, 02.09.2026]

**Ne kaybolur.** Avukatın verisi tek yerde:

| Katman | Fiziksel yer | İçerik |
|---|---|---|
| `collex_local` (PostgreSQL) | `C:\Users\anile\scoop\persist\postgresql\data` (294 MB küme) | dosyalar, kayıtlar, cevaplar, taslakların **her sürümü**, süreler, notlar, ayarlar, belgelerin çıkarılmış NFC metni + parçaları |
| Asıl belgeler | `…\yargi-mcp-independent\var\uploads\<sha256><ext>` | yüklenen PDF/DOCX/TXT/UDF'nin **bayt birebir** kopyası |
| Dışa aktarımlar | Tarayıcının indirilenler klasörü | DOCX/MD/UDF (yeniden üretilebilir) |

`fsync=on`, `synchronous_commit=on`, `full_page_writes=on`
(`show` ile doğrulandı) — yani **elektrik kesintisi PostgreSQL'i bozmaz**,
en fazla commit edilmemiş son işlem gider. Sorun dayanıklılık değil,
**tek kopya** olması: disk arızası, yanlış `scoop uninstall -p postgresql`,
`drop database`, fidye yazılımı ya da klasörün taşınması her şeyi götürür ve
geri dönüş yoktur.

**Meslekî boyut.** Avukatlık Kanunu ve TBB Meslek Kuralları anlamında
müvekkil dosyasının korunması özen borcudur; "verileriniz bilgisayarınızda"
sözü yedek olmadan yarım bir sözdür.

**Düzeltme:** §3'teki tam öneri (test edilmiş komutlarla).

---

### E2 (P0) — `/v1/answer` ölçekte 45,8 saniye; trigram şeridi sessizce ölüyor

**Ölçüm (probe DB, 20 055 parça, port 8934).**

```
POST /v1/answer  "Depozito ne zaman iade edilir?"            45,774 s  200
POST /v1/answer  "Kira sozlesmesinde depozito iadesi ..."    45,875 s  200
POST /v1/answer  "Zamanasimi suresi kac yildir?"             45,030 s  200
POST /v1/answer  "TCK m.157 cezasi nedir?"                   45,122 s  200
```

Aynı sunucu `collex_demo` (55 parça) ile: **0,096 – 0,169 s**. Yani
sorunun kaynağı sorgu seçiciliği değil, **korpus boyutu**.

**Teşhis — cevabın kendi `trace`'i:**

```json
"warnings":[
 "RETRIEVAL_LANE_DEGRADED:primary:lane trigram failed: canceling statement due to statement timeout",
 "RETRIEVAL_LANE_DEGRADED:contrary:issue-1:outcome_flip:lane trigram failed: ...",
 "RETRIEVAL_LANE_DEGRADED:contrary:issue-1:dissent:lane trigram failed: ..."]
"trace":[ ... {"name":"retrieve","ms":45024.86,...} ... ]
```

3 sorgu × `statement_timeout` 15 000 ms (`src/store/db.ts:65`) = 45 s.
Durum: `ABSTAIN`, `evidence: []`.

**Kök neden — `src/store/chunkStore.ts:611-628`.** `trigramSearch` şu
predikatı kullanıyor:

```sql
and extensions.word_similarity(${queryText}, c.search_text) >= ${minSimilarity}
```

Bu bir **fonksiyon çağrısıdır, indekslenemez**. `chunks_search_trgm`
(`gin (search_text extensions.gin_trgm_ops)`) indeksi vardır ama kullanılmaz.
İronik olarak dosyanın kendi yorumu (satır 606-609) doğru formu tarif ediyor
("at corpus scale the `<%` operator + the `chunks_search_trgm` GIN index …
serve the same lane") ve kod onu kullanmıyor.

**EXPLAIN ANALYZE (aynı DB, 20 055 satır, `search_text` ortalama 5 392
karakter):**

| Sorgu biçimi | Plan | Süre |
|---|---|---|
| `word_similarity(q, c.search_text) >= 0.5` (bugünkü kod) | `Seq Scan on chunks` | **17 146 ms** |
| `'q' <% c.search_text` + `order by score desc limit 24` | `Bitmap Index Scan on chunks_search_trgm` | **1,56 ms** |

**~11 000× hızlanma, şema değişikliği yok, indeks zaten var.**

**Düzeltme (somut).** `trigramSearch` içinde:

1. `WHERE`'e `${queryText} <% c.search_text` operatörünü koyun
   (`operator(extensions.<%)` ile şema-nitelikli);
2. eşiği aynı bağlantıda `set_config('pg_trgm.word_similarity_threshold',
   ${minSimilarity}::text, true)` ile ayarlayın (işlem-yerel, `true`);
3. `word_similarity(...)` çağrısını **yalnız SELECT listesinde** skor için
   bırakın — orada satır başına değil, sadece dönen 24 satır için çalışır;
4. `ORDER BY score DESC` korunmalı: `LIMIT`'li erken çıkış planlayıcıyı
   yanıltıyor; sıralama varken bitmap planı seçiliyor (ölçüldü).

**Regresyon testi (öneri).** `tests/store/retrieval.test.ts` içine: 2000
sentetik parça yükle, `explain (format json)` al ve planda
`chunks_search_trgm` geçtiğini iddia et. Bugün hiçbir test planı denetlemiyor
— bu yüzden gerileme fark edilmedi.

**İkinci sıra düzeltme.** Şerit hatası bugün yalnız bir `warning`. 20 000
parçalık bir korpusta **her cevap** kanıtsız dönüyor ve arayüzde bu
"korpusta karşılık yok" gibi okunuyor. `RETRIEVAL_LANE_DEGRADED` konsolda
görünür bir uyarı olmalı ("arama şeridi zaman aşımına uğradı — sonuç eksik
olabilir"), sessiz bir satır değil.

**Bütçeyle ilişkisi.** `DEFAULT_ANSWER_TIME_BUDGET_MS` = 60 000 ve
**aşamalar arasında** denetleniyor. 20 000 parçada tek `retrieve` aşaması
bütçenin %75'ini yiyor; ~26 000 parçada her cevap `PARTIAL` +
`TIME_BUDGET_EXCEEDED` olur ve bunun nedeni hukuk değil, indeks kullanılmaması
olur.

---

### E3 (P0) — Ledger sentinel'i "başladı" der, "bitti" demez

**İddia.** FIX-2 kuralı ("probe, migration'ın kendi yarattığı bir şeyi
adlandırmalı") **yeterli değil**: probe hedefi dosyanın ORTASINDA
yaratılıyorsa, dosyanın yarısı uygulanmış bir veritabanı "tam uygulanmış"
sayılıyor.

**Kanıtlanmış senaryo (bu makinede, `collex_ledger_probe`).**

1. 10 runnable migration psql ile tam uygulandı.
2. `20260902120000_matters_persistence.sql`'in **ilk 228 satırı** uygulandı
   — yani `app_private.{matters,matter_items,answers,drafts,settings}`
   tabloları (satır 70–228) yaratıldı, **RLS ve politika bloğu (satır
   229–283) uygulanmadı**.
3. Durum:
   `settings_exists = t`, `policies_on_app_private = 0`, `ledger_exists = f`.
4. Python'un bootstrap kararı **birebir** koşturuldu (salt okunur):

```
ledger exists: False  has_documents: True  needs_bootstrap: True
BOOTSTRAP 20260826010000_extensions_and_schemas.sql -> extension:btree_gist
...
BOOTSTRAP 20260902120000_matters_persistence.sql   -> app_private.settings
would bootstrap 11 of 11
```

**Sonuç.** Avukatın dava dosyalarını, cevaplarını, taslaklarını ve ayarlarını
tutan beş tablo **RLS'siz ve politikasız** kalır, `--ensure-db` bir daha
asla o dosyayı uygulamaz, `/v1/health` `migrations 11/11` der. Bu, CLAUDE.md
"Invariants" bölümünün ADR-011 satırının ("RLS resolves tenancy through the
owning document. … that was a P0 leak") tam olarak engellemek için var olduğu
sınıfın kendisidir.

**Aynı sınıf, ikinci dosya.** `20260826060000_rls.sql`:
probe `regprocedure:app_private.current_tenant_id()` **satır 51**'de
tanımlanıyor; dosyanın geri kalanı (satır 73–281+) `alter table … enable row
level security` ve 20'den fazla `create policy`. Fonksiyon var, politikalar
yok → bootstrap "uygulanmış" der.

**Üçüncü:** `20260826010000` probe'u `extension:btree_gist` **satır 41**'de;
`legal`/`app_private` şemaları (44, 48) ve enum tipleri (52+) ondan SONRA.
Ayrıca `btree_gist` başka bir araç tarafından da kurulmuş olabilir — probe
"başka bir nedenle var olabilen nesne" tanımına giriyor.

**Bu yol gerçekten erişilebilir mi? Evet.**
`apply_missing_migrations` her dosyayı `with conn.transaction()` içinde
çalıştırır (güvenli), ama ledger bootstrap'ı **kendi yaratmadığı**
veritabanlarına da uygulanır: `demo.mjs`/`db_local_check.py`/`testDb.ts`
dosya dosya psql/driver ile yükler, kullanıcı bir dump geri yükleyebilir,
ya da bir migration çalışırken disk dolabilir. Ölçüldü: **`collex_demo`'da
`app_private.schema_migrations` tablosu YOKTUR** — yani demo/probe
veritabanları her `/v1/health` çağrısında tam olarak bu bootstrap yolunu
kullanıyor.

**Düzeltme (dördü birden önerilir).**

1. **Çoklu probe.** Bir dosya birden fazla `-- [LEDGER SENTINEL]` satırı
   taşıyabilsin ve bootstrap **hepsi** çözülürse kaydetsin. `ledger_sentinel`
   → `ledger_sentinels() -> list[str]`; `resolveSentinels` zaten küme
   döndürüyor, `deriveMigrationHealth` `every()` ile kontrol etsin. Her
   dosyaya en az **ilk ve son** yarattığı nesne için birer probe koyun.
2. **Yeni kind: `policy:<schema.table>.<name>`** (`pg_policies`). `060000`
   ve `20260902120000` için son politikayı probe'layın — SQL CASE'e bir
   `when` eklemek yetiyor, iki tarafta da.
3. **Test kapısı.** `tests/ingestion/test_migrations_ledger.py`'ye:
   "her dosyanın probe hedeflerinden en az biri, dosyadaki **son**
   `create`/`alter`/`grant` ifadesinden sonra gelen bir nesneyi
   adlandırır" iddiası. Bugünkü test yalnız "probe çözülüyor mu" diyor.
4. **Ucuz emniyet ağı (bağımsız).** `/v1/health`'e
   `rls: { expected: N, present: M }` alanı: `select count(*) from
   pg_policies where schemaname in ('legal','app_private')` (tam bir
   veritabanında **17** — geri yükleme testinde ölçüldü). Politikasız bir
   ürün veritabanı böylece görünür olur.

---

### E4 (P1) — CSRF: durum değiştiren uçlar `Origin` denetlemiyor

**Kanıtlanmış (port 8934, gerçek istekler).**

```
curl -X POST /v1/matters -H "Origin: https://evil.example" \
     -H "content-type: text/plain;charset=UTF-8" \
     -d '{"title":"CSRF-PROBE","kind":"dava"}'
→ 201   (kayıt gerçekten oluştu; GET /v1/matters listede gösterdi)

curl -X POST /v1/files -H "Origin: https://evil.example" -F "file=@csrf.txt"
→ 200   (belge gerçekten avukatın korpusuna girdi; var/uploads'a yazıldı)
```

**Neden önemli.** `text/plain`, `application/x-www-form-urlencoded` ve
`multipart/form-data` **CORS-safelisted** içerik türleridir: tarayıcı bunlar
için preflight yapmaz. `c.req.json()` (fetch `Request.json()`) içerik türüne
bakmadan gövdeyi ayrıştırır. Yani avukatın ColleX açıkken ziyaret ettiği
herhangi bir web sayfası `fetch(..., { mode: "no-cors" })` ile bu istekleri
gönderebilir. Cevabı **okuyamaz** (CORS başlığı yok — bu doğru), ama
**yan etkiyi yapar**.

Ulaşılabilir uçlar: `POST /v1/matters`, `/v1/matters/{id}/items`,
`/v1/answer`, `/v1/evidence-bundle`, `/v1/files`, `/v1/drafts`,
`/v1/research*`, ve **`/v1/ai/analyze-document` · `/v1/ai/ocr` ·
`/v1/ai/draft-paragraph`**. Son üçü kritiktir: "istek başına onay" (ADR-018)
gövdedeki `useCloudAi:true` alanıdır ve **saldırgan onu kendisi yazar** —
yani avukatın belgeleri onun bilgisi ve rızası olmadan Anthropic'e
gönderilebilir ve parası harcanır (E13 ile birleşince sınırsız).
`PUT/PATCH/DELETE` preflight gerektirdiği için erişilemez.

**Düzeltme (≈20 satır, `src/api/server.ts`, her router'dan önce).**

```ts
// Durum değiştiren istekte yabancı Origin reddedilir. Yerel bir betik
// (curl, ColleX-Baslat) Origin göndermez; tarayıcı çapraz kaynakta HER
// ZAMAN gönderir — no-cors dahil. Bu yüzden kontrol tam ve kırılgan değil.
app.use("*", async (c, next) => {
  const m = c.req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  const origin = c.req.header("origin");
  if (origin !== undefined && !isOwnOrigin(origin, c.req.header("host"))) {
    return c.json({ error: { kind: "FORBIDDEN_ORIGIN",
      message: "Bu istek başka bir web sayfasından geldi ve reddedildi." } }, 403);
  }
  const site = c.req.header("sec-fetch-site");
  if (site !== undefined && site !== "same-origin" && site !== "none") {
    return c.json({ error: { kind: "FORBIDDEN_ORIGIN", message: "…" } }, 403);
  }
  return next();
});
```

`Sec-Fetch-Site` kontrolü ikinci savunmadır (Chrome/Firefox/Safari hepsi
gönderir). İkisi birlikte, kimlik doğrulaması eklemeden, tek kullanıcılı
yerel mimariyi bozmadan CSRF'yi kapatır.

---

### E5 (P1) — `Host` başlığı denetlenmiyor → DNS rebinding ile **okuma**

**Kanıtlanmış.**

```
curl -H "Host: evil.example"    http://127.0.0.1:8934/         → 200 (konsol)
curl -H "Host: attacker.test"   http://127.0.0.1:8934/v1/health → 200 (JSON)
```

`serve.mjs` `hostname: "127.0.0.1"` ile bağlanır (doğru) ama gelen `Host`
başlığını hiç denetlemez. Saldırı: saldırgan `x.evil.example`'ı kısa TTL ile
kendi IP'sine çözer, avukat sayfayı açar, sonra aynı ad `127.0.0.1`'e
yeniden bağlanır. Sayfanın kendi kaynağı artık `http://x.evil.example:8787`
olduğu için tarayıcı **aynı kaynak** sayar: `fetch("/v1/matters")`,
`fetch("/v1/answers/…?texts=true")`, `fetch("/v1/settings")` hepsi okunur.
Konsolun CSP'si burada yardımcı olmaz — saldırganın sayfası konsol değildir.
Bu, E4'ten daha ağırdır: E4 yazar, E5 **müvekkil verisini okur**.

**Düzeltme (≈8 satır, aynı ara katman).** İlk kontrol olarak:

```ts
const host = (c.req.header("host") ?? "").toLowerCase();
const hostname = host.replace(/:\d+$/u, "").replace(/^\[|\]$/gu, "");
if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
  return c.text("ColleX yalnız 127.0.0.1 üzerinden çalışır.", 421);
}
```

Testi kolay: `app.request("http://x/v1/health", { headers: { host: "evil" } })`
→ 421. Bu tek kontrol DNS rebinding sınıfını tamamen kapatır.

---

### E6 (P1) — `var/uploads/`: yazılıyor, hiç okunmuyor, yedeklenmiyor, onarılmıyor

Dört ayrı kusur, hepsi `intake/ingest.py`:

**(a) Hiçbir kod onu okumuyor.** Depo genelinde `DEFAULT_STORE_DIR` /
`store_dir` yalnız `_store_original` (yazma) ve `delete_file` (silme)
içinde geçiyor. `/v1/files/{id}` asıl baytları sunmuyor, konsolda "aslı
indir" düğmesi yok. Yani **avukat yüklediği PDF'i ColleX'ten geri
alamıyor**; veritabanında yalnız çıkarılmış NFC metin var — imza, ıslak
imza taraması, sayfa düzeni, mühür, ekler gitmiş sayılır. Bu hem veri
güvenliği hem özellik boşluğu.

**(b) Repo klasörünün içinde.** `var/` git-ignore'lu ve checkout'un
altında. Depoyu taşımak, yeniden klonlamak ya da bir "klasörü temizle"
hareketi asılları siler; veritabanı sağ kalır ve kayıtlar askıda kalır.
Kimse fark etmez (bkz. (a)).

**(c) Yazma atomik değil.** `target.write_bytes(data)` — geçici dosya +
rename yok, `fsync` yok. Yazma sırasında elektrik kesilirse
`<sha256>.pdf` **kırık uzunlukta** kalır; adı içeriğin sha256'sı olduğu
için artık yalan söyler.

**(d) Onarım yok.** `_store_original` `if not target.exists()` der.
Kırık/kısa dosya "var" sayılır ve aynı belge yeniden yüklense bile
**asla düzeltilmez**. (Dosya tamamen silinmişse yeniden yükleme onu geri
yazar — tek şanslı hâl.)

**Düzeltme.**
1. Depoyu repo dışına alın: `COLLEX_DATA_DIR` (varsayılan
   `%LOCALAPPDATA%\ColleX\uploads`), `serve.mjs` ve `intake.cli` aynı
   değeri kullansın; mevcut `var/uploads` içeriği ilk açılışta taşınsın.
2. Atomik yazın: `tmp = target.with_suffix(target.suffix + ".part")`,
   `write_bytes` → `os.fsync` → `os.replace(tmp, target)`.
3. Onarın: `target.exists()` yerine
   `target.exists() and target.stat().st_size == verified.size_bytes`;
   uymuyorsa yeniden yaz.
4. **DB commit'inden ÖNCE yazın** (bkz. E11) — asıl dosya varken kayıt
   yoksa yeniden yükleme temizler; tersi sessiz veri kaybıdır.
5. `GET /v1/files/{id}/original` (`Content-Disposition: attachment`) ekleyin
   ve konsola "Aslını indir" düğmesi koyun; asıl yoksa açık Türkçe uyarı.
6. Yedeğe dahil edin (§3).

---

### E7 (P1) — `/v1/files` her çağrıda tüm belge metinlerini detoast ediyor

**Ölçüm (2000 yükleme, `EXPLAIN ANALYZE`, aynı sorgu iki biçimde):**

| Sorgu | Execution Time |
|---|---|
| Bugünkü (`length(v.canonical_text)::int as chars`) | **148,923 ms** |
| `length(...)` çıkarılmış hâli | **12,422 ms** |

Yani sürenin **%91'i** yalnız karakter sayımı için her belgenin tüm
kanonik metnini TOAST'tan çıkarıp açmak. Sentetik metinler ~40 KB;
gerçek 300 sayfalık bir PDF'in kanonik metni ~600 KB — 2000 belgede
her `/v1/files` çağrısı **~1,2 GB açma** demek.

HTTP tarafında ölçülen: `GET /v1/files` → **0,23–0,27 s, 487 KB gövde**,
sayfalama **yok**, `limit` **yok**. Konsol bu 2000 kartı DOM'a basıyor.
Aynı sorgu `showFile`'da da var (her belge sayfası açılışında).

Ek olarak alt sorgu `select document_version_id, count(*) from legal.chunks
group by document_version_id` **tüm `legal.chunks` tablosunu** (kamu
korpusu dahil) her çağrıda tarıyor — planda `Seq Scan on chunks
rows=20055` + `HashAggregate`.

**Düzeltme (üçü de küçük).**
1. `chars` değerini yüklemede metadata'ya yazın
   (`meta.upload.chars = len(canonical)`; `IntakeResult.chars` zaten var)
   ve listede `v.metadata` içinden okuyun — `length(canonical_text)`
   sorgudan tamamen çıksın. Eski satırlar için `coalesce(meta chars,
   length(...))` geçiş yolu.
2. `listFiles`'a `limit`/`offset` (varsayılan 50) + toplam sayı ekleyin;
   `/v1/files` cevabına `page: {offset, limit, total}` (additive).
   Konsol "Daha fazla göster" ile devam etsin.
3. Parça sayısını `lateral (select count(*) from legal.chunks c
   where c.document_version_id = v.id) cc` ile SAYFANIN satırlarına
   sınırlayın — `chunks_version_idx` zaten var, tam tablo taraması gider.

---

### E8 (P1) — `GET /v1/answers?fileId=` jsonb üzerinde seq scan

**Ölçüm (2000 cevap, her `result` ~60 KB).**

| Durum | Plan | Süre |
|---|---|---|
| Bugün | `Seq Scan on answers`, `Rows Removed by Filter: 1999` | **15,495 ms** |
| `gin (result jsonb_path_ops)` | `Bitmap Index Scan` | **0,130 ms** |
| `gin ((result->'fileScope') jsonb_path_ops)` (128 kB indeks) | `Bitmap Index Scan` | **0,087 ms** |

Konsol bu sorguyu **her belge sayfası açılışında** yapıyor
(`renderDocHistory`). `result` alanı `MAX_STORED_TEXT_BYTES` = 5 MiB'a
kadar büyüyebildiği için seq scan her satırın jsonb'sini açmak zorunda:
2000 × ortalama 500 KB ile bu saniyelere çıkar.

**Düzeltme.** Yeni migration (probe kuralına uygun, §4'e göre çoklu
sentinel ile):

```sql
-- [LEDGER SENTINEL] regclass:app_private.answers_filescope_gin
create index if not exists answers_filescope_gin
  on app_private.answers using gin ((result -> 'fileScope') jsonb_path_ops);
```

ve `answerStore.list` predikatını
`result -> 'fileScope' @> ${sql.json({fileIds:[fileId]})}::jsonb`
biçimine çevirin (indeksin kullanılabilmesi için ifade birebir aynı olmalı).
Daha temiz uzun vadeli çözüm: `app_private.answer_files(run_id, file_id)`
yan tablosu — ama tek indeks bugün 119× kazandırıyor.

---

### E9 (P1) — `control-plane` CI işi, kurmadığı PostgreSQL'i zorunlu kılıyor

**Kanıt.**
- `.github/workflows/ci.yml` `control-plane` işi: `checkout → setup-node →
  npm ci → npm run typecheck → npm test`. **`services:` bloğu yok, Python
  yok, venv yok.**
- `package.json` `"test": "vitest run"`, `vitest.config.ts`
  `include: ["tests/**/*.test.ts"]` — hiçbir dışlama yok.
- `tests/store/testDb.ts:125` `requireScratchPostgres()` **skip etmez,
  `throw` eder**: *"store integration tests require the LOCAL scratch
  PostgreSQL at 127.0.0.1:55432 … and must not be skipped."*
- Bunu `beforeAll`'da çağıran süitler: `tests/store/retrieval.test.ts:79`,
  `tests/quality/retrievalQuality.test.ts:61` (+ `tests/quality/qualityDb.ts`
  aynı kural).

**Sonuç.** `control-plane` CI işi ya kalıcı olarak **kırmızı**dır ya da
hiç yeşile ulaşmamıştır. Her iki hâlde de STATUS S1/S2'nin ima ettiği
"CI bu süiti koşuyor" güvencesi yoktur; S2 yalnız **bu makinenin** ölçümüdür.

**İkinci, daha ağır yarısı.** Ortam-atlamalı dört süit
(`real-export`, `store/persistence`, `integration/serve`,
`integration/real-exec`) CI'da **her zaman** atlanır (PG ve venv yok). Bu
dördü şunları kapsayan tek testlerdir:

- `PgAnswerStore`, `PgDraftStore`, `PgMatterStore`, `PgSettingsStore` —
  yani **avukatın verisini tutan katmanın tamamı**;
- ledger probe grameri ve `deriveMigrationHealth` gerçek-PG davranışı
  (E3'ün tam olarak yaşadığı yer);
- `serve.mjs --with-mcp` token değişmezi (CLAUDE.md invariant'ı);
- gerçek DOCX/UDF dışa aktarımı.

`grep` doğrulaması: `PgAnswerStore`, `PgDraftStore`, `deriveMigrationHealth`
adları **yalnız** `tests/store/persistence.test.ts` içinde geçiyor.

**Düzeltme.**
```yaml
  control-plane:
    services:
      postgres:
        image: postgres:18
        env: { POSTGRES_HOST_AUTH_METHOD: trust, POSTGRES_USER: postgres }
        ports: ["55432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s
          --health-timeout 5s --health-retries 10
    steps:
      # … setup-node …
      - uses: actions/setup-python@v5
        with: { python-version: "3.13" }
      - run: python -m venv .venv && .venv/bin/pip install -e ".[intake,export]"
        working-directory: .
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```
Bu tek değişiklik 4 atlamayı 4 koşuya çevirir ve E3 sınıfını CI'da
yakalanabilir kılar. `eval-gate` işi zaten `postgres:16` servisi kuruyor —
kalıp hazır (yalnız port ve `18` sürümü hizalanmalı; `turkish` text-search
config'i 16'da da var).

---

### E10 (P1) — Durdurucu sert kill yapıyor; belgelenen `flush()` yolu hiç çalışmıyor

**Kanıt.** `ColleX-Durdur.cmd`:
- satır 20: `taskkill /FI "WINDOWTITLE eq ColleX Sunucu*" /T /F`
- satır 34 ve 49: `Stop-Process -Id … -Force`

Windows'ta `/F` / `-Force` süreci `TerminateProcess` ile öldürür; Node'un
`process.on("SIGINT"/"SIGTERM")` ve `process.on("exit")` kancaları
**çalışmaz**. `serve.mjs:352-378`'deki `shutdown()` — `killMcp()`,
`removePid()`, `answerStore.flush()`, `draftStore.flush()`,
`sql.end({timeout:5})` — hiçbiri koşmaz.

**Bu makinede doğrulandı:** sunucuyu `taskkill /F` ile öldürdükten sonra
`var/collex.pid` yerinde kaldı (RISKS #22'nin gözlemi; burada nedeni
gösteriliyor: yalnız kazara bir kill değil, **ürünün kendi durdurucusu**
sert kill yapıyor).

**Ne kadar veri riskte? Ölçüldü/okundu — sanıldığından az, ama sıfır değil.**
STATUS "Kalıcılık sözü ve çekinceleri · Çekince 1" diyor ki
*"`PgAnswerStore.put`/`PgDraftStore.put` arka planda yazar; süreç yazma
bitmeden sert öldürülürse son kayıt DB'ye ulaşmaz."* Kod bugün bundan daha
iyi:

| Yol | Kod | Kayıp penceresi |
|---|---|---|
| `POST /v1/answer` | `server.ts:736-737` `await answerStore.persisted(runId)` | **0** — 200 ancak yazma sonuçlandıktan sonra döner |
| `POST/PUT /v1/drafts` | `drafting/routes.ts:430` `await store.persisted(draftId)` | **0** |
| `POST /v1/ai/draft-paragraph` | `ai/routes.ts:721` | **0** |
| `POST/PATCH/DELETE /v1/matters*`, items | `matters/store.ts` — hepsi `await this.sql` | **0** |
| `PUT /v1/settings` | `settings/store.ts:150` `await this.sql` | **0** |
| **`POST /v1/research/start` (202)** | koşu bitince sink'e `put()`, **hiçbir cevap beklemiyor** | koşu süresi + 1 INSERT (loopback'te ms) |
| **`matterLink` bağlama** | tasarımı gereği "asla isteği düşürmez" | 1 UPDATE |

**Yani gerçek pencere iki yerde:** canlı derin araştırmanın 202 yolu ve
otomatik dosyalama. Diğer yollarda "kaydedildi" gördüyseniz **gerçekten
kaydedilmiştir**.

**Düzeltme.**
1. **Belgeyi düzeltin** (dürüstlük): STATUS Çekince 1 bugünkü kodu yanlış
   anlatıyor; yukarıdaki tabloyu kullanın. Bu, kullanıcıya verilen
   güvencenin **artmasıdır**, azalması değil.
2. **Durdurucuya nazik yol ekleyin.** `serve.mjs` `var/collex.stop`
   dosyasını 500 ms'de bir yoklasın (ya da yalnız loopback'ten kabul edilen
   `POST /v1/shutdown`); `ColleX-Durdur.cmd` önce onu oluştursun, 5 sn
   beklesin, `var/collex.pid` hâlâ duruyorsa `/F` ile öldürsün. Bu,
   `flush()` + pid temizliği + `sql.end()` yolunu ilk kez gerçekten
   erişilebilir yapar ve `tests/integration/launcher.test.ts`'e tek bir
   yeni iddia ekler.
3. `pg_ctl -m fast -w stop` **doğru seçim** (rollback + checkpoint);
   `-m immediate`'a asla geçmeyin.

---

### E11 (P2) — Asıl bayt, DB commit'inden SONRA yazılıyor

`intake/ingest.py`: satır 278 `Pipeline(dsn, source).run()` (publish
transaction **commit edilir**), satır 309 `_store_original(...)`.
Aradaki her hata — disk dolu, izin, antivirüs kilidi, sert kill —
`process_file`'dan yukarı fırlar, CLI exit ≠ 0 verir, HTTP **500
`INTAKE_FAILED`** döner. Ama **belge veritabanına girmiştir**: `/v1/files`
onu listeler, "Belgeye sor" çalışır, asıl bayt yoktur.

Daha kötüsü: aynı baytlar tekrar yüklendiğinde pipeline `unchanged` der ve
kullanıcı `"Bu belge zaten yüklüydü"` görür — yani kullanıcı hatayı
"düzeltmek" için yaptığı doğru hareketle bile ilerleyemez (asıl bu kez
yazılır ama kullanıcı bunu bilmez).

**Düzeltme.** `_store_original`'ı `Pipeline(...).run()`'dan **önce**
çağırın. Sıra ters olduğunda kötü hâl "diskte asıl var, DB'de kayıt yok" →
yeniden yükleme temizler, kullanıcı hiçbir şey kaybetmez. Atomik yazma
(E6-(c)) ile birlikte yapın.

---

### E12 (P2) — `--ensure-db` yarışı ve başlatıcının kendi kendini öldürmesi

**(a) Advisory lock yok.** `apply_missing_migrations` hiçbir kilit almaz.
İki eşzamanlı `--ensure-db` boş bir veritabanında `ledger_state()` sonucunu
ikisi de "boş" okur, ikisi de aynı dosyayı uygulamaya çalışır.
`20260826010000` içinde `create type legal.document_scope as enum (…)`
`if not exists` **taşımaz** (PostgreSQL bunu desteklemez) → ikinci süreç
`duplicate_object` alır, transaction abort olur, başlatıcı
`"Veritabani semasi hazirlanamadi"` basar ve **durur**.

Düzeltme: `apply_missing_migrations` başında
`select pg_advisory_lock(hashtext('collex.migrations'))`, sonunda unlock —
üç satır, hem yarışı hem çift tıkı çözer.

**(b) Başlatıcı çift tıkta ilk sunucuyu öldürüyor.** `ColleX-Baslat.cmd`
adım 0 sağlık kontrolü yapar (`HEALTHY=1` ise yalnız tarayıcı açar), ama
sunucu **açılış sırasındaysa** (60 sn'lik poll penceresi) `HEALTHY=0`
döner ve adım 1
`taskkill /FI "WINDOWTITLE eq ColleX Sunucu*" /T /F`
**çalışan/açılan sunucuyu sert öldürür**. Sabırsız bir kullanıcının ikinci
tıkı budur.

Düzeltme: adım 1'den önce `var/collex.pid`'e bak; pid yaşıyor ve
CommandLine'ı ColleX ise "zaten başlıyor, bekleniyor" deyip doğrudan
poll'a geç.

**(c) Pencere başlığıyla öldürme.** `WINDOWTITLE eq ColleX Sunucu*`
kullanıcının aynı adı verdiği ilgisiz bir cmd penceresini de kapatır.
Durdurucudaki CommandLine kuralı (FIX-2 #7) burada da uygulanmalı.

---

### E13 (P2) — Bulut AI hattında kümülatif maliyet/hız sınırı yok

`src/ai/analysis.ts` **çağrı başına** giriş token bütçesi uyguluyor
(`ANALYSIS_TOKEN_BUDGET`), `anthropicAdapter` token toplamlarını sayıyor —
ama hiçbir yerde **saatlik/günlük çağrı tavanı, kümülatif token tavanı ya
da USD tavanı** yok (`grep` ile doğrulandı: `cost`/`quota`/`rateLimit`
karşılığı yok). E4 ile birleşince: yabancı bir sayfa `useCloudAi:true`
taşıyan istekleri döngüye sokarak avukatın anahtarını sınırsız harcatabilir;
kullanıcı hatayı yalnız Anthropic faturasında görür.

**Düzeltme.** `ai/routes.ts`'e üç sabit: `AI_MAX_CALLS_PER_HOUR` (ör. 60),
`AI_MAX_INPUT_TOKENS_PER_DAY`, ve aşımda tipli `429 AI_RATE_LIMITED` +
Türkçe mesaj. Ayarlar › Sistem durumu'nda "Bugün: N çağrı / ~M jeton"
satırı — hem güvenlik hem dürüstlük kazancı.

---

### E14 (P2) — `/v1/*` cevapları güvenlik başlığı taşımıyor

Ölçülen (`curl -D -`):

| Uç | Başlıklar |
|---|---|
| `GET /` | `content-security-policy` (hash-pinli, doğru), `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `cache-control: no-store` |
| `GET /v1/health` | yalnız `Content-Type`, `Content-Length`, `Date`, `Connection` |

`GET /v1/answers/{runId}/evidence-bundle?texts=true` müvekkil belgesinin tam
metnini döndürür ve **`no-store` taşımaz** — tarayıcının disk önbelleğine
(ve ileride herhangi bir yerel proxy'ye) yazılabilir. Paylaşılan/çalınan bir
dizüstünde bu, silinmiş sanılan verinin diskte kalmasıdır.

**Düzeltme.** `/v1/*` için tek ara katman:
`cache-control: no-store`, `x-content-type-options: nosniff`,
`referrer-policy: no-referrer`. Üç satır.

**CSP durumu — SAĞLAM.** Konsolun CSP'si hâlâ hash-pinli ve doğru:
`default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…';
img-src 'none'; font-src 'none'; connect-src 'self'; form-action 'none';
base-uri 'none'; frame-ancestors 'none'; object-src 'none'`.
`console.html`'de markup atayan DOM API'leri ve dinamik kod değerlendirme
**0 kez** geçiyor (grep: `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
belge-yazma API'si, dinamik fonksiyon üretimi). Bu bölüm "düzeltilecek"
değil, **korunacak**.

---

### E15 (P2) — Ledger, diskte olmayan satırları görmezden geliyor

`store/health.ts:239-243`:
```ts
const recorded = new Set(result.ledger);
const missing = plan.filter((m) => !recorded.has(m.name)).map((m) => m.name);
return { applied: expected - missing.length, expected, missing };
```
Ledger'da olup diskte olmayan bir dosya (ileri bir dalganın uyguladığı
migration, sonra kodun geri alınması) hiçbir yerde raporlanmaz; sonuç
`11/11 OK` olur ve uygulama **daha yeni bir şemaya karşı** çalışır.
Python tarafı da aynı: `apply_missing_migrations` yalnız eksikleri arar.

**Düzeltme.** `MigrationHealth`'e additive `unknown: string[]` alanı
(`ledger \ plan`) ve `/v1/health`'te dolu olduğunda Türkçe uyarı:
"Veritabanı bu sürümden daha yeni (N bilinmeyen migration) — ColleX'i
güncelleyin." Ucuz ve geri alma kazalarını görünür kılar.

---

### E16 (P2) — Sözcüksel kapsam şeridinde aday sınırı yok

**Ölçüm (20 055 parça, homojen korpus, en kötü hâl):** coverage-mode
sorgusu **1 553,9 ms**; plan `Nested Loop … rows=20000` — `@@` tsquery
**bütün** parçaları kabul ediyor ve her satır için
`tsvector_to_array(c.search_tsv_tr)` + dizi kesişimi hesaplanıyor.

Yorum: gerçek çeşitli bir korpusta bu çok daha az olur, ama bir avukatın
yüklemeleri (hepsi kira, hepsi aynı sözcükler) tam olarak homojen olduğu
için bu **gerçekçi** bir üst sınırdır ve E2 düzeltildikten sonra en yavaş
şerit bu olur.

**Düzeltme.** Kapsam filtresini bir aday CTE'sinin üstüne koyun:
`with cand as (select … from legal.chunks c where vector @@ q.tsq
order by ts_rank_cd(…) desc limit 2000)` → sonra kesişim/kapsam yalnız
2000 satırda. Sınır (`LEXICAL_CANDIDATE_CAP`) sabit ve belgelenmiş olsun.

---

### E17 (P2) — `extract_pdf`'te sayfa sınırı yok

`intake/extract.py:119-168`: şifreli PDF reddediliyor (iyi), ayrıştırma
hataları tipli (iyi), taranmış PDF fail-closed (iyi) — ama
`for page in reader.pages: page.extract_text()` üzerinde **sayfa sayısı
sınırı yok**. `intake/quarantine.py` açıklaması pypdf'i sayfa başına
~50-100 ms olarak veriyor: 25 MB'lık 3000 sayfalık bir tarama 150–300 sn →
`INTAKE_EXEC_TIMEOUT_MS` (180 sn) aşılır, 504 `UPLOAD_TIMEOUT`, üç dakika
kayıp. `ai/ocr.ts` aynı iş için **100 sayfa** sınırı koyuyor; intake
koymuyor.

**İyi haber (doğrulandı):** zaman aşımı veritabanını bozmaz. Publish tek
transaction (`ingestion/pipeline.py:212-228`, `tests/ingestion/
test_publish_atomicity.py`), çıkarma ise DB'ye dokunmadan önce biter.

**Düzeltme.** `PDF_MAX_PAGES = 600` (ya da OCR ile aynı 100) + tipli
`EXTRACTION_FAILED` ve Türkçe mesaj ("Belge N sayfa; en fazla M sayfa
işlenebilir — belgeyi bölün"). Kullanıcı 3 dakika yerine 2 saniyede öğrenir.

---

### E18–E22 (P3, kısa)

- **E18** `ColleX-Baslat.cmd` `pg_isready` başarılıysa kümenin ColleX'in
  veri dizini olduğunu doğrulamıyor. Kullanıcı ileride normal bir PostgreSQL
  kurup 55432'yi kaparsa ColleX **boş bir kümeye** bağlanır ve "bütün
  dosyalarım gitti" görünür. Düzeltme: `psql -Atc "show data_directory"`
  çıktısını `%PGDATA_DIR%` ile karşılaştır, uymuyorsa Türkçe uyar ve dur.
- **E19** `pushFileHistory` (`console.html`) `{fileId: [≤20 kayıt]}`
  haritasını sınırsız büyütüyor; 2000 belgede localStorage 5 MB kotasına
  dayanır, `writeStore`'un `catch` bloğu hatayı yutar ve belge geçmişi
  sessizce kalıcı olmaz. Düzeltme: en yeni 100 `fileId`'yi tut.
  (Genel not: **tüm** localStorage/sessionStorage erişimleri try/catch
  içinde — özel pencere, kapalı depolama ve kota hatası zaten güvenli.)
- **E20** `initAsOf()` tarayıcının bugününü kullanıyor; `/v1/health.time`
  sunucu saatini veriyor ama ikisi hiç karşılaştırılmıyor. Saati kaymış bir
  makinede "değerlendirme tarihi" ve süre başlangıçları sessizce yanlış
  olur — ve süre kuralları zaten `dogrulanmadi` (RISKS #19). Düzeltme:
  `|health.time - Date.now()| > 24 saat` ise üst çubukta uyarı.
- **E21** `guardAnswerForConsole` + `scanForInjection` yalnız cevap
  kanıtlarına uygulanıyor; `GET /v1/files/{id}` parça önizlemeleri (belge
  sayfasının sol bölmesi) taramadan geçmiyor. Karşı tarafın dilekçesindeki
  `SYSTEM: …` satırı cevapta işaretli, belge sayfasında işaretsiz görünür.
  Düzeltme: aynı tarayıcıyı `FileDetail.chunks` üzerinde de koştur, additive
  `injectionFlagged` alanı ekle.
- **E22** Cevap önbelleği 32 girdi (`InMemoryAnswerStore`), her girdi
  `result` + `bundle` ile 5 MiB'a kadar → **teorik tavan ~160 MB** yalnız
  cevap önbelleği için. Ölçülen gerçek: 250 cevap sonrası **181,6 MB WS /
  255,4 MB PM** (başlangıç zirvesi 241,5 MB; 50 cevap sonrası 122,2 MB) —
  **sızıntı yok, GC çalışıyor**. Tavan belgelenmeli (RUNBOOK §7), gerekirse
  kapasite bayt cinsinden sınırlanmalı.

---

## 2. Veri güvenliği haritası ve arıza matrisi

### 2.1 Her şey nerede yaşıyor

| Ne | Nerede | Yedeği var mı |
|---|---|---|
| Dosyalar, kayıtlar, süreler, notlar | `collex_local.app_private.{matters,matter_items}` | **hayır** |
| Cevaplar (+ tam kanıt paketi, ≤5 MiB metin) | `collex_local.app_private.answers` | **hayır** |
| Taslakların **her sürümü** | `collex_local.app_private.drafts` (satır = sürüm) | **hayır** |
| Profil, tercihler | `collex_local.app_private.settings` | **hayır** |
| Yüklenen belgelerin metni + parçaları | `collex_local.legal.{documents,document_versions,chunks}` | **hayır** |
| Ham yükleme denetim kopyası | `collex_local.legal.source_snapshots` | **hayır** |
| Migration ledger'ı | `collex_local.app_private.schema_migrations` (11 satır) | **hayır** |
| **Yüklenen belgelerin ASLI** | `var/uploads/<sha256><ext>` (repo içinde!) | **hayır** |
| Küme dosyaları | `C:\Users\anile\scoop\persist\postgresql\data` (294 MB) | **hayır** |
| Aktif dosya / tema / belge geçmişi | tarayıcı `localStorage` | ilgisiz (türetilebilir) |

Not: `scoop/apps/postgresql/current` bir junction; `data` ise
`scoop/persist/postgresql/data`'ya bağlı — yani **scoop sürüm yükseltmesi
veriyi korur**. `scoop uninstall -p postgresql` korumaz.

### 2.2 Arıza matrisi (kod + ölçüm karşılığı)

| Olay | Bugün ne oluyor | Kayıp | Not |
|---|---|---|---|
| **Yazma sırasında elektrik kesintisi** | PostgreSQL WAL ile kurtarır (`fsync/synchronous_commit/full_page_writes` hepsi `on`, doğrulandı) | commit edilmemiş son işlem | DB **bozulmaz** |
| Aynı anda yükleme varsa | publish tek transaction → rollback; asıl bayt kırık kalabilir (E6-c) | belge yok sayılır | asıl dosya sessiz bozulur |
| **PostgreSQL çalışırken durduruluyor** | `/v1/health db:"down"`, uçlar tipli `503 STORE_UNAVAILABLE` / `CORPUS_UNAVAILABLE`, konsol Türkçe uyarı + 5 sn yoklama | 0 | iyi tasarlanmış |
| **Sunucu açılırken DB kapalı** | `serve.mjs` Türkçe teşhis + `exit 1`; başlatıcı `exit /b 1` ile durur | 0 | FIX-2 #7, doğru |
| **DB var, şema yok** | sunucu **bellek içi** depolarla kalkar ve söyler | oturum sonunda **her şey** | riskli ama görünür |
| **Disk dolu (DB)** | PostgreSQL `53100 disk_full`; commit başarısız; `persisted:false` + Türkçe uyarı | 0 (yazılamadı, söylendi) | doğru |
| **Disk dolu (asıl bayt)** | 500 `INTAKE_FAILED`, **belge DB'de kalır** | asıl bayt | **E11** |
| **`var/uploads` silinmesi** | hiçbir uyarı yok; kimse okumuyor | **tüm asıllar** | **E6** |
| **Bozuk yükleme** | magic-byte/uzantı/ZIP/şifreli-PDF/boş hepsi tipli 400/415/422 (ölçüldü, §5.1) | 0 | sağlam |
| **İki ColleX penceresi (sekme)** | `storage` olayı + toast; taslakta `baseVersion` → `409 VERSION_CONFLICT` | 0 | P1-11/P2-7 doğru |
| **İki ColleX sunucusu** | ikincisi `EADDRINUSE` → Türkçe mesaj + `exit 1` | 0 | doğru |
| **İki başlatıcı çift tıkı** | ikinci tık ilkini `taskkill /F` ile öldürebilir; iki `--ensure-db` yarışabilir | 202-yolu + bağlama | **E12** |
| **Taslak kaydederken sert kill** | rota `persisted()`'ı **bekliyor** → 200 gördüyse yazılmıştır | **0** | STATUS Çekince 1 güncellenmeli (**E10**) |
| **`collex_local` yanlışlıkla drop** | geri dönüş **yok** | **her şey** | **E1** |
| **Yarım uygulanmış migration** | ledger 11/11 der, RLS gitmiştir | sessiz güvenlik kaybı | **E3** |

---

## 3. Yedekleme / geri yükleme önerisi (tam ve test edilmiş)

Hedef: **tek düğme, tek dosya, kanıtlanmış geri dönüş.** Aşağıdaki her komut
bu makinede koşuldu.

### 3.1 Ölçülen gerçekler

| İşlem | Komut | Sonuç |
|---|---|---|
| Yedek (ürün DB) | `pg_dump -h 127.0.0.1 -p 55432 -U postgres -d collex_local -Fc -f collex_local.dump` | **0,22 sn**, 75 868 bayt (boş DB) |
| Yedek (veri dolu) | aynı, `collex_demo` | **0,17 sn**, 120 385 bayt |
| Geri yükleme | `pg_restore -h … -d collex_restore_probe --no-owner --no-privileges collex_demo.dump` | **0,37 sn**, **exit 0, tek hata yok** |
| Bütünlük | geri yüklenen DB'de | uzantılar `plpgsql,btree_gist,pg_trgm,pgcrypto` · tetikleyici **1** · indeks **54** · RLS politikası **17** · `search_tsv_tr` üretilmiş sütunları **74/74 dolu** |
| Araçlar | `pg_dump 18.1`, `psql 18.1` | `C:\Users\anile\scoop\apps\postgresql\current\bin` — **zaten PATH'te** |

`-Fc` (custom) formatı seçildi: sıkıştırılmış, seçici geri yükleme yapıyor,
paralel geri yüklemeye izin veriyor ve `pg_restore` sürüm farklarına
düz SQL'den daha dayanıklı.

### 3.2 `ColleX-Yedekle.cmd` (yeni dosya, repo kökü)

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PGBIN=%USERPROFILE%\scoop\apps\postgresql\current\bin"
set "PGPORT=55432"
set "STAMP=%date:~-4%%date:~3,2%%date:~0,2%-%time:~0,2%%time:~3,2%"
set "STAMP=%STAMP: =0%"
set "OUT=%USERPROFILE%\ColleX-Yedek\%STAMP%"

if not exist "%PGBIN%\pg_dump.exe" (
  echo [ColleX] PostgreSQL araclari bulunamadi: %PGBIN%
  pause & exit /b 1
)
"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p %PGPORT% >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Veritabani calismiyor. Once ColleX-Baslat.cmd calistirin.
  pause & exit /b 1
)

mkdir "%OUT%" 2>nul
echo [ColleX] Veritabani yedekleniyor...
"%PGBIN%\pg_dump.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d collex_local ^
   -Fc -f "%OUT%\collex_local.dump"
if errorlevel 1 ( echo [ColleX] YEDEK BASARISIZ ^(veritabani^). & pause & exit /b 1 )

echo [ColleX] Belge asillari kopyalaniyor...
robocopy "var\uploads" "%OUT%\uploads" /E /R:2 /W:1 /NFL /NDL /NJH /NJS >nul
if errorlevel 8 ( echo [ColleX] YEDEK BASARISIZ ^(belge asillari^). & pause & exit /b 1 )

rem --- Dogrulama: dump gercekten okunabiliyor mu? ---
"%PGBIN%\pg_restore.exe" -l "%OUT%\collex_local.dump" > "%OUT%\icindekiler.txt"
if errorlevel 1 ( echo [ColleX] YEDEK DOGRULANAMADI. & pause & exit /b 1 )

powershell -NoProfile -Command ^
  "$d=Get-Item '%OUT%\collex_local.dump'; $u=(Get-ChildItem '%OUT%\uploads' -Recurse -File -EA SilentlyContinue); ^
   @{ tarih='%STAMP%'; veritabani_bayt=$d.Length; asil_dosya=$u.Count; asil_bayt=(($u|Measure-Object Length -Sum).Sum) } ^
   | ConvertTo-Json | Set-Content -Encoding utf8 '%OUT%\yedek.json'"

echo.
echo [ColleX] Yedek tamam: %OUT%
echo [ColleX] Bu klasoru harici diske veya bulut klasorune KOPYALAYIN.
echo [ColleX] Geri yuklemek icin: ColleX-Geri-Yukle.cmd "%OUT%"
pause
```

**Saklama (isteğe bağlı son satır, son 14 yedeği tutar):**
`powershell -NoProfile -Command "Get-ChildItem '%USERPROFILE%\ColleX-Yedek' -Directory | Sort-Object Name -Descending | Select-Object -Skip 14 | Remove-Item -Recurse -Force"`

### 3.3 `ColleX-Geri-Yukle.cmd` (yeni dosya)

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PGBIN=%USERPROFILE%\scoop\apps\postgresql\current\bin"
set "PGPORT=55432"
set "SRC=%~1"
if "%SRC%"=="" ( echo Kullanim: ColleX-Geri-Yukle.cmd "C:\...\ColleX-Yedek\20260902-1430" & pause & exit /b 1 )
if not exist "%SRC%\collex_local.dump" ( echo [ColleX] Yedek dosyasi yok: %SRC% & pause & exit /b 1 )

echo.
echo  DIKKAT: mevcut collex_local veritabani yeniden adlandirilacak ve
echo  yerine yedek geri yuklenecek. Once ColleX-Durdur.cmd calistirin.
echo.
set /p ONAY="Devam etmek icin EVET yazin: "
if /I not "%ONAY%"=="EVET" ( echo Iptal edildi. & pause & exit /b 1 )

rem 1) Guvenlik agi: mevcut hali once yedekle (geri yukleme de bir risktir).
"%PGBIN%\pg_dump.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d collex_local ^
   -Fc -f "%TEMP%\collex_local_gerialma_oncesi.dump" 2>nul

rem 2) Eskiyi SAKLA, yerine bos bir veritabani ac (asla drop ile baslamayin).
"%PGBIN%\psql.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d postgres -v ON_ERROR_STOP=1 ^
  -c "alter database collex_local rename to collex_local_eski;" ^
  -c "create database collex_local;"
if errorlevel 1 ( echo [ColleX] Veritabani hazirlanamadi. & pause & exit /b 1 )

rem 3) Geri yukleme.
"%PGBIN%\pg_restore.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d collex_local ^
   --no-owner --no-privileges --exit-on-error "%SRC%\collex_local.dump"
if errorlevel 1 (
  echo [ColleX] GERI YUKLEME BASARISIZ. Eski veritabani collex_local_eski adiyla duruyor.
  pause & exit /b 1
)

rem 4) Belge asillari (birlestirir, silmez).
robocopy "%SRC%\uploads" "var\uploads" /E /R:2 /W:1 /NFL /NDL /NJH /NJS >nul

rem 5) Dogrulama.
"%PGBIN%\psql.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d collex_local -Atc ^
 "select 'dosya='||(select count(*) from app_private.matters)||' cevap='||(select count(*) from app_private.answers)||' taslak='||(select count(*) from app_private.drafts)||' belge='||(select count(*) from legal.documents where scope='tenant')||' politika='||(select count(*) from pg_policies where schemaname in ('legal','app_private'))||' migrasyon='||(select count(*) from app_private.schema_migrations);"

echo.
echo [ColleX] Geri yukleme tamam. Eski veritabani: collex_local_eski
echo [ColleX] Her sey yolundaysa elle silin: drop database collex_local_eski;
pause
```

**Tasarım kararları (gerekçeli).**
- **Yeniden adlandır, silme.** `alter database … rename to collex_local_eski`
  — geri yükleme başarısız olursa eski veri hâlâ oradadır. `drop` asla ilk
  hamle olmamalı; silmeyi kullanıcı sonradan elle yapar.
- `--exit-on-error`: kısmen geri yüklenmiş bir veritabanı, E3'ün tam olarak
  yarattığı durumdur; sessizce devam etmesin.
- `robocopy /E` asılları birleştirir (silmez): yedek eksikse mevcut
  dosyalar kaybolmaz.
- Doğrulama satırı `pg_policies` sayısını da basar — E3'e karşı emniyet.

### 3.4 Arayüz tarafı (Ayarlar sekmesi)

- **"Yedek al"** düğmesi → `POST /v1/backup` (yalnız loopback, E4/E5
  ara katmanının arkasında) → sunucu `pg_dump`'ı `execFile` ile
  (argüman dizisi, shell yok) koşar, sonuç `{path, sizeBytes, files, at}`
  (işlem < 1 sn ölçüldü, ilerleme kanalı gerekmiyor).
- **"Son yedek: GG.AA.YYYY HH:MM"** satırı; 7 günden eskiyse turuncu uyarı,
  hiç yoksa kırmızı: *"Henüz hiç yedek alınmadı — verileriniz tek bir
  diskte."*
- `/v1/health`'e additive `backup: {lastAt, sizeBytes} | null`.
- **Dürüstlük bağı:** KULLANIM-ColleX.md'deki "verileriniz bu bilgisayarda"
  cümlesi ancak yedekle birlikte tamamlanır; yedek satırı oraya da girmeli.

### 3.5 Ne yapılmamalı

- **PITR / WAL arşivleme yok.** Tek kullanıcı, saniyelik RPO gerekmiyor,
  operasyonel yükü büyük.
- **`pg_basebackup` yok.** Küme düzeyi yedek `collex_demo` ve test
  veritabanlarını da taşır; ürün verisi için `pg_dump` daha temiz.
- **Otomatik zamanlanmış görev başlangıçta yok.** Önce kullanıcı bir
  düğmeyle kontrolü öğrensin; ikinci adımda `ColleX-Durdur.cmd`'nin sonuna
  "çıkarken yedek al" seçeneği eklenebilir.
- **Şifreleme henüz yok**, ama yedek klasörü müvekkil verisi taşır: dosyada
  ve arayüzde *"Bu klasör müvekkil verisi içerir — şifreli bir diske veya
  BitLocker'lı bir klasöre koyun"* uyarısı zorunlu.

---

## 4. Migration / ledger: dilbilgisindeki delikler

E3 ana bulgudur. Tam liste:

| # | Delik | Durum | Düzeltme |
|---|---|---|---|
| 4.1 | Probe dosyanın ORTASINDA yaratılan nesneyi adlandırıyor → yarım uygulanmış dosya "tam" sayılıyor | **kanıtlandı** (E3) | çoklu probe + `policy:` kind + "son nesne" testi |
| 4.2 | `extension:btree_gist` başka bir araç tarafından da kurulmuş olabilir | **çıkarım** (probe kuralı "kendi yarattığı" diyor, ama uzantı paylaşımlıdır) | 010000'i dosyanın SON yarattığı nesneye (enum tipi ya da `app_private` şeması) çevirin |
| 4.3 | Ledger'da olup diskte olmayan satır görünmez | **kod** (`health.ts:239-243`) | E15: additive `unknown[]` |
| 4.4 | Downgrade / rollback yolu yok | **kod** — hiçbir migration `down` taşımıyor, ledger'da silme yok | Kabul edilebilir (tek kullanıcı, yedek varsa geri yükleme = rollback). §3 bunu **ön koşul** yapıyor |
| 4.5 | Eşzamanlı `ensure-db` için kilit yok | **kod** | E12(a): `pg_advisory_lock(hashtext('collex.migrations'))` |
| 4.6 | Yarım *uygulama* (dosya içi) `apply_missing_migrations` yolunda **imkânsız** | **doğrulandı** — her dosya `with conn.transaction()` içinde, PostgreSQL'de DDL transactional; hiçbir dosyada `create index concurrently` yok (grep) | değişiklik gerekmez |
| 4.7 | Sonraki dalganın eklediği migration | **doğru çalışıyor** — ledger'da olmayan dosya uygulanır | değişiklik gerekmez |
| 4.8 | `collex_demo`'da ledger tablosu **yok** | **ölçüldü** | Demo/probe DB'leri her `/v1/health`'te bootstrap yolunu kullanıyor; 4.1 orada canlı |

---

## 5. Dış sınırların arıza davranışı

### 5.1 Intake CLI — **sağlam** (gerçek isteklerle ölçüldü, port 8934)

| Girdi | Sonuç |
|---|---|
| 5 KB rastgele bayt, `.docx` adı | `415 UNSUPPORTED_TYPE` "dosya içeriği tanınmadı (magic-byte sniff başarısız)…" |
| `%PDF` başlıklı `.txt` | `415` "uzantı ile içerik uyuşmuyor: uzantı 'txt', içerik 'pdf'" |
| 0 bayt | `400 INVALID_REQUEST` "boş dosya" |
| `PK\x03\x04junk` `.docx` | `415` "bozuk ZIP kapsayıcı: File is not a zip file" |
| Dosya adı `../../../../evil.txt` | `200`, ad **`evil.txt`** olarak saklandı |
| Dosya adı `..\..\..\evil2.txt` | `200`, ad **`evil2.txt`** |
| Dosya adı `a\x00b.txt` | `200`, ad **`a_b.txt`** |

**Path traversal yok** (`safeUploadName`, `files/routes.ts:212`), shell yok
(`execFile` + argüman dizisi), `FILE_ID_RE` DELETE'te süreç başlamadan
denetleniyor. Zip bomba korumaları (`ZIP_MAX_ENTRIES` 200, 50 MB
girdi/toplam, 100× oran), şifreli PDF reddi, taranmış PDF fail-closed —
hepsi yerinde. Kalan boşluklar: **E17** (sayfa sınırı), **E11** (yazma
sırası), ve eşzamanlı yükleme sayısı için sınır yok (konsol kuyruk
kullanıyor, API kullanmıyor — kötü niyetli/yanlış bir istemci N tane
Python süreci doğurabilir; `MAX_CONCURRENT_INTAKE = 2` semaforu ucuz).

### 5.2 Export CLI

`DRAFT_ID_RE` süreç başlamadan denetleniyor; geçici dosyalar sabit adlı
(`draft.json` / `draft.<fmt>`) — id asla yol parçası değil; `EXPORT_FAILED`
gövdesinde stderr yok, `correlationId` var. **Content-Disposition
enjeksiyonu yok** (doğrulandı): `exportFileName`'in `clean()` fonksiyonu
`[\u0000-\u001f"\\/:*?<>|]` sınıfını (CR/LF dahil) siliyor, `asciiSafe`
`[^A-Za-z0-9 ._-]`'yi atıyor, `filename*` yüzde-kodlu. Bulgu yok.

### 5.3 MCP çocuğu

- **Port dolu:** `pickMcpPort` 20 portluk aralıkta boş olanı bulur, Türkçe
  uyarır. Doğru.
- **Çökme:** `onExit` → `mcpState='down'` → `/v1/research` tipli 502; dosya
  ve cevap uçları çalışmaya devam eder. Doğru.
- **Asılma:** `mcpState` `'starting'`da kalır ve **hiçbir zaman zaman
  aşımına uğramaz** — hazır satırı hiç gelmezse konsolda MCP rozetleri
  sonsuza kadar "başlatılıyor" der. Düzeltme: 60 sn sonra `'down'` +
  Türkçe satır. (P3)
- **Yeniden başlatma fırtınası yok:** çocuk bir kez başlatılıyor, otomatik
  yeniden başlatma yok — kullanıcı sunucuyu yeniden başlatmalı. Bu bilinçli
  ve doğru (fırtına riski yok), ama arayüz "canlı araştırma için sunucuyu
  yeniden başlatın" demeli (`serve.mjs:415` stderr'de diyor, konsolda
  görünmüyor). (P3)
- **Token:** yalnız ortamdan; `--token` fırlatıyor. Doğrulandı (kod).

### 5.4 Bulut AI adaptörü — büyük ölçüde sağlam

`anthropicAdapter.ts`: istek başına `AbortSignal.timeout` (60 sn),
429/5xx/ağ hatasında **2 yeniden deneme** + üstel backoff + sınırlı
`retry-after`, `stop_reason === "max_tokens"` → tipli hata (kesik JSON
sessizce kabul edilmiyor), `AnthropicApiError` yalnız status/code taşıyor,
anahtar WeakMap'te ve `toJSON`/`inspect` `[gizli]`. Aşırı büyük belge:
`selectChunksWithinBudget` giriş bütçesini uyguluyor; OCR'de 32 MB + 100
sayfa + PDF imza ön-koruması.

**Eksik olan tek şey maliyet:** E13 (kümülatif tavan yok) ve E4 ile
birleştiğinde rıza modelinin kendisi zayıflıyor.

### 5.5 Tarayıcı

- **localStorage dolu / kapalı / özel pencere:** tüm erişimler try/catch
  içinde (`readStore`/`writeStore` + doğrudan siteler) — uygulama sessizce
  çalışmaya devam eder. **Bulgu yok** (E19 yalnız sınırsız büyüme).
- **Çevrimdışı / sunucu kapalı:** `humanError` + `markServerDown()` üç rozeti
  kırmızıya çevirir, Türkçe cümle basar, 5 sn'de bir `/v1/health` yoklar ve
  geri gelince görünümü yeniler. İyi.
- **Saat sapması:** E20.
- **İki sekme:** `storage` olayı + toast + `baseVersion` 409. İyi.

---

## 6. Performans: ölçülen tablo ve ölçekte ilk beş

### 6.1 Ölçümler (bu makine, 02.09.2026)

| Yüzey | `collex_demo` (55 parça) | Probe DB (20 055 parça / 2000 belge / 2000 cevap) |
|---|---|---|
| `serve.mjs` soğuk açılış → ilk `/v1/health` 200 | — | **2 248 ms** |
| `GET /v1/health` | — | **4,5 / 6,6 / 4,7 ms** |
| `GET /` (konsol, 401 996 bayt) | — | **3,9 / 9,3 ms** |
| `GET /v1/files` | — | **231 / 255 / 265 ms**, 486 904 bayt |
| `GET /v1/matters` | — | **6,2 / 8,9 ms**, 73 505 bayt (200 dosya) |
| `GET /v1/answers?limit=20` | — | **5,6 / 8,4 ms** |
| `GET /v1/answers?fileId=…` | — | **16,7 / 25,9 ms** |
| `POST /v1/answer` | **96 / 104 / 169 ms** | **45 030 – 45 875 ms** |
| 50 cevap arka arkaya | **6 sn** | — |
| Bellek (Node WS/PM) | başlangıç 241,5 / 278,9 MB → 50 cevap sonrası **122,2 / 129,4 MB** → 250 cevap sonrası **181,6 / 255,4 MB** | — |

**Bellek sonucu: sızıntı yok.** 250 cevap boyunca kullanım dalgalanıyor ve
başlangıç zirvesinin altında kalıyor; GC çalışıyor. Tavan E22'de.

**Konsol ilk boyama.** Dosya **401 996 bayt / 8 634 satır**, tek `<style>`
(satır 8–1654) + tek `<script>` (satır 1970–8631). Sunucu 4–9 ms'de
gönderiyor; ayrıştırma/derleme maliyeti ~400 KB tek parça betik için
tipik olarak 40–90 ms (bu hatta ölçülmedi — **tarayıcı hattının işi**).
Betik `bootConsole()`'u dosyanın sonunda çağırıyor, yani ayrıştırma
tamamlanmadan hiçbir şey çizilmiyor.

### 6.2 200 dosya / 2 000 belge / 20 000 parçada ilk beş darboğaz

| Sıra | Ne | Ölçülen | En ucuz düzeltme |
|---|---|---|---|
| 1 | `/v1/answer` trigram şeridi (**E2**) | 45,8 sn; şerit tamamen kayıp | `<%` operatörü + `set_config` eşiği → **1,56 ms** (indeks zaten var) |
| 2 | `/v1/files` `length(canonical_text)` detoast'ı (**E7**) | 148,9 → 12,4 ms; HTTP 250 ms / 487 KB | `chars`'ı metadata'ya yaz + `limit/offset` + `lateral` sayım |
| 3 | `GET /v1/answers?fileId=` jsonb seq scan (**E8**) | 15,5 → **0,087 ms** | tek GIN indeksi (128 kB) + predikatı `result->'fileScope'`e çevir |
| 4 | Sözcüksel kapsam şeridi (**E16**) | 1 553,9 ms (homojen korpus) | `@@` adaylarını `limit 2000` CTE'siyle sınırla |
| 5 | Konsol: 2000 belge kartı / 200 dosya satırı tek seferde DOM'a | HTTP 487 KB (ölçüldü); DOM tarafı bu hatta ölçülmedi | API sayfalaması (2 numara) + "Daha fazla göster"; sanal liste **gerekmez** |

**Bilinçli olarak ilk beşte olmayanlar.** Konsolu bölmek (400 KB tek dosya
CSP hash pinini ve "tek script" değişmezini taşıyor; kazanç < 100 ms,
maliyet yüksek); sanallaştırılmış listeler (sayfalama yeterli);
`max_connections` (5+3 havuz, tek kullanıcı); `statement_timeout` yükseltmek
(**yanlış düzeltme** — 15 sn doğru bir emniyet, sorun indekssiz sorgu).

---

## 7. Güvenlik duruşu (kimlik doğrulaması olmayan tek kullanıcılı yerel uygulama)

### 7.1 Gerçekten neye açık

`serve.mjs` `hostname: "127.0.0.1"` ile bağlanıyor; `netstat` yalnız
`127.0.0.1:8934` gösterdi. Yani **uzak ağdan erişilemez**. Kalan iki gerçek
tehdit ikisi de **tarayıcı üzerinden** geliyor:

1. **CSRF (E4)** — yazma. Kanıtlandı: `Origin: https://evil.example` +
   `content-type: text/plain` → `201`; multipart yükleme → `200`.
2. **DNS rebinding (E5)** — okuma. Kanıtlandı: `Host: evil.example` → `200`.

Üçüncüsü, aynı makinedeki başka bir yerel süreç: kimlik doğrulaması
olmadığı için `127.0.0.1:8787`'ye bağlanan herhangi bir program her şeyi
okuyabilir/yazabilir. Tek kullanıcılı masaüstü modelinde bu **kabul
edilebilir** (o süreç zaten `%LOCALAPPDATA%`'yı da okuyabilir) ve
belgelenmiş; E4/E5 ise kabul edilebilir değil çünkü **uzaktaki bir web
sayfası** tetikliyor.

### 7.2 Sağlam bulunanlar (korunmalı, "iyileştirilmemeli")

- **CSP hash-pinli ve doğru** (§E14'te tam metin). `frame-ancestors 'none'`
  → clickjacking yok. `connect-src 'self'` → konsol başka yere istek
  atamaz. `img-src/font-src 'none'` → uzaktan piksel yok.
- **Konsolda markup kanalı yok** — `console.html` metni yalnız
  `createElement` + `textContent` ile kuruyor; markup atayan DOM API'leri
  ve dinamik kod değerlendirme grep'te **0 kez** geçiyor. CSP + `textContent`
  iki bağımsız katman.
- **Untrusted içerik:** `security/renderGuard.ts` (idempotent, `<` hiç
  bırakmıyor, link/görsel yalnız izinli host, referans tanımları
  nötrleştiriliyor), `consoleGuard.ts` (enjeksiyon **etiketliyor**,
  temizlemiyor — alıntının sha256 zinciri korunuyor), `sourceUrl` yalnız
  `sourceUrlAllowed === true` iken bağlantı oluyor. Bu tasarım doğru.
  Tek boşluk: **E21** (belge sayfası parça önizlemeleri taranmıyor).
- **Path traversal yok** — yükleme adı (§5.1, 3 vektör denendi), dosya id
  biçimi (`FILE_ID_RE`), taslak id biçimi (`DRAFT_ID_RE`), dışa aktarım
  dosya adı (`asciiSafe`), export geçici dosyaları (sabit ad).
- **Shell yok** — intake ve export `execFile` + argüman dizisi.
- **SQL enjeksiyonu yok** — tüm kullanıcı değeri postgres.js bağlı
  parametresi; coverage-mode'daki `::tsquery` cast'i sözcüklenmiş
  leksemler üzerinde (`tests/quality/lexicalLane.test.ts` sabitliyor).
- **Sır sızıntısı yok** — DSN, stderr ve API anahtarı hiçbir HTTP gövdesine
  girmiyor (`correlationId` deseni); `AiConfig.toJSON` `[gizli]`.

### 7.3 Önerilen tek ara katman (E4+E5+E14 birlikte)

```ts
// src/api/localGuard.ts (yeni) — createApp'te ilk app.use("*", …)
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export function localGuard(): MiddlewareHandler {
  return async (c, next) => {
    const hostname = (c.req.header("host") ?? "").toLowerCase()
      .replace(/:\d+$/u, "").replace(/^\[|\]$/gu, "");
    if (!LOCAL_HOSTS.has(hostname)) return c.text("ColleX yalnız 127.0.0.1 üzerinden çalışır.", 421);
    const m = c.req.method;
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      const foreign =
        (origin !== undefined && !isOwnOrigin(origin, c.req.header("host"))) ||
        (site !== undefined && site !== "same-origin" && site !== "none");
      if (foreign) return c.json({ error: { kind: "FORBIDDEN_ORIGIN",
        message: "Bu istek başka bir web sayfasından geldi ve reddedildi." } }, 403);
    }
    await next();
    if (c.req.path.startsWith("/v1/")) {
      c.header("cache-control", "no-store");
      c.header("x-content-type-options", "nosniff");
      c.header("referrer-policy", "no-referrer");
    }
  };
}
```

Test yüzeyi (üç test): yabancı `Host` → 421; yabancı `Origin` + POST → 403
ve pipeline **çağrılmadı**; `Origin`'siz POST (curl/yerel betik) → normal.
Konsol kendi kaynağından çağırdığı için hiçbir mevcut davranış bozulmaz.

---

## 8. Test süiti kalitesi

### 8.1 Kapsanmayan riskli yollar

| Yol | Durum |
|---|---|
| `PgAnswerStore` / `PgDraftStore` / `PgMatterStore` / `PgSettingsStore` | yalnız `tests/store/persistence.test.ts`; **CI'da hiç koşmuyor** (E9) |
| `deriveMigrationHealth` gerçek-PG yolu | aynı süit; **CI'da hiç koşmuyor** |
| **Yarım uygulanmış migration** (E3) | **hiç test edilmemiş** — mevcut ledger testi yalnız "eksik DOSYA" senaryosunu kuruyor, "yarım DOSYA"yı değil |
| **Sorgu planı** (indeks kullanılıyor mu) | **hiç test edilmemiş** — E2 bu yüzden fark edilmedi |
| CSRF / `Host` / güvenlik başlıkları | **hiç test edilmemiş** (E4, E5, E14) |
| Yedekleme / geri yükleme | yok (E1) |
| `reportDatabaseHealth`, `MatterLinker` | doğrudan birim testi yok (rota üstünden dolaylı) |
| Ölçek davranışı (>1000 satır) | hiçbir süit 100 satırdan fazlasıyla koşmuyor |
| Eşzamanlı `--ensure-db` | yok (E12a) |
| `mcpState` `'starting'`da asılı kalma | yok |

### 8.2 Davranış yerine dize sabitleyen testler

`console.test.ts` (74 test) büyük ölçüde **dize eşleştirmesidir** — tasarım
gereği (LANG-7 adlandırma kuralı, gizlilik cümleleri, disclaimer birebirliği
gibi *dürüstlük değişmezleri* için doğru araç). Ama bazıları davranış
sanılıyor: "editör işlevleri/kimlikleri", "PUT şekli", "linter sabiti"
kontrolleri HTML metninde alt dize arıyor; fonksiyon yeniden adlandırılırsa
test kırılır, mantık bozulursa kırılmaz.

**Öneri.** Konsolun sözcüksel çekirdeğinin (`evidenceOverlapsClient`,
`lintParagraph`, `LINT_STOPWORDS`, `QUOTE_OVERLAP_FLOOR`) **davranışını**
TypeScript tarafında test edin — sunucudaki karşılığı
(`drafting/composer.evidenceOverlaps` + `llm/lexicalEntailment`) zaten orada
ve zaten aynadır; oraya "aynı girdi → aynı çıktı" tablo testleri ekleyin.
`console.test.ts` ise yalnız **sabitlerin** (0.7 eşiği, 22 stopword listesi)
iki tarafta birebir aynı olduğunu doğrulasın. Böylece ayna gerçekten
davranışla sınanır, konsolun tek-`<script>` sözleşmesi bozulmaz ve hiçbir
dinamik kod yürütülmez.

### 8.3 Yavaş / kırılgan testler

- `tests/store/retrieval.test.ts` ve `tests/quality/retrievalQuality.test.ts`
  her koşuda `collex_retrieval_test` / `collex_quality_test` veritabanını
  **drop + create + tüm migration + seed** yapıyor. Doğru ama pahalı; ve
  E9 nedeniyle CI'da hiç koşmuyor.
- `tests/integration/serve.test.ts` gerçek süreç doğuruyor ve port
  bekliyor — kırılgan olabilir; sabit 8819/8919 kullanıyor, çakışma
  koruması yok.
- Kırılganlık kaynağı yok: hiçbir testte gerçek ağ çağrısı yok (grep +
  `vitest.config.ts` yorumu).

### 8.4 Dört ortam-atlama işaretleyicisi dürüst mü?

**Evet.** Dördü de `describe.skipIf(!available)` (gerçek süit) +
`describe.skipIf(available)` (`"… (environment unavailable)"` adlı görünür
işaretleyici) çiftini kullanıyor:
`tests/drafting/real-export.test.ts:47/90`,
`tests/integration/real-exec.test.ts:68/169`,
`tests/integration/serve.test.ts:149/293`,
`tests/store/persistence.test.ts:276/705`.
Ortam **varken** işaretleyici atlanır ve gerçek testler koşar — S2'nin
"4 skipped" açıklaması doğrudur. Sorun dürüstlük değil, **CI'da ortamın hiç
sağlanmaması**dır (E9).

### 8.5 Geçen dalganın iki P0'ı bugün gerileme yakalar mı?

| P0 | Yakalanır mı | Gerekçe |
|---|---|---|
| **P0-1** kapsam kapısının atıfla toptan atlanması | **Evet** | `tests/answer/coverage.test.ts` "per-passage admission" (4) + `answerHonesty.test.ts` (3) davranışsal: soru + atıf → yalnız m.157, PARTIAL, kesinleştirilemez; set-aside pasajdan gelen kenar hiçbir şey kabul ettirmiyor. Tam offline, saf fonksiyon; CI'da koşar |
| **P0-2** dosya silinince taslak sürümünün yazılamaması | **Kısmen** | Davranışın *bellek içi* yarısı CI'da koşuyor (`tests/matters/routes.test.ts` `detachMatter` çağrısı, `tests/drafting/{routes,store}.test.ts` `persisted:false` + uyarı). Ama **asıl hata FK 23503'tü** ve onu yalnız `tests/store/persistence.test.ts`'in gerçek-PG testi kanıtlıyor — **CI'da hiç koşmuyor** (E9). `PgDraftStore.persist`'in 23503 yakalama dalına bir gerileme girerse CI yeşil kalır |

Yani: **E9 düzeltilmeden P0-2 tam korumalı değildir.**

---

## 9. Mevcut belgelere düzeltme önerileri (dürüstlük)

1. **STATUS.md "Kalıcılık sözü ve çekinceleri · Çekince 1"** bugünkü kodu
   olduğundan kötü anlatıyor. `POST /v1/answer`, `POST/PUT /v1/drafts`,
   `POST /v1/ai/draft-paragraph`, tüm `/v1/matters*` ve `PUT /v1/settings`
   yollarında cevap **yazma sonuçlandıktan sonra** dönüyor (kod satırları
   E10'daki tabloda). Gerçek pencere yalnız `POST /v1/research/start`
   (202) ve `matterLink` bağlamasıdır. Çekince bunu söylemeli.
2. **RISKS #22** ("sert kill sonrası pid dosyaları") tamamlanmalı: pid
   dosyalarını bırakan şey **ürünün kendi durdurucusudur** (E10), yalnız
   kazara bir kill değil.
3. **STATUS "Known risks"**e iki satır: yedek yok (E1); 20 000 parçada
   cevap süresi ölçüldü ve 45 sn (E2).
4. **CLAUDE.md** "Invariants" ledger satırı, probe'un "dosyanın yarattığı
   bir şeyi" değil, **"dosyanın SON yarattığı şeyi"** adlandırması
   gerektiğini söylemeli (E3).
5. **KULLANIM-ColleX.md** "verileriniz bu bilgisayarda" cümlesi yedek
   düğmesi gelene kadar bir uyarı taşımalı: *"ColleX henüz otomatik yedek
   almıyor; klasörünüzü düzenli olarak kopyalayın."*
6. **`docs/implementation/RUNBOOK.md` §7**'ye bellek tavanı (E22) ve
   `statement_timeout` 15 sn eklenmeli — ikisi de bugün belgesiz.

---

## 10. Önerilen iş sırası (build hatları için)

| Sıra | İş | Dosya | Tahmini boyut |
|---|---|---|---|
| 1 | **E2** trigram şeridini `<%` operatörüne çevir + plan testi | `src/store/chunkStore.ts`, `tests/store/retrieval.test.ts` | S — en yüksek getiri |
| 2 | **E4+E5+E14** `localGuard` ara katmanı + 3 test | `src/api/localGuard.ts` (yeni), `server.ts`, `tests/api.test.ts` | S |
| 3 | **E1** `ColleX-Yedekle.cmd` + `ColleX-Geri-Yukle.cmd` + Ayarlar satırı | repo kökü, `console.html`, `/v1/health` | M |
| 4 | **E3** çoklu sentinel + `policy:` kind + "son nesne" testi + `/v1/health rls` | `ingestion/migrations.py`, `src/store/health.ts`, iki test | M |
| 5 | **E9** CI'ya postgres:18 + venv | `.github/workflows/ci.yml` | S |
| 6 | **E7+E8** `chars` metadata'ya, `/v1/files` sayfalama, `answers_filescope_gin` | `intake/ingest.py`, `files/store.ts`, yeni migration | M |
| 7 | **E6+E11** asılları repo dışına, atomik yazma, commit'ten önce yazma, `/original` ucu | `intake/ingest.py`, `files/routes.ts`, `console.html` | M |
| 8 | **E10+E12** nazik durdurma + advisory lock + başlatıcı çift tık koruması | `serve.mjs`, `ColleX-*.cmd`, `migrations.py` | S |
| 9 | **E13+E16+E17** AI hız/maliyet tavanı, sözcüksel aday sınırı, PDF sayfa sınırı | `ai/routes.ts`, `chunkStore.ts`, `intake/extract.py` | S |
| 10 | **E15, E18–E22** | çeşitli | S |

1–5 arası, bu ürünü "bir avukatın gerçek dosyalarını tutabilir" seviyesine
çıkaran asgari settir. 1, 2 ve 5 birlikte yarım günlük iştir ve en büyük üç
riski (ölçekte kullanılamazlık, tarayıcı üzerinden yazma/okuma, kalıcılık
katmanının CI körlüğü) kapatır.
