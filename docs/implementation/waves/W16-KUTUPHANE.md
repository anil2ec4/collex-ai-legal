# W16 · KÜTÜPHANE — yerel kütüphanenin ikinci yarısı (B-20 / ADR-027)

Tarih: **04.09.2026** · Şerit: tek · Kalem: **B-20'nin yayımlayıcı yarısı**
Durum: **İNDİ** (aşağıdaki üç açık kalem adıyla yazılıdır)

Bu rapor, W14-L-SOURCES §6'daki **IR-2** entegrasyon isteğinin karşılığıdır.
Lane raporları tarihsel kayıttır: buradaki bir sayı sonradan yanlış çıkarsa
`STATUS.md` içinde düzeltilir, bu dosya **yeniden yazılmaz**.

---

## 1. Kapatılan boşluk

Bugüne kadar canlı araştırmada getirilen **her tam metin, koşu bitince
atılıyordu**. `collex_local` 0 kamu belgesi ve 0 pasaj taşıyordu; sonuç:

- "Yerel korpus" kalıcı olarak ÇEKİMSER,
- Türkçe FTS şeridinin, atıf/citator şeridinin ve as-of motorunun
  çalışacak metni yok,
- aynı soru iki kez sorulduğunda iki kez ağa çıkılıyor.

`control-plane/src/sources/localLibrary.ts` bu işin **yazan** yarısını zaten
indirmişti: getirilen her tam metin, tam kökeniyle ve kimlik+içerik özetiyle
tekilleştirilerek dayanıklı bir **SPOOL** klasörüne (`var/library/`) bir
`collex.library.document/v1` zarfı olarak yazılıyor. `serve.mjs` bu deposu
**koşulsuz** veriyor (`sourcesLibrary: new FileLocalLibrary(args.libraryDir)`,
satır 523), yani kuyruk bugün de doluyor.

Eksik olan **okuyan** yarıydı. Bu şerit onu indirdi.

### Neden Python tarafında

Korpus sözleşmesi Python'da yaşıyor: `ingestion/identity.py` (mantıksal
kimlik), `ingestion/versioning.py` (ADR-012 zamansal kapanış),
`ingestion/chunking.py` (ADR-013 örtüşmeyen parçalar), `ingestion/relations.py`
(atıf kenarları). Bunları TypeScript'te yeniden yazmak **aynı belgeye, hangi
runtime yazdıysa ona göre iki farklı kimlik** verirdi — ADR-013'ün tam olarak
engellemek için var olduğu kusur. Bu yüzden `ingestion/library.py` hiçbir
şeyi yeniden türetmez: bir `SourcePort` kurar ve **mevcut**
`ingestion.pipeline.Pipeline`'a verir. Fikstür korpusunun ve müvekkil
yüklemelerinin geçtiği boru hattının aynısı.

---

## 2. İnen dosyalar

| Dosya | Ne |
|---|---|
| `ingestion/library.py` | **YENİ.** Spool okuyucu + doğrulayıcı + yayımlayıcı. `parse_library_record` (zarf doğrulama), `read_spool`, `LibrarySpoolSource(SourcePort)`, `publish_library`, `LibraryPublishReport`. |
| `ingestion/cli.py` | `--publish-library <spool> [--dry-run] [--json]` alt komutu; `--dry-run`/`--json` bayrakları; tipli `STORE_UNAVAILABLE`; UTF-8 stdout. Fikstür yolu **değişmedi**. |
| `tests/ingestion/test_library.py` | **YENİ.** 33 gerileme testi (aşağıda). |
| `docs/implementation/waves/W16-KUTUPHANE.md` | Bu rapor. |

**IR-2'den iki sapma, bilerek:** istek `ingestion/live_library.py` ve
`intake.cli --ingest-library` diyordu; bu şeridin görev tanımı
`ingestion/library.py` ve `ingestion.cli --publish-library` dedi. Davranış
aynı, ad farklı — `intake/` müvekkil yüklemelerinin (scope `tenant`) evi,
kütüphane ise kamu korpusu (scope `public`), ve ikisini ayrı kapıda tutmak
doğru olan.

`control-plane/**` ve `console.html` bu şeridin dosyası değildir ve
**dokunulmadı**.

---

## 3. Sözleşme

### 3.1 Zarf doğrulama — bilinmeyen ŞEMA REDDEDİLİR, sessizce atlanmaz

Her spool dosyası açılır, doğrulanır ve reddedilirse **adıyla** raporlanır.
Sessiz atlama bir ingestion hattında doğruluk tehlikesidir: "belge
kütüphanede yok" ile "belge keşif sırasında düşürüldü" aşağı akışta birebir
aynı görünür. (`FixtureSource`'un 27.08.2026 düzeltmesiyle aynı gerekçe.)

| Kod | Ne zaman |
|---|---|
| `NOT_UTF8` / `INVALID_JSON` / `NOT_AN_OBJECT` | dosya okunamıyor/çözümlenemiyor |
| `UNKNOWN_SCHEMA` | `schema != collex.library.document/v1` |
| `WRONG_SCOPE` | `scope != "public"` (müvekkil yüklemesi bu kapıdan giremez) |
| `WRONG_ORIGIN_LABEL` | `originLabel != "resmî kaynak"` |
| `UNKNOWN_MEDIA_TYPE` | `mediaType != "text/markdown"` |
| `SYNTHETIC_SOURCE` | `source`, `fixture-` ön ekini taşıyor |
| `EMPTY_SOURCE` / `EMPTY_EXTERNAL_ID` / `EMPTY_TEXT` / `EMPTY_FETCHED_AT` | zorunlu alan boş |
| `TEXT_NOT_CANONICAL` | metin NFC değil ya da CR taşıyor |
| `CODEPOINT_MISMATCH` | `contentCodePoints` metnin gerçek uzunluğu değil |
| `CONTENT_HASH_MISMATCH` | `contentSha256` **metinden yeniden hesaplanınca** tutmuyor |
| `MISSING_FIELD:<ad>` / `WRONG_TYPE:<ad>` | alan yok ya da tipi yanlış |

İki kural özellikle önemli:

- **İçerik özeti güvenilmez, YENİDEN HESAPLANIR.** Bir alıntı sonradan
  `contentSha256` üzerinden doğrulanacak; ikisi ayrışırsa alıntı, kimsenin
  elinde olmayan bir metnin karmasına karşı "doğrulanmış" görünürdü.
- **NFC olmayan metin onarılmaz, reddedilir.** Okuyucu metni kendisi
  normalleştirseydi yayımlanan sürümün karması zarfınkinden farklı olurdu ve
  yukarıdaki bağ kopardı. Ofsetler ve karma kanonik metin üzerinden
  tanımlıdır (ADR-003).

### 3.2 Tekillik ve sürümleme — hepsi mevcut kodda

- **Aynı mantıksal kimlik + aynı içerik özeti** → `unchanged`, hiçbir şey
  yazılmaz (idempotent).
- **Aynı kimlik + DEĞİŞEN içerik** → yeni **sürüm**; öncekinin
  `system_period`'ını **veritabanındaki tetikleyici** kapatır (ADR-012).
  Bu modülde kapatma kodu **yoktur**; olsaydı mekanizma ikiye bölünürdü.
- Bir koşuda aynı belgenin iki sürümü varsa, zarflar **`fetchedAt` sırasına**
  göre yayımlanır: sürüm makinesi ancak eskiden yeniye ekleyebilir.
- `dates` bilerek **boştur**: zarf bir *indirme* zamanı taşır, karar/yayım/
  yürürlük tarihi değil. İndirme zamanından `effective_period` uydurmak
  as-of motoruna yanlış bir cevap yazmak olurdu.

### 3.3 İşaretleme — yayımlanan taşınır, başarısız olan **asla silinmez**

- Yayımlanan (veya "zaten vardı" denen) zarf `<spool>/yayimlandi/` altına
  **taşınır** (`os.replace`, atomik). Silinmez: avukatın getirdiği metin bu
  şeridin var olma sebebi.
- Reddedilen zarf **yerinde kalır**, taşınmaz, silinmez.
- Boru hattı hatası alan zarf **yerinde kalır**; hata raporlanır, sonraki
  koşu yeniden dener. (Test: hata enjekte edilir, dosya durur, düzeltme
  sonrası yeniden koşu belgeyi yayımlar.)
- Taşıma başarısız olursa belge yine de yayımlanmıştır; sonraki koşu onu
  `unchanged` diye görür — kayıp değil, boşa geçmiş bir tur.

### 3.4 Kısmî başarı yalan söylemez

`LibraryPublishReport` her koşuda **üç sayıyı birden** verir —
`published` / `skipped` / `failed` — ve alt sayıları ayrı tutar:
`unchanged`, `reverted`, `rejected` (bozuk zarf), `pipelineFailed` (yayım
hatası). Bozuk bir dosya ile ölü bir veritabanı **farklı sorunlardır** ve
çözümleri farklıdır; tek bir "başarısız" sayısı bunu gizlerdi. CLI kısmî
başarıda **çıkış kodu 2** verir: kısmî bir koşu başarı gibi okunmaz.

### 3.5 Veritabanı adı disiplini

`publish_library` yalnız **`collex_local`** ve **`collex_ingest_test`**
adlarını kabul eder (`intake.cli --ensure-db` ile aynı duruş) ve reddi
**bağlantı açmadan önce** verir. Veritabanı yaratmaz, düşürmez, göç
uygulamaz — şemayı hazırlamak `intake.cli --ensure-db`'nin işidir ve CLI
`--publish-library` ile `--recreate-db`/`--apply-migrations`'ı birlikte
kullanmayı **reddeder**.

### 3.6 SENTETİK ile GERÇEK karışmaz

Fikstür korpusu `source: "fixture-*"` ve `_meta.synthetic: true` yazar.
Kütüphane belgesi bunun tam tersini **satırın kendisinde** söyler:

- `legal.documents.source` = sağlayıcı ailesi (`BEDESTEN`, `MEVZUAT`, …),
- `legal.document_versions.metadata -> 'fixture_meta'` içinde
  `synthetic: false`, `origin_label: "resmî kaynak"` ve tam köken
  (`tool_name`, `fetched_at`, `source_url`, `run_id`, `content_sha256`,
  spool anahtarı).

`fixture-` ön ekli bir `source` bu kapıdan **reddedilir**, yani sentetik veri
kütüphaneye giremez. İkisi aynı veritabanındayken bile **tek sorguyla**
ayrılırlar (test bunu iki yönde de ölçüyor), dolayısıyla cevap ekranı hangi
tarafın konuştuğunu söyleyebilir.

### 3.7 Parçalayıcı seçimi — yeni parçalayıcı YAZILMADI

Sağlayıcı ailesi yalnızca **mevcut** parçalayıcılardan hangisinin geçerli
olduğunu söyler: mevzuat ailesi → `legislation` (madde/fıkra),
karar ailesi → `decision` (ÖZET/OLAY/GEREKÇE/HÜKÜM), **tanınmayan sağlayıcı →
`generic`**. Tanınmayan bir sağlayıcı **düşürülmez**, genel parçalayıcıyla
yayımlanır ve `document_type` `belge` olur — çünkü yanlış tahmin edilen bir
`document_type` künyeyi yanlış etiketlerdi, oysa diğer iki parçalayıcı zaten
yapısı yokken `generic`'e düşüyor.

---

## 4. Ölçülen sayılar

> **Dürüstlük şartı.** Aşağıdaki zarflar bu ölçüm için **ÜRETİLDİ**; gerçek
> bir mahkeme arşivinden çekilmiş metin değildir. Sayılar **mekanizmayı**
> tarif eder — hiçbir hukukî kalite, kapsam ya da doğruluk iddiası taşımaz.
> Ölçüm `collex_ingest_test` üzerinde yapıldı ve veritabanı ölçüm sonunda
> **düşürüldü**. `STATUS.md` bu şeridin dosyası değil; bu satırların oraya
> birer satır olarak eklenmesi gerekiyor (§7, IR-C).

Ortam: PostgreSQL 18.1, 127.0.0.1:55432, `.venv/Scripts/python.exe`.
Kuyruk: **60 zarf**, toplam **37 886 kod noktası** metin.

| Ölçüm | Sonuç |
|---|---|
| `--dry-run` | `published=60 skipped=0 failed=0 moved=0`, **56 ms**; veritabanı sonrasında `(0 belge, 0 sürüm, 0 pasaj, 0 iş, 0 anlık görüntü)` — **hiçbir şey yazılmadı** |
| 1. koşu | `scanned=60 published=60 skipped=0 failed=0`, **360 pasaj**, `moved=60`, **0,37 s** |
| 1. koşu sonrası veritabanı | 60 belge · 60 sürüm · 360 pasaj · 120 gömme işi · 60 anlık görüntü |
| 2. koşu (kuyruk boş — hepsi taşınmıştı) | `scanned=0 published=0 failed=0`, **1 ms** |
| 3. koşu (aynı 60 zarf yeniden konuldu) | `scanned=60 **published=0** skipped=60 unchanged=60 failed=0 chunks=0`, **0,12 s**; veritabanı sayıları **birebir aynı** |
| 4. koşu (aynı kimlik, değişmiş metin) | `published=1`; belgenin sürümleri `[eski → kapalı, yeni → açık]` |
| "resmî kaynak" etiketli sürüm | 61 / 61 |

**Yayımlanan metin gerçekten aranabilir hâlde.** Aynı veritabanında mevcut
Türkçe FTS şeridi (`chunks.search_tsv_tr`, `websearch_to_tsquery('turkish',…)`)
üzerinde dört deneme ifadesinden **ikisi** pasaj döndürdü
(`"ifa engeli"` → 41 pasaj, `"tazminat talebi"` → 41 pasaj; toplam 365 pasaj
içinde). Diğer ikisi (`"sözleşmenin feshi"`, `"haksız fesih"`) **0** döndürdü:
pasajlar metinde var, snowball `turkish` kökleyicisi çekimli biçimleri
eşleştiremedi. Bu **kökleyicinin** bilinen davranışıdır, yayımlayıcının değil —
ve bir iyileştirme iddiası olarak yazılmıyor, ölçülen hâliyle yazılıyor.

Gerileme takımı:

```
$ .venv/Scripts/python.exe -m pytest tests/ingestion/test_library.py -q
33 passed in 11.02s

$ .venv/Scripts/python.exe -m pytest tests/ingestion -q
112 passed in 35.68s

$ .venv/Scripts/python.exe -m pytest tests -q
1306 passed in 143.32s
```

**Testler boş değil — iki mutasyonla doğrulandı.** (a) `UNKNOWN_SCHEMA`
kontrolü devre dışı bırakıldığında 4 test düştü; (b) başarısız zarf
silinecek şekilde değiştirildiğinde 1 test düştü. İkisi de geri alındı ve
takım yeniden yeşil.

---

## 5. Avukata anlatımı

> **Her araştırma kütüphanenizi büyütür.**
> Bir kararın ya da mevzuatın tam metnini getirdiğinizde, o metin artık
> ekranda görünüp kaybolmuyor: **kendi diskinizde**, kendi veritabanınızda
> kalıyor. Nereden geldiği (hangi kurum, hangi bağlantı, hangi gün
> getirildiği) metinle birlikte saklanıyor.
>
> Aynı belgeyi ikinci kez getirirseniz ikinci bir kopya oluşmaz. Metin
> değişmişse eskisi silinmez — **yeni sürüm** olarak eklenir ve eskisi
> "artık geçerli değil" diye işaretlenir, yani bir kararın zaman içindeki
> hâlini de görebilirsiniz.
>
> Kütüphaneniz **kota tanımaz** ve **aboneliğe bağlı değildir**. Rakip
> ürünlerde arşiv onların sunucusundadır: aboneliğiniz biterse arşiv gider.
> Burada arşiv sizin bilgisayarınızdadır — internet olmasa da elinizdedir,
> yedeğini alabilirsiniz (`ColleX-Yedekle.cmd`), ve kimse geri alamaz.
>
> **Ne söz vermiyoruz:** kütüphaneniz *siz ne getirdiyseniz* o kadardır.
> Otomatik olarak milyonlarca karar inmez, hiçbir kapsam yüzdesi ya da
> doğruluk garantisi verilmez. Kütüphanedeki her belgenin yanında "resmî
> kaynak" ve getirilme günü yazar; test amaçlı üretilmiş örnek metinlerle
> **karışmaz**, ayrı işaretlidir.

---

## 6. Açık kalanlar — adıyla

1. **Otomatik çağrı yok.** Kuyruk kendiliğinden yayımlanmıyor; komut
   çalıştırılmalı. `ColleX-Baslat.cmd`, `serve.mjs` veya konsol bu şeridin
   dosyası değil (§7, IR-A).
2. **Atıf/citator kenarı üretilmiyor.** `relations.write_amendment_relations`
   değişiklik kenarlarını `structure_hints`'ten türetir; kütüphane zarfı
   yapılandırılmış değişiklik bilgisi taşımaz, dolayısıyla kütüphane
   belgeleri için **0 kenar** yazılır (0 çözümsüz kenar da yok — hiç ipucu
   yok demek, "aramayı başaramadık" değil). Kütüphane bugün **FTS ve tam
   künye** şeritlerini besliyor; citator şeridini beslemiyor.
3. **Anlık görüntü satırındaki `parser_name` "fixture-json" yazıyor.**
   `pipeline.py` `ensure_snapshot`'a ayrıştırıcı adı geçirmiyor ve
   `pipeline.py` bu şeridin dosyası değil. Denetim izinde kozmetik bir
   yanlışlık; verinin kendisini etkilemiyor. (§7, IR-B.)
4. **Gömme işleri yalnızca satır.** Mevcut davranış: `app_private.jobs`'a
   iş yazılır, yerel bir işçi/model çağrısı yoktur. Bu şerit bunu
   değiştirmedi.
5. **`/v1/health corpus.publicDocuments` artışı bu şeritte ölçülmedi.**
   Ölçüm `collex_ingest_test` üzerindeydi; `collex_local`'a yayım ve sağlık
   ucunun okuduğu sayının artışı, uçları çalıştıran şeridin işi.

---

## 7. Entegrasyon istekleri (sahip olmadığım dosyalar)

**IR-A · `ColleX-Baslat.cmd` / `control-plane/scripts/serve.mjs` (launcher
şeridi).** Kuyruğu düzenli yayımlamak için tek komut yeter — sunucu
başlarken ya da durduktan sonra:

```bat
.venv\Scripts\python.exe -m ingestion.cli ^
  --dsn postgres://postgres@127.0.0.1:55432/collex_local ^
  --publish-library "%COLLEX_DATA_DIR%\library" --json
```

Çıkış kodu 2, "en az bir zarf inmedi" demektir ve kullanıcıya
gösterilmelidir; **başlatmayı durdurmamalıdır** — cevap yolu kütüphaneden
bağımsız çalışıyor. `--dry-run` ile önce ne olacağı gösterilebilir.

**IR-B · `ingestion/pipeline.py` (boru hattı şeridi).** `ensure_snapshot`
çağrısına ayrıştırıcı adını `SourcePort`'tan alan bir geçiş eklenirse
(`parser_name=getattr(self.source, "parser_name", snapshot.PARSER_NAME)`),
kütüphane anlık görüntüleri denetim izinde doğru adla görünür. Veri
davranışı değişmez.

**IR-C · `docs/implementation/STATUS.md` (durum şeridi).** §4'teki ölçümler
"Ölçülen sayılar" tablosuna satır olarak eklenmeli (üretilmiş zarf uyarısı
dâhil). Bu şerit `STATUS.md`'ye dokunmadı.

**IR-D · `control-plane/src/sources/routes.ts` + `console.html` (kaynaklar /
konsol şeridi).** Kapsam manifestindeki `yerelKutuphaneAcik` artık
"kuyruk yazılıyor ama yayımlanmıyor" demek zorunda değil; yayımlanmış belge
sayısı okunabilir. **Ekranda büyüyen bir kütüphane ima edilmeden önce
gerçekten yayımlanmış olması gerekir** — ekran sağlık rozetine değil, uca
sormalı (W13-BACKLOG §G.3.4).

---

## 8. Kullanım

```bash
# Önce şema (bu komut veritabanını yaratır, asla düşürmez):
.venv/Scripts/python.exe -m intake.cli \
  --dsn postgres://postgres@127.0.0.1:55432/collex_local --ensure-db

# Ne yayımlanacak? (salt okunur, hiçbir şey yazmaz)
.venv/Scripts/python.exe -m ingestion.cli \
  --dsn postgres://postgres@127.0.0.1:55432/collex_local \
  --publish-library var/library --dry-run

# Yayımla:
.venv/Scripts/python.exe -m ingestion.cli \
  --dsn postgres://postgres@127.0.0.1:55432/collex_local \
  --publish-library var/library --json
```

Yayımlanan zarflar `var/library/yayimlandi/` altına taşınır. Reddedilen ya
da hata alan zarflar `var/library/` içinde **kalır**; hataları raporda
adlarıyla yazılıdır ve sorun giderildikten sonra komutu yeniden çalıştırmak
yeterlidir.
