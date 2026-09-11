# W13 — Hat FEATURE: gerçek bir tek-avukat bürosuna karşı özellik denetimi

Tarih: 02.09.2026 · Hat: FEATURE (araştırma/denetim; hiçbir ürün dosyası
değiştirilmedi) · Kapsam: bugün ColleX'te **ne var**, bir tek-avukat
bürosunun dava yaşam döngüsünde **ne eksik**, ve eksiklerin sıralı yığını.

Yöntem: kod ve belge okuma. Sunucu **başlatılmadı** (8933 kullanılmadı);
tek çalıştırılan komut, MCP araç yüzeyini saymak için `.venv` ile in-memory
FastMCP listelemesidir (ağ yok, yazma yok). Sayı taşıyan her satır ya bu
oturumda ölçüldü ya da `STATUS.md` "Ölçülen sayılar" satırına (S1–S22)
atıf yapar. **Rakip iddiası yok** — bu hat ürünün kendisini denetler;
rakip satırları `docs/COMPETITIVE.md`'dedir ve oradan alıntılanırken
[doğrulandı]/[pazarlama]/[çıkarım] etiketi taşınır.

Bu belgede kullanılan tek etiket seti: **[ölçüldü]** = bu oturumda kod/komut
çıktısıyla doğrulandı · **[belge]** = W12 hat raporundan veya STATUS'tan
alındı · **[çıkarım]** = iki kaynağın karşılaştırmasından çıkan sonuç.

---

## 0. Tek paragraflık sonuç

ColleX'in **motoru**, arayüzünden çok daha güçlü. 54 araçlık resmî kaynak
geçidinin **26'sı** ürünün herhangi bir yolundan çağrılabiliyor, kalan
**28'i hiçbir kod yolundan çağrılmıyor** [ölçüldü]. Yerel korpus üzerinde
tam bir hibrit arama ucu (`POST /v1/search`: FTS + trigram + citator +
`asOf` + `fileIds` + 100 sonuç) **çalışır hâlde duruyor ve konsoldan hiç
çağrılmıyor** [ölçüldü]. Avukatın araştırma yapmasının tek yolu, tek bir
serbest metin sorusudur ve o soru en fazla **6 tam belge** getirir
(`DEFAULT_RESEARCH_BUDGETS`) — yani bir avukatın gerçekte yaptığı iş
("İzmir BAM, 2023–2025, tahliye taahhüdü, 30 karar tara, 5'ini işaretle")
bugün **imkânsız**. Buna karşılık ürünün dosya/belge/taslak/süre
omurgası sağlam ve dürüst. En büyük üç boşluk sırayla: **(1) gerçek bir
karar arama ekranı**, **(2) yedekleme/geri yükleme**, **(3) araştırmada
getirilen belgelerin yerel korpusa kalıcı yazılmaması** — üçü de mevcut
taşlarla yerelde kurulabilir.

---

## 1. Envanter — bugün ne var

### 1.1 HTTP yüzeyi: 35 yol / 44 işlem, **5 yol arayüzden erişilemez**

Uç listesi `waves/W12-INTEGRATION.md` §3'tedir (bu belge listeyi
tekrarlamaz). Bu hattın eklediği tek şey **erişilebilirlik denetimi**:
`control-plane/public/console.html` içinde geçen tüm `/v1/...` dizileri
tarandı [ölçüldü].

| Yol | Konsoldan çağrılıyor mu | Not |
|---|---|---|
| `POST /v1/search` | **HAYIR** | Tam hibrit arama ucu: `query`, `asOf`, `filters.{sources,documentTypes,courtTypes,fileIds,includeCorpus}`, `limits.resultLimit ≤ 100`, şerit ayarları (`retrieval/searchService.ts` §Request schema). Ürünün en pahalı yeteneği ve **hiçbir ekrandan çağrılmıyor**. |
| `POST /v1/evidence-bundle` | **HAYIR** | Konsol yalnız `GET /v1/answers/{runId}/evidence-bundle` kullanıyor; kanıt paketini dosya olarak indirme düğmesi yok. |
| `POST /v1/research-runs`, `GET /v1/research-runs/{id}` | **HAYIR** | Eski koşu yüzeyi; canlı hat `/v1/research*` üzerinden gidiyor. |
| `GET /v1/deadlines/holidays` | **HAYIR** | Resmî tatil/dini bayram/adli tatil verisi (`deadlines/holidays.ts`) hiçbir ekranda gösterilmiyor — avukat "2027'de adli tatil ne zaman?" diye soramıyor. |
| Diğer 30 yol | evet | — |

### 1.2 Konsol: beş sekme + iki gizli sayfa

`W12-UI1.md` §1 ve `W12-UI2.md` §1 fonksiyon haritasıdır. Özet ve bu
hattın not ettiği sınırlar:

| Ekran | Ne yapılabiliyor | Bu hattın notu |
|---|---|---|
| **Dosyalarım** | Dosya CRUD, durum süzgeci, `?q=` arama, 14 günlük süre paneli, satıra sürükle-bırak yükleme | `?q=` yalnız `title/client/opposing/court/docket_no` sütunlarında ILIKE yapıyor (`matters/store.ts:119`) [ölçüldü] — not, olay, süre, cevap, taslak metni **aranamıyor** |
| **Dosya sayfası** | 6 sekme (Belgeler/Araştırmalar/Taslaklar/Zaman çizelgesi/Süreler/Notlar), hızlı işlemler | Dosya = tek düzlem. Klasör, etiket, alt-dosya, karşı dosya (icra ⇄ dava) bağı yok |
| **Araştır** | TEK serbest metin sorusu; 3 kapsam (Yerel korpus / Canlı / Yüklediğim belgeler); `asOf`; Bulut AI çipi; ilerleme paneli; geçmiş | Filtre yok (mahkeme, daire, tarih aralığı, karar türü), sonuç **listesi** yok, kaydedilmiş arama yok, favori/etiket yok. Yerel korpus günlük kurulumda **boş** → o kapsam her zaman ÇEKİMSER (`KULLANIM-ColleX.md` §4) [belge] |
| **Belgeler** | Sürükle-bırak çoklu yükleme (kuyruk), `?q=` **dosya adı** süzgeci, kart işlemleri | İçerik araması yok; klasör/etiket yok; toplu işlem (çoklu seçim → dosyaya ekle/sil) yok |
| **Belge sayfası** | Bölüm önizleme + çapa, 3 kapsamla "Belgeye sor", otomatik ön inceleme (atıf/tarih/talep), Bulut AI analizi + OCR kancaları | Ön inceleme kalemleri **tek tek** işlenir: her atıf için ayrı "Korpusta doğrula", her tarih için ayrı "Zaman çizelgesine ekle". Toplu işlem yok (§4.2) |
| **Taslak** | 13 şablon, gruplu dinamik form, ön-dolum, 4 kanıt kaynağı, editör (linter, sürüm, DOCX/MD/UDF), Kayıtlı taslaklar | Şablon kümesi sabit ve **kod içinde**; avukat kendi kalıbını ekleyemez |
| **Ayarlar** | Profil (10 alan), şehir, tema, demo, Sistem durumu, "Verilerim nerede?" | **Yedekleme yok**, dışa aktarma yok, saklama süresi/temizlik yok |

### 1.3 CLI'lar

| CLI | Ne yapar | Avukat erişebiliyor mu |
|---|---|---|
| `intake/cli.py` | `--file/--list/--show/--delete/--ensure-db` (yükleme, listeleme, silme, şema) | Dolaylı: `/v1/files` bu CLI'ı çağırır; `--ensure-db` başlatıcıdan |
| `ingestion/cli.py` | Fixture korpusu → PostgreSQL (provenance'lı) | **Hayır** — ürün yolunda hiç çağrılmıyor |
| `export/cli.py` | `--bundle` (kanıt paketi → DOCX/MD) · `--draft --format dilekce-docx\|dilekce-udf` | Dolaylı: taslak dışa aktarımı; **kanıt paketi dışa aktarımı arayüzde yok** |
| `scripts/*.py` (16 dosya) | Denetim/eval/canlı kontrol | Hayır (geliştirici) |
| `control-plane/scripts/{serve,serve-mcp,demo}.mjs` | Sunucu, MCP çocuğu, 6 senaryo demo | `ColleX-Baslat.cmd` üzerinden |

### 1.4 Şablonlar (13), süre kuralları (30), dosya modeli

- **13 şablon** [belge S11]: 7 dilekçe (dava, cevap, istinaf başvuru,
  temyiz, ihtarname, icra itiraz, arabuluculuk başvuru) + 6 sözleşme
  (hizmet, kira, tahliye taahhütnamesi, iş, satış, vekâlet ücreti). Her
  şablon `domain` taşır (12 × `ozel-hukuk`, `icra-itiraz-dilekcesi` =
  `icra`).
- **30 süre kuralı** [belge S12]: HMK 9 · CMK 4 · İYUK 6 · İİK 6 · AYM 1 ·
  Diğer 4. **Tamamı `verified.status:'dogrulanmadi'`**, 3'ü
  `computable:false` (`hmk-islah`, `hmk-karar-duzeltme`,
  `is-arabuluculuk-dava-sarti`) [ölçüldü, `deadlines/rules.ts`].
- **Dosya modeli** (`matters/types.ts`) [ölçüldü]:
  `Matter{title, client, opposing, court, docketNo, kind, status, notes}` —
  `client`/`opposing` **düz metin**, ayrı kişi kaydı yok. Öğe türleri:
  `file · answer · draft · note · event · deadline` (6). **Yok:**
  `hearing` (duruşma), `expense`/`fee` (masraf/ücret), `task` (yapılacak),
  `contact` (kişi), `correspondence` (yazışma/tebligat).

### 1.5 MCP araç yüzeyi — 54 araç, ne getiriyorlar

`.venv/Scripts/python.exe` ile in-memory FastMCP listelemesi: **54**
[ölçüldü]. Not: `mcp_server_main.py`'deki Yargıtay/Danıştay'a özel beş
araç (`search_yargitay_detailed`, `get_yargitay_document_markdown`,
`search_danistay_by_keyword`, `search_danistay_detailed`,
`get_danistay_document_markdown`) üçlü tırnak içinde **devre dışı**dır
(satır 417 `"""`) [ölçüldü]; Yargıtay/Danıştay'a erişim yalnız
`search_bedesten_unified`'ın `court_types` parametresi üzerindendir.

**A. Mahkeme kararı (8 araç)**

| Araç | Ne getirir |
|---|---|
| `search_bedesten_unified` | Bedesten üzerinden Yargıtay · Danıştay · Yerel Hukuk · İstinaf Hukuk · KYB karar kayıtları; tam ifade/AND/OR/NOT operatörleri, tarih aralığı, `court_types` |
| `get_bedesten_document_markdown` | Bedesten belgesinin tam metni (Markdown) |
| `search` / `fetch` | Aynı Bedesten hattının ChatGPT Deep Research uyumlu sarmalayıcıları |
| `search_emsal_detailed_decisions` | UYAP Emsal (yerel mahkeme + BAM içtihadı) |
| `get_emsal_document_markdown` | Emsal kararının tam metni |
| `search_uyusmazlik_decisions` | Uyuşmazlık Mahkemesi (adlî ⇄ idarî görev uyuşmazlığı) |
| `get_uyusmazlik_document_markdown_from_url` | Uyuşmazlık kararının tam metni |

**B. Anayasa Mahkemesi (2)** — `search_anayasa_unified` (norm denetimi +
bireysel başvuru, incelenen norm filtreleri), `get_anayasa_document_unified`.

**C. Düzenleyici kurul / özel yargı (16)** — arama + tam metin çiftleri:
KİK (`search_kik_v2_decisions` uyuşmazlık/düzenleyici/mahkeme kararı türleri),
Rekabet Kurumu (`PdfText` ile karar gövdesinde arama), Sayıştay (Genel
Kurul / Temyiz Kurulu / Daire), KVKK, BDDK, BTK Kurul kararları, GİB özelge
(18 bin+ özelge; `kanunNo` süzgeci), Sigorta Tahkim (Hakem Karar Dergisi
1–64, 2010–2025) + `search_within_sigorta_tahkim_issue` (bir dergi sayısı
içinde karar bazlı arama).

**D. Mevzuat — mevzuat.gov.tr hattı (20)** — dokuz tür için arama +
"içinde arama" çiftleri: `search_kanun`/`search_within_kanun`,
`search_khk`/`search_within_khk`, `search_tuzuk`/`search_within_tuzuk`,
`search_kurum_yonetmelik`/`search_within_kurum_yonetmelik`,
`search_teblig`/`search_within_teblig` + `get_teblig_content`,
`search_cbk`/`search_within_cbk`,
`search_cbyonetmelik`/`search_within_cbyonetmelik`,
`search_cbbaskankarar`/`search_within_cbbaskankarar` + `get_cbbaskankarar_content`,
`search_cbgenelge`/`search_within_cbgenelge` + `get_cbgenelge_content`.
`search_within_*` ailesi anahtar kelime **veya anlamsal** (embedding
anahtarı varsa) madde içi aramadır.

**E. Mevzuat — bedesten.adalet.gov.tr hattı (5)** —
`search_mevzuat` (12 mevzuat türü, `mevzuat_no` ile numaradan doğrudan),
`get_mevzuat_content`, `search_within_mevzuat` (madde bazlı),
**`get_mevzuat_gerekce`** (kanun/madde gerekçesi — hazırlık çalışmaları),
**`get_mevzuat_madde_tree`** (kanunun içindekiler ağacı).

**F. Sağlık (1)** — `check_government_servers_health`.

**G. Koşullu 55'inci** — `search_bedesten_semantic` (yalnız
`OPENROUTER_API_KEY` varken; 10 adayı embedding'le yeniden sıralar).

### 1.6 MCP erişilebilirlik denetimi — **28 araç ölü**

Denetim: `control-plane/src/planner/` içinde geçen tüm araç adları
tarandı; ayrıca `research/routes.ts` sağlık probu ve
`capabilities/registry.ts` haritası okundu [ölçüldü].

**Ürünün herhangi bir yolundan çağrılabilen 26 araç:**

- Arama (13): `search_bedesten_unified`, `search_anayasa_unified`,
  `search_uyusmazlik_decisions`, `search_mevzuat`, `search_within_kanun`,
  `search_kvkk_decisions`, `search_rekabet_kurumu_decisions`,
  `search_kik_v2_decisions`, `search_bddk_decisions`,
  `search_btk_decisions`, `search_gib_ozelge`,
  `search_sigorta_tahkim_decisions`, `search_sayistay_unified`
- Tam metin (12): `fetch` (Bedesten), `get_emsal_document_markdown`,
  `get_anayasa_document_unified`, `get_mevzuat_content`,
  `get_kik_v2_document_markdown`, `get_kvkk_document_markdown`,
  `get_rekabet_kurumu_document`, `get_sayistay_document_unified`,
  `get_bddk_document_markdown`, `get_btk_document_markdown`,
  `get_gib_ozelge_document_markdown`,
  `get_sigorta_tahkim_document_markdown`
- Sağlık (1): `check_government_servers_health` (`GET /v1/research/health`)

**Hiçbir kod yolundan çağrılmayan 28 araç:** dokuz tür-özel mevzuat
araması (`search_kanun`, `search_khk`, `search_tuzuk`,
`search_kurum_yonetmelik`, `search_teblig`, `search_cbk`,
`search_cbyonetmelik`, `search_cbbaskankarar`, `search_cbgenelge`),
`search_within_*` ailesinin `kanun` dışındaki 10 üyesi,
`get_teblig_content`, `get_cbbaskankarar_content`, `get_cbgenelge_content`,
**`get_mevzuat_gerekce`**, **`get_mevzuat_madde_tree`**,
`get_bedesten_document_markdown` (yerine `fetch` kullanılıyor),
`search_emsal_detailed_decisions`, `search`,
`get_uyusmazlik_document_markdown_from_url`.

İki tanesi **yapısal kusur** derecesinde:

1. **Emsal ölü döngü.** `get_emsal_document_markdown` fetch tablosunda var
   (`planner/templates.ts:234`) ama **hiçbir plan `search_emsal_detailed_decisions`
   çağırmıyor** → EMSAL sağlayıcılı bir isabet hiç üretilemiyor, dolayısıyla
   o fetch aracı da hiç çalışmıyor. Yerel mahkeme ve BAM içtihadı — bir solo
   litigatörün en çok baktığı katman — canlı araştırmada **hiç taranmıyor**.
2. **Uyuşmazlık alıntılanamaz.** `search_uyusmazlik_decisions` planlanıyor
   ama `FETCH_BY_PROVIDER`'da `UYUSMAZLIK` **yok**
   (`planner/templates.ts:231–272`); kodun kendi yorumu bunu kabul ediyor
   (`research/payloads.ts`: "Uyuşmazlık has no fetch descriptor"). Arama
   özeti kanıt sayılmadığı için (doğru kural) Uyuşmazlık kararları
   **hiçbir cevaba giremez** — arama bütçesi harcanır, kanıt üretilmez.

### 1.7 Canlı araştırmanın gerçek tavanı

`researchService.ts` [ölçüldü]: varsayılan **16 araç çağrısı / 6 tam belge
/ 90 sn**; sert tavan 24 / 10 / 120 sn; konsol bütçe göndermiyor. Yani bir
soru = en fazla **6 tam karar/mevzuat metni**. Sonuç tek bir *cevap* olarak
çizilir (`render()`); getirilen kararların listesi, künyesi, "şunu da aç"
yolu yoktur.

---

## 2. Yaşam döngüsü denetimi — dava dosyasının 13 durağı

Her satır: **Var mı / Nasıl / Ne eksik**. "Şiddet" sütunu bu hattın
önceliklendirmesidir (P0 = solo pratikte iş durduran, P3 = konfor).

| # | Durak | ColleX bugün | Eksik | Şiddet |
|---|---|---|---|---|
| 1 | **Müvekkil görüşmesi** | Yok. Not alınabilir (`note` öğesi, ≤64 KB) | Görüşme kaydı/şablonu, vekâletname kontrol listesi, çıkar çatışması (menfaat çatışması) taraması — mevcut dosyalardaki `client`/`opposing` metinlerinde arama ile kolayca yapılabilirdi | P2 |
| 2 | **Dosya açılışı** | **Güçlü.** `POST /v1/matters` + otomatik bağlama (`matterLink.ts`), yanlış kimlik iş yapılmadan 404 | Kişi kaydı yok (her dosyada müvekkil adı yeniden yazılır); dosya numarası/iç referans yok; vekâletname, baro pulu, harç gibi açılış kontrol listesi yok | P2 |
| 3 | **Belge toplama** | **İyi.** PDF/DOCX/TXT/UDF, 25 MB, sha256 kimlik, "zaten yüklüydü", taranmış sayfa raporu, dosyaya otomatik bağ | Klasör/etiket yok; içerik araması yok; çoklu seçim + toplu işlem yok; taranmış PDF için **yerel** OCR yok (yalnız bulut, canlı sınanmamış); e-postadan/UYAP'tan alma yok | P1 |
| 4 | **Hukukî araştırma** | **En zayıf halka.** Tek serbest metin sorusu; canlı geçit 6 tam belge; alıntılar hash'li ve doğrulanmış; karşıt otorite taraması zorunlu; `asOf` çalışıyor | **Karar arama ekranı yok** (mahkeme/daire/tarih/karar türü filtresi, sonuç listesi, künye, favori/etiket, kaydedilmiş arama). Emsal hiç taranmıyor (§1.6). Yerel korpus boş → `POST /v1/search` ölü. Getirilen belge kalıcı değil | **P0** |
| 5 | **Dava/cevap dilekçesi** | **Güçlü.** 13 şablon, kanıt disiplini, KAYNAKSIZ rozeti, alaka kapısı, sürümlü editör, DOCX/MD/UDF | Şablon kümesi kod içinde — avukat kendi kalıbını ekleyemez; eksik dilekçe türleri: bilirkişi raporuna itiraz, delil/tanık listesi, ıslah, tedbir talebi, istinaf/temyiz **cevap** dilekçesi | P1 |
| 6 | **Deliller** | Yüklenen belge `Ek-n` olarak DELİLLER'e giriyor, `suggestedFacts` üretiliyor (ADR-021) | Delil listesi ayrı bir varlık değil (tanık, bilirkişi, keşif, yemin, ATK raporu); delil ⇄ iddia eşlemesi (claim chart) yok; delil dilekçesi üretimi yok | P2 |
| 7 | **Duruşma hazırlığı** | **Yok.** `duruşma` yalnız süre kuralı notlarında ve şablon metinlerinde geçiyor [ölçüldü] | Duruşma kaydı, duruşma takvimi, celse hazırlık kontrol listesi (beyanlar, sorulacaklar, dosyadaki son işlem, süresi geçen talepler), duruşma tutanağı yükleme akışı | **P0** |
| 8 | **Ara kararlar** | Zaman çizelgesine elle olay eklenebilir | Ara karar → gereğinin yapılması için süre + görev üretimi (en tipik süre kaçırma noktası); "yerine getirilecekler" listesi | P1 |
| 9 | **Bilirkişi** | Yok (kelime yalnız şablon metninde) | Rapor yükleme → itiraz süresi (2 hafta, HMK m.281) otomatik başlatma; rapora itiraz dilekçesi şablonu; rapordaki tarih/tutar çıkarımı (`extract_dates` zaten var) | P1 |
| 10 | **İstinaf / temyiz** | **İyi.** 2 şablon + 6 süre kuralı (HMK/İYUK/CMK), künye alanları | Kesin/kesin olmayan ayrımı ve parasal sınır kontrolü yok; istinaf **cevap** dilekçesi şablonu yok; UYAP'tan gerekçeli karar alma yok | P2 |
| 11 | **İcra** | 1 şablon (icra itiraz) + 6 İİK süre kuralı | Takip talebi/ödeme emri/haciz talebi/istihkak/sıra cetveli şablonu yok; **faiz ve işlemiş alacak hesabı yok** (yasal faiz, avans faizi, temerrüt faizi — saf aritmetik, yerelde kurulabilir); dosya bakiyesi yok | P1 |
| 12 | **Tahsilat** | **Yok** | Tahsilat kaydı, müvekkil cari hesabı, vekâlet ücreti tahakkuku, serbest meslek makbuzu bilgisi | P2 |
| 13 | **Arşiv** | `status:'kapali'` bir alan; başka hiçbir şey | Dosya paketi (ZIP) üretimi, kapanış kontrol listesi, **saklama süresi** (`docs/legal/retention-matrix.yaml` var ama uygulanmıyor), soğuk arşive alma | P1 |

### 2.1 Paralel hatlar

| Hat | ColleX bugün | Eksik | Şiddet |
|---|---|---|---|
| **Takvim / süreler** | 30 kural, adli tatil, resmî/dinî tatil, 14 günlük panel, dosyaya kaydetme; **tamamı `dogrulanmadi`** | Takvim görünümü (ay/hafta) yok; duruşma yok; hatırlatma/bildirim yok (yerelde: masaüstü bildirimi ya da başlangıçta özet); ICS dışa aktarımı yok; `GET /v1/deadlines/holidays` arayüzsüz | **P0** (duruşma+takvim), P1 (ICS/hatırlatma) |
| **Tebligat** | Yalnız süre hesabında tebligat usulü uyarıları (elektronik tebligatta 5. gün vb.) | Tebligat kaydı (tarih, usul, belge), UETS/PTT bağlantısı yok — **yerel olarak çözülemez**, dürüst "yok" | P2 (kayıt tutma kısmı yerelde yapılabilir) |
| **Müvekkil iletişimi** | Yok | Görüşme/telefon/e-posta kaydı, müvekkile durum özeti (sade dille) üretimi — taslak motoru zaten var | P2 |
| **Ücret / masraf** | Yok (`vekâlet ücreti` yalnız bir sözleşme şablonunda) | Harç hesabı (başvurma, peşin, karar-ilam), AAÜT vekâlet ücreti tarifesi, masraf avansı, gider pusulası. Saf aritmetik + yıllık tarife tablosu; **süre kuralları gibi `dogrulanmadi` etiketiyle** çıkabilir | P1 |
| **Adli yardım / CMK** | Yok | CMK görevlendirme kaydı, CMK ücret tarifesi hesabı, adli yardım başvuru/rapor formları — genç solo için gerçek bir gelir hattı | P2 |
| **Arabuluculuk** | 1 şablon + dava şartı cümlesi + `is-arabuluculuk-dava-sarti` (**`computable:false`**) | Son tutanak tarihi → 2 haftalık dava açma süresi hesabı tam olarak bu `computable:false` kuralın kendisi; arabuluculuk süreç kaydı ve anlaşma belgesi şablonu yok | P1 |
| **Sözleşme danışmanlığı** | 6 sözleşme şablonu; Bulut AI `focus=sözleşme` analizi (canlı sınanmamış) | **Yerel** sözleşme inceleme yok (riskli madde kontrol listesi, eksik madde taraması, tarafların yükümlülük çıkarımı) — `intake/analysis.py` iskeleti var; sözleşme sürüm karşılaştırma (redline) yok | P1 |
| **KVKK uyumu** | `docs/legal/` altında ColleX **hakkında** eksiksiz belge seti (aydınlatma, DPA, işleme envanteri, saklama matrisi, DSAR); `search_kvkk_decisions` aracı var (ama UI'sız) | Avukatın **kendi** veri sorumlusu yükümlülüğü için araç yok: müvekkil aydınlatma metni / açık rıza / veri işleyen sözleşmesi şablonu yok (3 şablon = S efor), VERBİS notu yok, dosya bazlı saklama süresi takibi yok | P1 |

---

## 3. Görevde adı geçen aday boşlukların tek tek yargısı

| Aday | Yargı | Gerekçe |
|---|---|---|
| **54 araç üzerinde tam metin karar arama ekranı** | **EVET — 1 numaralı iş** | Bugün araştırma tek bloklu bir soru; 28 araç ölü; Emsal hiç taranmıyor; 6 belge tavanı. Avukatın gerçek davranışı liste tarama + işaretleme. Filtre alanları zaten araç şemalarında var (`court_types`, tarih aralığı, `kanunNo`, `decision_type`) |
| **Yapıştırılan/yüklenen dilekçedeki atıfların doğrulanması** | **EVET — yüksek** | Taşların tamamı var (`intake/analysis.py::extract_references` tekilleştirmeli, `verifyReference`, as-of, citator, karşıt tarama). Bugün **tek tek** ve **`asOf` göndermeden** çalışıyor (`console.html:8340–8346` — `payload` içinde `asOf` yok [ölçüldü]) ve boş yerel korpusa soruyor. `COMPETITIVE.md` §2.9 bunu zaten yol haritası olarak ilan etmiş |
| **Zaman çizelgesi / olay örgüsü çıkarımı** | **EVET — orta** | `extract_dates` + `event` öğesi + zaman çizelgesi sekmesi var; eksik olan **toplu** aktarım ve belgeler arası birleştirme + kronoloji dışa aktarımı. Ucuz |
| **Müvekkil / karşı taraf kartları** | **EVET — orta** | `client`/`opposing` düz metin; her taslakta yeniden yazılıyor; çıkar çatışması taraması imkânsız. Ama iş durdurucu değil |
| **Duruşma takvimi + hazırlık kontrol listesi** | **EVET — 3 numaralı iş** | Litigatörün takvimindeki en kritik nesne bugün sistemde **hiç yok**. `deadline` öğesinin kardeşi olarak `hearing` eklemek küçük; asıl değer hazırlık listesinin dosya içeriğinden üretilmesi |
| **Masraf/ücret, harç, AAÜT hesabı** | **EVET — orta/yüksek** | Her dosyada, her ay. Saf aritmetik; süre kuralları gibi yıllık tarife verisi ister ve aynı dürüstlük etiketiyle (`dogrulanmadi`) çıkmalı |
| **Avukatın düzenleyebildiği şablon kütüphanesi** | **KISMEN** | Tam düzenlenebilir şablon motoru **L** ve composer'ın slot sözlüğünü dışa açmayı gerektirir (risk: kanıt disiplini delinir). Ucuz ve gerçekçi dilim: "bu taslağı başlangıç noktası olarak kaydet" + eksik 4–6 dilekçe türünü kodla eklemek |
| **Toplu belge yükleme + arşiv** | **KISMEN** | Çoklu yükleme zaten var (kuyruk). Gerçek eksik: klasör/etiket, içerik araması, çoklu seçim, ve 25 MB / 180 sn eşiğinin arkasındaki **senkron tek süreç** mimarisi (arka plan kuyruğu = M) |
| **Her şeyde genel arama (global search)** | **EVET — yüksek** | Bugün üç ayrı, dar arama var (dosya alanları, dosya adı, soru kutusu). Not/olay/süre/cevap/taslak metni aranamıyor. `legal.chunks.search_tsv_tr` Türkçe FTS indeksi ve `POST /v1/search` **hazır** duruyor |
| **Dosya paketi (ZIP) dışa aktarımı** | **EVET — yüksek** | Bugün yalnız tek taslak ya da tek kanıt paketi dışa aktarılabiliyor. Meslektaşa devir, müvekkile teslim, arşiv, denetim — hepsi bunu ister |
| **Yedekleme / geri yükleme** | **EVET — 2 numaralı iş, varoluşsal** | `pg_dump`/`yedek`/`backup` deposun ürün kodunda **hiç geçmiyor** [ölçüldü]. Her şey tek bir yerel PostgreSQL'de; `var/uploads/` yalnız asılları tutuyor. Disk giderse dosya, taslak, süre, not gider. Bu bir özellik değil, **meslekî özen** meselesi |
| **Çoklu dil (Kürtçe/İngilizce)** | **HAYIR — P3** | İş ürünü (dilekçe, karar, mevzuat) Türkçe; arayüzü çevirmek bir solo İzmir bürosunda kimseyi kurtarmaz. Gerçek ihtiyaç varsa dar dilimi: **müvekkile sade dilde özet** (dil seçimiyle), arayüz yerelleştirmesi değil |

---

## 4. Sıralı yığın

Sıralama = (sıklık × acı) × yerel stoğumuzla ne kadar dürüstçe teslim
edilebileceği. Her kalem: ne · neden · üstüne kurulacak mevcut taşlar
(dosya yolları) · efor · **kabul ölçütü**.

### F1 — "Karar ara" ekranı: 54 aracın üstünde gerçek arama · **P0 · L**

**Ne.** Yeni bir sekme (`#karar-ara`) ve arkasında yeni bir uç
(`POST /v1/sources/search`, `POST /v1/sources/fetch`): mahkeme/kurul
seçimi, `court_types`, tarih aralığı, karar türü, kanun no, tam ifade;
**sonuç listesi** (künye + eşleşen cümle) → satırda "Tam metni getir"
(fetch → hash'li kanıt kartı), "Dosyaya kaydet", "Taslakta kullan",
"Etiketle". Kaydedilmiş aramalar ve favoriler `matter_items` ya da yeni
bir `saved_search` tablosunda.

**Neden.** Bugün 28 araç ölü (§1.6); Emsal hiç taranmıyor; canlı araştırma
6 belgeyle sınırlı ve sonucu tek bir cevap. Bir litigatörün araştırması
liste tarama işidir; ColleX bunu hiç desteklemiyor.

**Mevcut taşlar.** `control-plane/src/research/mcpSession.ts` (gerçek MCP
oturumu, 54 araç probu, 85 sn tavan) · `research/payloads.ts` (her arama
aracının cevabını tipli isabete çeviren ayrıştırıcı — **zaten dokuz
tür-özel mevzuat aracını ve Emsal'i tanıyor**) · `planner/templates.ts`
`FETCH_BY_PROVIDER` · `research/liveEvidence.ts` (tam belgeden hash'li
alıntı) · `research/progress.ts` (54 aracın Türkçe etiketi hazır) ·
`security/untrusted.ts` + `renderGuard.ts`.

**Efor.** L (uç + ekran + iki eksik sağlayıcı bağı). Alt-dilimlere bölünür:
**F1a** Emsal'i planlayıcıya bağla + Uyuşmazlık fetch tanımını ekle (S,
tek başına değerli), **F1b** `POST /v1/sources/search` + liste ekranı (M),
**F1c** kaydedilmiş arama / favori / etiket (S).

**Kabul ölçütü.** Ağı olan bir makinede "Yargıtay 3. HD · 2023-01-01 →
2025-12-31 · `\"tahliye taahhüdü\"`" araması ≥ 10 künye döndürür; bir satırda
"Tam metni getir" hash'li bir kanıt kartı üretir; aynı kart "Taslakta
kullan" ile bir dilekçeye `[K-n]` olarak girer; arama bir dosyaya
kaydedilip yeniden çalıştırılabilir; `/v1/health` araç sayısı 54 kalır.

### F2 — Yedekleme ve geri yükleme · **P0 · M**

**Ne.** `ColleX-Yedekle.cmd` + Ayarlar'da "Yedek al" düğmesi: `pg_dump`
(`collex_local`) + `var/uploads/` + sürüm/şema damgası → tek `.zip`
(kullanıcının seçtiği klasöre; varsayılan `Belgelerim\ColleX-Yedek\`).
Karşılığı `ColleX-GeriYukle.cmd`: boş bir kümeye geri yazar, ledger'ı
doğrular. Ayarlar'da "Son yedek: GG.AA.YYYY HH:MM" satırı ve 7 günden
eskiyse uyarı.

**Neden.** Bugün hiç yok [ölçüldü]. Tek diskte duran dosya/taslak/süre
kaydının kaybı bir avukat için meslekî sorumluluk doğurur; ürünün
"verileriniz bilgisayarınızda" sözü ancak yedekle birlikte dürüst olur.

**Mevcut taşlar.** `ingestion/migrations.py` (ledger + sentinel probe'ları —
geri yüklemenin doğruluğunu kanıtlayan mekanizma zaten var) ·
`control-plane/src/store/health.ts` (`deriveMigrationHealth`) ·
`ColleX-Baslat.cmd`/`ColleX-Durdur.cmd` (PG yaşam döngüsü ve Türkçe hata
disiplini) · `intake/cli.py --ensure-db`.

**Efor.** M.

**Kabul ölçütü.** Bir dosya + 1 belge + 1 taslak + 1 süre içeren
`collex_local` yedeklenir; PostgreSQL veri dizini silinip küme sıfırdan
kurulur; geri yükleme sonrası `/v1/health` `migrations 11/11` der,
`GET /v1/matters` aynı dosyayı, `GET /v1/files/{id}` aynı `sha256`'yı,
`GET /v1/drafts/{id}/versions` aynı sürüm listesini döndürür. Yedek
alınırken `collex_local`'a **yazılmaz**.

### F3 — Duruşma kaydı + takvim + celse hazırlık listesi · **P0 · M**

**Ne.** Yeni öğe türü `hearing { date, time, court, salon, kind:
'durusma'|'kesif'|'e-durusma', note, status }`; Dosyalarım üstündeki
paneli **takvim** görünümüne çevir (ay/hafta; süre + duruşma birlikte);
duruşmaya tıklayınca **hazırlık kartı**: son celse tutanağı, açık ara
kararlar, süresi yaklaşan işler, dosyadaki son üç belge, hazırlanan
beyanlar, "yanına al" listesi. `.ics` dışa aktarımı.

**Neden.** Litigatörün takvimi duruşmadır; bugün sistemde hiç yok.
Süre paneli var ama duruşma orada görünmüyor.

**Mevcut taşlar.** `matters/{types,store,routes}.ts` (polimorfik öğe
modeli — `deadline` ile birebir aynı kalıp) · `deadlines/holidays.ts`
(tatil verisi) · `console.html` `loadDeadlinePanel`/`daysChip`.

**Efor.** M.

**Kabul ölçütü.** Bir dosyaya duruşma eklenir; Dosyalarım takviminde
süreyle birlikte görünür; 7 gün kala kırmızı; hazırlık kartı o dosyanın
açık sürelerini ve son üç belgesini listeler; `.ics` dosyası Outlook/Takvim
uygulamasında doğru tarih ve saatle açılır.

### F4 — Dilekçe atıf denetçisi (karşı tarafın dilekçesi) · **P0 · M**

**Ne.** Belge sayfasına "**Atıfları denetle**": belgedeki tüm atıflar
(§`extract_references`, tekilleştirilmiş, `count`'lu) tek seferde denetlenir
→ tablo: atıf · bulundu/bulunamadı · **dilekçe tarihi itibarıyla** yürürlük
(yürürlükte / mülga / henüz değil) · varsa aksi yöndeki karar · tam metne
git. Çıktı: tek bir Markdown/DOCX "atıf denetim raporu".

**Neden.** Karşı tarafın mülga fıkraya dayanması sık ve savunulabilir bir
kazanç noktası; iki rakibin resmî sayfalarında atıf doğrulama/yürürlük
kontrolü geçmiyor (`COMPETITIVE.md` §2.9 [çıkarım], 02.09.2026).

**Mevcut taşlar.** `intake/analysis.py::extract_references` (FIX-2 ile
tekilleştirmeli) · `legal_reference/` (Türkçe normalizasyon, kısaltma
tabloları TCK→5237, değişiklik hedef çözümleyici) ·
`control-plane/src/retrieval/referenceParser.ts` (Python ile tek fixture'a
sabitli) · as-of + temporal kapanış (ADR-012) · citator şeridi (ADR-015) ·
karşıt tarama (ADR-008) · `console.html::verifyReference` (tek atıflık
hâli).

**Bu iş sırasında düzeltilecek iki kusur.** (a) `verifyReference` `asOf`
göndermiyor — belgedeki tarih (ya da avukatın seçtiği tarih) gönderilmeli;
(b) sorgu **boş yerel korpusa** gidiyor — F1'den sonra canlı kaynağa ya da
F5'in biriktirdiği yerel korpusa yönlendirilmeli.

**Efor.** M (F1 ya da F5 olmadan sonucu zayıf kalır).

**Kabul ölçütü.** İçinde en az 5 atıf bulunan sentetik bir dilekçe
yüklenir; "Atıfları denetle" tek istekte 5 satırlık tablo üretir; her
satırda yürürlük rozeti dilekçe tarihine göredir; bulunamayan atıf açıkça
"bulunamadı" der (asla uydurulmuş bir künye gösterilmez); rapor DOCX
olarak dışa aktarılır ve içindeki her alıntı `export/` doğrulamasından
geçer.

### F5 — Araştırmada getirilen belgeleri yerel korpusa yaz (kişisel içtihat kütüphanesi) · **P1 · M**

**Ne.** Canlı araştırmanın (ve F1'in) `document.fetch` ile getirdiği her
tam belge, ingestion boru hattından `scope='public'`,
`source='<PROVIDER>'`, provenance ve alınma zaman damgasıyla
`collex_local`'a yazılır. Böylece yerel korpus zamanla avukatın kendi
kütüphanesi olur.

**Neden.** Bugün `collex_local`'ta korpus **boş**; "Yerel korpus" kapsamı
her zaman ÇEKİMSER (`KULLANIM-ColleX.md` §4, RISKS) ve `POST /v1/search`,
FTS indeksi, citator şeridi, as-of motoru **veri bulamıyor**. Aynı kararı
ikinci kez getirmek için tekrar ağa çıkılıyor. Bu kalem ürünü tek seferlik
bir araçtan **biriken bir varlığa** çevirir ve F6/F4'ün değerini açar.

**Mevcut taşlar.** `ingestion/pipeline.py` (`connect_local`, tek giriş
noktası) · `identity.py`/`versioning.py`/`chunking.py`/`indexer.py`
(provenance'lı, çakışmasız parçalama — ADR-013) · `relations.py` (citator
kenarları) · `research/liveEvidence.ts` (kanonik metin zaten elde) ·
`store/chunkStore.ts` (FTS/trigram/citator şeritleri hazır).

**Efor.** M. **Dikkat:** `collex_local`'a yazan ilk ürün yolu bu olacağı
için kaynak ayrımı (`scope`, `source`, `fetchedAt`) ve "SENTETİK değil,
resmî kaynaktan alınmış" etiketi baştan doğru kurulmalı; disk büyümesi
için basit bir üst sınır/temizlik gerekir.

**Kabul ölçütü.** Bir canlı araştırma koşusu sonrası `/v1/health`
`corpus.publicDocuments` artar; aynı soru ikinci kez "Yerel korpus"
kapsamıyla sorulduğunda ağa çıkılmadan aynı alıntıyı hash'iyle döndürür;
kaynak çipi "yerel kütüphane · alınma GG.AA.YYYY" der (asla "SENTETİK"
demez); `POST /v1/search` aynı belgeyi bulur.

### F6 — Genel arama (her şeyde tek kutu) · **P1 · M**

**Ne.** Üst çubukta tek arama kutusu: dosyalar, belgeler (**içerik**),
notlar, olaylar, süreler, cevaplar, taslaklar. Sonuçlar türe göre gruplu;
her satır kendi ekranına gider.

**Neden.** Bugün üç dar arama var: dosya alanları ILIKE, belge **adı**
ILIKE, ve soru kutusu. "Şu ibare hangi dosyamda geçiyordu?" cevaplanamıyor.

**Mevcut taşlar.** `POST /v1/search` (kullanılmıyor, `fileIds` +
`includeCorpus` + `resultLimit ≤ 100` destekli) · migration `110000`
`legal.chunks.search_tsv_tr` Türkçe FTS + `pg_trgm` ·
`store/chunkStore.ts` · `matters/store.ts::likePattern`.

**Efor.** M (belge içeriği kısmı S; matter öğeleri için yeni bir
`GET /v1/matters/search?q=` gerekir).

**Kabul ölçütü.** Bir belgenin gövdesinde geçen ve hiçbir başlıkta olmayan
bir ibare aratıldığında o belge sonuçlarda çıkar ve tıklanınca ilgili
bölüme çapayla gider; aynı ibare bir notta da geçiyorsa not satırı da
listelenir; arama 500 ms'de döner (yerel, tek kullanıcı).

### F7 — Dosya paketi (ZIP) dışa aktarımı · **P1 · M**

**Ne.** Dosya sayfasında "**Dosya paketini indir**": `dosya-ozeti.docx`
(künye, taraflar, kronoloji, süreler, notlar) + `belgeler/` (asıl
dosyalar) + `taslaklar/` (her taslağın son sürümü DOCX) +
`arastirmalar/` (her cevabın kanıt paketi JSON + DOCX) + `MANIFEST.json`
(sha256 listesi) → tek ZIP.

**Neden.** Devir, müvekkile teslim, arşiv ve denetim; bugün yalnız **tek**
taslak/kanıt paketi dışa aktarılabiliyor.

**Mevcut taşlar.** `export/bundle*.py` (kanıt paketi → DOCX/MD) ·
`export/petition.py`/`udf.py` · `drafting/routes.ts` `/export` ·
`files/store.ts` + `var/uploads/` · `matters/store.ts::deriveMatterSummary`.

**Efor.** M.

**Kabul ölçütü.** İçinde 2 belge, 2 cevap, 1 taslak (v2) ve 2 süre olan
bir dosya için üretilen ZIP açıldığında dört klasör ve `MANIFEST.json`
bulunur; manifestteki her sha256 dosyanın kendisiyle doğrulanır;
doğrulanamayan tek bir alıntı varsa paket **yazılmaz** (mevcut export
sözleşmesiyle aynı sertlik).

### F8 — Masraf/ücret ve harç hesabı · **P1 · M**

**Ne.** Yeni öğe türü `expense { date, kind: 'harc'|'avans'|'posta'|
'bilirkisi'|'yol'|'diger', amount, note, paidBy: 'buro'|'muvekkil' }` +
dosya bazlı toplam; ve bir hesap penceresi: **harç** (başvurma, peşin,
karar-ilam, istinaf/temyiz) ve **AAÜT vekâlet ücreti** (dava değerine göre
kademeli). Süre kuralları gibi yıllık tarife verisi ayrı bir veri dosyası,
ve **her sonuç `dogrulanmadi` etiketi + değiştirilmez uyarı cümlesi**
taşır.

**Neden.** Her dosyada, dava açılışında ve karar sonrası; bugün hiç yok.

**Mevcut taşlar.** `deadlines/` mimarisi (saf TS, I/O yok; `rules.ts` veri
+ `calc.ts` hesap + `routes.ts` uç + `verified` alanı + değiştirilemez
disclaimer) — birebir aynı kalıp kopyalanabilir; `matters` öğe modeli.

**Efor.** M.

**Kabul ölçütü.** `GET /v1/fees/tariffs` yıl bazlı tarifeyi döndürür ve
**tüm kalemler `verified.status:'dogrulanmadi'`**; bir dava değeri için
hesap adım adım gösterilir; sonuç dosyaya `expense` olarak kaydedilir;
dosya sayfasında toplam masraf görünür; her ekranda ve her çıktıda
tarife uyarısı birebir yer alır.

### F9 — Zaman çizelgesini toplu doldur + kronoloji çıktısı · **P1 · S**

**Ne.** Belge sayfasında "**Tüm tarihleri zaman çizelgesine aktar**"
(tekilleştirilmiş, `verified:false`, kaynağı `belge:<fileId>`), dosya
sekmesinde tarihe göre birleşik kronoloji ve "Kronolojiyi DOCX indir".

**Neden.** Kronoloji bir litigatörün temel iş ürünü; bugün her tarih tek
tek elle ekleniyor.

**Mevcut taşlar.** `intake/analysis.py::extract_dates` (tarih başına tek
kayıt + `count` + 40 karakter bağlam) · `matters` `event` öğesi ve zaman
çizelgesi sekmesi · `export/bundle_docx.py`.

**Efor.** S.

**Kabul ölçütü.** 12 tarih içeren bir belgede tek tıkla 12 olay eklenir,
hepsi "belgeden sezgisel çıkarım — doğrulanmadı" çipi taşır, kaynak
belgeye bağlanır; ikinci kez basıldığında kopya oluşmaz; kronoloji DOCX'i
tarih sırasında ve kaynak sütunuyla üretilir.

### F10 — Kişi kartları (müvekkil / karşı taraf / vekiller) · **P2 · M**

**Ne.** `contact { ad, tckn|vkn, adres, telefon, eposta, uetsAdresi, rol }`
kaydı; dosya bu kayıtlara referans verir; taslak ön-dolumu kişiden okur;
yeni dosya açarken "bu müvekkilin diğer dosyaları" ve **menfaat çatışması
uyarısı** ("bu ad karşı taraf olarak şu dosyada geçiyor").

**Mevcut taşlar.** `intake/analysis.py::extract_parties` (belgeden taraf
çıkarımı zaten var) · `drafting/input.ts` `DraftParty` (aynı alan seti) ·
`settings/store.ts` (kalıcı jsonb kalıbı).

**Efor.** M. **Kabul ölçütü.** Bir kişi bir kez girilir, iki dosyada
kullanılır; yeni dosyada karşı taraf olarak aynı ad girilince uyarı çıkar;
taslak vekil/taraf blokları kişiden dolar ve "otomatik — kontrol edin"
çipi taşır.

### F11 — Eksik dilekçe şablonları + "bunu şablon olarak kaydet" · **P2 · S (her biri)**

**Ne.** Öncelik sırasıyla: **bilirkişi raporuna itiraz**, **delil/tanık
listesi**, **istinaf cevap dilekçesi**, **ıslah dilekçesi**, **ihtiyati
tedbir/haciz talebi**, **KVKK aydınlatma metni + açık rıza + veri işleyen
sözleşmesi** (danışmanlık hattı). Ayrıca editörde "Bu taslağı başlangıç
noktası olarak kaydet".

**Mevcut taşlar.** `drafting/templates.ts` (13 şablonun `fieldGroups` +
`domain` + slot dili) · `composer.ts` · `relevance.ts`.

**Efor.** Şablon başına S. **Kabul ölçütü.** `GET /v1/draft-templates`
sayısı artar ve her yeni şablon bir `domain` taşır; her yeni şablon için
`tests/drafting/templates.test.ts`'te bir sözleşme testi ve composer'da
KAYNAKSIZ davranışı doğrulanır; hukukî metin bir madde referansı
içeriyorsa `dogrulanmadi` disiplini korunur.

### F12 — Ara karar / bilirkişi → süre ve görev üretimi · **P2 · S**

**Ne.** Zaman çizelgesine "ara karar" ya da "bilirkişi raporu" olarak
eklenen bir olayda "**Süre başlat**" kısayolu ilgili kuralı ön-seçili
açar (rapora itiraz = 2 hafta; ara kararın gereği = mahkemenin verdiği
süre → özel süre). Ayrıca dosyada basit bir "yapılacaklar" listesi
(`task` öğesi).

**Mevcut taşlar.** `openDeadlineModal({startDate})` (belge tarihinden
ön-dolum zaten var) · `deadlines/rules.ts` · `matters` öğe modeli.

**Efor.** S. **Kabul ölçütü.** Bir bilirkişi raporu yüklendiğinde ön
incelemedeki rapor tarihinden tek tıkla itiraz süresi hesaplanır ve
dosyaya kaydedilir; `task` öğeleri Dosyalarım panelinde sürelerin yanında
görünür.

### F13 — Belge klasörleri, etiketler ve toplu işlem · **P2 · S/M**

**Ne.** Belgeye serbest etiket (`tag`), dosya içinde klasör
("Deliller", "Yazışma", "Karşı taraf"), listede çoklu seçim → dosyaya
ekle/çıkar/sil/etiketle. **Mevcut taşlar.** `files/routes.ts` `?q=`,
`matters` öğe payload'ı (etiket için ek alan additive). **Efor.** S
(etiket) / M (klasör + toplu işlem). **Kabul ölçütü.** 20 belgelik bir
dosyada etiketle süzme çalışır; çoklu seçimle 5 belge tek istekte
etiketlenir; `GET /v1/files?tag=` süzer.

### F14 — Faiz / alacak hesabı (icra hattı) · **P2 · M**

**Ne.** Yasal faiz, avans faizi, temerrüt faizi; başlangıç–bitiş tarihi,
kısmî ödemeler, dönem bazlı oran tablosu; sonuç adım adım ve `dogrulanmadi`
etiketli. **Mevcut taşlar.** `deadlines/` kalıbı (tarih aritmetiği,
tatil/gün sayımı, doğrulama etiketi). **Efor.** M. **Kabul ölçütü.**
Oran tablosu ayrı veri dosyasında ve her satırı kaynaksız → `dogrulanmadi`;
hesap adımları (dönem, gün, oran, tutar) gösterilir; sonuç dosyaya
`expense`/`hesap` olarak kaydedilir.

### F15 — Yerel (bulutsuz) OCR · **P2 · M**

**Ne.** Taranmış PDF için makinede çalışan OCR (Tesseract-tr ya da eşdeğeri),
Bulut OCR'a alternatif. **Neden.** Taranmış PDF günlük gerçeklik; bugün tek
çözüm bulut ve **canlı sınanmamış**; ürünün "her şey bilgisayarınızda"
sözünü koruyan tek yol. **Mevcut taşlar.** `intake/extract.py` (sayfa başına
metin katmanı kapısı, `SCANNED_PAGES:<n>`), `ai/ocr.ts` (akış ve teslim
sözleşmesi). **Efor.** M (harici ikili bağımlılık; kurulum yükü — dikkat).
**Kabul ölçütü.** Tamamı taranmış bir PDF yüklendiğinde yerel OCR
önerilir, çıktı metin belgesi olarak aynı dosyaya bağlanır, ağ trafiği
sıfırdır (`netstat`/proxy kanıtı).

### F16 — Müvekkile sade dilde durum özeti · **P3 · S**

Dosya sayfasında "Müvekkil özeti": son işlemler, yaklaşan tarihler,
bekleyenler — hukuk jargonu olmadan, DOCX/e-posta metni olarak. Taslak
motoru ve `deriveMatterSummary` zaten var. Çoklu dil ihtiyacı varsa
**buraya** bir dil seçimi eklenir; arayüz yerelleştirmesi yapılmaz.

### F17 — Saklama süresi ve dosya kapatma akışı · **P3 · S**

`docs/legal/retention-matrix.yaml` bugün yalnız belgedir. Dosya
kapatılırken kontrol listesi + saklama süresi sonu tarihi + "arşive al"
işareti; süresi dolan dosya için Ayarlar'da bir uyarı satırı.

---

## 5. Bu denetimde bulunan, düzeltilmesi ucuz beş somut kusur

Bunlar özellik değil, mevcut sözleşmelerin içindeki tutarsızlıklar; her
biri tek bir hatta sığar.

1. **Uyuşmazlık aranıyor ama alıntılanamıyor** — `search_uyusmazlik_decisions`
   planlanıyor, `FETCH_BY_PROVIDER`'da `UYUSMAZLIK` yok
   (`planner/templates.ts:231–272`), dolayısıyla bulunan karar hiçbir
   cevaba giremez; arama bütçesi boşa gidiyor. Ya fetch tanımı eklenir
   (`get_uyusmazlik_document_markdown_from_url`, `idParam: document_url`)
   ya da lane kapatılır. **S.**
2. **Emsal hattı ölü** — `get_emsal_document_markdown` fetch tablosunda,
   ama `search_emsal_detailed_decisions` hiçbir şablonda planlanmıyor.
   Yerel mahkeme/BAM içtihadı canlı araştırmada hiç görünmüyor. **S.**
3. **`verifyReference` `asOf` göndermiyor** (`console.html:8340–8346`) —
   "Korpusta doğrula" düğmesi yürürlük denetimini bugünkü tarihe göre
   yapar; `COMPETITIVE.md` §2.9'un tarif ettiği "dilekçe tarihi itibarıyla"
   davranışı kodda yok. **S.**
4. **`POST /v1/search` hiçbir yerden çağrılmıyor** — en pahalı retrieval
   yüzeyi ölü; `openapi.yaml`'da belgeli, testli, çalışır. **S** (F6'nın
   ilk dilimi).
5. **`GET /v1/deadlines/holidays` arayüzsüz** — resmî tatil/adli tatil
   verisi var, avukat göremiyor. Süre penceresine küçük bir "bu yılın
   tatilleri" katlanır listesi. **S.**

---

## 6. Dürüstlük notları ve bu hattın sınırları

- Sunucu başlatılmadı; hiçbir HTTP probe yapılmadı. Uç davranışları
  **kodun kendisinden ve W12 hat raporlarından** okundu; W12 raporları
  "as implemented" sözleşmelerdir ve kendi ölçümlerini taşır.
- Tek çalıştırılan komut, MCP araç yüzeyini sayan in-memory listelemedir
  (sağlayıcı anahtarları boşlanmış, `COLLEX_NO_DOTENV=1`, ağ yok).
  Sonuç: **54**. `collex_local`'a ve `collex_demo`'ya dokunulmadı; hiçbir
  dosya yazılmadı (bu rapor hariç); geçici betik scratchpad'dedir.
- Yaşam döngüsü tablosundaki "eksik" yargıları **bu deponun kodu**
  üzerinedir; bir avukatın gerçek gününe dair sıklık/acı değerlendirmesi
  bu hattın mesleki çıkarımıdır, ölçüm değildir.
- Efor tahminleri (S/M/L) bu deponun mevcut mimarisine ve test
  disiplinine göredir; hiçbiri ölçülmüş bir süre değildir.
- Bu rapor rakip iddiası üretmez. `COMPETITIVE.md`'ye yapılan iki atıf
  (§2.9 ve rakiplerin atıf doğrulama ilan etmemesi) o belgenin kendi
  etiketleriyle (02.09.2026, [çıkarım]) taşınmıştır; yeniden teyit
  edilmemiştir.
- **Hiçbir sayı hukukî kalite ölçüsü değildir**; `evals/fixtures/corpus/`
  sentetiktir ve `collex_local`'da korpus yoktur (CLAUDE.md kural 5).
</content>
</invoke>
