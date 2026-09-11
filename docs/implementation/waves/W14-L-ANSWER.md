# W14 — L-ANSWER hattı (B-06, B-07, B-08, B-09, B-31)

Tarih: **02.09.2026** · Faz A · Hat: **L-ANSWER**
Sahip olunan dosyalar dışında hiçbir dosyaya dokunulmadı; hiçbir git işlemi
yapılmadı; `openapi.yaml`, `STATUS.md`, `CLAUDE.md`, `console.html`,
`server.ts` ve migration dosyaları **değiştirilmedi**.

Bu belgedeki her sayı bu makinede bugün ölçüldü. Korpuslar **SENTETİK**tir
(`evals/fixtures/corpus/`, `tests/quality/qualityCorpus.ts` ve bu hattın
kendi probe korpusu); hiçbiri hukukî kalite ölçüsü değildir.

---

## 0. Özet

| Kalem | Durum | Tek cümlelik sonuç |
|---|---|---|
| **B-06** trigram şeridi indeksi kullansın | **İNDİ** | Şeridin predikatı indekslenebilir `<%` oldu; 20 006 parçalık probe'ta seçici bir sorgu `Seq Scan` **19 702 ms** → `Bitmap Index Scan on chunks_search_trgm` **40 ms**; sorgu planı için ilk kez bir gerileme testi var |
| **B-07** çıplak kanun atfı çekimserliği devirmesin | **İNDİ** | Çıplak kanun adı artık sabitlemeyi sürdürüyor ama hiçbir pasaja kapı muafiyeti vermiyor; "…tbk ya gore" sorusu tekrar **ÇEKİMSER**, madde düzeyi atıf aynen çalışıyor |
| **B-08** uzun/olgu içeren soru | **İNDİ** | Altı gerçekçi olay örgüsünde uzun biçim **0 kanıt / ÇEKİMSER** iken şimdi kısa biçimle **birebir aynı** kanıt sayısı ve durumu |
| **B-09** zamansal soruda `COMPLETE` yasağı | **İNDİ (bir sapmayla)** | Zamansal soru sürüm karşılaştırması olmadan `COMPLETE` olamıyor; tetikleyici olarak **yalnızca soru metnindeki zamansal işaretleyiciler** kullanıldı, çıplak `asOf` kullanılmadı — gerekçesi §5'te ölçümüyle |
| **B-31** entailment iddia parçalarına atıf | **İNDİ** | ARCH'ın iki probe fixture'ı **SUPPORTED**; `run_evals` kesinleştirilebilir oranı **%47,6 → %85,7** — bu **bir kusurun kalkmasıdır, kalite artışı değildir** |

`RESULT: PASS` — `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02`.

---

## 1. B-06 · Trigram şeridi indeksi kullansın (`<%`) + sorgu planı testi

### 1.1 Ne yapıldı

`control-plane/src/store/chunkStore.ts`:

- `trigramSearch` predikatı `extensions.word_similarity(q, c.search_text) >= t`
  (fonksiyon çağrısı, indekslenemez) yerine
  `${queryText} operator(extensions.<%) c.search_text` oldu. İki biçim
  **tanım gereği aynı kümeyi** verir (`a <% b` ⇔
  `word_similarity(a,b) >= pg_trgm.word_similarity_threshold`).
- Eşik aynı işlemde `set_config('pg_trgm.word_similarity_threshold', …, true)`
  ile kuruluyor; bu yüzden şerit artık `sql.begin` içinde koşuyor
  (`set_config(..., true)` işlem dışında bir sonraki ifadeden önce atılır).
- `word_similarity(...)` yalnız SELECT listesinde skor olarak kaldı.
- `minSimilarity` [0,1] dışındaysa `RangeError` (GUC zaten kabul etmezdi).
- Yeni `explainTrigramSearch(...)` — şeridin **kendi SQL'inin**
  `explain (format json)` çıktısı; testin plan iddiası için var.

### 1.2 Kabul ölçütünün ötesinde bulunan şey — planlayıcı düzeltmesi

Backlog'un "nasıl" bölümü yalnız operatörü ve GUC'u anıyordu. Ölçüldü: **tek
başına yetmiyor.** `search_text` TOAST'a taşındığı için `legal.chunks` yığını
20 006 satırda yalnız **5 528 kB / 691 sayfa**; planlayıcı bir `<%` çağrısını
`cpu_operator_cost` (0,0025) ile fiyatlıyor ve bütün sıralı taramayı **941
maliyet birimi** sanıyor — ölçülen gerçek **19 702 ms**. Bu yüzden 81 MB'lık
`chunks_search_trgm` yerine sıralı taramayı seçiyor.

Bu nedenle şerit kendi işleminde `enable_seqscan = off` ile koşuyor
(`is_local = true`, yalnız o işlem). Denenen ve **yetmeyen** alternatif:
`cpu_operator_cost = 1` (indeks yolunu da aynı oranda pahalılaştırdığı için
plan değişmedi — ölçüldü, hâlâ `Seq Scan`, 21 904 ms).

### 1.3 Ölçüm — probe veritabanı `collex_answer_test`, 20 006 parça

Korpus: 20 006 parça, ortalama `search_text` **5 633 kod noktası**, yığın
**5 528 kB**, `chunks_search_trgm` **81 MB**. (ENGRISK E2'nin probe'u 20 055
parça / 5 392 karakterdi; bu hat kendi probe'unu kurdu.)

**ÖNCE — bu şeridin W14'e kadar kullandığı predikat:**

```
Limit  (cost=5408.89..5408.95 rows=24) (actual time=19701.963..19701.969 rows=14)
  ->  Sort  ...
        ->  Hash Join ...
              ->  Seq Scan on chunks c  (actual time=3269.275..19688.193 rows=14)
                    Filter: (extensions.word_similarity('depozito iadesi'::text, search_text) >= '0.5')
                    Rows Removed by Filter: 19992
Execution Time: 19702.699 ms
```

**SONRA — ürünün kendi `trigramSearch` SQL'i, işlem-yerel ayarlarla:**

```
Limit  (cost=2380.69..2380.75 rows=24) (actual time=39.438..39.441 rows=14)
  ->  Sort ...
        ->  Nested Loop ...
              ->  Bitmap Heap Scan on chunks c  (actual time=1.837..25.579 rows=14)
                    Filter: ('depozito iadesi'::text OPERATOR(extensions.<%) search_text)
                    Rows Removed by Filter: 11
                    Heap Blocks: exact=6
                    ->  Bitmap Index Scan on chunks_search_trgm  (actual time=0.767..0.767 rows=25)
                          Index Cond: (search_text OPERATOR(extensions.%>) 'depozito iadesi'::text)
Execution Time: 40.244 ms
```

**19 702 ms → 40 ms (≈490×), sonuç kümesi aynı (14 satır), şema değişikliği
yok.**

Ürün yolundan (`trigramSearch`, limit 24) ölçülen süreler, aynı probe DB:

| Sorgu | Süre | Satır |
|---|---:|---:|
| `depozito iadesi` | **101 ms** | 14 |
| `zamanaşımı süresi` | 20 264 ms | 17 |
| `haksız fiil sorumluluğu` | 20 754 ms | 14 |
| `Depozito ne zaman iade edilir?` | 17 813 ms | 0 |

### 1.4 Dürüstlük notu — kapanmayan yarı

Son üç satır düzelmedi ve bunu saklamıyorum. Plan **her dördünde de**
`chunks_search_trgm` kullanıyor; kalan maliyet **recheck**tir: GIN, sorgunun
trigramlarının yeterli bölümünü taşıyan her satırı aday verir, ve bu probe
korpusunda (rastgele hece sözcükleriyle üretilmiş 5,6 kB'lık parçalar)
"zamanaşımı süresi" için aday kümesi **19 987/20 006** satır; her adayda
`word_similarity` yeniden hesaplanır ve 5,6 kB metin TOAST'tan açılır.
ENGRISK'in ölçtüğü **1,56 ms** kendi korpusunun trigram seçiciliğine aittir;
bu hat onu kendi probe'unda **yeniden üretemedi** ve iki sayıyı da olduğu gibi
yazıyor.

Sonuç: **indekslenebilirlik kusuru kapandı** (ölçülebilir, testli); **uzun ve
yaygın-sözcüklü sorgularda şeridin recheck maliyeti ölçekte hâlâ yüksektir.**
Aday sınırı koymak sonuç kümesini değiştirir (KABUL "sonuç kümesi bugünküyle
aynı kalır" diyor), bu yüzden bu dalgada **bilinçle yapılmadı** — §7 açık
konular.

### 1.5 Gerileme testi

`control-plane/tests/store/retrieval.test.ts` içinde yeni `(k)` bloğu, kendi
veritabanında (`collex_answer_test`, 2 000 parça / 50 belge; blok sonunda
düşürülür — `collex_retrieval_test`'e tek satır girmez):

1. `explainTrigramSearch` planında **`chunks_search_trgm` geçer** ve
   `legal.chunks` üzerinde `Seq Scan` **yoktur**. Bu iddia, planlayıcının
   fixture ölçeğindeki maliyet tercihine değil **indekslenebilirliğe** bakar:
   probe, bitmap dışındaki bütün erişim yollarını kapatır
   (`enable_indexscan`, `enable_indexonlyscan`, `enable_nestloop` = off), ve
   W14 öncesi predikat bu koşullarda cezalı bir `Seq Scan`'e düşerdi.
2. Şeridin kendi ayarlarıyla da `legal.chunks` sıralı okunmaz.
3. **Sonuç kümesi birebir aynıdır**: aynı sorgu, W14 öncesi predikatın
   verbatim SQL'iyle referans olarak koşturulur; `chunkId` listesi ve `score`
   listesi eşittir.
4. `minSimilarity: 1.5` → `RangeError`.

---

## 2. B-07 · Çıplak kanun atfı çekimserliği devirmesin

### 2.1 Kök neden (DAILYFLOW §2, yeniden okundu)

`exactPinLookup` çıplak bir kanun atfında **kanunun bütün parçalarını**
sabitler; `referenceBypass` bunu "okuyucu bu metni adıyla istedi" sayar; ve
`admitUnderReferenceBypass` sabitli pasajı **hak olarak** kabul eder. Çıplak
atıfta *her pasaj sabitli* olduğu için P0-1'in pasaj pasaj kabul düzeltmesi
tam bu senaryoda devre dışı kalıyordu.

### 2.2 Ne yapıldı

`control-plane/src/answer/coverage.ts` — yeni
`classifyReferenceBypass(references, hits): "none" | "article" | "bare-law"`:

- **article**: kanun numarası **+ madde** ("TBK m. 49"), ya da E. + K. → bugünkü
  davranış **aynen** korunur (sabitli metin hak olarak kabul edilir).
- **bare-law**: yalnız kanun adı ("TBK'ya göre", "TCK bakımından") → sabitleme
  sürer, **muafiyet yoktur**: her pasaj kapıdan tek başına geçer.
- **none**: atıf yok ya da hiçbir sabitli isabet yok.

`admitUnderReferenceBypass` additive `pinnedByLaw` alanı aldı: çıplak kanun
sabitlemesiyle gelen pasajın **çıpası iki değil bir içerik sözcüğüdür**
(kapsam tabanı `0.4` **değişmedi** ve aynen uygulanır). Bu tek gevşetme
ölçümle zorunlu oldu: iki sözcüklük çıpayla `run_evals`'ın
`fx-amend-002` satırı ("7999 sayılı Kanun ile 6098 sayılı Türk Borçlar
Kanununda hangi değişiklik yapılmıştır?") **yanlış çekimser** oluyordu
(değiştiren madde "değişiklik"i taşıyor, "borçlar"ı taşımıyor).

`answerPipeline.ts`: çıplak kanun bypass'ı **hiçbir pasajı kabul etmezse**
kapı `failed`'a düşer → `ABSTAIN` + mevcut `QUESTION_NOT_COVERED` (yeni bir
kod yok).

### 2.3 Kabul ölçütü — kanıt

`tests/answer/answerHonesty.test.ts` (yeni "B-07" bloğu, sahte korpus TBK
m.49 + m.51 sabitli):

| İddia | Sonuç |
|---|---|
| (a) "kira sozlesmesinde depozito iadesi ne zaman yapilir **tbk ya gore**" | `ABSTAIN`, `evidence: []`, `claims: []`, `bundle.evidence: []`, `QUESTION_NOT_COVERED`, `QUESTION_NOT_COVERED:2`; iki pasaj **kimlikle** raporlanır, alıntılanmaz |
| (a′) aynı soru kısaltmasız | Aynı durum, aynı kanıt sayısı (birebir karşılaştırma testi) |
| (b) "TBK m. 49 uyarınca haksız fiil sorumluluğunun genel kuralı nedir?" | `bypassed-by-reference`, yalnız `chunk-tbk-49` kanıt, `ABSTAIN` değil, tespit üretilmiş |
| (c) mevcut P0-1 pasaj pasaj kabul testleri | Dördü de yeşil (`tests/answer/answerHonesty.test.ts` 28/28) |

`tests/answer/coverage.test.ts` (yeni "B-07" bloğu): `classifyReferenceBypass`
DAILYFLOW'un iki ölçülmüş sorusunda ve "7999 … 6098 …" sorusunda `bare-law`;
"TCK m.157" ve E./K. sorusunda `article`; sabitli isabet yoksa `none`.

---

## 3. B-08 · Uzun/olgu içeren soruda kapsam kapısı hukukî soruya uygulansın

### 3.1 Teşhis — iki ayrı kusur, ikisi de ölçüldü

1. **Kapsam kapısının birimi.** Kapı bütün soru metnine karşı sözcükseldir.
   1 200 kod noktalık bir olay örgüsü ~80 içerik lexeme'i (ad, tarih, tutar,
   yer) taşır; hiçbir hukukî pasaj bunları içeremez, oran çöker, her pasaj
   kenara konur.
2. **Lexeme seyrelmesi (retrieval).** `lexicalSearch`, bir parçayı ancak
   **sorgunun** lexeme'lerinin `DEFAULT_LEXICAL_MIN_COVERAGE = 0.25`'ini
   taşıyorsa kabul eder. ~120 lexeme'li bir anlatıda hiçbir pasaj tabana
   ulaşamaz ve **şerit boş döner**. Ölçüldü: altı uzun biçimin **altısı da**
   0 kanıt getiriyordu.

Yalnız (1) düzeltilirse altı çiftin **dördü hâlâ 0 kanıt/ÇEKİMSER** kalıyor
(ara ölçüm, aynı koşu).

### 3.2 Ne yapıldı

`control-plane/src/pipeline/questionIntent.ts`:
`LONG_QUESTION_CODE_POINTS = 400` (belgelenmiş sabit; denetlenen kısa biçimler
40–120, denetlenen olay örgüsü 1 178 kod noktası) ve
`extractLegalQuestion(question, references)`:

- eşiğin altında: `legalQuestion = question`, `measuredOn: "soru+olay"` —
  **kod yolu ve sonuçlar birebir değişmez**;
- üstünde: soru işaretli cümleler + son cümle + ayrıştırılan atfı taşıyan
  cümleler, özgün sırada → `measuredOn: "soru"`.

`answerPipeline.ts`:
- kapsam ölçümü, pasaj pasaj kabul ve kapsam-farkındalı kanıt tavanı artık
  `legalQuestion` üzerinden;
- **retrieval bütün metni almaya devam eder** (sıralama sinyali), ve
  `measuredOn === "soru"` iken **ikinci bir birincil sorgu** planlanır:
  `primary:soru`. Seyrelmenin susturduğu şerit böylece cevap verebiliyor.
- `CoverageView.measuredOn` additive alanı.

`extractLegalQuestion` `intent` aşamasının içinde koşuyor: `trace` aşama
listesi konsolun okuduğu bir sözleşme, ona yeni bir isim eklenmedi.

### 3.3 Ölçüm — altı gerçekçi olay örgüsü

Korpus: `tests/quality/qualityCorpus.ts` (SENTETİK, 5 belge), gerçek
`AnswerPipeline`, gerçek PostgreSQL. Çiftler
`tests/quality/qualityCorpus.ts :: LONG_FORM_PAIRS` içinde; uzun biçimler
1 252–1 581 kod noktası.

| # | Uzun (kn) | Kısa biçim | Uzun — **ÖNCE** | Uzun — **SONRA** | Kapsam kısa/uzun (sonra) |
|---|---:|---|---|---|---|
| L1 | 1 435 | 5 kanıt / QUALIFIED | **0 kanıt / ABSTAIN** (kapsam 0,18) | 5 kanıt / QUALIFIED | 1,00 / 1,00 |
| L2 | 1 297 | 3 kanıt / QUALIFIED | **0 kanıt / ABSTAIN** (0,00) | 3 kanıt / QUALIFIED | 1,00 / 1,00 |
| L3 | 1 274 | 1 kanıt / COMPLETE | **0 kanıt / ABSTAIN** (0,00) | 1 kanıt / COMPLETE | 1,00 / 1,00 |
| L4 | 1 255 | 1 kanıt / PARTIAL | **0 kanıt / ABSTAIN** (0,00) | 1 kanıt / PARTIAL | 1,00 / 1,00 |
| L5 | 1 252 | 4 kanıt / QUALIFIED | **0 kanıt / ABSTAIN** (0,00) | 4 kanıt / QUALIFIED | 0,85 / 0,85 |
| L6 | 1 581 | 6 kanıt / QUALIFIED | **0 kanıt / ABSTAIN** (0,11) | 6 kanıt / QUALIFIED | 1,00 / 1,00 |

Altı çiftte de oran **%100** (KABUL: ≥ %70) ve durum sınıfı aynı. "ÖNCE"
ölçümü, B-08'in iki kancası geçici olarak geri alınıp aynı script koşularak
alındı; kaynak dosya baytı baytına geri konuldu ve ölçümden sonra bütün süit
yeşil koştu.

Kısa biçimlerde `measuredOn === "soru+olay"` ayrı bir testle sabitlendi.

---

## 4. B-09 · Zamansal soru: `COMPLETE` yasağı + sürüm karşılaştırması

### 4.1 Ne yapıldı

- `questionIntent.ts`: `TEMPORAL_MARKERS` (21 kalıp: "öncesi", "sonrası",
  "tarihinde yürürlükte", "hangisi uygulanır", "lehe kanun", "eski hâli" …) ve
  `classifyTemporalQuestion`. `QuestionIntentAssessment` additive
  `temporal: {isTemporal, markers, rationale}` alanı aldı.
- `answer/verifier.ts`: `VerifyOptions.temporal = {applicable,
  comparisonPresent}`. `applicable && !comparisonPresent` iken durum **asla
  `COMPLETE` olamaz** (`QUALIFIED`'a düşer) ve
  `TEMPORAL_COMPARISON_MISSING` gerekçesi yazılır.
- `answerPipeline.ts`: **karşılaştırma vardır** = kabul edilen kanıtta *aynı
  belgenin birden fazla sürümü* bulunur. Değiştiren kanun, citator (relation)
  şeridinden geldiğinde künyesiyle ayrıca raporlanır ama **iki metnin yerini
  tutmaz**.
- Additive `AnswerResult.temporal` görünümü (yalnız zamansal soruda):
  `{applicable, present, asOf, versions[], amendedBy[], note}`.
- `answer/renderer.ts`: `TEMPORAL_COMPARISON_MISSING` Türkçe sözlüğe girdi —
  *"Sorulan tarih için hangi metnin uygulanacağı karşılaştırılmadı; cevapta
  hükmün tek bir sürümü var"* — ve `renderReason` artık `KOD:özne` biçimindeki
  gerekçeleri de Türkçe açıklıyor (kod parantez içinde birebir kalıyor).

### 4.2 SAPMA — çıplak `asOf` tetikleyici yapılmadı

Backlog: *"`asOf` verilmişse **veya** soruda zamansal işaretleyici varsa"*.
Denendi ve **ölçüldü**: konsolun ve `run_evals`'ın her isteği `asOf` taşıdığı
için bu kural **her cevabı** zamansal yapıyor; tek sürümü olan her hüküm
cevabı `QUALIFIED` + "karşılaştırılmadı" ile dönüyor ve **zamansal olmayan
altı mevcut pipeline testi** `COMPLETE` → `QUALIFIED`'a düşüyordu. Bu, tuzak
§C.6'nın tarifi: her cevapta çıkan bir dürüstlük satırı okunmayan satırdır ve
savunmak istediğimiz as-of özelliğine iftira eder.

Uygulanan kural: **zamansallık sorunun sözlerinden okunur.** DAILYFLOW'un
ölçtüğü soru ("… 2026 **öncesi** mi **sonrası** mı uygulanır?") bu kuralla da
yakalanır. `asOfProvided` seçeneği kodda duruyor ve birim testi var; daha katı
kural bir sonraki dalgada **yeniden ölçülerek** açılabilir.

### 4.3 Kabul ölçütü — kanıt

`tests/pipeline/answerPipeline.test.ts` (yeni "B-09" bloğu; TCK m.157 v1/v2
fixture'ı + `hitAmendingLaw` relation provenance'ı):

| İddia | Sonuç |
|---|---|
| `asOf 2024-06-01` + zamansal soru, kanıtta tek sürüm | `COMPLETE` **dönmez**; `TEMPORAL_COMPARISON_MISSING` `reasons`'ta, `markdown`'da ve `bundle.reasons`'ta **birebir**; `temporal.present === false`; not "karşılaştırılmadı" içerir |
| İki sürüm + değiştiren kanun kanıtta | `temporal.present === true`, iki `documentVersionId` de listelenir, biri `role: "sorulan-tarihte"`, `amendedBy` 7999'u `kind: "AMENDS"` ile adlandırır, `TEMPORAL_COMPARISON_MISSING` **yok** |
| Zamansal olmayan soru | `result.temporal` **yok**, durum `COMPLETE`, hiçbir değişiklik |

---

## 5. B-31 · Entailment: iddia parçalarına atıf

### 5.1 Ne yapıldı (ARCH §4.3'ün additive sözleşmesi)

- `evidence/types.ts`: `ClaimDraft.segments?: {text, evidenceIds}[]`
  (+ `ClaimSegment` arayüzü).
- `llm/ruleDrafter.ts`: `claimFromGroup` her alıntı için bir segment yazar
  (`"<künye>: \"alıntı\""` + o alıntının kendi `evidenceId`'si). Tek pasajlı
  grupta segment metni iddia metniyle özdeştir → skor değişmez.
- `llm/ports.ts`: `EntailmentPort.assessSet?(claimText, evidence[])`.
- `llm/lexicalEntailment.ts`: `assessSet` aynı ölçüyü **pasajların
  birleşim yüzeyi** üzerinde koşar; **sayı kuralı birleşim üzerinde de sert
  başarısızlıktır**. Ayrıca `matchedClaimTokens` / `evidenceSurfaceOf`
  dışa açıldı (padding denetimi için).
- `answer/verifier.ts` — `confidence.entailment`:
  - segment varsa ve her segmentin kimlikleri doğrulanıyorsa →
    **segment bazlı `min`**;
  - segment yok, >1 geçerli kanıt, **kural tabanlı** drafter → `assessSet`;
  - segment yok, >1 geçerli kanıt, **bulut** drafter → bugünkü `max` +
    görünür `ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM`;
  - tek kanıt → **değişmedi**.
  Pasaj bazlı yargılar hesaplanmaya ve döndürülmeye devam eder (okuyucunun
  denetim izi).
- **Padding denetimi**: hiçbir segmentin sahiplenmediği (ya da birleşim
  yolunda diğerlerinin taşımadığı hiçbir token'ı katmayan) doğrulanmış atıf
  `UNUSED_CITATION:<claimId>:<evidenceId>` uyarısı alır.
- `addressesSameIssue`: sayı kuralı **hukukî atıf token'larına** daraltıldı —
  yalnız *(kanun no + madde)* ve *(E. + K.)* çiftleri; **çıplak kanun adı ve
  yalın yıl/tutar artık çelişki bağı kurmuyor.** İki incelik ölçümle zorunlu
  oldu: (i) kanun ile madde ancak parser'da **yan yana** çözüldüğünde
  eşleşir (yoksa pasajın hiç yapmadığı bir atıf uydurulur); (ii) karşıt
  pasajın **kendi** E./K. numarası kullanılmaz — o belgeyi tanımlar, konuyu
  değil, ve aynı kararın diğer parçaları her iddiayla "çelişir" hâle
  geliyordu (ölçüldü: dört canlı-araştırma iddiası, kendilerinden
  üretildikleri kararın üç pasajıyla çelişkili ilan edildi).
- Additive `VerifiedClaim.entailmentAggregation`
  (`"segments" | "set" | "max" | "none"`) ve
  `VerifiedClaim.entailmentMeasured` (kural tabanlı üretimde **false**);
  ikisi de `ClaimView`'a taşındı.
- `ENTAILMENT_THRESHOLD = 0.85` ve hiçbir kapı değeri **değişmedi**
  (testle sabitlendi).

### 5.2 Kabul ölçütü — kanıt

`control-plane/tests/answer/entailmentSegments.test.ts` (15 test):

| Probe | Sonuç |
|---|---|
| **probe 1** — bir maddenin iki fıkrası, çapraz referans yok | `entailmentAggregation: "segments"`, skor ≥ 0,85, verdict **SUPPORTED**, durum `COMPLETE`, `ENTAILMENT_BELOW_THRESHOLD` yok |
| **probe 2** — 2. fıkra "158 inci maddede" çapraz referansı taşıyor | Aynı: **SUPPORTED** |
| **Boşluk testi (her iki probe için)** | Aynı fixture'da segmentler soyulup `assessSet`'siz yargıçla koşulunca skor **0,85'in altında** ve `ENTAILMENT_BELOW_THRESHOLD` geri geliyor — test boşuna geçmiyor |
| Tek pasajlı iddia | `max` yolu, skor **1,000**, davranış değişmedi |
| Segmentsiz **kural tabanlı** iddia | `set` yolu, skor ≥ 0,85 |
| Segmentsiz **bulut** iddiası | `max` + `ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM` |
| Padding | Diğerlerinin taşımadığı hiçbir şey katmayan atıf `UNUSED_CITATION:…` ile raporlanır |
| `assessSet` sayı kuralı | İddiada geçen "9999" hiçbir pasajda yoksa skor ≤ 0,20, `entails: false` |
| Kural tabanlı eksen | `entailmentMeasured === false`; bulut drafter'da `true` |
| Eşik | `ENTAILMENT_THRESHOLD === 0.85` |
| Çelişki bağı | Yalnız yıl paylaşan karşıt pasaj **bağlanmaz**; aynı hükmü anan karşıt pasaj **bağlanır** (boşluk testi) |

### 5.3 `run_evals` — yeniden ölçüm

`.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` →
**`RESULT: PASS`** (altı sert kapının altısı da PASS).

| Cevap düzeyi (REPORT ONLY) | W14 öncesi (aynı gün) | W14 sonrası |
|---|---|---|
| Durum sayıları | ABSTAIN=13, COMPLETE=6, PARTIAL=11, QUALIFIED=4 | ABSTAIN=13, **COMPLETE=12**, **PARTIAL=3**, QUALIFIED=6 |
| Kesinleştirilebilir oran | %47,6 (10/21) | **%85,7 (18/21)** |
| Yanlış çekimserlik | 0 | **0** |
| Yanlış cevap (no_answer satırlarında) | 0 | **0** |
| Beklenen birim kanıtta | %100,0 | **%95,2** |
| Cevap katmanı çekimserlik kesinliği / duyarlılığı | %100 / %100 | %100 / %100 |
| TRIPWIRE — cevap katmanı yanlış çekimserlik | 0 | **0** |

**Bu artış bir kusurun kalkmasıdır, kalite artışı değildir.** Kural tabanlı
modda iddia metni alıntıların kendisidir; eksen her iki hâlde de bir
totolojidir (ARCH W2). `entailmentMeasured` alanı tam olarak bunun için var.

**Ve kaybedilen tek satır dürüstçe:** "beklenen birim kanıtta" %100 → %95,2.
Tek satır `fx-amend-002`; B-07'nin çıplak kanun kuralı yürürlükteyken o cevap
sekiz sabitli pasaj yerine soruyu gerçekten karşılayan pasajla dönüyor, ve
gold'un adlandırdığı kardeş madde kenara konan pasajlar arasında kalıyor.
Satır hâlâ **COMPLETE** ve **yanlış çekimser değil**. Gold setine
dokunulmadı, hiçbir eşik oynatılmadı; ölçüm olduğu gibi yazıldı.

---

## 6. Faz B için tam UI sözleşmesi (L-CONSOLE)

Hiçbir uç **eklenmedi**; `POST /v1/answer` cevabı üç additive alan kazandı.
Türkçe etiketler LANG sözlüğüne uygun; makine kodu Türkçe cümleden sonra
parantez içinde.

### 6.1 `coverage.measuredOn` (B-08)

- **Uç / gövde:** değişmedi (`POST /v1/answer`).
- **Alan:** `coverage.measuredOn: "soru" | "soru+olay"` (yoklukta eski
  davranış varsayılır).
- **Ekran:** Kapsam satırının yanında **tek satır**:
  - `"soru"` → **"Ölçüm: sorunun kendisi (olay metni sıralama için kullanıldı)"**
  - `"soru+olay"` → **"Ölçüm: soru metni"**
- Uyarı bütçesine (B-27, en fazla 4 blok) **girmez**: bu bir uyarı değil,
  kapsam satırının niteleyicisidir.

### 6.2 `temporal` (B-09)

- **Alan (yalnız zamansal soruda vardır):**
  ```
  temporal: {
    applicable: boolean,           // her zaman true (yoksa alan hiç yok)
    present: boolean,              // iki sürüm yan yana mı
    asOf: "YYYY-MM-DD",
    versions: [{ evidenceId, documentId, documentVersionId, title,
                 legislationNo?, article?, effectiveFrom?,
                 role: "sorulan-tarihte" | "sonraki" | "onceki" | "belirsiz" }],
    amendedBy: [{ chunkId, documentVersionId, title, legislationNo?, kind }],
    note: string                   // hazır Türkçe cümle
  }
  ```
- **Ekran:**
  - `present === true` → cevap kartında iki başlık:
    **"Sorulan tarihte yürürlükte olan metin"** (`role === "sorulan-tarihte"`)
    ve **"Sonraki metin"** (`role === "sonraki"`; `"onceki"` için
    **"Önceki metin"**). `amendedBy` varsa altında tek satır:
    **"Değiştiren: <title> (<legislationNo> sayılı Kanun)"**.
  - `present === false` → kartın üstünde **turuncu tek satır**, `note` metni
    birebir: *"Sorulan tarih için hangi metnin uygulanacağı
    karşılaştırılmadı; cevapta hükmün tek bir sürümü var."* Bu, uyarı
    bütçesinin **bir** bloğudur.
  - Tarihler **GG.AA.YYYY** biçiminde gösterilir (`asOf`, `effectiveFrom`).
- `reasons` içinde `TEMPORAL_COMPARISON_MISSING` geldiğinde konsol kendi
  sözlüğünü kullanmak yerine sunucunun `renderReason` çıktısını gösterebilir;
  Türkçe cümle sunucuda hazırdır.

### 6.3 `claims[].entailmentMeasured` / `claims[].entailmentAggregation` (B-31)

- **Alanlar:** `entailmentMeasured: boolean`,
  `entailmentAggregation: "segments" | "set" | "max" | "none"`.
- **Ekran (KABUL: kural tabanlı modda yüzde gösterilmez):**
  - `entailmentMeasured === false` → "Anlamsal doğrulama" ekseni
    **"— (kural tabanlı üretimde ölçülmez)"** olarak gösterilir; **yüzde
    yazılmaz**. (W12-B2'nin `currentnessApplicable === false` kalıbının aynısı.)
  - `entailmentMeasured === true` → bugünkü yüzde.
  - İsteğe bağlı ipucu (tooltip): `entailmentAggregation === "segments"` →
    **"Her tespit parçası kendi pasajına karşı ölçüldü"**;
    `"set"` → **"Tespit, atıf yapılan pasajların birleşimine karşı ölçüldü"**.
- `reasons` içinde yeni görülebilecek kodlar ve hazır Türkçe karşılıkları
  (sunucu `renderReason` veriyor):
  - `ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM:<claimId>` — *"Tespit birden çok
    pasaja dayanıyor ama hangi pasajın hangi kısmı taşıdığı belirtilmemiş;
    ölçüm en yüksek tek pasaj üzerinden yapıldı"*
  - `UNUSED_CITATION:<claimId>:<evidenceId>` — *"Bu atıf, tespide diğer
    atıfların taşımadığı hiçbir şey eklemiyor"*
  - `TEMPORAL_COMPARISON_MISSING` — yukarıda.

### 6.4 B-06'nın konsol tarafı (ENGRISK'in ikinci sıra düzeltmesi)

Sunucu tarafı **zaten** `warnings` içinde
`RETRIEVAL_LANE_DEGRADED:<lane>:<detay>` gönderiyor (değişmedi). L-CONSOLE'un
Faz B'de yapması gereken: bunu **görünür** bir uyarıya çevirmek —
**"Arama şeritlerinden biri zaman aşımına uğradı; sonuç eksik olabilir."**
Bu satır uyarı bütçesinin bir bloğudur.

---

## 7. `openapi.yaml` additive delta (L-DOCS, Faz B)

Hiçbir yol, hiçbir operasyon, hiçbir parametre eklenmedi/kaldırılmadı.
`AnswerResult` şemasına **additive** alanlar:

| Şema | Alan | Tip | Not |
|---|---|---|---|
| `QuestionCoverage` | `measuredOn` | `string enum: soru \| soru+olay` | opsiyonel; kapsamın hangi metin üzerinden ölçüldüğü (B-08) |
| `AnswerResult` | `temporal` | `object` | opsiyonel; **yalnız zamansal soruda** bulunur (B-09) |
| `AnswerResult.temporal` | `applicable` | `boolean` | |
| | `present` | `boolean` | |
| | `asOf` | `string (date)` | |
| | `versions` | `array of TemporalVersion` | |
| | `amendedBy` | `array of AmendingInstrument` | |
| | `note` | `string` | hazır Türkçe cümle |
| `TemporalVersion` (yeni şema) | `evidenceId`, `documentId`, `documentVersionId`, `title` | `string` | |
| | `legislationNo`, `article`, `effectiveFrom` | `string` | opsiyonel |
| | `role` | `enum: sorulan-tarihte \| sonraki \| onceki \| belirsiz` | |
| `AmendingInstrument` (yeni şema) | `chunkId`, `documentVersionId`, `title`, `kind` | `string` | `kind` = `legal.relation_kind` |
| | `legislationNo` | `string` | opsiyonel |
| `Claim` | `entailmentAggregation` | `enum: segments \| set \| max \| none` | opsiyonel (B-31) |
| `Claim` | `entailmentMeasured` | `boolean` | opsiyonel (B-31) |

Yeni **gerekçe kodları** (`reasons` dizisi, serbest string olduğu için şema
değişikliği gerektirmez ama belgelenmeli):
`TEMPORAL_COMPARISON_MISSING`, `ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM:<claimId>`,
`UNUSED_CITATION:<claimId>:<evidenceId>`.

---

## 8. `integrationRequests` — başka hatların dosyalarında gereken değişiklikler

Hiçbiri bu hat tarafından yapılmadı.

1. **L-CONSOLE** · `control-plane/public/console.html` — §6'daki üç görünüm
   (kapsam `measuredOn` satırı, `temporal` kartı, `entailmentMeasured` ekseni)
   ve `RETRIEVAL_LANE_DEGRADED`'in görünür uyarıya çevrilmesi. Gerekçe: Faz
   A'da `console.html`e yalnız L-CONSOLE dokunur (G.1 sözleşme 2).
2. **L-DOCS** · `control-plane/src/api/openapi.yaml` — §7'deki additive delta.
   Gerekçe: Faz A'da openapi'ye kimse dokunmaz (G.1 sözleşme 3).
3. **L-DOCS** · `docs/implementation/STATUS.md` — "Ölçülen sayılar" tablosuna
   bu rapordaki ölçümler (B-06 20 006 parçada 19 702 ms → 40 ms; cevap düzeyi
   kesinleştirilebilir oran %47,6 → %85,7 ve **"kusurun kalkması"** ibaresi;
   uzun/kısa biçim tablosu). Gerekçe: Faz A'da STATUS'a kimse dokunmaz
   (G.1 sözleşme 4). **Bu hattın hiçbir sayısı STATUS'a kendisi yazılmadı.**
4. **L-DOCS** · `docs/architecture/ADRS.md` — iki yeni ADR önerisi:
   (a) *trigram şeridi indekslenebilir predikat + işlem-yerel planlayıcı
   düzeltmesi* (B-06, §1.2'deki TOAST gerekçesiyle);
   (b) *entailment segment sözleşmesi ve toplama kuralı* (B-31, ARCH §4.3).
   Gerekçe: ikisi de kalıcı mimari kararlardır.
5. **L-SAFE** (isteğe bağlı, bu dalga için gerekli değil) ·
   `.github/workflows/ci.yml` — `tests/store/retrieval.test.ts`'in yeni `(k)`
   bloğu `collex_answer_test` adında bir veritabanı yaratıp düşürüyor; B-12
   ile gelen PostgreSQL servisinde ek bir ayar gerekmez, yalnız bilgi olsun
   diye bildiriliyor.
6. **L-SOURCES** (bilgi) · `tests/research/**` testleri bu hattaki
   `addressesSameIssue` daraltmasından etkilenmedi; ilk denemede etkilenmişti
   ve kural, karşıt pasajın **kendi** E./K. numarasını kullanmayacak biçimde
   düzeltildi (§5.1(ii)). L-SOURCES'ın bir şey yapması gerekmiyor.

---

## 9. Ölçülen test sonuçları (bu makine, 02.09.2026)

```
cd control-plane && npx tsc --noEmit
  -> bu hattın dosyalarında 0 hata.
     (Koşu sırasında başka hatların dosyalarında geçici hatalar görüldü ve
      DÜZELTİLMEDİ: src/ai/masking.ts, src/ai/routes.ts,
      tests/drafting/contracts.test.ts, tests/integration/app.test.ts.
      Son koşuda tsc tamamen temiz döndü.)

cd control-plane && npx vitest run tests/answer tests/pipeline tests/quality \
                                   tests/store/retrieval.test.ts
  -> Test Files 16 passed (16) · Tests 398 passed (398)
     answer/coverage 39 · answer/entailmentSegments 15 (YENİ) ·
     answer/answerHonesty 28 · answer/ruleDrafter 8 · answer/evidencePack 16 ·
     answer/renderer 10 · answer/pipeline 5 · answer/lexicalEntailment 6 ·
     answer/verifierFinalizability 10 · pipeline/answerPipeline 40 ·
     pipeline/answerService 24 · pipeline/console 110 ·
     pipeline/courtDateFilters 8 · pipeline/retrievalProvenance 7 ·
     quality/retrievalQuality 29 · store/retrieval 43

cd control-plane && npx vitest run            # bütün süit
  -> Test Files 100 passed (100) · Tests 1993 passed | 6 skipped (1999)
     (Bir sonraki koşuda tests/integration/serve.test.ts'in üç testi
      "collex_intake_test veritabanına başka bir ColleX sunucusu zaten bağlı"
      diyerek düştü — eşzamanlı koşan başka bir hattın sunucusu. Tek başına
      yeniden koşturuldu: 4 passed | 1 skipped. Bu hattın değişiklikleriyle
      ilgisi yok.)

.venv/Scripts/python.exe -m pytest evals/tests -q
  -> 74 passed

.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02
  -> RESULT: PASS   (6/6 sert kapı PASS; cevap düzeyi sayıları §5.3)
```

Veritabanı hijyeni: bu hat yalnız `collex_answer_test` adını yarattı ve
düşürdü (probe + testin kendi bloğu; koşu sonunda **yok**). Kendi test
dosyalarının sahip olduğu `collex_retrieval_test` ve `collex_quality_test`
alışıldık biçimde kullanıldı. `collex_local`'a **hiç dokunulmadı**. Hiçbir
sunucu başlatılmadı; 8942/8787/8898 portlarında bu hattan bir dinleyici yok
(`netstat` boş). Geçici dosyaların tamamı scratchpad'de.

---

## 10. Açık konular — dürüstçe

1. **B-06'nın kapanmayan yarısı.** İndeks artık kullanılıyor ama *yaygın
   sözcüklü / uzun* sorgularda GIN aday kümesi bu probe korpusunda neredeyse
   bütün tabloyu kapsıyor ve `<%` recheck'i (TOAST açma + trigram çıkarma)
   20 saniyeyi yiyor. Sonuç kümesini değiştirmeden aday sınırı koymanın
   deterministik bir tasarımı gerekiyor (sıralama anahtarına göre kesmek
   yüksek skorlu satırları düşürür). ENGRISK'in 1,56 ms'i bu hattın kendi
   probe korpusunda **yeniden üretilemedi**.
2. **B-06 planlayıcı düzeltmesi bir çekiçtir.** `enable_seqscan = off`
   işlem-yereldir ve ölçülmüş bir yanlış maliyetlemeyi düzeltir; doğru kalıcı
   çözüm `word_similarity` için gerçekçi bir `COST` ya da `search_text`
   üzerinde detoast maliyetini planlayıcıya gösteren bir şema kararıdır —
   ikisi de migration/DDL işidir (L-SAFE) ve bu dalgada **yapılmadı**.
3. **B-09 tetikleyicisi dar tutuldu** (§4.2). Çıplak `asOf` zamansal sayılmıyor;
   bu bilinçli ve ölçülmüş bir sapmadır, ve bir sonraki dalganın kararıdır.
4. **B-31 padding denetimi birleşim yolunda sözcükseldir.** Segment varken
   kesindir (hiçbir segmentin sahiplenmediği atıf), segmentsiz birleşim
   yolunda "hiç yeni token katmayan atıf" ölçütü lexical-v0'ın kendi
   sınırlarını taşır.
5. **`fx-amend-002`** (§5.3): beklenen birim kanıtta %100 → %95,2. Kök neden
   B-07'nin çıplak kanun kabulü; satır hâlâ COMPLETE ve yanlış çekimser değil,
   ama gold'un adlandırdığı madde artık kanıt listesinde değil. Bunu bir eşik
   oynatarak "düzeltmek" reddedildi.
6. **Uzun soru eşiği (400 kod noktası) ölçülmüş değil, belgelenmiş bir
   sabittir.** Denetlenen kısa biçimler 40–120, denetlenen olay örgüsü 1 178
   kod noktası; aradaki her değer aynı ayrımı yapar. Gerçek kullanımda
   300–500 arası sorular hangi tarafa düşerse orada davranış değişir.
7. **B-08'in "olay metni sıralama sinyalidir" sözü kısmen doğrudur.** Uzun
   biçimde artık **iki** birincil sorgu koşuyor (tam metin + çıkarılan hukukî
   soru); bu, uzun sorularda korpusa bir ek sorgu maliyeti getirir
   (bu makinede ölçülemeyecek kadar küçük: quality korpusunda p50 < 20 ms).
8. **Hiçbir şey canlı doğrulanmadı.** mevzuat.gov.tr / Yargıtay / Bedesten bu
   makineden erişilemiyor; bu hattın hiçbir kalemi canlı upstream'e bağlı
   değildir ve hiçbiri canlı sınanmadı.
