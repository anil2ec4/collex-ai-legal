# W14 — L-MATTER (dosya, takvim, süreler, depolar)

Tarih: **02.09.2026** · Hat: **L-MATTER** · Faz: **A**
Kalemler: **B-17, B-18, B-26, B-29, B-30 (`/original`), B-32 (files/answers),
B-42, B-43**

Bu rapor yalnız **ölçülen** şeyi yazar. Hiçbir sayı hukukî kalite ölçüsü
değildir; probe verisi **sentetiktir** ve `collex_local`'a hiçbir şey
yazılmamıştır.

---

## 0. Sahiplik ve sınırlar

Düzenlenen dosyalar (yalnız bunlar):

```
control-plane/src/matters/{types,store,routes}.ts
control-plane/src/matters/{ics,contacts,contactsRoutes,recordsRoutes}.ts   (YENİ)
control-plane/src/files/{store,routes}.ts
control-plane/src/api/answerService.ts
control-plane/src/store/{answerStore,draftStore}.ts
control-plane/tests/matters/{routes,ics,w14,contacts,pg}.test.ts           (3'ü YENİ)
control-plane/tests/files/{routes,w14}.test.ts                            (1'i YENİ)
control-plane/tests/deadlines/{calc,routes}.test.ts                       (yalnız L-LEGAL kaynaklı kırıkların onarımı)
```

Dokunulmayanlar: `src/api/server.ts`, `public/console.html`, `openapi.yaml`,
`STATUS.md`, `CLAUDE.md`, `docs/DEMO.md`, `docs/KULLANIM-ColleX.md`,
`supabase/migrations/**`, `tests/store/persistence.test.ts`, `package.json`,
`.env`. Gereken değişiklikler §7'de (integrationRequests).

**Router bağlama kararı (§G.1 sözleşme 1).** `server.ts` L-SAFE'in olduğu
için, bu dalgada eklenen üç uç (`DELETE /v1/answers/{runId}`,
`DELETE /v1/drafts/{draftId}`, `GET /v1/drafts/{id}/versions/{n}`) ayrı bir
dosyaya (`src/matters/recordsRoutes.ts`) yazıldı ve **matters router'ının
içinden** mount edildi — matters router zaten `answers` ve `drafts`
portlarını taşıyor ve `server.ts`'te zaten `/`'a mount ediliyor. Aynı şey
`/v1/contacts` için geçerli (`contactsRoutes.ts`, yalnız bir contact store
verildiğinde mount edilir). Böylece **hiçbir uç ölü kalmadı** ve `server.ts`
değişmedi. Bu üç yolun hiçbiri mevcut bir handler tarafından tutulmuyor
(drafting router'da `DELETE /v1/drafts/:id` ve `/versions/:n` yok), yani
mount sırası gölgeleme yapamaz.

---

## 1. B-17 · Takvim + duruşma öğesi + `.ics` akışı — **İNDİ**

**Ne yapıldı**

- Yeni öğe türü `hearing`, `deadline` ile birebir aynı kalıpta:
  `{ date, time 'SS:DD', court, salon, kind: 'durusma'|'kesif'|'e-durusma',
  title?, note, status: 'planlandi'|'yapildi'|'ertelendi' }`
  (`src/matters/types.ts`, zod şeması `src/matters/routes.ts`).
- `MatterSummary` additive alanları: `counts.hearings`, `nextHearing`
  (`{itemId, title, date, time, kind, daysLeft}`).
- `GET /v1/matters/deadlines` artık aynı pencerenin **duruşmalarını da**
  döndürüyor (`hearings[]`) — panel ve takvim tek cevaptan okuyor.
- İki `.ics` ucu: `GET /v1/matters/calendar.ics` (tüm dosyalar, bugün ±365
  gün) ve `GET /v1/matters/{id}/calendar.ics`. Ayrıca
  `GET /v1/matters/deadlines?format=ics`.
- `src/matters/ics.ts`: RFC 5545 üretici. Süre = **tüm gün** olayı
  (`DTSTART;VALUE=DATE`, `DTEND` ertesi gün — RFC'de DTEND dışlayıcı);
  duruşma = **saatli** olay, `TZID=Europe/Istanbul` ve dosyaya gömülü
  `VTIMEZONE` (Türkiye 08.09.2016'dan beri sabit +03:00, yaz saati yok), 60
  dakika. `VALARM`: süre için 7 gün, duruşma için 1 gün önce.
- **`DEADLINE_DISCLAIMER` her VEVENT'in `DESCRIPTION` alanına birebir**
  gömülüyor (CLAUDE.md invaryantı). Satır katlama 75 **oktet**te ve UTF-8
  farkında (bir çok baytlı karakterin ortasından katlanmıyor); kaçışlama
  RFC 5545 §3.3.11 (`\\`, `;`, `,`, satır sonu).
- Hazırlık kartı: `GET /v1/matters/{id}/hearings/{itemId}/prep` →
  duruşma künyesi + `openDeadlines[]` + `recentFiles[]` (son 3) +
  `chronology[]` (B-18'in olayları) + `today`.

**KABUL kanıtı** (`control-plane/tests/matters/ics.test.ts`, 9 test):

```
$ npx vitest run tests/matters/ics.test.ts
      Tests  9 passed (9)
```

Doğrulananlar: `DTSTART;TZID=Europe/Istanbul:20260918T100000` (tarih **ve**
saat), `DTSTART;VALUE=DATE:20260916` + `DTEND;VALUE=DATE:20260921`,
`VERSION:2.0` / `PRODID` / `CALSCALE` / `UID` / `DTSTAMP` / `SUMMARY` /
`LOCATION` / `TRIGGER:-P1D` / `TRIGGER:-P7D`, `content-type:
text/calendar; charset=utf-8`, ve her VEVENT'in `DESCRIPTION`ının
`escapeIcsText(DEADLINE_DISCLAIMER)` içerdiği + ters kaçışlandığında sabitin
**birebir** geri geldiği. Hazırlık kartı testi: açık süreler (kapanmış olan
listelenmiyor), **son üç** belge (dördüncüsü değil), kronoloji.

**Sapma — dürüstlük notu.** `app_private.matter_items.kind` sütununda
`check (kind in ('file','answer','draft','note','event','deadline'))` var ve
**`hearing` listede yok**; yeni migration yalnız L-SAFE tarafından
yazılabilir (§G.1 sözleşme 5). Bu yüzden:

- kod tarafı tamamdır ve **bellek içi** depoda (konsol testleri, demo) çalışır;
- `PgMatterStore` SQLSTATE 23514'ü yakalayıp `ItemKindUnsupportedError`
  fırlatır, router bunu **tipli 503 `ITEM_KIND_UNSUPPORTED`** ve tek Türkçe
  cümleye çevirir ("Duruşma kaydı için yerel veritabanı güncellenmeli:
  ColleX-Baslat.cmd ile veritabanını yeniden başlatın (kayıt türü listesi
  eski).") — sürücü hatası hiçbir zaman kullanıcıya gitmez;
- gerçek SQL testi (`tests/matters/pg.test.ts`) **iki dalı da** kapsar ve bu
  makinede bugün **reddedilen** dalı ölçtü (constraint henüz eski).
  DDL §7'de L-SAFE'e verildi.

Yani **duruşma bugün kalıcı veritabanına yazılamaz**; migration inince
hiçbir kod değişmeden çalışır.

---

## 2. B-18 · Kanıta bağlı kronoloji (toplu tarih aktarımı) — **İNDİ**

- `POST /v1/matters/{id}/items:batch` (+ iki noktasız takma ad
  `.../items/batch`): `{items: NewMatterItem[]}`, **≤ 50 kayıt**, tek istek,
  tek onay. `MAX_ITEM_PAYLOAD_BYTES` (64 KiB) **her kalem için ayrı**
  uygulanır. Cevap: `{created, createdCount, skipped:[{index, reason,
  message}]}`.
- Kopya bastırma: `dedupeKey` — referansı olan kayıt `kind+refId` ile,
  olmayan `kind + (date|dueDate) + (title|text) + time` ile tekilleşir.
  İkinci kez basıldığında **hiçbir şey eklenmez**, her satır
  `reason:"DUPLICATE"` ile döner.
- `PgMatterStore.addItems`: 12 kayıt **tek `insert ... select unnest(...)
  with ordinality`** ile yazılır ve matter'ın `updated_at`'i **bir kez**
  dokunulur.
- Yükleme cevabı ve `GET /v1/files/{id}` artık `analysis.dates[]`'i
  doğrudan aktarılabilir hâlde veriyor: her kalem additive `title`
  (bağlamdan, **kelime sınırında** kırpılmış, ≤120 kod noktası), `source:
  "belge:<fileId>"`, `verified:false` kazanıyor. `context` ve `count`
  duruyor (additive).

**KABUL kanıtı** (`tests/matters/w14.test.ts`, `tests/files/w14.test.ts`,
`tests/matters/pg.test.ts`):

- 12 tarih **1 HTTP isteğiyle** aktarılıyor, hepsi `verified:false` ve
  `source: belge:0123456789abcdef`;
- ikinci istek `createdCount:0`, `skipped` 12 satır, dosyada hâlâ 12 olay;
- 51 kayıt → 400 ("Tek istekte en fazla 50 kayıt gönderilebilir."), bozuk
  kalem → `items.1.payload.date` yollu 400, **reddedilen istekten hiçbir şey
  yazılmıyor**;
- gerçek SQL: `addItems` 12 satırı yazdı, `listItems` 12 olay döndürdü;
- kelime sınırı testi: kırpılan başlığın **her belirteci** kaynaktaki bir
  tam belirteç; `trimToWordBoundary("𝔄𝔅ℭ", 2)` **kod noktası** sayıyor
  (ADR-003), kod birimi değil.

**Sapma.** "Kronolojiyi DOCX indir" (`export/bundle_docx.py`) bu hatta
**yapılmadı**: `export/**` L-EVID'in. Sunucu tarafı hazır (kronoloji
`GET /v1/matters/{id}` ve hazırlık kartında tarih sırasında, kaynak
alanıyla); istek §7'de.

---

## 3. B-26 · "Sessizce yok sayma" biter — **İNDİ** (bir parçası hariç)

| Ölçülen kusur (DAILYFLOW) | Bu dalgada |
|---|---|
| `/v1/answers?q=`, `?status=` yok sayılıyor | **Gerçekten süzüyor** (`InMemoryAnswerStore` + `PgAnswerStore`); tanınmayan durum 400 |
| `/v1/files?matterId=` 9 belgenin tümünü döndürüyor | **Gerçekten süzüyor**; depo süzemiyorsa **400** (`FILTER_UNSUPPORTED`), asla tam liste |
| `/v1/drafts?q=` süzmüyor | `PgDraftStore.list({q})` **süzüyor**; route bağlanması L-EVID'de (§7) |
| Tanınmayan sorgu parametresi sessizce yutuluyor | Her liste ucunda **400** + hangi parametrenin tanınmadığı + kullanılabilir liste |
| `DELETE /v1/answers/{runId}` yok | **Var**; 204, ikinci çağrı 404; matter kaydı da düşer; önbellek + satır birlikte silinir |
| `DELETE /v1/drafts/{id}` yok | **Var**; 204/404; taslağın **her sürümü** silinir |
| `/versions/{n}` yok | **Var**; eski sürümün gövdesi okunuyor |
| Belge silinince matter kaydı/taslak eki öksüz kalıyor | `DELETE /v1/files/{id}` artık `file` matter kayıtlarını düşürüyor; **`GET /v1/files/{id}/usage`** silmeden önce ne öksüz kalacağını Türkçe uyarılarla söylüyor |
| `nextDeadline` 49 gün geçmiş tarihi gösteriyor | `nextDeadline` **geçmişi atlıyor**; `daysLeft` + `overdue` alanları; ayrı `overdueCount` |
| `/v1/matters/deadlines` 4 süre = 9 965 bayt | Varsayılan pencere **bugün .. bugün+30**, `computed` bloğu yalnız `?include=computed` |
| `updatedAt` / `matterTitle` / `matterId` yok | Üçü de additive olarak eklendi |

**KABUL kanıtı**

- Her süzgeç ya süzer ya 400 verir — testte **her iki dal da** var
  (`tests/matters/w14.test.ts` "an unimplemented filter is a 400",
  `tests/files/w14.test.ts` "says the filter is unsupported instead of
  returning everything").
- Silme uçları 204, ikinci çağrıda 404 — hem bellek hem **gerçek SQL**
  (`pg.test.ts`: `remove("run-b")` → true, sonra false; `versions("d-1")`
  boş).
- `nextDeadline` geçmişi göstermiyor, `overdueCount` doğru sayıyor —
  bellek + gerçek SQL (2026-07-15 geçmiş, 2026-09-08 sonraki, `daysLeft: 6`,
  `overdueCount: 1`).
- Gövde küçülmesi: ölçülen test `lean.length < full.length * 0.2`
  (**≥ %80 küçülme**), 4 süre × 24 adımlık `computed` bloğuyla.

**İNMEYEN parça — dürüst bildirim.** "Silinmiş `fileId`'ye sorulan soru
`404 FILE_NOT_FOUND` döner" **yapılmadı**: bu denetim `POST /v1/answer`
yolunda (`src/api/server.ts` + `src/pipeline/**`) olmalı ve iki dosya da bu
hatta ait değil. Gereken kanca hazırlandı (`FilesReadStore.originalRef` /
`fileUsage` aynı sorguyu verir) ve istek §7'de. Bugünkü davranış
değişmedi: bilinmeyen `fileId` `ABSTAIN` üretiyor.

**UXAUDIT P1-3 kök neden — bu hattın bulgusu.**
Backlog §H bu maddenin "kök nedene kadar götürülmediğini" yazıyor ve
L-MATTER'dan araştırmasını istiyor. Bulunan:

1. **Listeleme ucu suçsuz.** `PgMatterStore.list` yalnız
   `app_private.matters`'ı `tenant_id` ile okur; hiçbir yerde yerel
   önbellek, birleştirme ya da yeniden yazma yok. Yeni gerçek SQL testi
   (`pg.test.ts` "UXAUDIT P1-3") `list()` sonucunu tablonun **doğrudan
   sayımıyla satır satır** karşılaştırıyor ve başka bir kiracının satırının
   sızmadığını da gösteriyor. Yani uç "veritabanında olmayan dosya"
   üretemez.
2. **Hayalet seçenek konsoldan geliyor.** `public/console.html`
   `renderMatterSelect()` (bugünkü satır ~6446): `mattersCache` çizildikten
   sonra, `activeMatter` (localStorage `MATTER_KEY`) listede yoksa **fazladan
   bir `<option>` daha ekliyor**. Ölü bir kimlik böyle seçilebilir hâle
   geliyor; `loadMatters()` `GET /v1/matters` 200 dönmediğinde
   `mattersCache`'i hiç güncellemiyor ve eski liste ekranda kalıyor.
3. **Kimliklerin "hiç var olmaması" beklenen bir yan etki.** Denetim
   `collex_demo` üzerinde yapıldı; `demo.mjs` bu veritabanını **düşürüp
   yeniden kuruyor**, dolayısıyla `app_private.matters` boşalıyor —
   localStorage ise sağ kalıyor. Bir önceki inkarnasyonun kimlikleri
   tablodan sorulduğunda "hiç var olmamış" görünür.

Bu üçü birlikte gözlemi (6 seçenek ↔ 2 satır ↔ 404) artık **açıklıyor**.
Düzeltme konsol tarafındadır (B-10, L-CONSOLE): seçiciyi `GET /v1/matters`
sonucuyla buda ve `MATTER_NOT_FOUND` alınca aktif dosyayı temizleyip tek
Türkçe cümleyle söyle. Sunucu tarafında yapılacak bir şey **yok**; bu bir
ürün kusuru olarak L-MATTER'da kapanmıştır.

---

## 4. B-29 · Genel arama — **İNDİ** (belge gövdesi yarısı bağlanmayı bekliyor)

- `GET /v1/matters/search?q=&limit=` ve aynı handler'ın takma adı
  `GET /v1/search/all?q=` → `{q, total, groups, documentsSearched, tookMs}`.
  `groups`: `matters · documents · notes · events · deadlines · hearings ·
  answers · drafts`. Her satırda `href` çapası var; belge satırlarında
  `startChar`/`endChar` (**kod noktası**, ADR-003) ve
  `#belge/<fileId>?parca=<chunkId>&offset=<startChar>`.
- Kaynaklar: matters (`title/client/opposing/court/docketNo` ILIKE),
  `PgMatterStore.searchItems` (not metni + olay/süre/duruşma başlıkları,
  joker karakterler nötrlenmiş), `answerStore.list({q})`,
  `draftStore.list({q})`, ve belge gövdesi için
  `PostgresFilesStore.searchChunks` (mevcut `legal.chunks.search_tsv_tr`
  Türkçe FTS indeksi + ILIKE yedeği, yalnız `scope='tenant'` yüklemeler).
- Belge yarısı **ayrıca kendi ucundan** da erişilebilir:
  `GET /v1/files/search?q=&limit=` (files router'ında, deponun yanında).
- Bağlı değilse **sessiz boş grup yok**: cevap `documentsSearched:false`
  diyor.

**KABUL kanıtı**

- "Belgenin gövdesinde geçen ve hiçbir başlıkta olmayan ibare aratıldığında
  o belge çıkar ve tıklanınca bölüme gider": `tests/matters/w14.test.ts`
  "finds a phrase that appears ONLY in a document body and anchors it"
  (`startChar: 1200`, `href` `#belge/…?parca=chunk-7&offset=1200`).
- "Aynı ibare bir notta da geçiyorsa not satırı da listelenir": aynı dosyada
  matters/notes/events/answers/documents beşi birden dönüyor (`total: 5`).
- **Süre ölçümü (gerçek, bu makinede):** probe betiği
  `scratchpad/w14-L-MATTER/searchProbe.mjs` `collex_matter_test`'i kurup
  **400 dosya × 12 kayıt = 4 800 satır** yazdı ve aramanın matter+kayıt
  yarısını üç kez ölçtü:

  ```
  seeding 400 matters x 12 items = 4800 rows
  seed ms 319
  rows { m: '400', i: '4800' }
  cold ms 6 matters 0 items 20
  warm-1 ms 6 matters 0 items 20
  warm-2 ms 6 matters 0 items 20
  dropped collex_matter_test
  ```

  **6 ms** — 500 ms bütçesinin çok altında. **Dürüstlük:** bu ölçüm
  **belge gövdesi (chunk) yarısını içermez**; 2 000 belgelik / 20 055
  parçalık probe veritabanı bu hatta kurulmadı (ENGRISK/L-VERIFY'ın işi).
  Yani "arama < 500 ms" iddiası **yalnız dosya/kayıt/cevap/taslak yarısı
  için** ölçülmüştür.

**Sapma.** Genel aramanın belge yarısının `GET /v1/matters/search` içinden
çalışması için `createMattersRouter`'a `documents: filesStore` verilmesi
gerekiyor; bu satır `server.ts`'te ve o dosya L-SAFE'in (§7). O satır
gelene kadar konsol belge gövdesini `GET /v1/files/search` ile alabilir —
o uç bu hattın dosyasında ve **bugün çalışıyor**.

---

## 5. B-30 (`/original`) · Aslını indir — **İNDİ**

- `GET /v1/files/{id}/original` → yüklenen baytların **birebir aynısı**,
  `Content-Disposition: attachment` (ASCII yedek + `filename*=UTF-8''`),
  gerçek `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`. Dosya akış olarak (`createReadStream`)
  gönderiliyor, belleğe alınmıyor.
- Yol çözümü: `var/uploads/<sha256><uzantı>` (`intake/ingest.py` sözleşmesi).
  `sha256` **veritabanından** gelir ve `^[0-9a-f]{64}$` ile denetlenir;
  uzantı yalnız `.pdf/.docx/.txt/.udf` beyaz listesinden seçilir — hiçbir
  istek bir yol adlandıramaz. `uploadsDir` enjekte edilebilir (testler).
- Asıl diskte yoksa **açık Türkçe uyarı**: `404 ORIGINAL_NOT_FOUND`,
  "Bu belgenin aslı bilgisayarda bulunamadı (var/uploads klasöründe yok);
  yalnız çıkarılan metin ve alıntılar elinizde."

**KABUL kanıtı** (`tests/files/w14.test.ts`): geçici dizine yazılan
`%PDF-1.7\nİhtarname içeriği\n` baytları geri okunup `Buffer.equals` ile
**birebir** karşılaştırıldı; `content-length` eşleşiyor; `content-disposition`
`İhtarname_Şahin.pdf`in yüzde kodlu hâlini taşıyor; bilinmeyen id → 404
`NOT_FOUND`, bozuk id → 404 (süreç başlatılmadan).

ZIP paketi (B-30'un asıl gövdesi) **L-EVID'indir**; bu hat yalnız
`/original` ucunu teslim etti.

---

## 6. B-32 (files/answers) · Ölçek — **KISMEN İNDİ**

**İnen (bu hattın yarısı)**

- `GET /v1/files?limit=&offset=` → additive `page: {offset, limit, total}`;
  varsayılan **50**, tavan **200**.
- Liste sorgusu yeniden yazıldı (`PostgresFilesStore.listFilePage`):
  - `chars` artık `metadata.fixture_meta.upload.chars`'tan okunuyor,
    **yalnız yoksa** `length(v.canonical_text)`'e düşüyor (ENGRISK: sürenin
    %91'i bu detoast'tı);
  - parça sayımı **`left join lateral`** ile **sayfanın satırlarına**
    bağlandı; eski `group by document_version_id` alt sorgusu (her çağrıda
    tüm `legal.chunks` taraması) **kaldırıldı**.
  Bu iki invaryant `tests/files/routes.test.ts` içinde sahte `sql` ile
  **sorgu metni üzerinden** sabitlendi: iki ifade (sayım + sayfa), `'upload'
  ->> 'chars'` var, `left join lateral` var, `group by document_version_id`
  **yok**.
- `GET /v1/answers?fileId=` predikatı zaten `result @> …` biçimindeydi
  (W12-API2) — indeksle birebir aynı ifade; indeksin kendisi migration
  olduğu için §7'de.

**İNMEYEN**

- `answers_filescope_gin` migration'ı (L-SAFE) ve `intake/ingest.py`'nin
  `chars`'ı metadata'ya yazması (L-SAFE) — §7.
- "2000 belgelik probe DB'de `GET /v1/files` < 60 ms, gövde < 60 KB,
  `GET /v1/answers?fileId=` < 5 ms, `explain` planında indeks" ölçümü
  **yapılmadı**: o probe veritabanı bu hatta kurulmadı. Sayfalama ve sorgu
  şekli indi, **ölçüm L-VERIFY'a kalıyor**.

---

## 7. B-42 · Kişi kartları + menfaat çatışması — **İNDİ**

- `Contact { id, ad, tckn, vkn, adres, telefon, eposta, uetsAdresi, rol,
  notlar, createdAt, updatedAt }`; `rol ∈ {muvekkil, karsi-taraf, vekil,
  tanik, bilirkisi, diger}` (Türkçe etiketler `CONTACT_ROLE_LABELS`).
- Uçlar: `GET/POST /v1/contacts`, `GET/PATCH/DELETE /v1/contacts/{id}`,
  `POST /v1/contacts/conflict-check`.
  Çatışma taraması **POST**'tur: taraf adı kişisel veridir ve sorgu
  dizesinde (sunucu günlüğü, tarayıcı geçmişi) yer almamalıdır.
- **Depolama: yeni tablo YOK.** Kayıtlar `app_private.settings` içinde
  `key = 'contacts'` altında tek jsonb belgesi olarak duruyor — profil ve
  tercihlerin kullandığı tablo. Gerekçe: migration L-SAFE'in, ve tek
  avukatın kişi sayısı yüzlerle ölçülür (tavan `MAX_CONTACTS = 2000`).
- Çatışma taraması sözlükseldir ve bunu **söyler**: Türkçe katlanmış ad
  eşitliği (`normalizeTurkishSearch`), `matters.client` / `matters.opposing`
  üzerinde. `muvekkil` rolü karşı tarafta geçtiğinde **çatışma**;
  `karsi-taraf`/`vekil` rolü müvekkil tarafında geçtiğinde **çatışma**;
  aynı taraf `sameSide` ("bu müvekkilin diğer dosyaları"). Cevap, konsolun
  göstereceği **tam Türkçe cümleyi** taşıyor — cümle arayüzde kurulmuyor.
- TCKN resmî kontrol haneleriyle, VKN uzunlukla denetleniyor; hata
  **uyarıdır, ret değildir** (yabancı müvekkilin TCKN'si yoktur).

**KABUL kanıtı** (`tests/matters/contacts.test.ts`, 13 test): bir kişi bir kez
girildi ve iki dosyada kullanıldı; aynı ad karşı taraf rolüyle girilince
`hasConflict:true` ve mesaj dosya başlığını içeriyor; kart oluşturulurken de
tarama koşuyor; gerçek SQL'de `app_private.settings` üzerinden gidiş-dönüş
(`pg.test.ts`).

**Sapma.** "Taslak blokları kişiden dolar ve 'otomatik — kontrol edin' çipi
taşır" — taslak ön-dolumu `src/drafting/**` (L-EVID) ve çip
`console.html` (L-CONSOLE). Sunucu tarafı (kart + tarama) teslim edildi,
UI sözleşmesi §9'da.

---

## 8. B-43 · "Nerede kalmıştım" — **İNDİ**

`GET /v1/matters/{id}/activity?since=&limit=` →
`{matterId, matterTitle, activity: [{itemId, kind, kindLabel, refId, title,
at}], lastActivityAt}`. Altı öğe türü (+ duruşma) **tek listede**, en yeni
önce, her satır kendi ekranına gidecek `kind`+`refId` ile. Başlıklar
`trimToWordBoundary` ile kırpılıyor. Varsayılan 10, tavan 200.

**KABUL kanıtı**: `tests/matters/w14.test.ts` — üç farklı türde kayıt eklendi,
`activity` `["deadline","note","file"]` sırasında ve Türkçe etiketleriyle
(`["Süre","Not","Belge"]`) döndü; `?limit=1` bir satır; gelecekteki `since`
boş liste; bilinmeyen dosya 404.

"Bu dosyada daha önce sorulanlar" ucu zaten vardı
(`GET /v1/answers?matterId=`) ve artık `q`/`status` ile de süzülüyor;
tekilleştirme `DELETE /v1/answers/{runId}` ile mümkün hâle geldi.

---

## 9. Faz B için tam UI sözleşmesi (L-CONSOLE)

Aşağıdakilerin hiçbiri Faz A'da konsola dokunmadı.

**Takvim (B-17)**
- `GET /v1/matters/deadlines?from=&until=&include=computed`
  → `{deadlines[], hearings[], today, window:{from,until}, includedComputed}`.
  Ay/hafta görünümü bu tek çağrıdan çizilir. Varsayılan pencere bugün..+30;
  ay görünümü için `from`/`until` verin.
- Süre kartı: başlık `payload.title`, tarih **GG.AA.YYYY**, `daysLeft`
  `matters[].nextDeadline`'dan; **7 gün kala kırmızı**, `overdue` ise
  "gecikmiş" rozeti.
- Duruşma kartı: `payload.kind` → `Duruşma | Keşif | e-Duruşma`,
  `payload.time` **SS:DD**, `payload.court`, `payload.salon`.
- `.ics`: `<a href="/v1/matters/calendar.ics">Takvimime ekle (.ics)</a>` ve
  dosya sayfasında `/v1/matters/{id}/calendar.ics`. Türkçe etiket:
  "Takvime aktar (.ics) — Outlook / Google Takvim'de açılır".
- Duruşmaya tıklama → `GET /v1/matters/{id}/hearings/{itemId}/prep`;
  kart bölümleri: "Açık süreler" (`openDeadlines`), "Son belgeler"
  (`recentFiles`, en fazla 3), "Dosya kronolojisi" (`chronology`).
- Duruşma ekleme formu alanları (POST `/v1/matters/{id}/items`,
  `kind:"hearing"`): Tarih (GG.AA.YYYY → ISO), Saat (SS:DD), Mahkeme, Salon,
  Tür (Duruşma/Keşif/e-Duruşma), Not, Durum (Planlandı/Yapıldı/Ertelendi).
  `503 ITEM_KIND_UNSUPPORTED` gelirse **mesajı olduğu gibi göster**.

**Toplu tarih aktarımı (B-18)**
- Belge sayfasında "Tüm tarihleri zaman çizelgesine aktar" düğmesi →
  `POST /v1/matters/{id}/items:batch` gövdesi
  `{items: analysis.dates.map(d => ({kind:"event", payload:{date:d.date,
  title:d.title, source:d.source, verified:false}}))}`.
- Cevap: `createdCount` → "N olay eklendi"; `skipped.length` → "M kayıt
  zaten vardı, eklenmedi". Her olay satırında **"belgeden sezgisel çıkarım —
  doğrulanmadı"** çipi (`verified:false`) ve kaynak `belge:<fileId>`
  bağlantısı.

**Silme / sürüm (B-26)**
- `DELETE /v1/answers/{runId}` → 204; onay metni: "Bu araştırma kaydı
  silinsin mi? Dosyadaki kaydı da düşer."
- `DELETE /v1/drafts/{draftId}` → 204; "Taslağın **tüm sürümleri** silinir."
- `GET /v1/drafts/{id}/versions/{n}` → sürüm gövdesi (JSON draft);
  sürüm penceresinde "Bu sürümü aç". Sürüm satırında artık `updatedAt` var —
  P1-4'ün "iki satır aynı tarih" kusuru bununla kapanır.
- `GET /v1/files/{id}/usage` → silme onayında `warnings[]` **birebir**
  gösterilir (üç Türkçe cümle: matter kayıtları, taslak ekleri, kayıtlı
  araştırmalar).
- Liste süzgeçleri: tanınmayan parametre artık **400** döner; konsol
  yalnız `q`, `status`, `matterId`, `limit`, `offset`, `until`, `from`,
  `include`, `format` gönderebilir.

**Genel arama (B-29)**
- Üst çubukta tek kutu → `GET /v1/search/all?q=` (≥2 karakter).
- Gruplar sırayla: Dosyalar · Belgeler · Notlar · Olaylar · Süreler ·
  Duruşmalar · Araştırmalar · Taslaklar. Her satır `href` çapasını kullanır.
- `documentsSearched:false` ise belgeler grubunun altına tek satır:
  "Belge içeriği bu sunucuda aranamıyor." (boş grup gösterme).

**Aslını indir (B-30)**
- Belge sayfasında `<a href="/v1/files/{id}/original">Aslını indir</a>`;
  404 `ORIGINAL_NOT_FOUND` gelirse `error.message`'ı olduğu gibi göster.

**Kişi kartları (B-42)**
- `GET /v1/contacts?q=&rol=`; kart alanları Türkçe etiketlerle (Ad, T.C.
  kimlik no, Vergi no, Adres, Telefon, E-posta, UETS adresi, Rol, Notlar).
- Yeni dosya formunda müvekkil/karşı taraf alanı kişi seçiciye bağlanır;
  seçimden sonra `POST /v1/contacts/conflict-check {ad, rol}` çağrılır ve
  `message` **birebir** uyarı şeridinde gösterilir; `sameSide` satırları
  "Bu müvekkilin diğer dosyaları" başlığı altında.
- Kart cevabındaki `warnings[]` (TCKN/VKN) alanın altında sarı not.

**Nerede kalmıştım (B-43)**
- Dosya sayfası açılışında `GET /v1/matters/{id}/activity?limit=10`;
  tek liste, `kindLabel` rozeti + `title` + `at` (GG.AA.YYYY SS:DD).

---

## 10. Additive OpenAPI deltası (L-DOCS, Faz B)

**Yeni yollar**

| Yol | Metot | Cevap |
|---|---|---|
| `/v1/matters/calendar.ics` | GET | `text/calendar` |
| `/v1/matters/{id}/calendar.ics` | GET | `text/calendar` |
| `/v1/matters/search` | GET | `SearchAllResponse` |
| `/v1/search/all` | GET | `SearchAllResponse` |
| `/v1/matters/{id}/activity` | GET | `ActivityResponse` |
| `/v1/matters/{id}/items:batch` | POST | `BatchItemsResponse` (201) |
| `/v1/matters/{id}/items/batch` | POST | aynısı (takma ad) |
| `/v1/matters/{id}/hearings/{itemId}/prep` | GET | `HearingPrep` |
| `/v1/answers/{runId}` | DELETE | 204 / 404 |
| `/v1/drafts/{draftId}` | DELETE | 204 / 404 |
| `/v1/drafts/{draftId}/versions/{version}` | GET | draft gövdesi / 404 / 501 |
| `/v1/files/{id}/original` | GET | ikili akış / 404 `ORIGINAL_NOT_FOUND` |
| `/v1/files/{id}/usage` | GET | `FileUsage` |
| `/v1/files/search` | GET | `{q, hits[]}` |
| `/v1/contacts` | GET, POST | `{contacts[]}` / `Contact` (201) |
| `/v1/contacts/{id}` | GET, PATCH, DELETE | `Contact` / 204 |
| `/v1/contacts/conflict-check` | POST | `ConflictReport` |

**Mevcut şemalara additive alanlar**

- `MatterSummary`: `counts.hearings`, `overdueCount`, `nextHearing`
- `NextDeadline`: `daysLeft`, `overdue`
- `MatterItemsByKind`: `hearings[]`
- `MatterItemKind` enum: `hearing` (additive değer)
- `GET /v1/matters/deadlines` cevabı: `hearings[]`, `window`,
  `includedComputed`; yeni sorgu parametreleri `from`, `include`, `format`
- `AnswerSummary`: `matterTitle`
- `GET /v1/answers` sorgu parametreleri: `q`, `status`
- `DraftSummary`: `updatedAt`
- `GET /v1/drafts` sorgu parametresi: `q` (route bağlaması L-EVID'de)
- `FileListEntry`: `matterId`, `matterTitle`
- `GET /v1/files` cevabı: `page: {offset, limit, total}`; yeni sorgu
  parametreleri `matterId`, `limit`, `offset`
- `GET /v1/files/{id}` `analysis.dates[]`: `title`, `source`, `verified`
- Yeni hata kodları: `ITEM_KIND_UNSUPPORTED` (503), `ORIGINAL_NOT_FOUND`
  (404), `NOT_SUPPORTED` (501), `LIMIT_EXCEEDED` (409)

**Not:** MCP araç yüzeyi **54'te sabit** kaldı; hiçbir araç/parametre
eklenmedi, çıkarılmadı, adı değiştirilmedi.

---

## 11. Ölçümler (gerçek çıktı)

```
$ cd control-plane && npx tsc --noEmit
tests/api.test.ts(915,68): error TS2322: ...   <- L-SAFE'in dosyası (geçici)
(L-MATTER dosyalarında hata yok)

$ npx vitest run tests/matters
      Tests  74 passed | 1 skipped (75)

$ npx vitest run tests/files
      Tests  39 passed (39)

$ npx vitest run tests/settings
      Tests  6 passed (6)

$ npx vitest run tests/deadlines
      Tests  1 failed | 72 passed (73)
      FAIL tests/deadlines/rules.test.ts > has the mandatory disclaimer verbatim
      (L-LEGAL'in dosyası: DEADLINE_DISCLAIMER metnini bu dalgada değiştirdiler)

$ npx vitest run                 # tüm süit
 Test Files  6 failed | 86 passed (92)
      Tests  7 failed | 1777 passed | 5 skipped (1789)
```

Yedi kırıktan **altısı** başka hatların dosyalarında ve onların
uçuşta olan değişikliklerinden:

| Kırık | Sahip | Sebep |
|---|---|---|
| `tests/api.test.ts` (tsc + 1 test) | L-SAFE | header tipi + `/v1/health` sayıları |
| `tests/capabilities/manifest.test.ts` | L-SOURCES | B-14 manifesto |
| `tests/deadlines/rules.test.ts` | L-LEGAL | disclaimer metni değişti |
| `tests/drafting/templates.test.ts` | L-LEGAL | B-25 şablon içeriği |
| `tests/integration/app.test.ts` (2) | L-SAFE | süre kuralı sayısı 30 → **41** (L-LEGAL) |
| `tests/store/persistence.test.ts` | L-SAFE dosyası, **L-MATTER sebebi** | §12'de |

`tests/files/uploadCap.test.ts` tam süitin bir koşusunda kırıldı, tek başına
ve sonraki tam koşuda geçti; `intake/quarantine.py` L-SAFE tarafından o
sırada düzenleniyordu (`UPLOAD_CAP_MIB = 25` yerinde). Geçici.

**Probe veritabanı hijyeni.** `collex_matter_test` üç kez kuruldu ve **her
seferinde düşürüldü**; koşu sonunda `pg_database`:
`collex_answer_test collex_demo collex_eval_test collex_local
collex_mig_test collex_quality_test collex_retrieval_test postgres
template0 template1` — `collex_matter_test` **yok**. `collex_local`'a
yazılmadı, düşürülmedi. Hiçbir sunucu başlatılmadı (8944 dinlenmiyor);
`var/collex.pid` bu hat tarafından **yaratılmadı**, dokunulmadı.

Python testleri bu hatta çalıştırılmadı: bu hat hiçbir Python dosyasını
değiştirmedi.

---

## 12. integrationRequests (dosyasına sahip olmadığım değişiklikler)

1. **L-SAFE · `supabase/migrations/<yeni>.sql`** — `hearing` öğe türü.
   `app_private.matter_items.kind` CHECK'i `'hearing'`i kabul etmeli:
   ```sql
   alter table app_private.matter_items
     drop constraint if exists matter_items_kind_check;
   alter table app_private.matter_items
     add constraint matter_items_kind_check
     check (kind in ('file','answer','draft','note','event','deadline','hearing'));
   ```
   Ledger sentinel'i bu ALTER'ı adlandırmalı; B-05'in çoklu sentinel
   grameriyle `-- [LEDGER SENTINEL] column:app_private.matter_items.kind`
   yerine, kısıtı adlandıran bir probe daha doğru olur (kısıt adı
   `matter_items_kind_check`). **Bu inmeden duruşma kalıcı depoya
   yazılamaz** (bugün tipli 503 dönüyor).

2. **L-SAFE · `supabase/migrations/<yeni>.sql`** — B-29 ve B-32 indeksleri:
   ```sql
   create index if not exists answers_filescope_gin
     on app_private.answers using gin ((result -> 'fileScope'));
   create index if not exists answers_question_trgm
     on app_private.answers using gin (question gin_trgm_ops);
   create index if not exists drafts_title_trgm
     on app_private.drafts using gin (title gin_trgm_ops);
   create index if not exists matter_items_hearing_date_idx
     on app_private.matter_items ((payload ->> 'date'))
     where kind = 'hearing';
   ```
   `answers_filescope_gin` ifadesi `PgAnswerStore.list`'in predikatıyla
   (`result @> '{"fileScope":{"fileIds":["…"]}}'::jsonb`) **birebir**
   eşleşmelidir.

3. **L-SAFE · `intake/ingest.py`** — `chars`'ı upload metadata'sına yaz:
   `meta["upload"]["chars"] = len(canonical)` (`IntakeResult.chars` zaten
   var). `PostgresFilesStore.listFilePage` bunu `coalesce` ile okuyor;
   yazılmayan eski satırlar hâlâ `length(v.canonical_text)`'e düşüyor
   (ENGRISK'in %91'lik detoast maliyeti).

4. **L-SAFE · `control-plane/src/api/server.ts`** — üç satır:
   - matters router'ına belge arama portunu ver (B-29'un belge yarısı):
     `createMattersRouter({ store: matterStore, answers: answerStore,
     drafts: draftStore, now, ...(filesStore !== undefined ? { documents:
     filesStore } : {}) })`
   - kişi kartlarını aç (B-42): `import { PgContactStore } from
     "../matters/contacts.js";` ve `...(sql !== undefined ? { contacts: new
     PgContactStore({ sql }) } : { contacts: new InMemoryContactStore() })`
     — matters router'ının `contacts` bağımlılığı verilmezse `/v1/contacts`
     hiç mount edilmez (vaporware kapısı).
   - files router'ına isterse `uploadsDir` geçilebilir (varsayılan
     `<repoRoot>/var/uploads` zaten doğru; `COLLEX_DATA_DIR` B-34 ile
     gelirse buraya bağlanmalı).

5. **L-SAFE · `control-plane/tests/store/persistence.test.ts` satır ~747** —
   `nextDeadline` artık additive `daysLeft` ve `overdue` taşıyor (B-26).
   Tek kelimelik onarım:
   `expect(summaryA?.nextDeadline).toEqual({...})` →
   `expect(summaryA?.nextDeadline).toMatchObject({ itemId: soon!.itemId,
   title: "Cevap süresi", dueDate: "2026-09-16" })`.
   (Aynı testin `counts` satırı zaten `toMatchObject`, `hearings` eklenmesi
   onu kırmadı.)

6. **L-ANSWER + L-SAFE · `src/api/server.ts` / `src/pipeline/**`** — B-26'nın
   inmeyen parçası: `POST /v1/answer` `filters.fileIds` içinde artık var
   olmayan bir belge kimliği taşıyorsa **retrieval'dan önce**
   `404 { kind: "FILE_NOT_FOUND", message: "Belge kaydı bulunamadı; silinmiş
   olabilir." }` dönmeli (bugün `ABSTAIN` dönüyor ve avukat sebebini
   göremiyor). Kanca hazır: `FilesReadStore` üzerinden kimliklerin varlığı
   tek sorguyla kontrol edilebilir (`originalRef` / `fileUsage` aynı satırı
   okuyor); isterseniz `existingFileIds(ids)` yardımcı metodunu bu hatta
   ekleyebilirim.

7. **L-EVID · `control-plane/src/drafting/routes.ts`** — iki küçük geçiş:
   - `GET /v1/drafts` `?q=` parametresini `store.list({ q })`'ye geçirsin ve
     tanınmayan sorgu parametresine 400 dönsün (`PgDraftStore.list` `q`'yu
     zaten uyguluyor);
   - `GET /v1/drafts` ve `/versions` satırları artık `updatedAt` taşıyor
     (additive, pass-through olduğu için kod değişikliği gerekmez —
     yalnız sözleşmede belgelenmesi gerekir).

8. **L-EVID · `control-plane/src/drafting/store.ts`** — `InMemoryDraftStore`
   `remove(draftId)` ve `getVersionBody(draftId, version)` kazanırsa
   `DELETE /v1/drafts/{id}` ve `/versions/{n}` bellek modunda da tam çalışır
   (bugün bellek modunda 501 + Türkçe cümle dönüyor, Pg modunda tam çalışıyor).

9. **L-EVID · `export/bundle_docx.py`** — B-18'in "Kronolojiyi DOCX indir"
   yarısı: `GET /v1/matters/{id}` `items.events` (tarih sırasında,
   `source`/`verified` alanlarıyla) doğrudan besleyebilir; kaynak sütunu
   `source` (`belge:<fileId>` → belge adı) olmalı ve her satır
   `verified:false` için "doğrulanmadı" işareti taşımalı.

10. **L-CONSOLE · `public/console.html`** — P1-3'ün asıl düzeltmesi
    (B-10 kapsamında): `renderMatterSelect()` içindeki "aktif dosya listede
    yoksa fazladan option ekle" dalı kaldırılmalı ya da `GET /v1/matters`
    başarılı döndüğünde ölü aktif dosya **temizlenmelidir**; `MATTER_NOT_FOUND`
    alındığında `setActiveMatter(null)` + tek Türkçe cümle. Sunucu tarafında
    yapılacak bir şey yok (§3'teki bulgu).

11. **L-DOCS** — §10'daki additive delta.

---

## 13. Açık konular (dürüst)

1. **Duruşma kalıcı depoya yazılamıyor** (madde 12.1 inene kadar). Bellek
   modunda ve testlerde tamamdır; Pg modunda tipli 503 + Türkçe cümle.
2. **B-29'un 500 ms bütçesi yalnız yarım ölçüldü**: 400 dosya / 4 800 kayıtta
   **6 ms**, ama belge gövdesi (chunk) yarısı 2 000 belgelik probe DB
   olmadığı için ölçülmedi.
3. **B-32'nin kabul ölçüsü ölçülmedi** (2 000 belgelik DB, `explain` planı,
   `< 60 ms` / `< 60 KB`). Sorgu şekli ve sayfalama indi; ölçüm L-VERIFY'da.
4. **`GET /v1/matters/search`'ün belge grubu bugün boş** (dürüstçe
   `documentsSearched:false` diyor) — 12.4'teki tek satır gelene kadar.
   `GET /v1/files/search` şimdiden çalışıyor.
5. **Silinmiş belgeye sorulan soru hâlâ `ABSTAIN`** — 12.6.
6. **`/v1/drafts?q=`** deposu süzüyor, **route henüz geçirmiyor** — 12.7.
7. **`tests/deadlines/calc.test.ts`'te bir vaka L-LEGAL'in içeriğine bağlı
   olarak güncellendi**: İİK m.363 kuralı bu dalgada 10 gün/tefhimden
   → 2 hafta/tebliğden olarak düzeltildi (7499 s.K. m.37, 01.06.2024), ve
   test vakası buna göre `2026-09-14` → `2026-09-17` yazıldı. Hukukî
   içeriğin doğruluğu **L-LEGAL'in `rules.test.ts`'inde** iddia edilir; bu
   hat yalnız hesabın kuralla tutarlı olduğunu iddia eder.
8. **`DEADLINE_DISCLAIMER`in kopyası iki test dosyamdan kaldırıldı**
   (`calc.test.ts`, `routes.test.ts`): artık sabiti **import ediyorlar**.
   Metnin birebir sabitlenmesi L-LEGAL'in `rules.test.ts`'inin işidir;
   benim dosyalarımın iddiası "her hesap onu **değiştirmeden** taşıyor".
   Hiçbir iddia zayıflatılmadı.
9. **`ICS` çıktısı gerçek bir Outlook/Google Takvim'de açılmadı** —
   RFC 5545 zorunlu alanları ve katlama/kaçışlama testle doğrulandı, ama
   canlı istemci denemesi bu makinede yapılmadı. Bu bir ürün kusuru değil,
   ölçülmemiş bir iddiadır ve öyle yazılmıştır.
10. **Sentetik veri uyarısı:** §4'teki 6 ms ve tüm satır sayıları bu hattın
    kendi ürettiği **uydurma** kayıtlar üzerindedir; hiçbiri hukukî kalite
    ya da gerçek kullanım ölçüsü değildir.
