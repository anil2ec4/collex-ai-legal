# W14 — L-EVID: alıntı bütünlüğü, dosyalanabilir çıktı, atıf denetimi

**Hat:** L-EVID (Faz A) · **Kalemler:** B-01, B-02, B-13, B-24, B-30 (paket
kısmı), B-36 (kayıt kısmı) · **Tarih:** 02.09.2026 · **Probe portu:** 8941 ·
**Probe veritabanı:** `collex_evid_test` — **kurulmadı ve kullanılmadı**
(bu hattın hiçbir kalemi veritabanına dokunmuyor; tek bir SQL sorgusu
çalıştırılmadı).

Bu belgedeki her sayı bu koşuda ölçüldü. Hiçbiri hukukî kalite ölçüsü
değildir: bütün fixture içeriği **SENTETİK**tir.

---

## 0. Özet

| Kalem | Durum | Tek cümlelik sonuç |
|---|---|---|
| **B-01** Alıntı bütünlüğü kapısı | **İNDİ** | Paragraf, atıf yaptığı alıntıyı NFC-kanonik biçimde **birebir** içermek zorunda; içermiyorsa PUT `QUOTE_ALTERED` der, paragraf KAYNAKSIZ'a düşer, `md/docx/udf` dışa aktarımı **reddedilir** ve hiçbir dosya yazılmaz. |
| **B-02** Dosyalanabilir çıktı | **İNDİ** | `annex=full\|none` + `marks=all\|none` (ikisi de additive, varsayılan bugünkü davranış); A4 21×29,7 cm, ortalanmış mahkeme hitabı, sağa yaslı imza, iki yana yaslı gövde, gerçek `bold`; nihai kopyada `⚠ KAYNAKSIZ`, `[K-n]`, SHA-256, şema etiketi ve kural kimliği **0 kez**. |
| **B-13** Atıf Denetim Raporu | **İNDİ (sunucu tarafı)** | `POST /v1/citation-audit` (üç kova + as-of + boş künye kuralı) ve `GET /v1/drafts/{id}/export?format=denetim-docx`; DOCX raporu `export/audit.py`. Konsol tablosu Faz B (L-CONSOLE). |
| **B-24** Sözleşme/kontrol listesi incelemesi | **İNDİ (sunucu tarafı)** | `POST /v1/contracts/review` + kayıtlı kontrol listeleri; VAR/YOK/BELİRSİZ; "risk" kelimesi yalnız hash'li alıntıya bağlı satırda kalabiliyor. |
| **B-30** Dosya paketi (paket kısmı) | **KISMEN İNDİ** | `export/package.py` + `--package` CLI: dört klasör + `MANIFEST.json`, her sha256 arşivin içinde yeniden doğrulanıyor, doğrulanamayan tek atıfta **paket yazılmıyor**. HTTP ucu L-MATTER'ın verilerine bağlı → §7 entegrasyon isteği. |
| **B-36** Doğrulama kontrol listesi (kayıt kısmı) | **İNDİ (kayıt + rapor)** | Üç kutu taslak sürümüne yazılıyor, sürümler arası taşınıyor; işaretlenmemişken her çıktıda "doğrulama tamamlanmadı" satırı; denetim raporunda inceleyen/tarih/not sütunu. Kutuların arayüzü Faz B. |

**Kapı 2 (B-01 + B-02 birlikte) gerçek uçtan uca koşuldu ve 11/11 geçti** — §3.

---

## 1. B-01 · Alıntı bütünlüğü kapısı

### 1.1 Ne yapıldı

Yeni dosya **`control-plane/src/drafting/quoteIntegrity.ts`**: iki runtime'ın
üzerinde anlaştığı tek kanonik karşılaştırma biçimi ve kapının kendisi.

Kanonikleştirme (Python aynası: `export/draft.py::canonical_quote_text` —
**ikisi birlikte değişir, yoksa hiç değişmez**):

1. render guard'ın ürettiği varlık kaçışları geri katlanır
   (`&lt;` `&gt;` `&#40;` `&#58;` `&#46;` ve en sonda `&amp;`) — paragraf
   metni `sanitizeMarkdown`'dan geçmiştir, `evidence.quote` ham saklanır;
2. görünmez/BiDi karakterler atılır (görünmeyen bir karakter atfın geçerli
   olup olmadığına karar veremez);
3. NFC normalize edilir (ADR-003);
4. boşluk dizileri tek boşluğa iner, kırpılır.

Başka hiçbir şey affedilmez: **bir harf, bir rakam, bir kelime değişirse bağ
kopar.** Hiçbir yerde `.length`/`.slice` aritmetiği yok; karşılaştırma alt
dizgi aramasıdır.

| Katman | Dosya | Ne değişti |
|---|---|---|
| Besteci | `src/drafting/composer.ts` | Yeni `evidenceBindingHolds()` (tam kapsama). `assessmentParagraph` artık bunu kullanıyor. `evidenceOverlaps` (0,7 eşiği) **silinmedi** — alıntı DIŞI cümleler için doğru ölçü olduğundan duruyor ve testli. |
| Düzenleme | `src/drafting/revise.ts` | `lexical` bağlama artık tam kapsama arıyor; başarısızsa `ReviseIssue` **yeni `code` alanıyla** `QUOTE_ALTERED` taşıyor, mesaj `K-n` ile Türkçe. |
| HTTP | `src/drafting/routes.ts` | `findAlteredQuotes(draft)` **her biçimden önce** koşuyor. Markdown TypeScript'te üretildiği için Python doğrulamasına hiç uğramıyordu — kapı buradan geçiyordu. |
| İhracat | `export/draft.py::verify_draft_or_refuse` | Kimlik kapanışına ek olarak **paragrafın alıntıyı hâlâ içerdiği** denetleniyor; bulgu `alıntı değiştirildi — kanıt bağı koptu (QUOTE_ALTERED)`. |

Kapı **iki bağımsız katmanda** duruyor ve bu bilinçli: PUT yolu bağı anında
koparıyor; export kapısı, mağazaya başka bir yoldan girmiş (B-01 öncesi
kaydedilmiş ya da doğrudan yazılmış) bir taslağı yakalıyor.

### 1.2 KABUL kanıtı

UXAUDIT P0-1'in **iki mutasyonu da ayrı ayrı** test ediliyor; her biri iki
kez: önce **eski sözcüksel kapının hâlâ "sorun yok" dediği** ispatlanıyor
(regresyon geri gelemesin), sonra yeni kapının reddettiği.

`control-plane/tests/drafting/quoteIntegrity.test.ts` — 10 test:

```
✓ tests/drafting/quoteIntegrity.test.ts (10 tests) 142ms
```

- `evidenceOverlaps("… beş yıldan on yıla …", QUOTE_157) === true`
  (kelimeyle yazılı ceza, `extractNumbers` görmez) ·
  `evidenceBindingHolds(...) === false`
- `MADDE 157 → 158`: künyede "157" durduğu için eski sayı denetimi geçiyor;
  yeni kapı reddediyor
- PUT sonrası: `issues[].code === "QUOTE_ALTERED"`, mesajda
  `alıntı değiştirildi — kanıt bağı koptu` ve `K-1`; paragraf
  `supported:false`, `note: KAYNAKSIZ`
- `md`, `docx`, `udf` üçü de **409 `EXPORT_REFUSED`**, `error.code =
  QUOTE_ALTERED`; **dışa aktarıcı süreç hiç başlatılmıyor** (`spawned === 0`)
- Bozulmamış taslakta hiçbir davranış değişmiyor (`findAlteredQuotes → []`,
  `unsupportedCount` aynı, `md` 200 ve `Dayanak [K-1]` içeriyor)

`tests/export/test_cli.py` — 6 yeni test (2 mutasyon × 2 biçim + 2 sağlamlık):

```
.venv/Scripts/python.exe -m pytest tests/export/test_cli.py -q
16 passed in 0.65s
```

Her biri: `main([... "--format", "dilekce-docx|dilekce-udf"]) == 2`,
`not out.exists()`, `tmp_path.glob("*.tmp") == []`, stderr'de `QUOTE_ALTERED`
+ `alıntı değiştirildi — kanıt bağı koptu` + `[K-1]`.

### 1.3 Değiştirilen mevcut testler (hiçbiri zayıflatılmadı)

| Dosya | Ne değişti | Neden |
|---|---|---|
| `tests/drafting/composer.test.ts` | `warnings` iddiası `"örtüşmüyor"` → `"birebir yer almıyor"` | Uyarı metni bilinçli değişti; davranış iddiası (paragraf KAYNAKSIZ'a düşer) aynen duruyor. |
| `tests/drafting/revise.test.ts` (2 test) | mesaj metni yerine `i.code === QUOTE_ALTERED` | Aynı davranış, artık makine koduyla; ek olarak Türkçe mesaj da ayrıca iddia ediliyor. |
| `tests/drafting/routes.test.ts` | `issues[].message.includes("örtüşmesi")` → `code === "QUOTE_ALTERED"` | Aynı. |
| `tests/export/test_petition_docx.py::make_contrary_draft` | Karşı içtihat paragrafının metni, bestecinin gerçekten ürettiği biçime çevrildi (`<künye> — "<alıntı>"`) | **Fixture düzeltmesi, iddia değişikliği değil.** Eski metin (`… — ÖZET: …`) K-2'ye atıf yapıyordu ama alıntısını içermiyordu — yani bestecinin hiç üretmediği, tam da kapının reddettiği bir durum. Testin bütün iddiaları (K-2 asla "Dayanak" okunmaz, `Yönü: karşıt`, uyarı notu) olduğu gibi duruyor. |

---

## 2. B-02 · Dosyalanabilir çıktı

### 2.1 İki additive anahtar

`GET /v1/drafts/{id}/export` iki yeni sorgu parametresi alıyor. **İkisi de
opsiyonel ve varsayılanları bugünkü davranış** — mevcut hiçbir istemci
etkilenmiyor.

| Parametre | Değerler | Ne yapar |
|---|---|---|
| `annex` | `full` (varsayılan) · `none` | `none`: künye tablosu, `Uyarılar` listesi, `EK — DOĞRULAMA BİLGİLERİ` bölümü, `DAYANAK KAYNAKLARI` eki ve biçim notları yazılmaz; gövde atıf satırı `Dayanak [K-n]: …` yerine `Dayanak: <künye>` olur (gösterecek ek yokken makine numarası anlamsızdır). Kanıt/hash paketi **ayrı dosya** olarak (`export/bundle*.py`) durmaya devam eder. |
| `marks` | `all` (varsayılan) · `none` | `none`: yalnız ekran işaretleri (`⚠ KAYNAKSIZ — ` ön eki ve `Not: …` satırları) yazılmaz. |

`annex=none&marks=none` = **nihai dosyalama kopyası**; dosya adı
`… - v3 - NİHAİ.docx`, başlık `(NİHAİ)`. Diğer her kombinasyon `TASLAK`.

**Kapıya dokunmayan tarafı (tuzak §C.2):** `verify_draft_or_refuse` — alıntı
hash'leri, atıf kapanışı, KAYNAKSIZ sayımı ve B-01 bütünlük denetimi — her
modda aynı koşuyor. `marks=none` doğrulanamayan bir taslağı **yine
reddediyor** (§2.3'te ölçüldü). Zorunlu inceleme bandı ve altbilgi her modda
duruyor: mürekkebi kaldırmak disiplini kaldırmaz.

### 2.2 Biçim düzeltmeleri (her modda)

| DAILYFLOW bulgusu | Ne yapıldı |
|---|---|
| #2 Sayfa US Letter | `export/petition.py::_apply_page_geometry` — A4 21,0 × 29,7 cm; kenar 2,5 cm (üst 3,0 cm, mahkeme kaşesi için). |
| #3 236/236 paragrafta `bold=False`, `alignment=None` | Stiller zaten kalın/hizalı idi ama Word ve python-docx **miras alınan** değeri `None` okuyor. Artık her paragraf hizalamasını, her kalın run `bold=True`'yu **doğrudan** taşıyor. Mahkeme hitabı `CENTER`, imza `RIGHT`, gövde `JUSTIFY`, TARAFLAR etiketleri kalın. |
| #3 UDF'de `Alignment` hepsinde 0 | `UdfLine.alignment`: başlık 1 (orta), imza 2 (sağ), gövde/KAYNAKSIZ 3 (iki yana). Üç çıktı, **tek biçim sözleşmesi**. |
| #7 "kiracı yüklemesi" | `src/drafting/appendix.ts` → **"yüklediğiniz belge"** (COPY M1: "tenant" veritabanı terimi; kira dosyasında "kiracı" karşı taraf demek, ticari alacak ihtarnamesinde ortada kiracı yok). |
| #9 UDF gövdesinde `collex.export.evidence-report/v1` | `petition.py` ve `udf.py` artık `ColleX export 1.0.0` yazıyor; kanıt paketi şeması bu belgenin şeması değil. |

### 2.3 KABUL kanıtı — gerçek DOCX'ten okunmuş

`tests/export/test_filable_output.py` — 19 test:

```
.venv/Scripts/python.exe -m pytest tests/export/test_filable_output.py -q
19 passed in 2.67s
```

Ve §3'ün gerçek HTTP koşusunun ürettiği dosyalar, `python-docx` ile
okunarak (`scratchpad/w14-L-EVID/docx_probe.py`):

```
=== 1-taslak.docx (39746 B) ===            === 2-nihai.docx (38689 B) ===
  sayfa: 21.00 x 29.70 cm                    sayfa: 21.00 x 29.70 cm
  paragraf: 45 · kalın run: 10               paragraf: 27 · kalın run: 7
  CENTER: 1 · RIGHT: 3 · JUSTIFY: 9          CENTER: 1 · RIGHT: 3 · JUSTIFY: 8
  '⚠ KAYNAKSIZ': 0                           '⚠ KAYNAKSIZ': 0
  'kiracı yüklemesi': 0                      'kiracı yüklemesi': 0
  'collex.export.': 0                        'collex.export.': 0
  'dava-dilekcesi': 1                        'dava-dilekcesi': 0
  '[K-1]': 3                                 '[K-1]': 0
  'Alıntı SHA-256': 1                        'Alıntı SHA-256': 0
  'Kanıt kimliği': 1                         'Kanıt kimliği': 0
  64-hex sha: 2                              64-hex sha: 0
  gövde bayt: 3720                           gövde bayt: 1813
```

KABUL satır satır: `page_width` 21 cm ✓ · mahkeme hitabı `CENTER` ✓ · en az
bir `bold=True` run ✓ (7) · `"⚠ KAYNAKSIZ"`, `"kiracı yüklemesi"`,
`"collex.export."` ve `hmk-istinaf`/`dava-dilekcesi` gibi kural kimlikleri
**0 kez** ✓ · gövde/ek oranı: nihai kopyada ek yok, **%100 gövde** ✓ ·
çıktı 38,7 KB ≤ 40 MB ✓.

`annex=full&marks=all` regresyonu: `test_full_mode_keeps_every_annex_entry_and_every_mark`
— numaralandırma `((1,"ev-tck157"),(2,"ev-karsit-1"))`, `citation_refs`
`("K-1","K-2")`, KAYNAKSIZ sayısı taslağın dediği kadar, her kanıtın
`Alıntı SHA-256:` satırı belgede. `test_cli_defaults_are_todays_behaviour`
ayrıca varsayılan çağrı ile açık `--annex full --marks all` çağrısının
**okunan raporunun birebir eşit** olduğunu ispatlıyor.

Kapı testi: `test_marks_none_still_refuses_an_unverifiable_draft` —
`--annex none --marks none` ile bozuk hash'li taslak → çıkış 2, dosya yok.

### 2.4 Bilinçli sapma (KABUL'ün lafzından)

KABUL "`annex=full&marks=all` bugünkü baytların **birebir aynısı**" diyor.
Bunu harfiyen uygulamak A4 ve hizalama düzeltmelerini (aynı kalemin "Nasıl"
bölümünün emrettiği işi) imkânsız kılardı. **Uygulanan yorum:** biçim
düzeltmeleri (A4, kalın, hizalama, "yüklediğiniz belge", şema etiketinin
kalkması) **her modda** geçerlidir; `annex`/`marks` yalnız **içeriği**
yönetir. Bu yüzden `annex=full&marks=all` bayt bazında değişmiştir; **içerik
bazında** hiçbir şey kaybetmez ve bu regresyon testle sabitlenmiştir
(§2.3). Sapma bilinçlidir ve burada kayıtlıdır.

---

## 3. Kapı 2 — B-01 + B-02 uçtan uca gerçek koşu

`scratchpad/w14-L-EVID/e2e.mjs`: **gerçek HTTP sunucusu** (`@hono/node-server`,
127.0.0.1:**8941**), gerçek drafting router, gerçek venv Python dışa
aktarıcısı. Veritabanı yok, `collex_local`'a dokunulmadı.

```
  taslak: v1 · kanıt=1 · kullanılmayan=0 · bağlı paragraf=2
PASS  adım 2 · bozulmamış taslak DOCX olarak dışa aktarılıyor — 200, 39746 B
PASS  adım 3 · PUT alıntı bozulmasını QUOTE_ALTERED olarak bildiriyor — v2, issues=["QUOTE_ALTERED","QUOTE_ALTERED"]
PASS  adım 3 · bozulan paragraf artık kanıta bağlı değil (KAYNAKSIZ) — bağlı paragraf: 0
PASS  adım 4 · kayıtlı bozuk taslak: export?format=md REDDEDİLDİ — 409 EXPORT_REFUSED
PASS  adım 4 · kayıtlı bozuk taslak: export?format=docx REDDEDİLDİ — 409 EXPORT_REFUSED
PASS  adım 4 · kayıtlı bozuk taslak: export?format=udf REDDEDİLDİ — 409 EXPORT_REFUSED
PASS  adım 4 · marks=none de kapıyı geçemiyor — 409
PASS  adım 5 · alıntı geri konunca kanıt bağı yeniden kuruluyor — v3, bağlı=2
PASS  adım 5 · onarılmış taslak yeniden dışa aktarılıyor — 200, 39771 B
PASS  adım 6 · nihai kopya 200 ve dosya adı NİHAİ — attachment; filename="Dava Dilekcesi - v3 - NIHAI.docx"; filename*=UTF-8''Dava%20Dilek%C3%A7esi%20-%20v3%20-%20N%C4%B0HA…
PASS  adım 7 · Atıf Denetim Raporu üretiliyor — 200, 37896 B

11/11 kontrol geçti
```

Adım 4'ün senaryosu şudur ve kayda geçmesi önemlidir: **PUT yolu artık bağı
anında kopardığı için**, "çip sağlam + alıntı bozuk" durumu ancak
**kayıtlı** bir taslakta olabilir (B-01 öncesi kaydedilmiş sürüm ya da
doğrudan mağaza yazımı) — yani UXAUDIT'in ölçtüğü durumun ta kendisi. Koşu bu
durumu mağazaya yazıp üç biçimin de reddettiğini ispatlıyor.

Sunucu kapatıldı; `netstat` 8941'de **LISTENING yok** (yalnız TIME_WAIT
soketleri). `var/*.pid` **yaratılmadı** (bu hat `serve.mjs` çalıştırmadı).

---

## 4. B-13 · Atıf Denetim Raporu

### 4.1 Üç kova ve boş hücre kuralı

Yeni `control-plane/src/contracts/citationAudit.ts`:

| Kova | Makine kodu | Anlamı (raporda birebir yazılı) |
|---|---|---|
| bulundu | `FOUND` | Kaynak bulundu ve künyesi doğrulandı. |
| bulunamadı | `NOT_FOUND` | Bu atıf, taradığımız kaynaklarda bulunamadı. Uydurulmuş bir künye olabilir; kaynağı elle teyit edin. |
| belirsiz | `UNCERTAIN` | Karar verilemedi: kapsam dışında, kaynağa erişilemedi ya da referans eksik. **Kaynağın yokluğu anlamına gelmez.** |

**Bozulamayacak kural:** çözümlenemeyen atıfın `kunye` alanı `""`'dir —
motor asla künye üretmez, yazıcı asla o hücreye bir şey koymaz, ve DOCX
self-check bunu **arşivin kendisinde** doğrular.

Ayrıca:
- `asOf` **zorunlu** ve `YYYY-AA-GG` olmak zorunda; yürürlük **dilekçenin
  tarihine** göre değerlendirilir, bugüne göre değil. Raporun başlığında
  "Yürürlük durumu 01.06.2026 tarihine göre değerlendirilmiştir." yazar.
- Çözümleyici (resolver) **enjekte edilir**. Bağlanmamış bir kurulumda
  varsayılan `UNWIRED_RESOLVER` her satıra **belirsiz** der; asla
  "bulunamadı" demez — bakmadığımız için bir atıfı uydurmakla suçlamayız.
- Çözümleyici hata fırlatırsa satır **belirsiz** olur, "bulunamadı" değil.
- Alıntı denetimi **hash karşılaştırmasıdır** (sha256/UTF-8), benzerlik
  puanı değil. Kaynak var ama iddia edilen alıntı tutmuyorsa satır
  **belirsiz** ve gerekçesi yazılır.

### 4.2 Uçlar ve rapor

- `POST /v1/citation-audit` — karşı tarafın dilekçesi (metin ya da hazır atıf
  listesi) → satırlar (§6 UI sözleşmesi).
- `POST /v1/citation-audit/preview` — lookup harcamadan "ne denetlenecek".
- `GET /v1/drafts/{id}/export?format=denetim-docx` — **kendi taslağımızın**
  raporu; çözümleyiciye gerek yok, çünkü taslaktaki her atıf zaten hash'li
  bir kanıt kaydıdır (`src/contracts/draftAudit.ts`). Hash tutmuyorsa,
  kaynak gövdede kullanılmıyorsa ya da alıntı bağı koptuysa satır
  **belirsiz** olur ve gerekçesi yazılır.
- `export/audit.py` — `collex.citation-audit/v1` → DOCX; A4, tablo, durum
  sözlüğü, "boş künye" kuralı yazılı, B-36 inceleyen/tarih/not sütunu.
  Yazılan dosya **yeniden açılıp** doğrulanır (satır sayısı, künye hücreleri,
  sözlük, dürüstlük cümleleri); tutmuyorsa dosya silinir.
- `export.cli --audit <json> --out <docx> --format denetim-docx`.

### 4.3 KABUL kanıtı

```
npx vitest run tests/drafting/contracts.test.ts     21 passed
.venv/Scripts/python.exe -m pytest tests/export/test_audit_report.py -q   11 passed
```

- **5 atıflı sentetik dilekçe** (`PETITION`) → tek istekle ≥5 satır
  (`test: audits a petition in one request`, `body.rows.length >= 5`)
- her satırın yürürlük rozeti `asOf`'a göre (`report.asOf === "2026-06-01"`)
- bulunamayan atıf açıkça "bulunamadı" diyor ve **künye hücresi boş**
  (`test_unresolved_citations_render_an_empty_kunye_cell`, DOCX tablosundan
  okunarak: `not_found[2] == ""`, `uncertain[2] == ""`)
- rapor DOCX olarak iniyor; `_self_check` geçmezse dosya yazılmıyor
  (`test_self_check_refuses_a_report_whose_rows_would_be_lost` — bozuk yazıcı
  → `ExportRefused`, `not out.exists()`, `*.tmp` yok)
- §3 adım 7: gerçek HTTP üzerinden `format=denetim-docx` → 200, 37 896 B

---

## 5. B-24 · Sözleşme / kontrol listesi inceleme motoru

`control-plane/src/contracts/clauseReview.ts` — **tamamen kural tabanlı**,
model yok, bulut yok.

- `splitClauses(text)`: `MADDE 5` / `5.` / `5.2.` gibi madde işaretlerinden
  böler; ilk işaretten önceki metin numarasız bir madde olur (hiçbir şey
  sessizce düşmez).
- `runChecklist(clauses, checklist)`: avukatın kendi yazdığı başlıklar
  (`terms` / `weakTerms`) madde metinlerinde aranır → **VAR / YOK /
  BELİRSİZ** + eşleşen madde numaraları + **hangi ifadeyle eşleştiği**.
- **"Risk" kelimesinin tek sahibi hash'li alıntıdır.** Bir gözlemin
  `evidenceId`'si `sha256(quote) == quoteSha256` doğrulamasından geçen bir
  kayda çözülmüyorsa satır `⚠ KAYNAKSIZ — ` ön ekiyle yazılır **ve "risk"
  kelimesinin bütün Türkçe çekimleri metinden silinir** (`riski`, `riskli`,
  `risklerin` → `gözlem`). Bağlamdan koparıldığında bile bir risk
  değerlendirmesi gibi okunamaz.
- **`YOK`'un anlamı raporda yazılıdır:** "Bu başlık, incelenen metinde
  BULUNAMADI. Bu, maddenin hukuken zorunlu olduğu ya da sözleşmenin sakat
  olduğu anlamına gelmez — değerlendirme avukatındır."

Uçlar: `POST /v1/contracts/review`, `GET /v1/contracts/checklists`,
`PUT /v1/contracts/checklists/{id}`.

### KABUL kanıtı (`tests/drafting/contracts.test.ts`)

- **10 maddelik sentetik kira sözleşmesi** + 10 başlıklı kontrol listesi →
  her başlık üç durumdan birini alıyor (`findings` 10 satır,
  `VAR+YOK+BELİRSİZ === 10`)
- depozito → `VAR` (madde 4); artış oranı → `VAR`; tahliye taahhüdü, damga
  vergisi, kefil → `YOK`
- kaynaksız gözlem `⚠ KAYNAKSIZ` etiketi taşıyor ve "risk" kelimesini
  **kullanmıyor**; hash'i tutmayan kaynağa dayanan gözlem de aynı şekilde
  düşürülüyor
- kullanıcı kontrol listesi kaydediliyor (`PUT`), listeleniyor (`GET`) ve
  **ikinci bir sözleşmede yeniden koşuyor**

**Eksik kalan (dürüstlük):** B-24'ün "çıktı DOCX olarak iner" kısmı
uygulanmadı — §8 açık madde.

---

## 6. B-36 · Dosyalama öncesi doğrulama kaydı (kayıt kısmı)

Üç kutu, taslak **sürümüne** yazılıyor:

| id | Türkçe etiket |
|---|---|
| `citationsOpened` | Her [K-n] kaynağını açıp okudum |
| `unsupportedReviewed` | Her ⚠ KAYNAKSIZ paragrafı gözden geçirdim |
| `contraryRead` | KARŞI İÇTİHAT bölümünü okudum |

Ayrıca `evidenceReview`: `evidenceId → {checked, at, by, note}` — kanıt
başına kalıcı inceleme durumu.

- Zaman damgası **sunucunun saatidir**, istemcinin değil — kaydın bütün
  değeri budur.
- Kayıt sürümler arasında taşınır; hiçbir şey söylemeyen bir `PUT` kaydı
  korur, bir kutuyu kaldırmak belgeyi yeniden açar.
- Bilinmeyen bir kutu **yok sayılır ve bildirilir**, asla uydurulmaz.
- **Dışa aktarımı engellemez.** İşaretlenmemişken her çıktıda (DOCX, UDF,
  Markdown, denetim raporu) şu satır çıkar:
  > Doğrulama tamamlanmadı: bu belgedeki kaynaklar, KAYNAKSIZ paragraflar ve karşı içtihat avukat tarafından tek tek onaylanmadan dışa aktarıldı.
- Dürüstlük sınırı, her yüzeyde birebir:
  > Bu kayıt bir doğrulama değildir: sistem doğrulamaz, avukatın doğruladığını kaydeder.

KABUL kanıtı: `tests/drafting/exportMode.test.ts` (5 test) +
`tests/export/test_filable_output.py` (6 test) + `test_audit_report.py`
(1 test). İşaretlenmeden dışa aktarılan belgede satır **var**;
işaretlendiğinde satır **yok**; denetim raporunda inceleyen/tarih/not
görünüyor; kayıt yeni sürüme taşınıyor.

**Eksik kalan:** "Alıntı ekle" penceresinde elenmiş kanıtın gerekçe rozeti —
o pencere `console.html`'de, L-CONSOLE'un (Faz B). §7 entegrasyon isteği.

---

## 7. B-30 · Dosya paketi (paket kısmı)

`export/package.py` — `collex.matter-package/v1` planından ZIP:

```
dosya-ozeti.docx          künye, taraflar, kronoloji, süreler, notlar
belgeler/                 ASIL yüklenen dosyalar, bayt bayt
taslaklar/                her taslağın son sürümü, DOCX
arastirmalar/             her cevabın kanıt paketi (JSON + DOCX)
MANIFEST.json             her girdinin sha256'sı + üretim künyesi + uyarı
```

Sertlik:
- Her asıl, arşive girmeden önce planın söylediği sha256 ile **yeniden
  hesaplanarak** doğrulanır; tutmuyorsa `ASIL_BOZUK`, paket yazılmaz.
- Taslaklar `export.petition` üzerinden üretilir → `verify_draft_or_refuse`
  (B-01 dâhil) koşar; **tek bir doğrulanamayan alıntı bütün paketi
  reddettirir**.
- Arşiv yazıldıktan sonra **yeniden açılır** ve her manifest özeti arşivin
  içinden yeniden hesaplanır; manifestte olmayan bir girdi de hatadır.
- `verify_package(path)` — alıcının bağımsız doğrulaması: bu sistemden
  hiçbir şeye ihtiyaç duymaz, yalnız arşive bakar.
- Plan içindeki dosya adları yol ayıracı / `..` / sürücü harfi içeremez
  (zip-slip kapalı).

CLI: `export.cli --package <plan.json> --out <paket.zip> --format dosya-paketi-zip`.

### KABUL kanıtı (`tests/export/test_matter_package.py`, 10 test)

2 belge + 2 cevap + 1 taslak (v2) + özet → dört klasör ve `MANIFEST.json`;
`verify_package() == []`; asıllar **bayt bayt** geri geliyor
(`archive.read(...) == source.read_bytes()`); alıntı bozulmuş taslakta
`ExportRefused` + `QUOTE_ALTERED` + `not out.exists()` + `*.tmp` yok;
kurcalanmış arşivde `GIRDI_OZETI` bulgusu.

**KISMEN:** HTTP ucu (`POST /v1/matters/{id}/package` benzeri) bu hatta
**yapılmadı** — künye/taraflar/kronoloji/süreler L-MATTER'ın matter
mağazasında, asıl baytlar L-MATTER'ın files lane'inde. §9 entegrasyon
isteğinde tam sözleşme var; paketleyicinin kendisi hazır ve testli.

---

## 8. Faz B için tam UI sözleşmesi (L-CONSOLE)

Faz A'da `console.html`'e **dokunulmadı**. Aşağıdakiler Faz B'de bağlanacak.

### 8.1 B-02 — "Nihai kopya indir" (belge/taslak ekranı)

- **Uç:** `GET /v1/drafts/{id}/export?format=docx|md|udf&annex=none&marks=none`
- **Varsayılan (bugünkü düğme):** parametresiz çağrı — davranış değişmedi.
- **Yanıt:** 200 + dosya; `Content-Disposition` ASCII `filename` ve
  RFC 5987 `filename*`; nihai kopyada ad `<Belge> - <Dosya> - v<N> - NİHAİ.<ext>`.
- **Türkçe etiketler:**
  - Düğme: **"Nihai kopyayı indir (dosyalanabilir)"**
  - Yanındaki ikinci düğme: **"Denetim kopyasını indir (kaynaklı)"**
  - Açıklama satırı: *"Nihai kopya yalnız dilekçe gövdesini içerir; kaynak
    listesi ve SHA-256 özetleri ayrı 'kanıt paketi' dosyasındadır."*
  - UYAP uyarısı (B-27 ile uyumlu): *"UYAP yalnız .udf/.pdf/.jpg/.png/.tiff
    kabul eder; Word yüklenemez."*
- **Hata:** `400 INVALID_REQUEST` (geçersiz `annex`/`marks` değeri) —
  `error.message` doğrudan gösterilebilir.

### 8.2 B-01 — dışa aktarım reddi (YENİ DURUM KODU)

- **Uç:** aynı export ucu · **Durum: `409`** (yeni; mevcut `500
  EXPORT_REFUSED` duruyor, bu ondan farklı ve istemci hatası değil, taslak
  durumu hatasıdır)
- **Gövde:**
  ```json
  { "error": {
      "kind": "EXPORT_REFUSED",
      "code": "QUOTE_ALTERED",
      "message": "Dışa aktarma REDDEDİLDİ: alıntı değiştirildi — kanıt bağı koptu (QUOTE_ALTERED). …",
      "paragraphs": [{ "paragraphId": "p-sebepler-6", "sectionId": "hukuki-sebepler", "ref": "K-1" }],
      "detail": "Ayrıntı sunucu günlüğüne yazıldı (kayıt no: …).",
      "correlationId": "…" } }
  ```
- **Ekran davranışı:** `error.message` gösterilir; `paragraphs[]` kullanılarak
  editörde ilgili paragraflar işaretlenir ve **"Alıntıya dön"** bağlantısı
  verilir. Kod tek başına gösterilmez, Türkçe cümleden sonra parantez içinde.

### 8.3 B-01 — PUT yanıtındaki `issues`

`PUT /v1/drafts/{id}` yanıtı `issues: [{path, message, code?}]`. `code ===
"QUOTE_ALTERED"` olan satırlar editörde **kırmızı** gösterilmeli ve chip
kırılmalı. `path` `sections.<i>.paragraphs.<j>.evidenceIds` biçimindedir.

### 8.4 B-36 — üç kutu (editör kenar çubuğu)

- **Uç:** `PUT /v1/drafts/{id}` gövdesine additive:
  ```json
  { "sections": [...],
    "reviewChecklist": {
      "citationsOpened":     { "checked": true, "by": "Av. Ayşe Yılmaz" },
      "unsupportedReviewed": { "checked": true },
      "contraryRead":        { "checked": true, "note": "Aleyhe karar yok." } },
    "evidenceReview": { "<evidenceId>": { "checked": true, "by": "…", "note": "…" } } }
  ```
- **Yanıt alanları:** `draft.reviewChecklist`, `draft.evidenceReview`
  (`{checked, at, by?, note?}`; `at` **sunucunun** ISO damgası).
- **Türkçe etiketler (birebir):**
  1. "Her [K-n] kaynağını açıp okudum"
  2. "Her ⚠ KAYNAKSIZ paragrafı gözden geçirdim"
  3. "KARŞI İÇTİHAT bölümünü okudum"
- **Kutuların altına, birebir:** *"Bu kayıt bir doğrulama değildir: sistem
  doğrulamaz, avukatın doğruladığını kaydeder."*
- **Uyarı satırı (üçü işaretli değilken):** *"Dışa aktarılan belgede
  'doğrulama tamamlanmadı' satırı çıkacak."*

### 8.5 B-13 — "Bu dilekçedeki bütün atıfları denetle"

- **Uç:** `POST /v1/citation-audit`
- **Gövde:** `{ "text": "<dilekçe metni>", "asOf": "2026-06-01",
  "matterId": "...", "documentTitle": "..." }` — **`asOf` zorunludur ve
  dilekçenin tarihidir**; konsol bugünkü tarihi göndermez, belge tarihini
  sorar/çıkarır.
- **Yanıt:** `{ schema, asOf, documentTitle, generatedAt, rows[], totals{FOUND,NOT_FOUND,UNCERTAIN}, reviewComplete, notices[] }`
- **`rows[]` alanları → sütunlar:**

  | Alan | Sütun başlığı | Not |
  |---|---|---|
  | `raw`, `count` | Atıf | `count > 1` ise "(3×)" |
  | `bucketLabel` | Durum | `bulundu` yeşil · `bulunamadı` **kırmızı** · `belirsiz` **gri** — üçü ayrı renk, ikisi asla aynı |
  | `reason` | Durum altı küçük satır | yalnız `belirsiz`de dolu |
  | `kunye` | Künye | **BOŞSA HÜCRE BOŞ BIRAKILIR** — asla "?" , "—", "bilinmiyor" ya da tahmin yazılmaz |
  | `currencyLabel` | Yürürlük | başlıkta "…tarihine göre" yazılır |
  | `quoteVerifiedLabel` | Alıntı | |
  | `contrary[]` | Aleyhe kayıt | `kunye` + `note` |
  | `review` | İnceleyen / tarih / not | `reviewed:false` → "incelenmedi" |
  | `href` | "Tam metne git" | boşsa bağlantı gösterilmez |

- **Zorunlu açıklama kutusu (`notices[]` birebir basılır)** — özellikle:
  *"'bulunamadı' taradığımız kaynaklarda yok demektir; 'belirsiz'
  kapsamımızın dışında ya da kaynağa erişilemedi demektir — ikisi aynı şey
  değildir."*
- **Ön izleme:** `POST /v1/citation-audit/preview` `{text}` →
  `{citations:[{raw,count}]}` — "N atıf bulundu, denetlensin mi?"
- **Rapor indirme:** `GET /v1/drafts/{id}/export?format=denetim-docx`
  (kendi taslağımız için). Düğme: **"Atıf Denetim Raporunu indir"**.

### 8.6 B-24 — sözleşme incelemesi

- **Uçlar:** `POST /v1/contracts/review` ·
  `GET /v1/contracts/checklists` · `PUT /v1/contracts/checklists/{id}`
- **İnceleme gövdesi:** `{ text, checklistId | checklist, documentTitle?,
  evidence?[], observations?[] }`
- **Yanıt:** `{ schema, documentTitle, checklistId, checklistTitle,
  generatedAt, clauseCount, findings[], clauses[], totals{VAR,YOK,BELIRSIZ},
  notices[] }`
- **`findings[]` → satırlar:** `label` · `stateLabel` (var/yok/belirsiz) ·
  `clauseNumbers[]` ("Madde 4") · `matchedTerm` ("neden eşleşti") · `note`
- **`clauses[].observations[]`:** `sourced:true` → normal metin +
  `evidenceLabel` bağlantısı; `sourced:false` → metin zaten
  `⚠ KAYNAKSIZ — ` ile başlar, **kırmızı/uyarı stiliyle** basılır
- **Zorunlu açıklama (`notices[]` birebir):** *"Bu inceleme KURAL
  TABANLIDIR: metni sizin kontrol listenizle karşılaştırır. Hukukî
  değerlendirme yapmaz, yorum üretmez ve yapay zekâ kullanmaz."* ve *"'yok'
  satırı, aranan başlığın metinde bulunamadığını söyler; maddenin gerekli
  olup olmadığına avukat karar verir."*
- **Kontrol listesi düzenleyicisi:** `items[] = {id, label, terms[],
  weakTerms?[], note?}`. Etiketler: "Başlık", "Aranacak ifadeler",
  "Zayıf ifadeler (belirsiz sayılır)", "Notum".

---

## 9. Entegrasyon istekleri (sahibi olmadığım dosyalar)

### 9.1 L-SAFE · `control-plane/src/api/server.ts` — router mount

Tam satır (varsayılan bağımlılıklarla çalışır; çözümleyici bağlanmazsa her
atıf dürüstçe "belirsiz" döner):

```ts
import { createContractsRouter } from "../contracts/routes.js";
// … diğer mount satırlarının yanına:
app.route("/", createContractsRouter());
```

Çözümleyici bağlandığında (B-15/B-20 sonrası, tercihen L-SOURCES ile):

```ts
app.route("/", createContractsRouter({
  resolveCitation: async (citation, asOf) => { /* korpus/citator sorgusu */ },
  // checklists: kalıcı bir ChecklistStore (bkz. 9.3)
}));
```

**Açılan yollar:** `POST /v1/citation-audit`,
`POST /v1/citation-audit/preview`, `POST /v1/contracts/review`,
`GET /v1/contracts/checklists`, `PUT /v1/contracts/checklists/{id}`.

### 9.2 L-SAFE · `server.ts` — mevcut drafting router'a bağımlılık yok

`createDraftingRouter` imzası değişmedi; yeni davranışlar (annex/marks,
`denetim-docx`, `QUOTE_ALTERED` reddi, B-36 kaydı) mevcut mount satırıyla
kendiliğinden gelir. **Değişiklik gerekmiyor.**

### 9.3 L-SAFE · kontrol listelerinin kalıcılığı (B-24)

**Dosya:** `supabase/migrations/<yeni>` **veya** `app_private.settings`
üzerinden — tercih L-SAFE'in.
**İhtiyaç:** kontrol listelerini saklayacak bir yer. En ucuz yol yeni tablo
değil, `app_private.settings` içinde `contractChecklists` anahtarı;
o durumda **hiçbir DDL gerekmez** ve L-MATTER'ın settings mağazasını
`ChecklistStore` arayüzüne saran 15 satırlık bir adaptör yeter.
**Neden:** B-24'ün KABUL'ü "kullanıcı kontrol listesi kaydedilir, ikinci
sözleşmede yeniden koşar" diyor; bugün liste yalnız süreç belleğinde
(`InMemoryChecklistStore`) yaşıyor.

### 9.4 L-MATTER · `POST /v1/matters/{id}/package` (B-30'un HTTP ucu)

**Dosya:** `control-plane/src/matters/routes.ts`
**Değişiklik:** yeni uç; matter'ın belgelerini/cevaplarını/taslaklarını
toplayıp `collex.matter-package/v1` planını yazar ve
`python -X utf8 -m export.cli --package <plan.json> --out <paket.zip>
--format dosya-paketi-zip` çağırır (mevcut `DraftDocxExec` deseniyle,
`execFile` + argüman dizisi).

Plan şeması (paketleyici bunu bekliyor, `export/package.py::parse_plan`):

```json
{ "schema": "collex.matter-package/v1",
  "matterId": "...", "matterTitle": "...",
  "summaryPath": "<dosya-ozeti.docx mutlak yolu>",
  "generatedAt": "<ISO>",
  "notes": ["..."],
  "documents": [{ "fileName": "kira.pdf", "sourcePath": "<var/uploads/... mutlak>", "sha256": "<64 hex>" }],
  "drafts":    [{ "fileName": "Dava Dilekcesi - v2.docx", "draftPath": "<taslak JSON yolu>" }],
  "answers":   [{ "fileName": "arastirma-1.json", "bundlePath": "<kanıt paketi JSON yolu>" }] }
```

**Neden bende değil:** künye/taraflar/kronoloji/süreler matter mağazasında,
asıl baytlar files lane'inde; ikisi de L-MATTER'ın dosyaları.
**Ayrıca gereken:** `GET /v1/files/{id}/original` (zaten B-30'da L-MATTER'a
verilmiş) ve `var/uploads` içindeki asıl dosyanın **mutlak yolu + sha256**'sı
— paketleyici bu ikisini plandan okuyor ve sha256'yı yeniden hesaplayıp
doğruluyor.

### 9.5 L-CONSOLE · `console.html` istemci linter'ı (B-01 aynası)

**Dosya:** `control-plane/public/console.html`
**Değişiklik:** `evidenceOverlapsClient` (bugün `QUOTE_OVERLAP_FLOOR 0.7` +
sayı denetimi) **tam alt dizgi kapsamasına** çevrilmeli:

```js
// canonicalQuoteText: &lt;/&gt;/&#40;/&#58;/&#46;/&amp; geri katla,
// görünmez karakterleri at, NFC normalize et, boşlukları tek boşluğa indir.
function evidenceBindingHoldsClient(paragraphText, quote) {
  const q = canonicalQuoteTextClient(quote);
  return q !== "" && canonicalQuoteTextClient(paragraphText).includes(q);
}
```

**Neden:** sunucu tarafı tek başına yeterlidir ve **önce gelir** (B-01'in
kendi cümlesi), ama editörde çip kırılmadığı sürece avukat hatayı `Kaydet`e
kadar göremez. `tests/pipeline/console.test.ts:533` bugün linter'ın
`evidenceOverlaps`'ı aynaladığını iddia ediyor; o iddia da güncellenmeli.

### 9.6 L-CONSOLE · "Alıntı ekle" penceresi (B-36'nın son parçası)

**Dosya:** `control-plane/public/console.html`
**Değişiklik:** alaka kapısının elediği kanıt (`draft.unusedEvidence`,
`unusedReason` `DOMAIN_MISMATCH`/`NOT_RELEVANT`) listede **gerekçe rozetiyle**
gösterilmeli; bugün uyarısız ve ilk sırada listeleniyor (UXAUDIT P1-21).
**Veri zaten var:** `draft.unusedEvidence[].unusedReason`.

### 9.7 L-DOCS · `openapi.yaml` — §10'daki additive delta

### 9.8 L-LEGAL · `control-plane/src/drafting/templates.ts` — kapanış bloğu

**Değişiklik:** mahkemeye özgü kapanış cümlesi
("…karar verilmesini saygıyla arz ve talep ederiz.") **ihtarname ve
sözleşme şablonlarından kaldırılmalı**; ihtarname kapanışı
"…gereğini bilgilerinize sunarım." / "Saygılarımla arz ederim." olmalı ve
kullanıcının kendi "…talep ederiz." satırının hemen ardına ikinci kez
eklenmemeli.
**Neden:** DAILYFLOW #4 — ihtarnamenin ortasında mahkeme hitabı var ve dava
dilekçesinde cümle tekrarı oluşuyor. **Bende değil:** kapanış metni
`templates.ts`'in içeriğidir (L-LEGAL, B-25). Biçim tarafı (imza bloğunun
sağa yaslanması, tarih satırının yeri) bu hatta indi.

### 9.9 L-LEGAL · `templates.ts` — EK numaralarının delil sırasını izlemesi

**Değişiklik:** DELİLLER listesindeki sıra ile `Ek-n` numaraları
eşleşmeli (DAILYFLOW #6). **Bende değil:** `Ek-n` satırının metni
`appendix.ts::uploadDelillerLine`'da (bende) ama **sıralama** şablonun
DELİLLER slot'undan geliyor.

---

## 10. `openapi.yaml` additive delta (L-DOCS, Faz B)

Hiçbiri kırıcı değildir; hepsi ya yeni yol, ya yeni opsiyonel parametre, ya
yeni opsiyonel alan.

**`GET /v1/drafts/{id}/export`**
- `format` enum'una **`denetim-docx`** eklendi (Atıf Denetim Raporu).
- Yeni opsiyonel query parametreleri:
  - `annex`: `string`, enum `[full, none]`, default `full`
  - `marks`: `string`, enum `[all, none]`, default `all`
- Yeni yanıt: **`409`** → `ApiError`, `error.kind = EXPORT_REFUSED`,
  additive `error.code = QUOTE_ALTERED`, additive
  `error.paragraphs: [{paragraphId, sectionId, ref}]`.

**`PUT /v1/drafts/{id}`**
- İstek gövdesine additive: `reviewChecklist`, `evidenceReview` —
  `object<string, {checked: boolean, by?: string, note?: string}>`
- Yanıt `issues[]` öğesine additive: `code?: string` (bugün tek değer:
  `QUOTE_ALTERED`).

**`Draft` şeması** — additive:
- `reviewChecklist?: object<string, ReviewMark>`
- `evidenceReview?: object<string, ReviewMark>`
- `ReviewMark = { checked: boolean, at?: string, by?: string, note?: string }`

**Yeni yollar (L-SAFE mount ettikten sonra):**

| Yol | Metot | Kısa |
|---|---|---|
| `/v1/citation-audit` | POST | Atıf Denetim Raporu (JSON) |
| `/v1/citation-audit/preview` | POST | Denetlenecek atıfların ön izlemesi |
| `/v1/contracts/review` | POST | Kural tabanlı sözleşme incelemesi |
| `/v1/contracts/checklists` | GET | Kayıtlı kontrol listeleri |
| `/v1/contracts/checklists/{id}` | PUT | Kontrol listesini kaydet (tam değiştirme) |

**Yeni şemalar:** `CitationAuditReport`, `CitationAuditRow`,
`ContractReviewReport`, `ChecklistFinding`, `ClauseLine`, `Checklist`,
`ReviewMark`.

**Not (STATUS için):** yol sayısı 35 → 40, operasyon 44 → 50 **olacaktır**;
bu sayı **L-VERIFY yeniden ölçmeden hiçbir belgeye yazılmamalıdır** (mount
L-SAFE'e bağlı).

---

## 11. Ölçümler (bu koşu, 02.09.2026)

```
cd control-plane && npx tsc --noEmit
  -> BENİM DOSYALARIMDA HATA YOK.
     Kalan tek hata başka hattın: src/ai/masking.ts(152,42) TS2322 (L-SAFE, B-23).

cd control-plane && npx vitest run tests/drafting
  Test Files  14 passed (14)
       Tests  192 passed | 1 skipped (193)
    ✓ composer.test.ts      35     ✓ quoteIntegrity.test.ts  10   [YENİ]
    ✓ revise.test.ts        20     ✓ exportMode.test.ts      14   [YENİ]
    ✓ routes.test.ts        26     ✓ contracts.test.ts       21   [YENİ]
    ✓ relevance.test.ts      9     ✓ markdown.test.ts         7
    ✓ evidence.test.ts       6     ✓ input.test.ts            5
    ✓ labels.test.ts         5     ✓ store.test.ts            4
    ✓ templates.test.ts     29 (L-LEGAL)  ✓ real-export.test.ts 2 (1 skipped)
  (dalga başında: 11 dosya / 130 test)

.venv/Scripts/python.exe -m pytest tests/export -q
  135 passed in 11.97s        (dalga başında: 89 passed)
    test_cli.py               16   (+6, B-01)
    test_filable_output.py    19   [YENİ, B-02 + B-36]
    test_audit_report.py      11   [YENİ, B-13]
    test_matter_package.py    10   [YENİ, B-30]
    test_petition_docx.py / test_udf_export.py / test_docx_export.py /
    test_markdown_export.py / test_verify.py — hepsi geçiyor

node scratchpad/w14-L-EVID/e2e.mjs   (gerçek HTTP, port 8941, gerçek Python)
  11/11 kontrol geçti
```

**Diğer hatların süiti (dürüst rapor).** Değiştirdiğim hiçbir sembol
`src/drafting/**`, `src/contracts/**`, `export/**` dışından import
edilmiyor (grep ile doğrulandı; tek istisna `tests/pipeline/console.test.ts`
içindeki metin iddiası, o test **110/110 geçiyor**). Yine de tam turu
koşturdum:

```
cd control-plane && npx vitest run
  Test Files  7 failed | 92 passed (99)
       Tests  14 failed | 1953 passed | 6 skipped (1973)
  Başarısızlar: tests/api.test.ts (3), tests/answer/answerHonesty.test.ts (2),
  tests/integration/app.test.ts (2), tests/pipeline/answerPipeline.test.ts (4),
  tests/research/{researchService,routes}.test.ts (2),
  tests/store/persistence.test.ts (1)
  -> HEPSİ başka hatların dosyaları (L-SAFE, L-ANSWER, L-SOURCES, L-MATTER)
     ve hepsi eşzamanlı düzenleme altında. tests/drafting/** 192/192 geçiyor.

.venv/Scripts/python.exe -m pytest tests evals/tests -q
  7 failed, 1290 passed, 20 errors in 127.31s
  Başarısız/hatalı: tests/ingestion/** (migrations ledger, publish atomicity,
  relations, RLS, versioning) ve tests/intake/test_ensure_db.py
  -> HEPSİ L-SAFE'in dosyaları (B-05 çoklu sentinel migration grameri).
     tests/export/** 135/135 geçiyor.
```

Bunları **düzeltmedim** (dosya sahipliği) ve **görmezden gelmedim**: burada
listelendiler.

---

## 12. Değişen dosyalar

**TypeScript (yeni):**
- `control-plane/src/drafting/quoteIntegrity.ts`
- `control-plane/src/drafting/exportMode.ts`
- `control-plane/src/contracts/citationAudit.ts`
- `control-plane/src/contracts/clauseReview.ts`
- `control-plane/src/contracts/draftAudit.ts`
- `control-plane/src/contracts/routes.ts`

**TypeScript (değişen):**
- `control-plane/src/drafting/composer.ts` — `evidenceBindingHolds`
- `control-plane/src/drafting/revise.ts` — `QUOTE_ALTERED`, `ReviseIssue.code`, B-36 kaydı
- `control-plane/src/drafting/routes.ts` — export kapısı, annex/marks, `denetim-docx`, PUT şeması
- `control-plane/src/drafting/markdown.ts` — mod farkındalığı
- `control-plane/src/drafting/appendix.ts` — "yüklediğiniz belge"
- `control-plane/src/drafting/types.ts` — `reviewChecklist`, `evidenceReview`

**Python (yeni):** `export/audit.py`, `export/package.py`

**Python (değişen):** `export/draft.py` (kanonik alıntı + B-01 kapısı +
`ExportMode` + B-36 ayrıştırma), `export/petition.py` (A4, doğrudan biçim,
mod, `citation_lines`), `export/udf.py` (hizalama, mod), `export/cli.py`
(`--annex`, `--marks`, `--audit`, `--package`)

**Testler (yeni):** `control-plane/tests/drafting/{quoteIntegrity,exportMode,contracts}.test.ts`,
`tests/export/{test_filable_output,test_audit_report,test_matter_package}.py`

**Testler (değişen):** `control-plane/tests/drafting/{composer,revise,routes}.test.ts`,
`tests/export/{test_cli,test_petition_docx}.py`

**Dokunulmayanlar:** `templates.ts`, `templates.test.ts`, `console.html`,
`server.ts`, `openapi.yaml`, `STATUS.md`, `CLAUDE.md`, migration'lar,
`package.json`, `.env`, `collex_local`.

---

## 13. Açık maddeler (dürüst liste)

1. **B-24'ün DOCX çıktısı yapılmadı.** İnceleme raporu bugün yalnız JSON
   dönüyor. `export/audit.py`'nin deseni birebir uygulanabilir
   (`export/review.py` + `--review` + `--format inceleme-docx`); KABUL'ün
   "çıktı DOCX olarak iner" cümlesi **karşılanmadı**.
2. **B-30'un HTTP ucu yapılmadı** (§9.4). Paketleyici, CLI ve testleri hazır;
   uç L-MATTER'ın verilerine bağlı.
3. **`annex=none`'da atıf satırı tekrar ediyor.** HUKUKÎ SEBEPLER paragrafı
   zaten `Dayanak: <künye> — "<alıntı>"` ile başlıyor; hemen altına
   `Dayanak: <künye>` satırı da yazılıyor. Yanlış değil, gereksiz. Düzeltmesi
   `appendix.ts` + `petition.py` arasında koordinasyon ister; COPY hattının
   diliyle birlikte yapılmalı.
4. **B-01'in konsol aynası yapılmadı** (§9.5). Sunucu tarafı yeterli ve
   önceliklidir, ama avukat hatayı `Kaydet`e kadar göremiyor.
5. **B-36'nın "Alıntı ekle" rozeti yapılmadı** (§9.6) — `console.html`.
6. **B-13'ün çözümleyicisi bağlı değil.** Bugün her satır dürüstçe
   "belirsiz" dönüyor. Kalemin kendisi "sonucun güçlü olması için B-15/B-20"
   diyordu; bağlanana kadar rapor **kapsam beyanıdır**, atıf doğrulaması
   değildir ve arayüz bunu aynen yazmalıdır.
7. **UDF hâlâ deneysel ve imzasız.** Bu hat UDF'nin biçim sadakatini
   düzeltti (hizalama), UYAP Doküman Editörü'nde **açılmadı** — bu makinede
   yok. "deneysel" etiketi duruyor ve durmalıdır.
8. **`collex_evid_test` kurulmadı.** Bu hattın hiçbir kalemi veritabanına
   dokunmadığı için gerek olmadı; PostgreSQL'e tek sorgu gitmedi.
9. **Sentetik veri uyarısı.** Bütün ölçümler `evals/fixtures/corpus` ve bu
   testlerin kendi sentetik metinleri üzerinde yapıldı. Hiçbiri hukukî
   kalite ölçüsü değildir.
