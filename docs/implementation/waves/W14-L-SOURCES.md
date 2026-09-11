# W14 — L-SOURCES (korpus ve geçit hattı)

Tarih: **02.09.2026** · Faz A · Kalemler: **B-14 (uç), B-15, B-16 (uç), B-20, B-38**
Kaynak sözleşme: `docs/implementation/waves/W13-BACKLOG.md` §D/§E/§G.

> **Dürüstlük notu, en başta.** Devlet uçları (mevzuat.gov.tr, Yargıtay,
> Bedesten) bu makineden **erişilemiyor**. Bu hattın canlı yola çıkan her
> parçası **enjekte edilmiş sahte geçide** karşı yazıldı ve test edildi;
> **canlı doğrulama YAPILMADI ve beklemede**. Bu bir ürün kusuru değil,
> ölçüm ortamının sınırıdır — ama rapor boyunca "çalışıyor" değil,
> "sahte geçitle doğrulandı" yazıyor.
>
> Bu belgede yeni bir **hukukî kalite** sayısı yoktur. Geçen her sayı ya bu
> makinede koşturulmuş bir komutun çıktısıdır ya da kayıt defterinden
> sayılmıştır.

---

## 0. Özet tablo

| Kalem | Durum | Tek cümlelik sonuç |
|---|---|---|
| **B-15** | **indi** | 54 aracın tamamı bir kod yolundan çağrılabilir; `tests/planner/reachability.test.ts` bir hat koparsa kırılıyor. Uyuşmazlık, Emsal ve dokuz `search_within_*` hattı açıldı. |
| **B-14** | **indi (uç)** | `GET /v1/sources/manifest` — kaynak başına durum + **en az sekiz** bilinen boşluk; ölçülmeyen her hücre `null`. Ekran Faz B'de L-CONSOLE'da. |
| **B-16** | **indi (uç), canlı doğrulama beklemede** | `POST /v1/sources/search` (merci/daire/yıl/tam ifade/hariç kelime) künye listesi döndürüyor; `POST /v1/sources/fetch` hash'i yeniden doğrulanan kaynak kartı üretiyor; başarısız kaynak **adlandırılıyor**. |
| **B-20** | **KISMÎ** | Kontrol düzlemi yarısı indi: her tam belge, tam provenance ile kalıcı bir kuyruğa yazılıyor, kimlik+hash ile tekilleşiyor, hiçbir yüzeyde "(SENTETİK)" yok. **`collex_local`'a yazma inmedi**: bunun için `ingestion/**` gerekiyor ve o dosyalar bu hattın değil (§6 entegrasyon isteği). |
| **B-38** | **indi** | Türkçe kısa-biçim atıflar iki runtime'da da tanınıyor; `evals/fixtures/reference_parity.json` 100 → **108** vakaya çıktı ve **ikisi de geçiyor**; çözülemeyen kısa biçim **"belirsiz"** kovasına düşüyor. |

---

## 1. B-15 · Ölü MCP hatlarını aç + erişilebilirlik testi

### Ne yapıldı

**G1 — Uyuşmazlık Mahkemesi.** `search_uyusmazlik_decisions` planlanıyordu ama
`FETCH_BY_PROVIDER`'da `UYUSMAZLIK` yoktu; arama özeti kanıt sayılmadığı için
(doğru kural) bulunan karar hiçbir cevaba giremiyordu.

- `planner/templates.ts`: `UYUSMAZLIK → { get_uyusmazlik_document_markdown_from_url, document_url }`.
- `capabilities/types.ts`: `ProviderCode`'a `"UYUSMAZLIK"` eklendi (**additive**).
  Bu olmadan zarf `BEDESTEN`'e yanlış atfediyor ve fetch tanımı kaydedilemiyordu.
- `planner/templates.ts::selectTemplate`: **görev / yargı yolu** açısı taşıyan
  bir soru artık `yargitay_danistay_contrary` şablonunu seçiyor. Uyuşmazlık
  şeridi yalnız o şablonda yaşıyor; eskiden aynı cümlede hem karşıt işareti
  hem yargı yolu açısı gerekiyordu, yani mahkemenin var oluş sebebi olan
  "bu davada görevli yargı yolu hangisidir?" sorusu ona **hiç** ulaşmıyordu.

**G2 — Emsal (UYAP).** `search_emsal_detailed_decisions` hiçbir şablonda
planlanmıyordu. `mevzuat_amendment_ictihat` ve `yargitay_danistay_contrary`
şablonlarına **koşu başına BİR** Emsal şeridi eklendi (konu başına değil:
konu başına kopya, 24 çağrılık tavanın dörtte birini tek şeride harcardı).

**G3 — `WITHIN_BY_TYPE`.** `statuteRead` yalnız `search_within_kanun`
çağırıyordu; yönetmelik/tebliğ/KHK/CBK bulunuyor ama **içi okunamıyordu**.

- `planner/templates.ts`: `WITHIN_BY_TYPE` tablosu (`FETCH_BY_PROVIDER` ile
  birebir paralel) + `withinDescriptorForKind` / `buildWithinInput` /
  `WITHIN_TOOL_NAMES` + `legislationKindFromName` (atfın kendi adından tür
  çıkarımı).
- `research/payloads.ts`: `search_mevzuat` satırındaki `(Kanunlar)` etiketi
  artık **kendi tipli alanı** (`legislationKind`) ve resmî numara
  (`legislationNo`) olarak ayrıştırılıyor; başlıktan çıkarıldı.
- `planner/outcomes.ts::extractHits`: iki alan tipli hit'e taşınıyor,
  `legislationNo` güven sınırında **yeniden daraltılıyor** (`^[0-9]{1,12}$`).
- `planner/rulePlanner.ts`: yeni "read-inside" aşaması — bir mevzuat isabetinin
  TÜRÜ kanun değilse kendi `search_within_*` aracıyla açılıyor
  (koşu başına en fazla 3 enstrüman, arama başına 1 satır).

**ARCH'ın iki ucuz isabet düzeltmesi**

- `bedestenInput` artık `kararTarihiStart` da gönderiyor.
  `DEFAULT_CASE_LAW_LOOKBACK_YEARS = 15`, **yalnız birincil şeritlerde**.
  Karşıt şeritler (direnme, içtihadı birleştirme) **bilinçle sınırsız** kaldı:
  1980'lerin bir içtihadı birleştirme kararı hâlâ bağlayıcıdır; onu gizlemek
  isabet artışını doğruluk kusuruna çevirirdi.
- `gapQueryForIssue` sabit `"emsal karar"` ibaresini **bıraktı**. Bedesten
  token'ları AND'lediği için o ek, round-2'yi round-1'den **daha dar**
  yapıyordu. Round-2 artık yalnız **değiştirir veya çıkarır**: kavramda
  sonraki eş anlam, mevzuat atfında madde numarasını **düşürür**
  (`"6098 sayılı" 344` → `"6098 sayılı"`), karar atfında karar numarasını
  düşürür (`E. 2023/45 K. 2024/12` → `E. 2023/45`).

### Erişilebilirlik modeli

Yeni `control-plane/src/capabilities/inventory.ts`: 54 aracın her biri için
`REACHABLE | NOT_YET_WIRED`, `via[]` (hangi kod yolu) ve **bir cümlelik
Türkçe not**. Sınıflandırma **elle tutulan bir listeden değil**, canlı
yönlendirme tablolarından (`planner/templates.ts`, `sources/catalog.ts`)
türetiliyor: bir hat bağlanınca kendiliğinden `REACHABLE`, bir hat kopunca
kendiliğinden `NOT_YET_WIRED` olur — testin yakaladığı şey budur.

### KABUL kanıtı

```
$ cd control-plane && npx vitest run tests/planner/reachability.test.ts
 ✓ tests/planner/reachability.test.ts (13 tests) 178ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

Testin doğruladıkları:

- 54 aracın **tamamı** sınıflanıyor, sırası `ALL_TOOL_NAMES` ile birebir;
- `EXPECTED_TOOL_COUNT === 54` ve `ALL_TOOL_NAMES.length === 54` — **yüzey
  değişmedi**;
- `REACHABLE ≥ 30` (kabul tabanı). **Ölçülen: 54/54, `NOT_YET_WIRED` = 0.**
  Dürüstlük kaydı: bunun **52'si testin kendisi tarafından sahte geçitle
  ÇAĞRILARAK** kanıtlanıyor (katalogdaki her arama aracı, her tam-metin
  aracı, her "içinde ara" aracı). Kalan ikisi — `search` (POST /v1/search,
  `api/server.ts`) ve `check_government_servers_health`
  (`/v1/research/health` varsayılan yoklaması) — **bu hattın sahip olmadığı
  dosyalardaki çağrı yerlerinden okunarak** işaretlendi, koşturularak değil;
- `NOT_YET_WIRED` her satır için ≥ 20 karakterlik, nokta ile biten ve
  "bilinmiyor" içermeyen bir gerekçe zorunlu (bugün boş küme; mekanizma
  bir hat koptuğunda devreye girer);
- **sahte geçitle bir Uyuşmazlık isabeti kanıta dönüşüyor**: `search` →
  `get_uyusmazlik_document_markdown_from_url(document_url=…)` → getirilen
  metnin SHA-256'sı kanıt kartının `contentSha256`'sı ile aynı;
- **bir Emsal araması planlanıyor** (tam olarak bir tane, gerçek argüman
  adlarıyla: `keyword`, `page_number`);
- `mevzuat_tur='Yönetmelikler'` bir isabette **`search_within_kurum_yonetmelik`**
  çağrılıyor, `search_within_kanun` **çağrılmıyor**, ve araca mevzuatId değil
  **resmî numara** (`mevzuat_no: "42641"`) gidiyor;
- hiçbir hat kayıt defteri dışında bir araç çağırmıyor.

```
$ .venv/Scripts/python.exe scripts/smoke_check.py
offline smoke checks passed: 54 tools, court inventory, shared limiter,
disabled-key errors, HTTP auth
(exit 0)
```

---

## 2. B-16 · "Karar ara" — sunucu tarafı

Yeni dizin `control-plane/src/sources/`:

| Dosya | Ne |
|---|---|
| `catalog.ts` | **26 seçilebilir kaynak** (5 Bedesten şeridi + Emsal + Uyuşmazlık + AYM + 10 mevzuat türü + 8 kurul), **19 tam-metin türü**, **2 "içinde ara"** hattı. Yalnız veri; modül yüklenirken her aracın kayıt defterindeki yeteneğe uyduğu doğrulanıyor. |
| `searchService.ts` | Seçilen kaynakların üstünde arama; künye satırı üretir. |
| `fetchService.ts` | Tam metin → **hash mühürlü kaynak kartı** + `verifySourceCard` (çevrimdışı yeniden doğrulama). |
| `routes.ts` | `createSourcesRouter` — beş uç. |
| `manifest.ts` | B-14 (aşağıda). |
| `localLibrary.ts` | B-20 (aşağıda). |

### Bozulmayan üç kural

1. **Arama özeti asla kanıt değildir** (brief 10.2). Satır bir künyedir:
   ne `contentSha256` ne `startChar` taşır. Kanıt üreten tek şey ayrı
   `POST /v1/sources/fetch` çağrısıdır ve o da `research/liveEvidence.ts`
   ile **aynı** yoldan geçer (CRLF katlanır → NFC → SHA-256 → kod noktası
   offsetleri), yani canlı araştırmanın ürettiği pasajla byte'ı byte'ına aynı.
2. **Başarısız kaynak ADLANDIRILIR.** Kısmî sonuç + `failedSources[]`
   (`{sourceId, sourceLabel, kind, message, correlationId}`); makine kodu
   İngilizce, cümle Türkçe ve **"Bu kaynağın sonuçları listede YOK."** diyor.
   Seçilen kaynakların hepsi düşerse yanıt **boş liste değil**, `502
   ALL_SOURCES_FAILED`.
3. **Hiçbir künye uydurulmaz.** Her satır `research/payloads.ts` tarafından
   gerçek bir yükten daraltılır; `externalId` yoksa satır **düşer**, doldurulmaz.

### KABUL kanıtı (sahte geçit)

```
$ npx vitest run tests/capabilities/sourcesSearch.test.ts
 ✓ tests/capabilities/sourcesSearch.test.ts (21 tests) 58ms
```

- litigatörün süzgeçleri araca **gerçek argüman adlarıyla** gidiyor:
  `phrase: '"tahliye taahhüdü" -kira tespiti'`, `court_types: ["YARGITAYKARARI"]`,
  `birimAdi: "H3"`, `kararTarihiStart: "2023-01-01"`, `kararTarihiEnd: "2025-12-31"`,
  `pageNumber: 1`;
- kendi dilbilgisinde dışlama olmayan kaynaklarda (Emsal, kurul, mevzuat)
  "hariç tutulacak kelimeler" **istemci tarafında** uygulanıyor — sessizce
  yok sayılmıyor;
- kaynak kartı: `contentSha256 === sha256(text)`, her alıntı kendi
  offsetlerinden geri dilimleniyor, `verifySourceCard` → `{ok: true}`;
  metne **tek karakter** eklenince `CONTENT_HASH_MISMATCH`;
- kart `originLabel: "resmî kaynak"`, gövdede `"SENTETİK"` **hiç geçmiyor**;
  çip metni `"resmî kaynak · alınma 02.09.2026"`;
- `extra` ile kimlik **ezilemiyor** (id parametresi en sona yazılıyor).

### Canlı doğrulama — BEKLEMEDE

Kabul ölçütünün "ağı olan bir makinede ≥ 10 künye" yarısı **koşturulamadı**:
bu makineden Bedesten/UYAP'a erişim yok. Yapılan: gerçek yük şekilleriyle
(gerçek `search_bedesten_unified` / `fetch` cevap alanları) sahte geçit.
Yapılmayan ve öyle raporlanan: gerçek uçlarla tek bir çağrı.

---

## 3. B-14 · Kapsam manifestosu

`GET /v1/sources/manifest` → `collex.sources.manifest/v1`.

**Tek kuralı: hiçbir hücre sayı uydurmaz.** Yanıttaki sayılar yalnız
(a) kayıt defterinden sayılabilenler (54 araç, 26 kaynak, bağlanan/bağlanmayan)
ve (b) `/v1/health`'ten **verilenler**dir. Verilmeyen her sayı `null` —
**0 değil, tahmin değil, aralık değil.**

```
$ npx vitest run tests/capabilities/manifest.test.ts
 ✓ tests/capabilities/manifest.test.ts (12 tests) 57ms
```

- her kaynak için `{id, ad, aile, durum, durumNotu, sonErisim, arac, bagli, notlar}`;
  `sonErisim` bugün **her zaman `null`** — böyle bir günlük tutulmuyor ve
  uydurulmuyor;
- **bilinen boşluklar 8 satır** (kabul: ≥ 5), her biri ≥ 40 karakter gerekçe:
  `aihm`, `doktrin`, `reklam-rtuk`, `ilk-derece`, `uyap-baglantisi`,
  `yerel-korpus`, `guncellik`, `kapsam-sayisi`;
- **"AİHM (HUDOC) kapsamda değildir"** başlığı birebir yanıtta ve iddia
  yanıtın kendi araç envanterine karşı **denetlenebiliyor** (envanterde
  `aihm|echr|hudoc` yok, kaynak adlarında `reklam kurulu|rtük` yok);
- MCP geçidi **kapalıyken de sayfa açılıyor** (200) ve "kapalı" diyor;
  sağlık yoklaması **istisna atsa bile** açılıyor ve o istisnanın metni
  gövdeye sızmıyor;
- gövdede rakamlı `milyon` ibaresi, `%N`, "halüsinasyon" ve "SENTETİK"
  **yok** (test bunları arıyor).

Ek uç `GET /v1/sources/catalog` arama formunun veri kaynağıdır (hangi kaynak
daire süzgeci alır, hangi karar türleri seçilebilir).

---

## 4. B-20 · Yerel kütüphane — **KISMÎ**

### İnen yarı (kontrol düzlemi)

`control-plane/src/sources/localLibrary.ts`:

- `LocalLibraryPort` = `{put, keys}`; üç uygulama:
  `DisabledLocalLibrary` (**varsayılan**, yani bugünkü davranış birebir korunur),
  `InMemoryLocalLibrary`, `FileLocalLibrary` (dosya başına bir JSON,
  geçici ada yazıp `rename` — okuyan yarım kayıt görmez);
- kayıt zarfı `collex.library.document/v1`: `source, externalId, title,
  sourceUrl, toolName, fetchedAt, originLabel, scope:"public", mediaType,
  text, contentSha256, contentCodePoints, runId?`;
- **tekilleştirme** anahtarı `provider__externalId__sha256[0:16]`: aynı metin
  ikinci kez gelirse `duplicate`, metin değişmişse **ayrı kayıt** — Python
  boru hattının yeni bir **sürüm** ekleyebilmesi için;
- provenance etiketi **`"resmî kaynak"`**, asla `"(SENTETİK)"` (TRMARKET:
  o kelime bir avukat için "bu sistem karar uyduruyor" demek);
- canlı araştırma (`/v1/research` ve `/v1/research/start`) her tam belgeyi
  kuyruğa yazıyor; yazma **koşuyu asla düşürmez** — başarısız yazma
  `LIBRARY_WRITE_FAILED:<n>` uyarısı olur, cevap ve alıntıları aynen kalır.

```
$ npx vitest run tests/capabilities/localLibrary.test.ts
 ✓ tests/capabilities/localLibrary.test.ts (10 tests) 201ms
```

### İnmeyen yarı ve NEDEN

Kabul ölçütü `/v1/health corpus.publicDocuments` artışını ve aynı sorunun
ikinci kez **ağa çıkmadan** cevaplanmasını istiyor. Bunun için belgenin
`collex_local`'a **ingestion boru hattından** yazılması gerekiyor ve o
sözleşme Python'da yaşıyor: `ingestion/identity.py` (mantıksal kimlik),
`ingestion/versioning.py` (ADR-012 zamansal kapanış), `ingestion/chunking.py`
(ADR-013 **örtüşmeyen** parçalar), `ingestion/relations.py` (citator kenarları).
Bunları TypeScript'te yeniden yazmak, **aynı belgeye hangi runtime yazdıysa
ona göre farklı kimlik** verirdi — ADR-013'ün tam olarak engellemek için var
olduğu kusur. `ingestion/**` bu hattın sahipliğinde değil (§G.1), dolayısıyla
ikinci yarı **entegrasyon isteği** olarak yazıldı (§6, IR-2).

O gelene kadar: `collex_local`'a **hiçbir şey yazılmıyor**, manifest
`yerelKutuphaneAcik: false` diyor ve büyüyen bir kütüphane **ima edilmiyor**.

---

## 5. B-38 · Türkçe kısa-biçim atıf (iki runtime, tek fixture)

### Ne tanınıyor

Yeni **`short_form`** referans türü, iki mekanizma ile:

1. **Karar anaforu** — `anılan karar/ilam/içtihat/hüküm`, `yukarıda anılan …`,
   `mezkûr/mezkur/söz konusu karar`, `aynı yönde(ki)`, `aynı doğrultuda`,
   `agk.` / `a.g.k.`: işaretin kendisi referans olur ve **kendisinden önceki
   en yakın** karar atfının E./K., mahkeme ve daire kimliğini taşır.
2. **Madde anaforu / tekrar** — `aynı Kanunun 345 inci maddesi`,
   `mezkûr Yönetmeliğin 12 nci maddesi` ve metinde **daha önce geçmiş** bir
   madde numarasının çıplak tekrarı (`… m. 352 … m. 352`): madde referansı
   `short_form`'a dönüşür ve önceki mevzuatı taşır.

**Enstrümanı yanına yeniden yazılmış madde asla anafor değildir.**
`TCK m. 157` elli kez geçse de elli **tam** atıftır. Bu istisna aynı zamanda
`intake/analysis.py`'nin blok-blok ayrıştırmasını bütün-metin ayrıştırmasına
**eşit** tutan şeydir (sahiplik yalnız maddeden önceki ≤ 16 karaktere bakar).

### "Belirsiz" kovası

Bağlamın çözemediği kısa biçim **bütün kimlik alanlarını boş bırakır**;
`is_unresolved_short_form` / `isUnresolvedShortForm` bunu ayırt eder.
Böyle bir referans **asla tam atıf gibi gösterilmez**: "burada bir atıf var"
der, "hangisi" demez.

### KABUL kanıtı — ikisi birden

`evals/fixtures/reference_parity.json`: **100 → 108 vaka, 160 referans**
(yeni `short_form` grubunda 8 vaka; ikisi bilerek çözülemez, biri işaret
kelimelerinin düz metinde hiçbir şey üretmediğini kanıtlar).

```
$ .venv/Scripts/python.exe -m pytest tests/contracts -q
695 passed in 0.71s

$ cd control-plane && npx vitest run tests/parser-parity.test.ts
 ✓ tests/parser-parity.test.ts (117 tests) 162ms

$ npx vitest run tests/capabilities/shortForm.test.ts
 ✓ tests/capabilities/shortForm.test.ts (12 tests) 56ms
```

`tests/capabilities/shortForm.test.ts` fixture'ın anlatamadığını doğruluyor:
"yukarıda anılan TBK m. 315" **tam atıf kalıyor**; tekrar eden `m. 352`
6098'e çözülüyor; üç çözülemez biçim `belirsiz` işaretleniyor ve o metinlerde
**hiçbir** `legislation`/`court_decision` referansı üretilmiyor; blok-blok
ayrıştırma bütün-metin ayrıştırmasına eşit kalıyor.

**Sapma (dürüstlük).** Fixture'ın vaka listesi
`scripts/gen_reference_fixtures.py`'de duruyor ve o dosya bu hattın
sahipliğinde değil. Yeni vakalar bu yüzden sahip olduğum bir modüle
(`legal_reference/parity_cases.py`) yazıldı ve fixture, jeneratörün kendi
`build_cases()/check()/serialize()` fonksiyonlarını kullanan bir scratch
betiğiyle yeniden üretildi. **Jeneratör bugün olduğu gibi yeniden
koşturulursa 8 vaka sessizce düşer** — bunu engelleyecek üç satırlık değişiklik
§6 IR-1'dedir ve bu hattın **en yüksek öncelikli** entegrasyon isteğidir.

---

## 6. Entegrasyon istekleri (sahip olmadığım dosyalar)

**IR-1 · `scripts/gen_reference_fixtures.py` (sahipsiz) — YÜKSEK.**
`build_cases()` sonuna kısa-biçim vakalarını ekleyin, yoksa fixture yeniden
üretildiğinde B-38'in test kapsamı **sessizce kaybolur**:

```python
from legal_reference.parity_cases import SHORT_FORM_CASES  # üst kısımda
...
def build_cases() -> list:
    ...
    cases.extend(Case(**entry) for entry in SHORT_FORM_CASES)   # return'den hemen önce
    return cases
```

**IR-2 · `ingestion/**` + `intake/cli.py` (L-SAFE) — B-20'nin ikinci yarısı.**
`control-plane/var/library/*.json` altındaki `collex.library.document/v1`
kayıtlarını okuyan bir `SourcePort` ve onu mevcut boru hattından yayımlayan
bir CLI kipi gerekiyor:

- yeni `ingestion/live_library.py`: `LiveLibrarySource(SourcePort)` —
  `list_documents()` kuyruk dosyalarını okur; her kayıt için
  `ParsedDocument(scope="public", source=<record.source>,
  external_id=<record.externalId>, text=<record.text>, …)` üretir ve
  provenance olarak `record.fetchedAt` / `record.sourceUrl` / `toolName`
  taşır; `contentSha256` **yeniden hesaplanıp** kayıttakiyle karşılaştırılır,
  tutmazsa belge atlanır ve raporlanır;
- `intake/cli.py`: `--ingest-library <dir> --dsn <dsn>` kipi; `collex_local`
  ve `collex_intake_test` dışındaki DSN'i reddeder;
- **yeni tablo/sütun/migration gerekmiyor** — kayıt mevcut
  `legal.documents/document_versions/chunks` şemasına birebir oturur ve
  `scope='public'`, `source='<PROVIDER>'` ile yazılır.

**IR-3 · `control-plane/src/api/server.ts` (L-SAFE) — router mount.**
Tek satır, `/` altına:

```ts
import { createSourcesRouter } from "../sources/routes.js";
// ... diğer mount'ların yanına:
app.route("/", createSourcesRouter({
  ...(gateway !== undefined ? { gateway } : {}),
  health: async () => ({
    mcp: mcpState(),
    ...(deps.sql !== undefined ? { db: (await reportDatabaseHealth(deps.sql)).db } : {}),
  }),
  ...(deps.sourcesLibrary !== undefined ? { library: deps.sourcesLibrary } : {}),
}));
```

`SourcesRouterDeps` alanlarının hepsi opsiyoneldir; hiçbiri verilmezse iki
canlı uç tipli `502 UPSTREAM_UNAVAILABLE` döner ve manifest yine açılır.

**IR-4 · `control-plane/scripts/serve.mjs` (L-SAFE) — yerel kütüphaneyi aç.**
`--library-dir <dir>` (varsayılan `var/library`) ile `FileLocalLibrary`
oluşturup hem `createResearchRouter({ library })` hem
`createSourcesRouter({ library })` içine geçirin. Verilmezse davranış
bugünküyle **birebir aynı** kalır.

**IR-5 · `control-plane/src/api/answerService.ts` (L-MATTER) —
`POST /v1/answer` `filters` genişletmesi.** B-16 kabul ölçütü
`courts[]/chambers[]/yearFrom/yearTo/excludeTerms[]` istiyor. Retrieval
tarafı **hazır**: `retrieval/searchService.ts` `CourtDateFilters` ve
`passesCourtDateFilters` bu dördünü **additive** olarak zaten uyguluyor ve
`POST /v1/search` şemasında açık. `answerRequestSchema.filters` içine aynı
dört alanı eklemek yeterlidir; alt katman değişikliği gerekmiyor.

**IR-6 · `docs/**` (L-DOCS, Faz B).** Aşağıdaki additive openapi deltası ve
`docs/KULLANIM-ColleX.md`'de "Karar ara" + "Kapsam" ekranlarının Türkçe
anlatımı.

---

## 7. Faz B için tam UI sözleşmesi (L-CONSOLE)

### 7.1 `#karar-ara` sekmesi

**Form verisi:** `GET /v1/sources/catalog` →
`{kaynaklar:[{id, ad, aile, arac, daireSuzgeci, tarihAraligi, kararTurleri[]}],
tamMetinTurleri:[{tur, ad}], icindeAramaTurleri:[{tur, ad}]}`.
`aile` üç grup başlığıdır: `ictihat` = "İçtihat", `mevzuat` = "Mevzuat",
`kurul` = "Kurul kararları".

**Arama:** `POST /v1/sources/search`

```jsonc
{
  "query": "tahliye taahhüdü",     // zorunlu, 2..500
  "sources": ["yargitay","istinaf_hukuk"],   // katalog id'leri; boş = Yargıtay+Danıştay
  "exactPhrase": true,              // "Tam ifade"
  "excludeTerms": ["kira tespiti"], // "Hariç tutulacak kelimeler", en fazla 10
  "chamber": "H3",                  // "Daire" (yalnız daireSuzgeci=true kaynaklarda)
  "yearFrom": 2023, "yearTo": 2025, // "Yıl aralığı"
  "dateFrom": "2023-01-01", "dateTo": "2025-12-31",  // yıl aralığını ezer
  "decisionType": "norm_denetimi",  // "Karar türü" (kararTurleri listesinden)
  "legislationNo": "6098",          // "Kanun no" (mevzuat kaynakları)
  "page": 1, "limit": 40
}
```

**200 yanıt alanları:** `searchId`, `query`, `effectiveQuery` (Bedesten'e
gerçekten giden ifade — "Aramayı göster" satırı), `requestedSources[]`,
`rows[]`, `failedSources[]`, `okSources[]`, `partial`, `tookMs`, `trace[]`,
`generatedAt`.

`rows[]` bir satır = **bir künye**:
`rowId, sourceId, sourceLabel, provider, fetchKind, externalId, title,
court?, decisionDate?, docketNo?, decisionNo?, legislationNo?,
legislationKind?, sourceUrl?, snippet?, injectionFlagged?`.

- Künye satırı: `court` + `E. docketNo` + `K. decisionNo` +
  tarih **GG.AA.YYYY** (`decisionDate` ISO'dur, ekranda çevrilir).
- `snippet` **eşleşen cümledir, kanıt DEĞİLDİR**; satırın altında
  gri, italik ve `textContent` ile yazılır. `injectionFlagged: true` olan
  satırda küçük bir uyarı rozeti: **"Bu özet metinde şüpheli talimat kalıbı
  var; yalnız görüntüleme amaçlıdır."**
- Satır eylemleri: **"Tam metni getir"** (→ `POST /v1/sources/fetch`
  `{kind: row.fetchKind, externalId: row.externalId, query: <arama metni>}`),
  **"Dosyaya kaydet"**, **"Taslakta kullan"**, **"Etiketle"**.

`failedSources[]` **her zaman gösterilir**, liste boş olmasa bile, listenin
üstünde uyarı bloğu olarak:
`{sourceId, sourceLabel, kind, message, correlationId}` → `message` birebir
basılır (Türkçe cümle, içinde makine kodu parantez içinde).

**Hata durumları:**
`400 INVALID_REQUEST` (`error.issues[]` alan bazlı), `502
UPSTREAM_UNAVAILABLE` (geçit yok → "Sunucuyu `--with-mcp` ile başlatın"),
`502 ALL_SOURCES_FAILED` (`error.failedSources[]` ile birlikte;
**boş liste çizilmez**, "hiçbirine ulaşılamadı" kartı çizilir).

### 7.2 "Tam metni getir" kartı

`POST /v1/sources/fetch` → 200

```jsonc
{
  "card": {
    "cardId","kind","kindLabel","provider","externalId","title",
    "sourceUrl","sourceUrlAllowed","contentSha256","contentCodePoints",
    "documentId","documentVersionId","retrievedAt",
    "originLabel":"resmî kaynak",
    "quotes":[{"startChar","endChar","quote","quoteSha256","score"}],
    "injectionFlagged": false
  },
  "text": "…tam kanonik metin…",
  "library": {"action":"written|duplicate|failed","key":"…","reason":"…?"},
  "kaynakEtiketi": "resmî kaynak · alınma 02.09.2026"
}
```

- Kart başlığı `title`, altında **çip: `kaynakEtiketi`** (asla "(SENTETİK)").
- `contentSha256` ilk 12 karakteri + "…" gösterilir; tam değer `title`
  özniteliğinde değil, "Kopyala" düğmesinde.
- `sourceUrlAllowed: false` ise bağlantı **tıklanabilir yapılmaz**, yanına
  "Bu adres izin listesinde değil" notu.
- `library.action === "failed"` ise sessiz kalınmaz: küçük bir not,
  **"Belge yerel kütüphaneye yazılamadı; kartın kendisi ve alıntıları
  etkilenmedi."**
- Hata: `502` + `{error:{kind,message,correlationId}}` → `message` birebir.

### 7.3 `#kapsam` görünümü (B-14)

`GET /v1/sources/manifest` → alanlar §3'te. Ekran kuralları:

- **Üst şerit:** `ozet` cümlesi.
- **Kaynak tablosu:** `ad` · `durum` rozeti (`acik` = yeşil "Açık",
  `kapali` = gri "Kapalı", `bilinmiyor` = gri "Bilinmiyor") · `sonErisim`
  (null ise **"ölçülmedi"** yazılır, tire değil) · `notlar` alt satırlar.
- **"Bilinen boşluklar"** bölümü `bilenenBosluklar[]` sırasıyla; her satır
  `baslik` (kalın) + `aciklama`. **"AİHM (HUDOC) kapsamda değildir"**
  cümlesi birebir görünmelidir (`console.test.ts` bunu doğrulasın).
- **"Ölçülen sayılar"** bloğu yalnız `olculenSayilar` alanlarından; `null`
  olan her alan **"ölçülmedi"** yazar, `0` yazmaz.
- **Araç envanteri** katlanır bir liste: `tool` · `state` ·
  `note`. `NOT_YET_WIRED` satırları üstte.
- En altta `durustlukNotu` birebir.
- Sayfa MCP kapalıyken de açılır; `durum` alanları "Kapalı" der.

### 7.4 "İçinde ara"

`POST /v1/sources/within` `{kind:"mevzuat"|"sigorta_tahkim", id, keyword,
maxResults?}` → `{kind,label,tool,id,keyword,sonuc,generatedAt}`.
`sonuc` sağlayıcı yüküdür; **yalnız `textContent` ile** basılır ve kanıt
sayılmaz.

---

## 8. Additive OpenAPI deltası (L-DOCS, Faz B)

**Yeni yollar (5):**

| Yol | Yöntem | Gövde / Yanıt |
|---|---|---|
| `/v1/sources/catalog` | GET | `SourceCatalog` |
| `/v1/sources/manifest` | GET | `CoverageManifest` (`collex.sources.manifest/v1`) |
| `/v1/sources/search` | POST | `SourceSearchRequest` → `SourceSearchResult`; 400 `ApiError`, 502 `ApiError` (+`failedSources`) |
| `/v1/sources/fetch` | POST | `SourceFetchRequest` → `SourceCardResponse`; 400/502 `ApiError` |
| `/v1/sources/within` | POST | `SourceWithinRequest` → `SourceWithinResult`; 400/502 `ApiError` |

**Var olan şemalara additive alanlar:**

- `ProviderCode` enum: **`UYUSMAZLIK`** eklenir.
- `POST /v1/search` `filters`: `chambers[]`, `yearFrom`, `yearTo`,
  `excludeTerms[]` (hepsi opsiyonel).
- `POST /v1/research` ve `/v1/research/start` `filters`: aynı dört alan.
- `LiveResearchResult.warnings[]`: yeni kod `LIBRARY_WRITE_FAILED:<n> …`.
- `GET /v1/research/runs/{runId}` `warnings[]`: aynı kod.

**Yeni şemalar:** `SourceCatalog`, `CoverageManifest`, `ManifestSource`,
`ManifestGap`, `ToolReachability`, `SourceSearchRequest`,
`SourceSearchResult`, `SourceSearchRow`, `SourceFailure`,
`SourceFetchRequest`, `SourceCardResponse`, `SourceCard`, `SourceQuote`,
`SourceWithinRequest`, `SourceWithinResult`.

Tool yüzeyi **54'te sabit kaldı**; hiçbir MCP aracı veya parametresi
eklenmedi, silinmedi, adı değiştirilmedi.

---

## 9. Değişen dosyalar

**Yeni**

- `control-plane/src/sources/catalog.ts`
- `control-plane/src/sources/searchService.ts`
- `control-plane/src/sources/fetchService.ts`
- `control-plane/src/sources/localLibrary.ts`
- `control-plane/src/sources/manifest.ts`
- `control-plane/src/sources/routes.ts`
- `control-plane/src/capabilities/inventory.ts`
- `control-plane/tests/planner/reachability.test.ts`
- `control-plane/tests/capabilities/sourcesSearch.test.ts`
- `control-plane/tests/capabilities/manifest.test.ts`
- `control-plane/tests/capabilities/localLibrary.test.ts`
- `control-plane/tests/capabilities/shortForm.test.ts`
- `legal_reference/parity_cases.py`

**Değişen**

- `control-plane/src/planner/templates.ts`
- `control-plane/src/planner/rulePlanner.ts`
- `control-plane/src/planner/outcomes.ts`
- `control-plane/src/capabilities/types.ts`
- `control-plane/src/research/payloads.ts`
- `control-plane/src/research/routes.ts`
- `control-plane/src/research/researchService.ts`
- `control-plane/src/retrieval/searchService.ts`
- `control-plane/src/retrieval/referenceParser.ts`
- `control-plane/tests/planner/templates.test.ts`
- `control-plane/tests/planner/rulePlanner.test.ts`
- `control-plane/tests/research/payloads.test.ts`
- `legal_reference/parser.py`
- `evals/fixtures/reference_parity.json`

---

## 10. Ölçümler (bu makinede, 02.09.2026)

```
$ cd control-plane && npx tsc --noEmit
# Bu hattın dosyalarında sıfır hata. Kalan iki hata başka hatların
# devam eden işi (aşağıda §11).

$ npx vitest run tests/capabilities tests/planner tests/research \
      tests/parser-parity.test.ts tests/registry.test.ts --reporter=basic
 ✓ tests/planner/contrary.test.ts            (20 tests)
 ✓ tests/planner/intake.test.ts              (26 tests)
 ✓ tests/planner/templates.test.ts           (44 tests)
 ✓ tests/planner/rulePlanner.test.ts         (21 tests)
 ✓ tests/planner/reachability.test.ts        (13 tests)   <- YENİ
 ✓ tests/capabilities/sourcesSearch.test.ts  (21 tests)   <- YENİ
 ✓ tests/capabilities/manifest.test.ts       (12 tests)   <- YENİ
 ✓ tests/capabilities/localLibrary.test.ts   (10 tests)   <- YENİ
 ✓ tests/capabilities/shortForm.test.ts      (12 tests)   <- YENİ
 ✓ tests/research/mcpSession.test.ts          (5 tests)
 ✓ tests/research/progress.test.ts            (5 tests)
 ✓ tests/research/payloads.test.ts           (11 tests)
 ✓ tests/research/asyncRuns.test.ts          (21 tests)
 ❯ tests/research/routes.test.ts             (10 tests | 1 failed)   <- §11
 ❯ tests/research/researchService.test.ts    (20 tests | 1 failed)   <- §11
 ✓ tests/parser-parity.test.ts              (117 tests)
 ✓ tests/registry.test.ts                     (8 tests)
 Test Files  2 failed | 15 passed (17)
      Tests  2 failed | 374 passed (376)

$ .venv/Scripts/python.exe -m pytest tests evals/tests -q
1 failed, 1316 passed in 126.88s      # tek hata §11'de, bu hattın değil

$ .venv/Scripts/python.exe -m pytest tests/contracts tests/intake -q
798 passed in 92.71s

$ .venv/Scripts/python.exe scripts/smoke_check.py
offline smoke checks passed: 54 tools, …   (exit 0)
```

Sayılabilir yeni gerçekler (hiçbiri hukukî kalite ölçüsü **değildir**):
54 kayıtlı araç, **54 erişilebilir** (52'si testte fiilen çağrılarak),
26 seçilebilir kaynak, 19 tam-metin türü, 8 bilinen boşluk,
fixture 108 vaka / 160 referans, bu hattın yeni testleri **68**.

Sunucu başlatılmadı, `var/*.pid` yaratılmadı, 8945/8955 portları
kullanılmadı, `collex_sources_test` **hiç oluşturulmadı** (bu hattın hiçbir
kalemi veritabanı gerektirmedi), `collex_local`'a hiçbir şey yazılmadı.

---

## 11. Açık konular ve başka hatların devam eden işi

1. **`tests/research/{researchService,routes}.test.ts` — 2 hata, sebebi bu
   hat DEĞİL.** Her ikisi de `status: "QUALIFIED"` (beklenen `"COMPLETE"`),
   sebep `CONFLICTING_AUTHORITIES`. Kanıt: (a) bu iki dosya bu hattın tüm
   değişiklikleri yerindeyken **14:23'te yeşildi**; (b) kısa-biçim geçişi
   geçici olarak kapatıldığında hata **aynen sürdü** (yani ayrıştırıcı
   değişikliği sebep değil); (c) `src/answer/verifier.ts` (14:45),
   `src/answer/coverage.ts` (14:40), `src/pipeline/answerPipeline.ts` (14:41),
   `src/llm/ruleDrafter.ts` ve `src/llm/lexicalEntailment.ts` (14:34)
   L-ANSWER tarafından bu arada değiştirildi. **L-ANSWER'a:** B-31 çalışması
   canlı araştırmanın mutlu yolunu ÇELİŞEN OTORİTELER'e çeviriyor; karşıt
   pasajın `stance` sınıflandırması veya entailment eşiği bu iki sözleşme
   testini kırıyor.
2. **`tests/intake/test_intake_cli.py::test_ensure_db_is_idempotent_on_existing_schema`**
   tam koşuda düşüyor, **tek başına koşturulduğunda geçiyor** (1 passed).
   Scratch veritabanı üzerinde eşzamanlı hat etkinliği; L-SAFE'in alanı.
3. **`npx tsc --noEmit` kalan iki hata**, ikisi de başka hatların:
   `src/ai/masking.ts(152,42)` (L-SAFE, B-23) ve
   `tests/drafting/contracts.test.ts(385,5)` (L-EVID).
4. **B-16 canlı doğrulama beklemede** (§2 sonu). Ağı olan bir makinede
   yapılacak ilk şey: "Yargıtay 3. HD · 2023-01-01 → 2025-12-31 ·
   `"tahliye taahhüdü"`" araması ve dönen künye sayısının kaydı.
5. **B-20 kısmî** (§4). IR-2 inmeden `collex_local` boş kalır ve "Yerel
   korpus" kapsamı ÇEKİMSER olmaya devam eder.
6. **Kısa biçimin tüketicileri.** `parseReferences` artık `short_form`
   döndürebiliyor. Bugünkü tüketicilerin hepsi `kind`'a göre açık şekilde
   filtreliyor (`planner/intake.ts`, `store/chunkStore.ts`,
   `answer/coverage.ts`, `pipeline/questionIntent.ts`, `llm/ruleDrafter.ts`),
   yani yeni tür **inert**. Kısa biçimlerin B-13 atıf denetimine
   **dâhil edilmesi** ayrı bir karardır ve bu hatta verilmedi: L-EVID
   `isUnresolvedShortForm` ile çözülmüş/çözülmemiş ayrımını yapabilir.
7. **`DEFAULT_CASE_LAW_LOOKBACK_YEARS = 15` ölçülmemiş bir seçimdir.**
   6098/6100/6102 kodifikasyon dalgasını kapsaması için seçildi; gerçek
   hukuk üzerinde doğrulanmadı ve öyle etiketlenmelidir.
8. **`sonErisim` günlüğü yok.** Manifest'teki "son başarılı erişim" hücresi
   bugün her kaynak için `null`. Doldurmak için kaynak başına başarı zaman
   damgası tutan küçük bir kalıcı kayıt gerekir; bu dalgada yapılmadı ve
   uydurulmadı.
