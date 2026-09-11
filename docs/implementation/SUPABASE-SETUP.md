# SUPABASE-SETUP — ColleX Veri Düzlemi Kurulum Rehberi

> **ÖNEMLİ — mevcut durum (son güncelleme 2026-09-02):** Bu depodaki
> `supabase/` klasörü **yalnızca dosyadan ibarettir**. Hiçbir migration, seed
> veya SQL **hiçbir canlı/uzak Supabase projesine uygulanmadı**; geliştirme
> sırasında **hiçbir Supabase (veya Resend) MCP aracı kullanılmadı** ve hiçbir
> uzak veritabanına bağlanılmadı. Tüm doğrulama yerel scratch PostgreSQL 18
> üzerinde yapıldı:
> `.venv/Scripts/python.exe scripts/db_local_check.py` → **exit 0, 18/18
> kontrol PASS** (2026-09-02). Aşağıdaki adımlar, **gelecekte** açacağınız yeni
> bir Supabase projesi içindir.
>
> **W12 (02.09.2026) eklemesi:** `20260902120000_matters_persistence.sql`
> (dava dosyası çalışma alanı + kalıcı cevap/taslak/ayar tabloları) ve
> `ingestion/migrations.py` içindeki **migration defteri** (ADR-020). Bu
> migration yerelde `collex_local` ürün veritabanına `intake.cli --ensure-db`
> ile uygulandı; uzak bir hedefe hâlâ hiçbir şey uygulanmadı.
>
> **İki P0 düzeltmesi migration dosyalarında YERİNDE yapıldı** (zincir hiçbir
> gerçek veritabanına uygulanmadığı için bu güvenliydi):
> `20260826060000_rls.sql` cross-tenant içerik sızıntısı (ADR-011) ve
> `20260826020000` + `20260826100000` temporal close-on-append (ADR-012).
> **Eski dosyaları uygulamış bir hedefiniz varsa** bu dosyaları yeniden
> uygulamak yetmez; düzeltici bir migration yazmanız gerekir.

## 1. Dosya envanteri

```
supabase/
├── config.toml                     # Supabase CLI proje ayarı (project_id = "collex-yargi")
├── seed.sql                        # 3 sentetik Türkçe mevzuat belgesi + gerçek sha256 hash'leri
└── migrations/
    ├── 20260826010000_extensions_and_schemas.sql   # extensions/legal/app_private şemaları + enum'lar
    ├── 20260826020000_documents_snapshots_versions.sql  # + temporal aralıklar (P0 düzeltmesi)
    ├── 20260826030000_chunks_relations.sql         # chunk + tsvector + trigram + ilişkiler
    │                                               #   + chunks_no_overlap_within_version (ADR-013)
    ├── 20260826040000_research_state.sql           # research_runs/steps/evidence/claims
    ├── 20260826050000_jobs.sql                     # job kuyruğu + claim_jobs() (SKIP LOCKED)
    ├── 20260826060000_rls.sql                      # RLS politikaları + current_tenant_id()
    │                                               #   (P0 cross-tenant düzeltmesi, ADR-011)
    ├── 20260826070000_embedding_profiles.sql       # profil kaydı (pgvector GEREKTİRMEZ)
    ├── 20260826080000_vector_embeddings.sql        # [PGVECTOR GEREKTİRİR — ASLA ÇALIŞTIRILMADI]
    ├── 20260826090000_hybrid_search.sql            # [PGVECTOR GEREKTİRİR — ASLA ÇALIŞTIRILMADI] RRF
    ├── 20260826100000_version_transitions.sql      # close-on-append trigger (P0 düzeltmesi, ADR-012)
    ├── 20260826110000_turkish_fts.sql              # 'turkish' snowball tsvector + GIN
    ├── 20260827120000_relations_index.sql          # citator lane indeksi (ADR-015) — DEFTER SINIRI
    └── 20260902120000_matters_persistence.sql      # W12: app_private.matters / matter_items / answers /
                                                    #   drafts / settings; RLS; idempotent; başlığında
                                                    #   "-- [LEDGER SENTINEL] app_private.settings" (ADR-016/020)
```

**On bir** migration pgvector **olmadan** çalışır ve yerelde gerçekten koşuldu
(`db_local_check.py` bunları dosya adı sırasına göre değil, her dosyanın
başlığındaki pgvector işaretine göre seçer). İki migration (`080000`,
`090000`) `vector` uzantısını gerektirir; yerelde yalnızca `pglast` ile
sözdizimi düzeyinde doğrulanmıştır ve **bu makinede asla çalıştırılmaz**.

### 1.1 Migration defteri (ledger) — ADR-020

`ingestion/migrations.py` bir defter tutar: `app_private.schema_migrations`
(`filename` pk, `applied_at`). Kurallar:

- **Defter tablosunu hiçbir migration yaratmaz**; defter kodu yaratır. Boş bir
  defter, defter-öncesi dolu bir veritabanını "hiçbir şey uygulanmamış" gibi
  gösterir ve zinciri yeniden koşardı — bu yüzden tablo migration'da değildir.
- **Bootstrap kuralı:** defter yok/boş **ve** `legal.documents` varsa, zaman
  damgası `20260827120000` (`LEDGER_BOOTSTRAP_BOUNDARY`) veya öncesi olan her
  çalıştırılabilir migration uygulanmış sayılır. Sınırdan **yeni** bir
  migration yalnız başlığındaki `-- [LEDGER SENTINEL] <regclass>` satırının
  adlandırdığı ilişki mevcutsa uygulanmış sayılır (psql ile yüklenmiş
  veritabanları); yoksa uygulanır.
- **Sınırdan yeni her migration bir sentinel taşımak ZORUNDADIR**
  (`tests/ingestion/test_migrations_ledger.py` bunu zorlar). Sentinel, o
  migration'ın yarattığı bir ilişkiyi adlandırmalıdır.
- Her migration kendi defter satırıyla **tek transaction** içinde koşar
  (migration dosyalarında transaction kontrolü yoktur — doğrulandı); başarısız
  migration geri alınır ve kaydedilmez.
- Yerelde defteri yalnız `intake.cli --ensure-db` kullanır (çıktı:
  `migrationsApplied / migrationsBootstrapped / migrationsAlreadyApplied`);
  `ingestion.cli --apply-migrations`, `db_local_check.py`, `demo.mjs` ve test
  harness'leri deftersiz yükler — bootstrap + sentinel bunları tanır.
  Control-plane tarafı (`control-plane/src/store/health.ts`) defteri yalnız
  **okur** ve `/v1/health.migrations = {applied, expected, missing}` verir.

**Uzak hedef için sonuç:** bir Supabase projesinde zincir `supabase db push`
ile uygulanırsa Supabase CLI kendi geçmişini (`supabase_migrations.schema_migrations`)
tutar; bu deponun defteri **ayrı** bir tablodur. Tek bir veritabanı için
**bir** kaynak seçin: ya CLI geçmişi (bu durumda `apply_missing_migrations`'ı
o hedefe karşı hiç çalıştırmayın), ya da `intake.cli --ensure-db` (bu durumda
`db push` kullanmayın). İkisini karıştırmak, sentinel'siz bir migration'ın iki
kez uygulanmasına yol açabilir. `20260902120000` idempotent yazıldığı için
(`create … if not exists`, `drop policy if exists`) çift uygulama bugün
zararsızdır; gelecekteki migration'lar için bu garanti yoktur.

> **Neden yerelde çalıştırılmıyorlar:** bu makinede pgvector **kurulamıyor**
> (kaynaktan derleme için Windows SDK yok, Docker yok). Bu nedenle yoğun
> (dense) getirim şeridi bütün ölçümlerde `NoopDenseLane`'dir ve hibrit
> retrieval hiç ölçülmemiştir. `080000`/`090000`'i ilk kez çalıştıracağınız yer
> burada kuracağınız Supabase projesidir.

## 2. Ön koşullar

1. **Supabase CLI** kurun (v2+):
   - Windows (Scoop): `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase`
   - macOS: `brew install supabase/tap/supabase`
   - npm ile: `npx supabase --help` (global kurulum gerekmez)
2. Supabase hesabında **yeni bir proje** oluşturun (Dashboard → New project).
   Bölge ve veritabanı parolasını not edin (parolayı asla depoya yazmayın).
3. CLI oturumu: `supabase login` (tarayıcı üzerinden token alır).

## 3. Projeyi bağlama (init / link)

Depo kökünde (bu deponun kök dizini):

```bash
# supabase/config.toml zaten mevcut olduğu için "supabase init" GEREKMEZ;
# çalıştırırsanız mevcut config'i ezmemesine dikkat edin.

supabase link --project-ref <PROJE_REF>
```

`<PROJE_REF>` değerini Dashboard → Project Settings → General'da bulursunuz.
`config.toml` içindeki `major_version` değerini projenizin gerçek Postgres
sürümüyle (Project Settings → Infrastructure) eşleştirin.

## 4. `vector` uzantısını etkinleştirme

`20260826080000` ve `20260826090000` migration'ları pgvector ister. Push'tan
**önce**:

1. Dashboard → **Database → Extensions** ekranını açın.
2. `vector` uzantısını bulun ve **schema = `extensions`** olacak şekilde
   etkinleştirin.

Migration dosyası yine de `create extension if not exists vector with schema
extensions;` içerir; uzantı Dashboard'dan açıldıysa bu satır zararsız bir
no-op olur. (`pg_trgm` ve `pgcrypto` Supabase'te genellikle hazırdır;
010000 migration'ı bunlar için de `if not exists` kullanır.)

## 5. Migration'ları uygulama sırası

Migration'lar dosya adındaki zaman damgasına göre **tek sırada** uygulanır;
`supabase db push` bu sırayı kendisi takip eder:

```bash
# Önce ne uygulanacağını görün:
supabase db push --dry-run

# Uygulayın:
supabase db push
```

Sıra şu şekilde işler:

1. `010000` → `070000`: şemalar, tablolar, kuyruk, RLS, profil kaydı
   (pgvector'süz çekirdek).
2. `080000`: `vector` uzantısı + public partitioned embedding tablosu
   (`voyage-4-1024-v1` ve `bge-m3-1024-v1` partition'ları, her birinde ayrı
   HNSW indeksi) + `app_private.private_chunk_embeddings_1024`
   (tenant_id/matter_id **NOT NULL**, RLS'li).
3. `090000`: `legal.hybrid_search_public_1024` RRF fonksiyonu.
4. `100000`: `document_versions` üzerinde close-on-append trigger'ı ve
   "belge başına en fazla bir açık sürüm" kısmi tekil indeksi (ADR-012).
5. `110000`: `legal.chunks` üzerinde `turkish` snowball tsvector kolonu +
   GIN indeksi. Mevcut `simple` kolonu **bilerek korunur**: brief §8.6, gold
   set üzerinde A/B karşılaştırması yapılmadan varsayılanın değişmesini
   yasaklıyor.
6. `120000`: `legal.document_relations` üzerinde citator şeridinin pasaj
   düzeyindeki dışa doğru sorgusu (`source_chunk_id = any(...)`) için kısmi
   indeks (ADR-015). Mevcut iki indeks bu yüklemi karşılamıyor; gerçek bir
   korpusta bu indeks olmadan şerit her aramada seq-scan yapar.
7. `20260902120000`: `app_private.matters`, `matter_items`, `answers`,
   `drafts` (sürüm başına satır, pk `(draft_id, version_no)`), `settings`
   (`(tenant_id, key) → jsonb`). Hepsinde `tenant_id uuid not null`, RLS açık,
   tek `for all` politikası `tenant_id = (select
   app_private.current_tenant_id())`; `matter_items` ayrıca SAHİBİ DOSYA
   üzerinden çözülür ve `with check` kiracı eşitliğini de ister (ADR-011
   deseni). İndeksler: `matters(tenant_id, created_at desc)`,
   `matters(tenant_id, status)`, `matter_items(tenant_id, matter_id,
   created_at desc)`, `matter_items(matter_id, kind)`, kısmi
   `matter_items(tenant_id, (payload->>'dueDate')) where kind='deadline'`,
   `answers(tenant_id, created_at desc)`, `answers(matter_id)`,
   `drafts(tenant_id, created_at desc)`, `drafts(matter_id)`. pgvector
   gerektirmez; idempotent. **Uzak/çok-kiracılı bir çalışma zamanında RLS
   gerçekten uygulanır**; yerelde tek kullanıcı owner bağlantısıyla bypass
   eder (belgelenmiş duruş), politikalar `db_local_check` c14'te probe
   rolüyle kanıtlanmıştır.

**Uygulama sonrası doğrulama (zorunlu):** `080000`/`090000` bu depoda hiç
koşmadığı için, uyguladıktan sonra en azından şunları doğrulayın: `vector`
uzantısının sürümü, HNSW indekslerinin gerçekten oluştuğu, boyut sınırının
(`vector` için <= 2000) profil boyutlarınızla uyumlu olduğu ve
`legal.hybrid_search_public_1024`'ün `search_path=''` altında
`operator(extensions.<=>)` ile çözüldüğü. Ardından `scripts/db_local_check.py`
içindeki invariant kontrollerinin eşdeğerini ve `scripts/run_evals.py`'ı bu
hedefe yönlendirerek koşun — dense şeridin ilk gerçek ölçümü budur.

`080000` adımı 4. bölümdeki uzantı etkinleştirmesi yapılmadıysa yetki
hatasıyla durabilir; önce uzantıyı açın, sonra tekrar `db push` çalıştırın.

Seed verisi (isteğe bağlı, geliştirme ortamı için): `supabase db reset`
yerel geliştirme stack'inde migration'ları + `seed.sql`'i uygular. Uzak
projeye sentetik seed basmak isterseniz
`psql "$SUPABASE_DB_URL" -f supabase/seed.sql` kullanabilirsiniz (idempotent:
sabit UUID + `on conflict do nothing`).

## 6. RLS ve tenant sözleşmesi (JWT `tenant_id` claim)

- Yardımcı fonksiyon: `app_private.current_tenant_id()` şu sırayla çözer:
  1. `current_setting('request.jwt.claim.tenant_id', true)` — eski tip
     claim-başına GUC;
  2. `current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'` —
     güncel Supabase biçimi (tüm claim nesnesi);
  3. `current_setting('app.tenant_id', true)` — **yalnızca yerel test** için:
     `SET app.tenant_id = '<uuid>';`
- **Sözleşme:** Kullanıcı JWT'sinde `tenant_id` claim'i bulunmak zorundadır.
  Supabase'te bunu **Custom Access Token Hook** (Authentication → Hooks) ile
  `app_metadata.tenant_id` değerinden claim'e kopyalayarak sağlayın. Claim
  yoksa fonksiyon NULL döner → tenant kapsamlı satırlar görünmez/yazılamaz
  (fail-closed).
- Politika özeti:
  - `legal.documents`: `scope='public'` satırlar herkese okunur;
    `scope='tenant'` satırlar yalnızca `tenant_id = current_tenant_id()`
    olduğunda okunur/yazılır. Public satır yazımı ingestion hattının işidir
    ve `service_role` ile yapılır (RLS bypass).
  - `app_private.research_runs`: doğrudan `tenant_id` eşleşmesi.
  - `research_steps` / `evidence_items` / `claims` / `claim_evidence`:
    bağlı oldukları run'ın tenant'ı üzerinden (EXISTS alt sorgusu).
  - `app_private.jobs`: RLS açık, **politika yok** → son kullanıcı rolleri
    için tamamen kapalı; yalnızca worker düzlemi (`service_role`) erişir.
  - `app_private.private_chunk_embeddings_1024` (080000): satır başına
    zorunlu `tenant_id`/`matter_id` + tenant RLS politikası. Public ANN
    graph'ı ile asla karışmaz.
- **`service_role` anahtarını asla istemciye/ tarayıcıya vermeyin.**
  Kullanıcıya dönük private sorgular kullanıcının JWT/RLS bağlamıyla veya
  tenant'ı doğrulanmış auth context'ten alan dar yetkili `SECURITY INVOKER`
  fonksiyonlarla çalışmalıdır (bkz. `hybrid_search_public_1024` — security
  invoker + `set search_path = ''`).

## 7. Yerel doğrulama: `scripts/db_local_check.py`

Yerel scratch PostgreSQL (127.0.0.1:55432, kullanıcı `postgres`, parolasız;
`pg_trgm` + `pgcrypto` mevcut, pgvector YOK) çalışırken:

```bash
# Bağımlılıklar (bir kez):
uv pip install --python .venv/Scripts/python.exe "psycopg[binary]" pglast

# Çalıştır:
.venv/Scripts/python.exe scripts/db_local_check.py
```

2026-09-02 koşumu: **exit 0, 18/18 PASS.** Script şunları yapar:

1. `collex_mig_test` scratch veritabanını düşürüp yeniden yaratır
   (UTF8 + C locale — code-point ofset garantisi için deterministik) ve
   `collex_rls_probe` süperuser-olmayan probe rolünü sıfırlar;
2. pgvector gerektirmeyen **on bir** migration'ı gerçek `psql` ile
   (`ON_ERROR_STOP=1`) uygular — `010000`..`070000`, `100000`, `110000`,
   `20260827120000` ve `20260902120000` (seçim dosya adı sırasına göre değil,
   her dosyanın başlığındaki pgvector işaretine göre yapılır);
3. Değişmez (invariant) kontrolleri (c1–c14):
   - **c1** Türkçe İ/ı ve astral karakter içeren metinde
     `substring(canonical_text ...)` ↔ Python `canonical_text[start:end]`
     eşdeğerliği (Unicode **code point** politikası),
   - **c2/c3** snapshot dedupe ve versiyon unique'i, **c4** CHECK reddleri,
   - **c5** generated tsvector + şema-nitelikli `pg_trgm`,
   - **c6/c7** `claim_jobs` batch + `FOR UPDATE SKIP LOCKED` eşzamanlılık
     smoke'u,
   - **c8** RLS tenant izolasyonu (A görür / B görmez / bağlamsız hiçbirini
     görmez),
   - **c9** *(P0 regresyonu)* `document_versions` / `chunks` /
     `document_relations` üzerinde RLS: tenant B'nin `canonical_text` ve
     `original_text`'i tenant A'ya kapalı, public satırlar okunur, çapraz
     tenant ilişkisi gizli — **ADR-011**,
   - **c10** *(P0 regresyonu)* `upper_inf` gerçekten canlı (eski `'infinity'`
     davranışı açıkça yanlışlanıyor), trigger önceki sürümü kapatıyor, tek
     açık satır zorunlu — **ADR-012**,
   - **c11** `effective_period` çakışmasının reddi,
   - **c12** sürüm içinde chunk çakışmazlığı + `normalizer_version` —
     **ADR-013**,
   - **c13** job deneme üst sınırı, `fail_job`, reaper, anahtar yeniden
     kullanımı;
   - **c14** *(W12)* `20260902120000`: 35 statement pglast ile parse; 5
     tabloda RLS + politika; idempotent yeniden uygulama; defter bootstrap
     (11 satır → ikinci koşum no-op); probe rolüyle kiracı izolasyonu (42501);
4. `seed.sql`'i uygular ve hash/ofset değişmezlerini **veritabanı içinde**
   yeniden doğrular (idempotency dahil);
5. İki pgvector migration'ını `pglast` ile (fonksiyon gövdeleri dahil)
   yalnızca **sözdizimi** düzeyinde doğrular — **çalıştırmaz**;
6. PASS/FAIL özeti basar; herhangi bir hata durumunda sıfır dışı çıkış kodu.

Ofset politikası notu: PostgreSQL UTF-8 veritabanında `substring`/
`char_length` **karakter = Unicode code point** sayar; Python `str` indeksleri
de code point'tir. Bu eşdeğerlik testte `İ` (U+0130), `ı` (U+0131) ve BMP
dışı `𝔘` (U+1D504) karakterleriyle bilinçli olarak doğrulanır. Byte ofseti
**asla** kullanılmaz.

## 8. Ortam değişkeni sözleşmesi (yalnızca İSİMLER — değer yazmayın)

Control-plane'in ihtiyaç duyacağı değişken adları:

| Değişken | Amaç |
|---|---|
| `SUPABASE_URL` | Proje API URL'i (`https://<ref>.supabase.co`) |
| `SUPABASE_ANON_KEY` | Publishable/anon anahtar (istemci; RLS altında) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role anahtarı (SADECE sunucu tarafı; RLS bypass) |
| `SUPABASE_DB_URL` | Doğrudan Postgres bağlantı dizesi (migration/worker) |
| `SUPABASE_JWT_SECRET` | JWT doğrulaması gereken sunucu bileşenleri için |

Değerler yalnızca gizli değişken deposunda tutulur; hiçbir dosyaya, loga veya
dokümana yazılmaz.

## 9. Model/boyut değişikliği politikası (özet)

1024 boyutlu lane sabittir (`legal.embedding_profiles` CHECK'i). Yeni model =
**yeni profil satırı + yeni partition + backfill + A/B eval + atomik aktif
profil geçişi + rollback planı**. Mevcut kolonda model karıştırmak yasaktır.
