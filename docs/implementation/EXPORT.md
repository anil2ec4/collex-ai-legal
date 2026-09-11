# EXPORT — Kanıt paketinden avukat teslimine (DOCX / Markdown / UDF-deneysel)

Son güncelleme: **03.09.2026**, **W14 Faz C kapanışı** (W12 lane C + W14
L-EVID/L-FIX + Faz F + Faz C).

> **Faz C'nin tek değişikliği (N-3).** `export/draft.py` artık her uyarıyı
> `presentable_warning(text, numbering)` üzerinden geçiriyor ve `parse_draft`
> bunu merkezî olarak yaptığı için **`Draft` nesnesini okuyan her dışa
> aktarıcı** (`petition.py`, `udf.py`, paket) aynı disiplini kendiliğinden
> alıyor. Kural: kanıt kimliği **silinmez**, parantezin içine taşınır ve
> cümle Türkçe bir sözcükle başlar — `'ev-f4d6…' alıntısı …` yerine
> `bir kanıtın (kanıt kimliği: ev-f4d6…) alıntısı …`, K-n bilindiğinde
> `K-1 numaralı kanıtın (…)`. Ölçüm: TASLAK gövdesinde parantez dışında
> duran UPPER_SNAKE makine kodu **0**; NİHAİ kopya zaten temizdi ve
> **temiz kaldı** (STATUS S35). Açık kalan tek sınır kalemi: `petition.py`'nin
> ek künye bloğundaki `Kanıt kimliği: ev-…` satırı — etiketli, Türkçesi
> önde ve NİHAİ kopyada zaten yok, ama parantez kuralına birebir uymuyor.

Bu belge `export/` paketini
anlatır: TypeScript cevap hattının ürettiği **kanıt paketini**
(`collex.answer.evidence-bundle/v1`, bkz. `control-plane/src/answer/renderer.ts`)
ve dilekçe hattının ürettiği **taslağı** (`collex.draft/v1`) Türk avukatının
Word/UYAP akışında kullanabileceği bir belgeye dönüştüren katman. §1–§4 kanıt
paketi dışa aktarımını, **§5 dilekçe taslağı dışa aktarımını (DOCX + UDF)**,
**§8 W14'ün üç yeni çıktısını ve iki yeni kipini** anlatır.

> **Sayı kuralı.** Bu belgede ölçülmüş sayı yoktur; hepsi `STATUS.md`
> "Ölçülen sayılar" tablosundadır (S1–S40) ve buradan satır kimliğiyle
> anılır.

Ürünün farkı, "Word'e aktarabiliyoruz" değildir; rakipler de aktarıyor. Fark,
**aktarılan belgenin doğrulanabilir bir kanıt ekiyle çıkmasıdır**: her
alıntının yanında belge sürüm kimliği, kod noktası konumu, alıntı SHA-256 ve
belge içerik SHA-256 vardır; okuyucu bu sisteme hiç güvenmeden alıntıyı
kaynağına geri bağlayabilir.

---

## 1. Hızlı kullanım

### CLI

```bash
C:/Users/anile/Desktop/yargı-anıl/yargi-mcp-independent/.venv/Scripts/python.exe \
  -m export.cli --bundle <paket.json> --out <cikti> --format docx|md
```

- `--format` verilmezse `--out` uzantısından çıkarılır (`.docx` → docx,
  `.md`/`.markdown` → md, aksi halde docx).
- `--generated-at <ISO>` belge üretim zamanını sabitler (yeniden üretilebilir
  çıktı, testler ve diff için).
- `--quiet` başarı özetini bastırır.

**Çıkış kodları sözleşmenin parçasıdır:**

| Kod | Anlamı | Dosya yazıldı mı? |
|---|---|---|
| `0` | Dışa aktarma başarılı ve kendi kendini doğruladı | evet |
| `1` | Kullanım hatası, okunamayan dosya veya bozuk/desteklenmeyen paket | hayır |
| `2` | **DIŞA AKTARMA REDDEDİLDİ** — bir alıntı, özet, offset veya atıf doğrulanamadı | hayır |

Sıfır olmayan her çıkışta **hiçbir dosya yazılmaz** (DOCX yolu geçici dosyaya
yazar, doğrular, ancak ondan sonra `os.replace` ile hedefe taşır).

Ölçülmüş örnek (bu depodaki sentetik fixture ile):

```
$ ... -m export.cli --bundle tests/export/fixtures/bundle_sentetik_serhli.json \
      --out <scratch>/cevap.docx --format docx
DOCX yazıldı: ...\cevap.docx | atıf: 4 | bütünlük: 5 alıntının tamamı doğrulandı;
5 tanesi kanonik metin + offset karşılaştırmasıyla (1 uyarı) | atıfsız kaynak: 1 | SENTETİK VERİ
  UYARI UNCITED_EVIDENCE (bundle): 1 kaynak değerlendirilmiş ancak hiçbir tespitte atıf yapılmamış; ...
exit 0
```

### Kütüphane olarak

```python
from export.bundle import load_bundle
from export.bundle_markdown import export_markdown   # stdlib-only
from export.bundle_docx import export_docx           # python-docx ister

bundle = load_bundle("paket.json")
result = export_docx(bundle, "cevap.docx")
print(result.summary())          # atıf sayısı + bütünlük özeti
```

`export_docx` / `export_markdown` başarısızlıkta `export.errors.ExportRefused`
fırlatır ve geride dosya bırakmaz.

### Bağımlılık

`python-docx` **isteğe bağlı extra**'dır:

```bash
pip install ".[export]"
```

Sunucunun kendisi Word dosyası yazmadığı için MCP kurulumu yalın kalır.
`export/__init__.py`, `export.bundle`, `export.verify`, `export.plan`,
`export.bundle_markdown` ve `export.cli` yalnız standart kütüphaneye dayanır;
`python-docx` sadece `export/bundle_docx.py` içinde import edilir.

---

## 2. Doğrulama garantisi

> **Doğrulanamayan bir dışa aktarma, hiç dışa aktarmamaktan daha kötüdür.**

Dosya yazılmadan önce iki aşama çalışır.

### 2.1 Paket bütünlüğü (`export/verify.py`)

Paketteki **her** kanıt kaydı için (atıf yapılmayanlar dâhil):

| Kod | Kontrol |
|---|---|
| `QUOTE_EMPTY` | Alıntı boş / yalnız boşluk |
| `QUOTE_CONTROL_CHARS` | OOXML metin düğümünde birebir taşınamayan karakter (CR dâhil — XML satır sonu normalizasyonu özeti bozardı) |
| `HASH_MALFORMED` | `quoteSha256` / `contentSha256` 64 haneli küçük harf hex değil |
| `QUOTE_HASH_MISMATCH` | `sha256(quote.utf8) != quoteSha256` — **kurcalama dedektörü** |
| `LOCATOR_INVALID` | Negatif / artmayan offset |
| `LOCATOR_SPAN_MISMATCH` | `endChar - startChar`, alıntının kod noktası uzunluğuna eşit değil |
| `DUPLICATE_EVIDENCE_ID` | Aynı `evidenceId` iki kez |
| `CONTENT_HASH_MISMATCH` | (paket `texts` taşıyorsa) kanonik metin `contentSha256`'ya hash'lenmiyor |
| `OFFSET_TEXT_MISMATCH` | (paket `texts` taşıyorsa) kod noktası aralığı bu alıntıyı vermiyor |
| `UNKNOWN_EVIDENCE_ID` | Bir tespit, pakette olmayan kaynağa atıf yapıyor — **uydurulmuş atıf** |
| `DUPLICATE_CLAIM_ID` | Aynı `claimId` iki kez |

Uyarı (dışa aktarmayı engellemez, ama belgede görünür):
`NON_NFC_QUOTE`, `UNCITED_EVIDENCE`, `ABSTAIN_WITH_CITATIONS`.

Offset birimi proje geneliyle aynıdır: **Unicode kod noktası**, NFC kanonik
metin üzerinde (bkz. `control-plane/fixtures/offset_policy.json`). Python `str`
dilimleme zaten kod noktası dilimlemesidir.

### 2.2 Yazılan belgenin kendi kendini doğrulaması

DOCX yolu, dosyayı geçici bir dosyaya yazar, **python-docx ile tekrar açar** ve
şunları kanıtlar:

- gövdedeki atıf numaraları ile `KAYNAKLAR` girişleri **birebir aynı küme**
  (ne sarkan atıf, ne öksüz giriş — iki yönde de),
- yazılan her alıntı, paketteki alıntıyla **karakter karakter aynı**,
- zorunlu bölümler (`KAYNAKLAR`, `DOĞRULAMA`, `Çelişen Otoriteler`,
  `Çekimser Kalınan Sonuçlar`) mevcut,
- zorunlu "avukat incelemesi" altbilgisi yazılmış,
- paket sentetikse `SENTETİK` etiketi belgede var.

Ancak bu kontrollerden sonra dosya hedefe taşınır. Markdown yolunda aynı atıf
kapanış kontrolü, üretilen metin tekrar ayrıştırılarak yapılır.

**Uydurma/düşürme neden mümkün değil:** atıf numaraları tek bir yerde
(`export/plan.py`) üretilir; bir numara ancak bir tespitin, pakette
**çözümlenen** bir kaynağa atıf yapmasıyla doğar. Gövde ve ek, aynı plandan
render edilir ve sonra gerçek dosya üzerinde karşılaştırılır.

**Sahte atıf işareti üretilemez:** güvenilmeyen metin (tespit gövdesi, başlık,
mahkeme adı) Markdown'da `escape_inline` ile köşeli parantezleri kaçırılarak
yazılır; DOCX'te atıf işaretleri yalnız kendine ait `CollexAtif` stilindeki
paragraflarda taranır, alıntılar `CollexQuote` stilindedir ve taramaya
girmez. Böylece içinde `[9]` geçen bir alıntı/tespit sahte atıf üretemez.

### 2.3 Çekimser (abstention) davranışı

`status == "ABSTAIN"` olan pakette **hiç numaralandırılmış kaynak yazılmaz**.
Doğrulama eşiğini geçmemiş kaynakları numaralandırmak, olmayan bir dayanağı
varmış gibi gösterirdi. Bunun yerine:

- `Çekimser Kalınan Sonuçlar` bölümü açıkça yazılır,
- `KAYNAKLAR` bölümü "0 atıf" olduğunu ve nedenini söyler,
- değerlendirilen ancak yayımlanmayan kaynak **sayısı** bildirilir (sessizce
  düşürülmez).

Çekimser olmayan paketlerde `INSUFFICIENT_EVIDENCE` verdiktli tespitler de
aynı bölümde "kaynaksız, karara dayanak yapılamaz" etiketiyle listelenir.

---

## 3. Belge yapısı (`collex.export.evidence-report/v1`)

1. Başlık + (varsa) `SENTETİK VERİ` bandı + avukat inceleme uyarısı
2. **Belge Künyesi** — insan satırları (soru, değerlendirme tarihi
   GG.AA.YYYY, cevap durumu Türkçe, belge üretim zamanı, kesinleştirme
   cümlesi, tespit/kaynak/atıf sayıları, bütünlük özeti) + **Teknik künye**
   alt tablosu (ham durum kodu, ISO damgalar, sistem sürümü, üretici, şema,
   güven boyutlarının İngilizce karşılıkları)
3. **Cevap Gövdesi** — her tespit için metin + `Atıflar: [1][2]` satırı
   (+ varsa `Karşıt kaynaklar: [3]`)
4. **Tespit Bazlı Güven Tablosu** — beş boyut (ortak sözlük): Kaynak
   isabeti · Pasaj desteği · Otorite · Güncellik · Kapsam
5. **Çelişen Otoriteler** — her zaman yazılır; yoksa "tespit edilmedi" der
6. **Çekimser Kalınan Sonuçlar** — her zaman yazılır
7. **Makine Gerekçeleri**
8. **KAYNAKLAR** — giriş başına: mahkeme/daire, E./K., tarih (GG.AA.YYYY),
   mevzuat no, madde/fıkra, otorite kademesi, güncellik, sonuç yönü,
   **birebir alıntı bloğu**, alıntı SHA-256, belge içerik SHA-256, belge
   sürüm kimliği, belge kimliği, kod noktası konumu, kaynak, kaynak URL,
   alınma zamanı, kanıt kimliği
9. **DOĞRULAMA** — okuyucunun alıntıyı bağımsız doğrulama tarifi

Her sayfanın altbilgisinde (brief 11.5):

> MAKİNE ÜRETİMİ BELGE — AVUKAT İNCELEMESİ ZORUNLUDUR. Bu metin hukukî
> mütalaa değildir ve olduğu gibi kullanılamaz.

Sentetik pakette altbilgiye ayrıca `SENTETİK VERİ` satırı eklenir. Markdown'ın
sayfası olmadığı için aynı uyarı dosyanın **başına ve sonuna** yazılır.

### Güvenlik notu

Alıntılar, başlıklar ve URL'ler **güvenilmeyen içeriktir**. Markdown'da
alıntılar, içindeki en uzun backtick dizisinden bir fazla uzunlukta bir çitle
sarılır: bayt bayt korunur (yani hâlâ `quoteSha256`'ya hash'lenir) ama tüm
Markdown/HTML anlamını kaybeder. Diğer güvenilmeyen dizeler
`escape_inline` (TypeScript `escapeInline` fonksiyonunun birebir aynadaki
karşılığı) ile nötrlenir. `http(s)` olmayan URL'ler hiç yazılmaz;
"(güvenli olmayan URL gizlendi)" konur.

---

## 4. Paketleme boşluğu ve düzeltmesi

**Sorun (daha önceki bir lane tarafından raporlanmıştı):**
`legal_contracts/`, `legal_reference/`, `ingestion/` — ve yeni `export/` —
`pyproject.toml` içindeki `[tool.setuptools.packages.find]` listesinde
**yoktu**. Bu paketler pytest altında sorunsuz import ediliyordu, çünkü depo
kökü tesadüfen `sys.path` üzerindeydi; ama **kurulmuş bir dağıtımda yoklardı**.
Bir lane, tam bu yüzden kodu import etmek yerine kopyalamak zorunda kalmıştı.

Ölçüm (düzeltmeden önceki ve sonraki `include` listeleriyle
`setuptools.find_packages`):

```
BEFORE fix, missing: ['export', 'ingestion', 'legal_contracts', 'legal_reference']
AFTER  fix, missing: []
```

**Düzeltme:** `[tool.setuptools.packages.find].include` artık her birinci
taraf paketi (gelecekteki alt paketleri de kapsayacak `*` ekiyle) sayıyor:

```toml
include = [
    "*_mcp_module",
    "semantic_search",
    "mevzuat_semantic_search",
    "legal_contracts*",
    "legal_reference*",
    "ingestion*",
    "export*",
]
```

### Kanıt: wheel üretip tek kullanımlık venv'e kurmak

Deponun kendi `.venv`'i **değiştirilmez**. Deponun `.venv`'inde `pip` /
`setuptools` yoktur (uv ile yönetiliyor), bu yüzden derleme tek kullanımlık
bir venv'den yapılır:

```bash
SCRATCH=<oturum scratchpad dizini>

# 1) Tek kullanımlık derleme ortamı
uv venv "$SCRATCH/buildvenv" --python 3.13
uv pip install --python "$SCRATCH/buildvenv/Scripts/python.exe" "setuptools>=77" wheel pip

# 2) Wheel
cd <repo>
"$SCRATCH/buildvenv/Scripts/python.exe" -m pip wheel . --no-deps --no-build-isolation -w "$SCRATCH/wheel"

# 3) Tek kullanımlık kurulum ortamı (deponun .venv'i DEĞİL)
uv venv "$SCRATCH/provevenv" --python 3.13
uv pip install --python "$SCRATCH/provevenv/Scripts/python.exe" --no-deps "$SCRATCH/wheel/yargi_mevzuat_mcp_independent-1.0.0-py3-none-any.whl"
uv pip install --python "$SCRATCH/provevenv/Scripts/python.exe" httpx pydantic python-docx

# 4) İmport kanıtı — cwd depo kökü OLMAMALI
"$SCRATCH/provevenv/Scripts/python.exe" -X utf8 "$SCRATCH/wheel_import_proof.py"
```

Kanıt betiği önce `sys.path` üzerinde depo kaynak ağacı olmadığını doğrular
(aksi hâlde kanıt geçersizdir), sonra `legal_contracts`, `legal_reference`,
`ingestion`, `export` paketlerini import eder ve her birinin `__file__`
yolunun `site-packages` altında olduğunu iddia eder. Alt modüller
(`legal_contracts.classify_exception`, `legal_reference.parse_references`,
`ingestion.chunking`, `export.bundle_docx`, `export.cli`) de import edilir.

Ölçülen sonuç: **PROOF PASSED**, wheel içeriği `export/`, `ingestion/`,
`legal_contracts/`, `legal_reference/` dizinlerini içeriyor.

`uv build` bu makinede setuptools'u derleme izolasyonuna çekemediği için
kullanılmadı; `uv lock` (extra eklendikten sonra) çalıştırıldı ve
`python-docx` kilit dosyasına eklendi.

---

## 5. Dilekçe taslağı dışa aktarımı (DOCX + UDF-deneysel) ve UYAP sınırları

### 5.1 Ne üretilir

Taslak (`collex.draft/v1`; `POST /v1/drafts`, `PUT /v1/drafts/{id}` ile
sürümlenir) üç biçimde dışa verilir — hepsi `GET /v1/drafts/{id}/export?format=`
ve `export.cli --draft <taslak.json> --out <dosya> --format …` üzerinden:

| `format` | Üretici | Doğrulama | Durum |
|---|---|---|---|
| `md` | `control-plane/src/drafting/markdown.ts` | atıf kapanışı | üretim |
| `docx` (`dilekce-docx`) | `export/petition.py` | yazılmadan önce yeniden doğrulama; yazıldıktan sonra **yeniden açılıp** öz-denetim; refusal = exit 2, dosya yok | üretim |
| `udf` (`dilekce-udf`) | `export/udf.py` | aynı ön-doğrulama; yazıldıktan sonra kendi okuyucusuyla + `intake/extract.py::extract_udf` ile geri okuma | **DENEYSEL** (ADR-019) |

Ortak parça `export/draft.py`: `parse_draft`, `load_draft`,
`verify_draft_or_refuse`, `Draft.numbering()`, `citation_ref(n) → "K-n"`.
`export/petition.py` eski adları yeniden dışa verir; mevcut import'lar
çalışmaya devam eder.

### 5.2 Taslak belgesinin yapısı (W12 ile değişenler)

- **Tarihler her yerde GG.AA.YYYY**: olaylar, künye tarih alanları,
  arabuluculuk tarihi, imza satırı (`Yer, GG.AA.YYYY`), etiketler
  (`T. GG.AA.YYYY`), MD/DOCX/UDF meta satırları (`Sürüm`, `Son düzenleme
  GG.AA.YYYY HH:MM`, `Dosya`). Gövdede ISO tarih yoktur.
- **Gövde atıfları `Dayanak [K-n]: <künye>`** ve `Karşı içtihat [K-n]: …`
  biçimindedir; `n`, `draft.evidence` içindeki 1-tabanlı sıradır. Gövdede
  **hash veya UUID yoktur**.
- **`EK — DOĞRULAMA BİLGİLERİ`** (`ek-dogrulama`, makineye ait, salt okunur
  son bölüm): her kanıt için etiket, kısa alıntı, SHA-256 ilk 8 hanesi, tarih,
  doğrulama durumu. Yüklenen belgeler dosya başına gruplanır. `PUT` ile
  gönderilen içerik yok sayılır ve bölüm yeniden üretilir.
- **DAYANAK KAYNAKLARI** eki belgenin sonundadır: `[K-n] label` başlığı, tam
  hash'ler, `Kanıt kimliği: <id>`; yüklenen belge için `Kaynak: yüklenen
  belge` ve alıntı bloğu yok.
- Taraf bloğu TCKN/VKN, adres, `VEKİLİ : Av. … (Baro, Sicil No: …)`,
  `DOSYA NO`, `DAVA DEĞERİ`; imza `DAVACI VEKİLİ / Av. … — (imza)`; başlık
  `matter.mahkeme` + yönelme eki (son ünlü sezgiseli — incelenecek metin).
- **Yüklenen belgeler delil, dayanak değil** (ADR-021): DELİLLER'de dosya
  başına `Ek-n: <dosya> (yüklenen belge, <sha256 ilk 8>)`; hukukî
  değerlendirme paragrafı üretmez; `suggestedFacts` yalnız öneridir, asla
  kendiliğinden eklenmez.
- Çelişen içtihat: destekleyen taraf `Doğrulanmış kaynak uyarınca — …` +
  sabit cümle `Aksi yönde karar için DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT
  bölümüne bakınız.`; karşıt kayıt asla `Dayanak` olmaz.
- DOCX öz-denetimi ek olarak `ATIF_BICIMI` (K-n dışı gövde atfı) ve
  `KANIT_NUMARASI` (ek numaralaması ≠ taslak sırası) ile **reddeder**.

### 5.3 UDF — deneysel, imzasız, UYAP editöründe doğrulanmadı

`export/udf.py` tek `content.xml` içeren bir zip yazar:
`<template format_id="1.8"><content><![CDATA[…]]></content><properties>
<pageFormat …/></properties><elements><paragraph …><content startOffset=
length= family="Times New Roman" size="12" …/></paragraph>…</elements>
</template>` — `intake/extract.py::extract_udf`'nin okuduğu yapı. 1. satır
inceleme bandı; 2. satır birebir **`Bu UDF dosyası deneyseldir ve
imzasızdır; UYAP Doküman Editörü'nde açarak doğrulayın.`**; KAYNAKSIZ
satırlar ön ekli; atıflar `Dayanak [K-n]: …`; ek DOCX'teki gibi.

- **Ofsetler UTF-16 kod birimidir** (UYAP editörü Java'dır ve
  `startOffset/length` Java dizgi indeksidir). Bu, ADR-003'ün kod noktası
  kuralına **dosya sınırlı** bir istisnadır: ADR-003 bu sistemin kendi
  sözleşmelerindeki kanonik metin ofsetlerini yönetir; yabancı bir editörün
  dosya biçimi o değildir. Taslaktaki, DOCX'teki ve ek-dogrulama'daki her
  hash/ofset kod noktası + UTF-8 kalır.
- Yazma: önce doğrula, geçici dosyaya yaz, yeniden aç, öz-denetim (band,
  deneysel satırı, her paragraf satırı, KAYNAKSIZ sayısı, `K-n` atıflarının
  ekte çözülmesi, her elemanın aralığının kendi satırını dilimlemesi, karşı
  içtihat girişi), sonra `os.replace`; başarısızlıkta geçici dosya silinir.
- HTTP: `application/octet-stream`, `content-disposition: attachment;
  filename="<id>.udf"`, başlık **`X-ColleX-Experimental: udf`**; hatalı
  `format` 400 mesajı udf'yi `deneysel — UYAP Doküman Editörü'nde açarak
  doğrulayın` diye adlandırır; exporter hatası `500 EXPORT_REFUSED` (exit 2)
  / `EXPORT_FAILED` + aynı `note`.
- **Doğrulanmayan:** dosya **hiç UYAP Doküman Editörü'nde açılmadı**.
  `pageFormat`, `Alignment`, `SpaceBelow` gibi öznitelikler kamuya açık
  örneklerden ve deponun kendi fixture'ından en iyi tahmindir. Dosya
  tasarım gereği imzasızdır.

Ölçülen (02.09.2026): `tests/export/test_udf_export.py` — `extract_udf` ile
gidiş-dönüş, kurcalanmış alıntı → exit 2 ve dosya yok, `KANIT_NUMARASI`
reddi; `tests/export` toplam **87 passed**. HTTP probe (`W12-INTEGRATION.md`
§6): `format=udf` → 5963 bayt, PK imzası, `X-ColleX-Experimental: udf`.

### 5.4 İmza zinciri — değişmeyen sınırlar

Brief 11.3 ve 11.5 bağlayıcıdır. Bu paket **imza zincirine hiç dokunmaz**:

- **İmzalı UDF üretilmez.** İmzalı evrak yeniden serileştirilmez; imzalı
  belgede yapılan değişiklik imza bilgisini kaybettirir.
- **PIN, token veya özel anahtar** sisteme girilmez, saklanmaz, istenmez.
- İmza geçerliliği gerçekten doğrulanmadıkça "doğrulandı" denmez.
- Model kullanıcı adına imza atmaz ve UYAP'a evrak göndermez.
- UDF'nin *deneysel* etiketi, ancak resmî editörde gerçek fixture'larla
  yapılmış ve kaydedilmiş bir uyumluluk testinden sonra kaldırılabilir.

Word/UYAP akışı:

1. Cevap hattı kanıt paketini, taslak hattı taslağı üretir.
2. `export.cli` doğrulanmış `.docx` (ve istenirse deneysel `.udf`) üretir.
3. Avukat `.docx`'i Word'de düzenler; **KAYNAKLAR/DAYANAK KAYNAKLARI**,
   **DOĞRULAMA/EK — DOĞRULAMA BİLGİLERİ** bölümleri belgede kalır, böylece
   karşı taraf/hâkim aynı hash'lerle doğrulayabilir.
4. Avukat belgeyi resmî UYAP Editör'e alır (deneysel `.udf`'yi orada açıp
   **kontrol eder**), son hâlini verir ve **kendi** imzasıyla imzalar. Sistem
   bu adımın hiçbir parçası değildir.

Citation gate'i geçmeyen paragraf ya bloke edilir ya da açık
"KAYNAKSIZ/inceleme gerekli" etiketiyle ayrılır — her biçim ikinci davranışı
uygular ve KAYNAKSIZ sayısı belgede görünür.

---

## 6. Üretici tarafındaki isteğe bağlı alanlar — durum (02.09.2026, kod okunarak doğrulandı)

`export/bundle.py` şu **isteğe bağlı, geriye dönük uyumlu** alanları okur.
Eski sürümde bu bölüm "üretici henüz yazmıyor" diyordu; artık **yazıyor** —
ancak `renderEvidenceBundle` tarafından değil, onu saran katmanlar
tarafından. Kaynak dosyalar (okundu, tahmin değil):

| Alan | Kim yazıyor | Nerede |
|---|---|---|
| `synthetic`, `syntheticNotice`, `producer` | `AnswerPipeline` (yerel cevap): `{...renderEvidenceBundle(doc), synthetic: this.syntheticCorpus, syntheticNotice: this.corpusNotice, producer: this.producer}`; `runResearch` (canlı): `synthetic:false`, `syntheticNotice: LIVE_CORPUS_NOTICE`, `producer: "collex.control-plane/researchService v1 (live)"` | `control-plane/src/pipeline/answerPipeline.ts` (render aşaması), `control-plane/src/research/researchService.ts` (sonuç nesnesi) |
| `texts: {documentVersionId: canonicalNfcText}` | `buildAnswerBundle(run, {includeTexts:true})` (`POST /v1/answer` `includeTexts`, depoya yazılan paket ve `GET /v1/answers/{runId}/evidence-bundle?texts=true`); canlı çalışmada `toAnswerEntry` (`{...result.bundle, texts: run.texts}`) | `control-plane/src/api/answerService.ts`, `control-plane/src/research/routes.ts` |
| `evidence[].origin` (`upload` / `corpus` / `live`) | `renderEvidenceBundle`'ın kendisi (W12-B2; `item.origin` varsa) — `export/bundle.py` bu alanı **okumaz, yok sayar** (bilinmeyen anahtar) | `control-plane/src/answer/renderer.ts` |

`renderEvidenceBundle` (`renderer.ts`) hâlâ yalnız çekirdek sözleşmeyi
üretir (`schema … evidence`) ve `synthetic`/`producer`/`texts` yazmaz; bu
bilinçli bir katmanlamadır — korpusun sentetik olup olduğunu ve üreticiyi
bilen taraf boru hattıdır, renderer değil. Bu yüzden `renderEvidenceBundle`'ı
doğrudan çağıran bir üretici bu alanları kendisi eklemek zorundadır.

Etki, değişmedi: `texts` varken doğrulama "kanonik metin `contentSha256`'ya
hash'leniyor **ve** kod noktası aralığı tam bu alıntıyı veriyor" seviyesine
çıkar (`texts` yoksa `hash_only_ids`); `synthetic` varken her insan-görünür
yüzey `SENTETİK` etiketlenir. **Sentetik veriyle çalışan hiçbir demoda
`synthetic` bayrağı atlanmamalıdır** — boru hattı bunu varsayılan olarak
`true` yazar (`syntheticCorpus` yalnız gerçek korpusta açıkça `false`
yapılır). Ölçüm: `tests/pipeline/answerService.test.ts` ("keeps the
synthetic-corpus provenance the exporter reads") üç alanı boru hattı
çıktısında; `tests/integration/app.test.ts` `?texts=true` yolunu doğrular.

Güncellik sözlüğü: `export/text.py::CURRENTNESS_TR` W12-API2 ile
`NOT_APPLICABLE → "yüklediğiniz belge — yürürlük değerlendirilemez"`
girdisini aldı; `bundle_docx.py` / `bundle_markdown.py` KAYNAKLAR
girişindeki `Güncellik` satırında bunu basar (bilinmeyen kod olduğu gibi
kalır). `tests/export` bunu iki biçimde de doğrular.

---

## 7. Testler

```bash
C:/Users/anile/Desktop/yargı-anıl/yargi-mcp-independent/.venv/Scripts/python.exe -m pytest tests/export -q
```

Ölçülen (02.09.2026): **87 passed** (tamamen offline; ağ, veritabanı veya
MCP sunucu modülü yok; `tests/export/conftest.py` sağlayıcı env
değişkenlerini import öncesinde boşaltır). W12 ile eklenen 14 test:
`test_udf_export.py` (gidiş-dönüş, refusal), DOCX ek-dogrulama +
GG.AA.YYYY, ek numaralaması reddi.

Kapsanan davranışlar:

- Üretilen fixture'ların **gerçek** hash ve offset taşıdığı,
- bir alıntıda **tek karakter** değişince hem `QUOTE_HASH_MISMATCH` hem
  `OFFSET_TEXT_MISMATCH` ile yakalandığı; `texts` olmadan da yakalandığı,
- uydurulmuş atıf, bozuk offset, `\r` içeren alıntı, tekrar eden kimlik,
  bozuk şema/enum/confidence değerlerinin reddedildiği,
- DOCX **tekrar açılıp** gövde atıfları ile KAYNAKLAR girişlerinin iki yönde
  de birebir eşleştiği (öksüz/sarkan atıf yok),
- DOCX'teki alıntıların pakettekiyle **bayt bayt aynı** olduğu,
- hash/sürüm kimliği/offset alanlarının belgede bulunduğu,
- çekimser pakette **sıfır** atıf ve `Çekimser` bölümünün varlığı,
- kurcalanmış paketin CLI'da **sıfır olmayan** çıkışa (2) yol açtığı ve
  geride hiçbir dosya (geçici dosya dâhil) bırakmadığı,
- avukat-inceleme altbilgisinin belgede bulunduğu,
- `[9]` içeren güvenilmeyen metnin sahte atıf üretemediği,
- `javascript:` URL'nin yazılmadığı.

### Fixture'lar

`tests/export/fixtures/*.json` dosyaları
`tests/export/fixtures/_build_fixtures.py` ile `evals/fixtures/corpus`
altındaki **SENTETİK** korpustan üretilir; içindeki her hash ve offset
gerçektir. Yeniden üretmek için:

```bash
C:/.../.venv/Scripts/python.exe tests/export/fixtures/_build_fixtures.py
```

`bundle_sentetik_serhli.json` — ŞERHLİ cevap: 4 tespit, 5 kaynak (biri
bilerek atıfsız), gerçek bir **çelişen otorite çifti** (Yargıtay fixture 1 ve
2) ve bir `INSUFFICIENT_EVIDENCE` tespiti.
`bundle_sentetik_cekimser.json` — dürüst çekimser cevap.

Bu dosyalar **gerçek Türk mevzuatı veya gerçek mahkeme kararı değildir.**

---

## 8. W14: iki kip, üç yeni çıktı ve bir ret

### 8.1 Dışa aktarım kipleri — içeriği yönetir, doğrulamayı ASLA (ADR-024)

`GET /v1/drafts/{id}/export?format=docx&annex=…&marks=…`

| Parametre | Değerler | Ne yapar |
|---|---|---|
| `annex` | `full` (varsayılan) · `none` | `none`: künye tablosu, uyarılar, `EK — DOĞRULAMA BİLGİLERİ`, `DAYANAK KAYNAKLARI` eki ve biçim notları çıkmaz |
| `marks` | `all` (varsayılan) · `none` | `none`: ekran işaretleri (`⚠ KAYNAKSIZ`, `[K-n]` çipleri) çıkmaz |

`annex=none&marks=none` **dosyalanabilir NİHAİ kopyadır**. Kural tek cümlede:
**mürekkebi silmek disiplini silmez** — `verify_draft_or_refuse` (alıntı
sağlamaları, atıf kapanışı, KAYNAKSIZ sayımı ve B-01 denetimi) **her kipte
aynı** koşar, zorunlu inceleme bandı ve altbilgi **her kipte** kalır.
Ölçülen: nihai kopyada `[K-n]`, SHA-256, `collex.` şema etiketi, ham kural
kimliği ve "kiracı yüklemesi" ifadesi **0 kez**; sayfa **A4 21×29,7 cm**,
mahkeme hitabı ortalı, imza sağa yaslı, gövde iki yana yaslı (STATUS S2/S3;
ölçüm `waves/W14-L-VERIFY.md` §4.3, python-docx ile açılarak).

### 8.2 Alıntı bütünlüğü reddi (ADR-023)

Bir paragraf, atıf yaptığı alıntıyı **birebir** içermek zorundadır — iki
runtime'ın üzerinde anlaştığı tek kanonik biçimde (render guard'ın entity
kaçışları geri açılır, görünmez/BiDi karakterler atılır, NFC, boşluklar
sadeleşir). Başka hiçbir şey bağışlanmaz ve karşılaştırma bir **alt dize
aramasıdır**; `.length`/`.slice` aritmetiği yoktur.

Bozulmuşsa: `md`/`docx`/`udf` dışa aktarımı **409 `EXPORT_REFUSED` /
`QUOTE_ALTERED`** ile reddedilir, **dışa aktarıcı süreç hiç başlatılmaz** ve
**hiçbir dosya yazılmaz** (geçici dosya dâhil). Kapı **iki bağımsız
katmandadır**: `PUT` yolu bağı anında koparır (`issues[].code =
QUOTE_ALTERED`, paragraf KAYNAKSIZ'a düşer) ve `export/draft.py` mağazaya
başka yoldan girmiş bir taslağı yakalar. **Asla bir benzerlik skoruyla
değiştirilmez.**

Dürüst kayıt: tarayıcıda tahrifat üretilerek **PUT katmanı** doğrulandı;
**`409` yolu uçtan uca üretilemedi**, çünkü PUT bağı zaten kopardığı için
mağazaya bozuk alıntılı bir taslak giremiyor. İkinci katman yalnız kendi
testiyle kanıtlıdır (`waves/W14-L-VERIFY.md` §4.3).

### 8.3 Üç yeni çıktı

| Şema | CLI | HTTP | Ne üretir |
|---|---|---|---|
| `collex.citation-audit/v1` | `export.cli --audit <rapor.json> --format denetim-docx` | `GET /v1/drafts/{id}/export?format=denetim-docx` | Atıf Denetim Raporu: üç kova (`Bulundu` / `Bulunamadı` / `Belirsiz`), `asOf` = **belgenin tarihi**, çözülemeyen atıfın künye hücresi **BOŞ** |
| `collex.contract-review/v1` | `export.cli --review <rapor.json> --format inceleme-docx` | **yok** — HTTP ucu inmedi | Sözleşme inceleme raporu: VAR/YOK/BELİRSİZ, "risk" kelimesi yalnız hash'li alıntıya ait |
| `collex.matter-package/v1` | `export.cli --package <plan.json> --format dosya-paketi-zip` | `POST /v1/matters/{id}/package` | Dosya paketi ZIP: `dosya-ozeti.docx` + `belgeler/` + `taslaklar/` + `arastirmalar/` + `MANIFEST.json` |

Üçü de aynı disipline uyar: **katı ayrıştır → kur → geçici adla yaz → belgeyi
yeniden aç ve kendi kendine denetle → yayımla**. Reddedilen bir dışa aktarım
**hiçbir dosya bırakmaz**, geçici dosya dâhil.

İki ayrıntı bu üçünde kritik:

* **Denetim raporu boş künye hücresini arşivin İÇİNDE doğrular.**
  `export/audit.py` yazdığı DOCX hücresini geri okur ve boş olması gerekirken
  doluysa **reddeder**. Uydurma künye bu yüzden bir kural değil, bir kapıdır.
* **Paket her sha256'yı bitmiş arşivin içinde yeniden hesaplar.** HTTP ucu
  (`packageRoutes.ts`) **tek bayt okumaz ve tek özet hesaplamaz**; alıcı için
  `verify_package(path)` bağımsız doğrulamadır ve kurcalanmış bir arşiv
  `GİRDİ_ÖZETİ` ile düşer.

### 8.4 Asılların yeri (Faz F, V-4)

Paket ve "Aslını indir" asılları **`<COLLEX_DATA_DIR>/uploads/<sha256><ext>`**
altından okur — intake'in yazdığı klasörün aynısı —, `COLLEX_DATA_DIR` boşsa
`<depo>/var/uploads`. Faz F öncesinde uçlar bu değeri hiç almıyordu ve
`COLLEX_DATA_DIR` kurulu bir makinede "Aslını indir" **her belgede 404**
veriyordu; paket de asılları taşımıyordu ("yalnız adı yazıldı"). Düzeltme
sonrası ölçülen: indirilen baytın sha256'sı hem diskteki asılla hem yüklenen
dosyayla **birebir aynı** (STATUS S31).

**Kalan kusur, açıkça:** "asıl bulunamadı" cümlesi üç yerde (`files/routes.ts`,
`matters/packageRoutes.ts`, `openapi.yaml`) hâlâ **"var/uploads klasöründe
yok"** diyor ve `COLLEX_DATA_DIR` kurulumunda **yanlış klasörü** işaret ediyor.
Üçü birlikte değiştirilmelidir.

### 8.5 Bu dalgada inmeyenler

* `inceleme-docx` için **HTTP ucu yok** (üretici hazır ve testli).
* `POST /v1/exports/grid` yok: belge × soru ızgarası **CSV** olarak iniyor.
  CSV Word'de açılır ama **bir DOCX değildir ve öyle sunulmuyor**.
* B-18'in kronoloji DOCX'i yok.
* Konsolda "Nihai kopya indir" ve "Dosya paketini indir" **düğmeleri yok**;
  uçlar çalışıyor, kontrol **yok** — sessizce bozuk değil.

---
