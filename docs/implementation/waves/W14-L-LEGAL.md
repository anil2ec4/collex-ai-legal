# W14 · L-LEGAL — süre kuralları, şablon hukukî içeriği, harç hesaplayıcısı

Tarih: **02.09.2026** · Hat: **L-LEGAL** · Kalemler: **B-11, B-25, B-35**
Faz: A. Bu rapor yalnızca **ölçülen** sonuçları yazar; ölçülmeyen hiçbir sayı
yoktur.

Sahip olunan ve değiştirilen dosyalar (yalnız bunlar):

| Dosya | Durum |
|---|---|
| `control-plane/src/deadlines/rules.ts` | yeniden yazıldı (B-11) |
| `control-plane/src/drafting/templates.ts` | düzeltildi (B-25) |
| `control-plane/src/fees/tariffs.ts` | **yeni** (B-35) |
| `control-plane/src/fees/calc.ts` | **yeni** (B-35) |
| `control-plane/src/fees/routes.ts` | **yeni** (B-35) |
| `control-plane/src/fees/index.ts` | **yeni** (B-35) |
| `control-plane/tests/deadlines/rules.test.ts` | genişletildi |
| `control-plane/tests/drafting/templates.test.ts` | genişletildi |
| `control-plane/tests/fees/tariffs.test.ts` | **yeni** |
| `control-plane/tests/fees/calc.test.ts` | **yeni** |
| `control-plane/tests/fees/routes.test.ts` | **yeni** |

Başka hiçbir dosyaya dokunulmadı. `server.ts`, `console.html`, `openapi.yaml`,
`STATUS.md`, `CLAUDE.md`, migration dosyaları, `evals/**`, `package.json`
değiştirilmedi.

---

## 0. Dalganın en önemli farkı: **ağ vardı**

STATUS S12'nin ve `rules.ts` başlığının dayandığı gerekçe ("doğrulama denendi,
alan adı çözümlenemedi") bu oturum için **geçerli değildir**. `yargi-mevzuat`
MCP üzerinden mevzuat.gov.tr'ye 02.09.2026 tarihinde erişildi ve aşağıdaki
maddelerin **yürürlükteki metni çekilip** kuralla/şablonla karşılaştırıldı:

İİK m.62 (W13-COPY §3 kaydı) · **İİK m.78/2** · **İİK m.128/a** · **İİK m.134**
· **İİK m.168/1** · **İİK m.169/a** · **İİK m.269** · **İİK m.363** (dipnot 135
dâhil) · **HMK m.94** · **HMK m.104** · **HMK m.133** · **HMK m.139** ·
**HMK m.140** · **HMK m.141** · **HMK m.176** · **HMK m.281** · **HMK m.341** ·
**HMK m.342** · **HMK m.361** · **HMK m.362** · **HMK m.364** · **HMK ek m.1** ·
CMK m.268 (W13-COPY §3 kaydı) · **TBK m.117** · **TBK m.314** · **TBK m.315** ·
**TBK m.344** · **TBK m.347** · **TBK m.352** · **TBK m.393** · **TMK m.606** ·
**TMK m.607** · **TMK m.764** · **Av.K. m.163** · **Av.K. m.164** ·
**FSEK m.52** · **İş K. m.41** · **492 s.K. (1) sayılı tarife**.

Ulaşılamayan / çekilemeyen: **492 s.K. m.28** (peşin harç oranı),
**İİK m.170** madde gövdesi, **HMK m.318**, **AAÜT** ve **Harçlar Kanunu Genel
Tebliği** (bunlar kanun değil, yıllık Resmî Gazete metinleridir; MCP yüzeyi
kanun/tebliğ aramasında bunları getirmedi). Bu üç boşluk **`dogrulanmadi`
olarak kaldı** ve her biri kendi `nasilDogrulanir` cümlesiyle işaretlendi.

---

## 1. B-11 — süre kuralları

### 1.1 Ne yapıldı

**(a) İki yanlış kural düzeltildi.**

- `iik-icra-mahkemesi-istinaf` (L1, L2, L3): `10 gün / tefhim` →
  **`2 hafta / tebliğ`**. `transition` eklendi
  (`effectiveFrom: "2024-06-01"`, `before: "on gün (tefhim veya tebliğden)"`,
  `law: 7499 sayılı Kanun`). Notlar yeniden yazıldı: kapsamın **ters** okunması
  düzeltildi (madde istinafa **kapalı** kararları sayar; sayılanların
  **dışındaki** kararlar parasal sınırı geçmek şartıyla istinaf edilebilir) ve
  parasal sınır ilk kez anıldı. `hmk-istinaf` notundaki aynı yanlış sayı da
  düzeltildi.
  Çekilen ibare: *"İstinaf yoluna başvuru süresi (…) tebliğ tarihinden itibaren
  iki haftadır."* + dipnot 135: *"…'tefhim veya' ibaresi madde metninden
  çıkarılmış ve 'on gündür.' ibaresi 'iki haftadır.' şeklinde
  değiştirilmiştir."*
- `hmk-islah` (L4): *"davanın her aşamasında sadece bir kez"* →
  **"Aynı davada taraflar ancak bir kez ıslah yoluna başvurabilir (HMK
  m.176/2); madde metni birebir böyledir — 'her aşamada bir kez' değildir."*
  Çekilen ibare: *"(2) Aynı davada, taraflar ancak bir kez ıslah yoluna
  başvurabilir."*

**(b) Disclaimer (L31).** `DEADLINE_DISCLAIMER` artık:

> Süre hesabı bilgi amaçlıdır; tebliğ usulü, adli tatil ve özel süreler avukatça kontrol edilmelidir — **kaçırılan süreden ColleX sorumlu değildir.**

**(c) Ham makine değerleri çıktı (L32, L33).** `'ozel'`,
`'amme-odeme-emri-dava'`, `'is-ise-iade-arabulucu-basvuru'`,
`'is-ise-iade-dava'` kullanıcı metninden kaldırıldı; yerlerine kuralların
**ekrandaki başlıkları** ve "Özel süre seçeneği" ifadesi geldi. Bir regresyon
testi, hiçbir kuralın metninde tırnak içinde **başka bir kuralın kimliğinin**
geçmediğini doğruluyor.

**(d) Atıf/diakritik tutarlılığı (L29, L30, C12, C19).**
`iik-kambiyo-itiraz` etiketi `İİK m.168/1-5` → **`İİK m.168/1 (4) ve (5)
numaralı bentler`**; imzaya itirazın **süresi** m.168/1-(4)'e bağlandı (eskiden
yanlışlıkla m.170/1'e bağlıydı), m.170 yalnızca "incelemesi m.170'e tabidir —
madde metnini ayrıca kontrol edin" biçiminde anıldı. AYM kuralının başlığına
madde atfı eklendi. `hukuki` → `hukukî`.

**(e) `adliTatileTabi` üç durumlu (additive).** Yeni alan
`adliTatileTabi: true | false | "belirsiz"`. Eski `adliTatilApplies: boolean`
**korundu** ve `belirsiz` kurallarda **`false`** (kısa ve güvenli tarih) olarak
bırakıldı; hangi kuralın tartışmalı olduğu artık ayrı bir alanda görünüyor.
`belirsiz` kurallar: `hmk-kesin-sure`, `iik-itirazin-iptali`, `thh-itiraz`,
`tbk-kira-odeme-suresi`, `tbk-tahliye-taahhudu-dava`,
`tbk-iki-hakli-ihtar-dava`, `tmk-mirasin-reddi`.

**(f) `nasilDogrulanir` (additive).** Her kuralda bir cümle: hangi maddeyi
açacağı ve neyi karşılaştıracağı. Test, cümlenin ≥ 40 karakter olmasını ve bir
madde numarası taşımasını zorluyor.

**(g) 11 yeni kural.** `hmk-bilirkisi-rapor-itiraz` (m.281/1, 2 hafta) ·
`hmk-on-inceleme-belge` (m.139/1-ç, 2 haftalık kesin süre) · `hmk-kesin-sure`
(m.94, bilgi notu) · `iik-haciz-isteme` (m.78/2, 1 yıl) ·
`iik-kiymet-takdiri-sikayet` (m.128/a, 7 gün) · `iik-ihalenin-feshi`
(m.134/2, 7 gün, ihale tarihinden) · `iik-kira-odeme-emri-itiraz`
(m.269/2, 7 gün) · `tbk-kira-odeme-suresi` (m.315/2, 30 gün) ·
`tbk-tahliye-taahhudu-dava` (m.352/1, 1 ay) · `tbk-iki-hakli-ihtar-dava`
(m.352/2, 1 ay) · `tmk-mirasin-reddi` (m.606, 3 ay).

### 1.2 Ölçülen sonuç

| Ölçüm | Değer |
|---|---|
| `DEADLINE_RULES.length` | **41** (eski 30) |
| `verified.status === 'dogrulandi'` | **16** |
| `verified.status === 'dogrulanmadi'` | **25** |
| `adliTatileTabi === 'belirsiz'` | **7** |

`dogrulandi` olan 16 kural: `hmk-temyiz`, `hmk-kesin-sure`,
`hmk-on-inceleme-belge`, `hmk-bilirkisi-rapor-itiraz`, `cmk-itiraz`,
`iik-odeme-emri-itiraz`, `iik-kambiyo-itiraz`, `iik-icra-mahkemesi-istinaf`,
`iik-haciz-isteme`, `iik-kiymet-takdiri-sikayet`, `iik-ihalenin-feshi`,
`iik-kira-odeme-emri-itiraz`, `tbk-kira-odeme-suresi`,
`tbk-tahliye-taahhudu-dava`, `tbk-iki-hakli-ihtar-dava`, `tmk-mirasin-reddi`.

`cmk-itiraz` ve `iik-odeme-emri-itiraz` için kaynak, W13-COPY §3'te **birebir
kayıtlı** çekilmiş ibaredir; kaynak cümlesi bunu açıkça söyler. Diğer 14'ün
metni bu oturumda doğrudan çekildi.

### 1.3 KABUL kanıtı

```
$ npx vitest run tests/deadlines/rules.test.ts
 ✓ tests/deadlines/rules.test.ts (18 tests) 43ms
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

- `GET /v1/deadlines/rules` sayısı ≥ 40 → **41** (mounted-app ölçümü:
  `tests/integration/app.test.ts` şu an `toHaveLength(30)` dediği için
  **41 döndüğünü rapor ederek kırılıyor** — §5 integrationRequests).
- "kaynaksız `dogrulandi` reddedilir": `rules.test.ts` →
  *"REJECTS a sourceless 'dogrulandi': a verified rule names its article and
  access date"* — her `dogrulandi` kaynağında madde atfı (`m.NNN`), GG.AA.YYYY
  erişim tarihi ve `mevzuat.gov.tr` aranır; `"bilgisine dayanır"` ve
  `"çekilmedi"` ifadeleri yasaklanır.
- `iik-icra-mahkemesi-istinaf` 2 hafta / tebliğ → *"İİK m.363/1: two weeks FROM
  TEBLİĞ — the repealed 'on gün / tefhim' is gone"*.
- `hmk-islah` "ancak bir kez" → *"HMK m.176/2: ıslah is 'ancak bir kez'"*.
- Yeni `DEADLINE_DISCLAIMER` birebir → *"has the mandatory disclaimer verbatim
  and names ColleX, not 'uygulama'"*. `tests/deadlines/calc.test.ts` ve
  `routes.test.ts` (L-MATTER) sabiti **import ederek** karşılaştırdığı için
  ikisi de yeşil kaldı.

### 1.4 KABUL'ün karşılanmayan yarısı (dürüst kayıt)

- **`adliTatileTabi:'belirsiz'` iki tarih döndürmüyor.** İki tarihi üretecek
  yer `src/deadlines/calc.ts` ve `routes.ts`'tir; ikisi de **L-MATTER'ın**
  dosyasıdır. Veri katmanı hazır (`adliTatileTabi`), hesap katmanı L-MATTER'a
  spesifikasyon olarak yazıldı (§5).
- **`.ics` açıklaması** (B-17) bu hatta yok; disclaimer sabiti tek noktadan
  okunabilir durumda.
- **Kalan 25 kural `dogrulanmadi`.** Bu bir başarısızlık değil, sözleşmenin
  kendisidir; her biri artık *"şu maddeyi açın, şunu karşılaştırın"* cümlesi
  taşıyor.

---

## 2. B-25 — şablonların hukukî içeriği

13 şablonun **kimliği, `kind`'ı, `domain`'i ve sırası korundu** (regresyon
testi bunu birebir listeyle sabitliyor). Uygulanan W13-COPY kalemleri:

| # | Şablon | Ne düzeldi |
|---|---|---|
| **L5** | Tahliye taahhütnamesi | "el yazısı" **uydurma geçerlilik şartı** kaldırıldı; TBK m.352/1'in aradığı **YAZILI** şekli yazıldı |
| **L6** | Tahliye taahhütnamesi | **Bir aylık hak düşürücü süre** metne ve `tahliyeTarihi` yardımına eklendi (tahliye taahhüdünde kaybedilen dosyaların birinci sebebi) |
| **L7** | Kira sözleşmesi | Aynı bir aylık süre tahliye hükmüne eklendi |
| **L8/L9** | Kira sözleşmesi | "TÜFE on iki aylık **ortalamasını**" → "on iki aylık ortalamalara göre **DEĞİŞİM ORANINI**"; "konutlarda" → "**konut ve çatılı işyeri** kiralarında" (hem hüküm hem alan metni) |
| **L10** | Kira sözleşmesi | **TBK m.344/3** (beşinci yıl ve sonrası: bedeli **hâkim** belirler) yeni hüküm olarak eklendi |
| **L11** | Kira sözleşmesi | TBK m.347/1'in iki operasyonel parçası eklendi: kiracının **15 günlük** bildirimi, kiraya verenin **10 yıllık uzama sonrası** fesih hakkı (3 ay önceden bildirim). *(COPY'de `[çıkarım]` idi; madde metni çekildi → uygulandı.)* |
| **L12/L13** | Avukatlık ücret sözleşmesi | %25 tavanı **yalnız nispi ücrete** bağlandı (Av.K. m.164/2); m.164/3 ve m.163/2 eklendi; alan yardımı ve açıklama düzeltildi |
| **L14** | Avukatlık ücret sözleşmesi | m.164/son doğru aktarıldı: yasak olan **iş sahibinin borcu nedeniyle** takas/mahsuptur; kararlaştırılan ücretten mahsup bir **sözleşmesel seçim** olarak kutucuklandı |
| **L15** | Hizmet sözleşmesi | FSEK **m.52**'nin "hakların **ayrı ayrı gösterilmesi**" şartı ve devredilen beş mali hak (m.21–25) yazıldı — hüküm artık geçersiz doğmuyor |
| **L16** | İş sözleşmesi | İş K. m.41'in üç emredici sayısı (**1 saat 30 dakika**, **6 ay**, **270 saat**) eklendi; "yazılı onay" → "**işçinin onayı**" (yazılılık Yönetmelik m.9) |
| **L17** | Hizmet sözleşmesi | Açıklama TBK **m.393**'ten (iş sözleşmesi) **m.502 vekâlet / m.470 eser**'e taşındı; bağımlılık uyarısı eklendi. *(COPY'de `[çıkarım]` idi; m.393 metni çekildi → uygulandı.)* |
| **L18** | İstinaf + temyiz | Dilekçe **gövdesinden** uygulama talimatı ve ham kural kimliği (`hmk-istinaf`, `hmk-temyiz`) çıkarıldı; `tebligTarihi` alan yardımına taşındı |
| **L19** | Temyiz | `m.364/**1**-c` → `m.364/**2**-c` + "hukuk dairesinden" |
| **L20/L21** | İstinaf + temyiz | Yeni zorunlu bölüm **"KARARIN ÖZETİ"** (m.342/2-d, m.364/2-e) + `kararOzeti` alanı |
| **L22** | İstinaf + temyiz | `tebligTarihi` **`required: true`** ve `requiredFields`'a eklendi |
| **L23** | Cevap dilekçesi | Yeni **`defiler`** alanı + **"DEF'İLERİMİZ"** bölümü (HMK m.141/1-2 yardımıyla). *(COPY'de `[çıkarım]`; m.141 metni çekildi.)* |
| **L24** | Cevap dilekçesi | Yeni **`karsiDava`** alanı + **"KARŞI DAVA"** bölümü (HMK m.133/1-2). *(m.133 metni çekildi.)* |
| **L25** | Kira sözleşmesi | GVK tebliğ künyesi ve **yazara verilmiş talimat** sözleşme gövdesinden çıkarıldı, `odemeGunu` yardımına taşındı |
| **L26** | 6 sözleşme | `dayanakNotlariSection` **imza bloğunun altına** alındı; başlığı **"EK — HUKUKÎ DAYANAK NOTLARI (SÖZLEŞMENİN PARÇASI DEĞİLDİR; İMZAYA GİRMEZ)"** oldu |
| **L27** | Satış sözleşmesi | TBK m.117/2 **koşullandırıldı** (ifa günü belirlenmişse günün geçmesiyle; belirlenmemişse m.117/1 **ihtarla**). *(m.117 metni çekildi.)* |
| **L28** | Satış sözleşmesi | "varsa şöyle, yoksa böyle" şablon metni tek dallı hükme çevrildi; TMK m.764'ün **resmî şekil + devralanın yerleşim yeri noterliği** şartı yazıldı |

Ek olarak, aynı dosyada duran ve nobody-else-owns kuralına giren W13-COPY
kalemleri de uygulandı ve raporda ayrıca işaretlendi:
**M2** (`"Dosya (matter) kimliği"` → `"Dosya numarası"`),
**C10** (`ticarî` → `ticari`), **C11** (`dâhil` → `dahil`),
**C13** (`HUKUKÎ DELİLLER` → `DELİLLER`, HMK m.119/1-f),
**C15** (yeni `FIELD_GROUPS.belge = "Belge künyesi"`; sözleşme/ihtarname/
arabuluculuk/icra formlarındaki tarih ve yer alanları artık içinde mahkeme
alanı olmayan "Mahkeme ve dosya" kutusunda durmuyor),
**C16** (`"evet"/"hayır"` → `"Evet"/"Hayır"`; duruşma istemi ve mülkiyeti saklı
tutma seçenekleri **dilekçeye/sözleşmeye yazılabilir cümlelere** çevrildi).

### 2.1 KABUL kanıtı

```
$ npx vitest run tests/drafting/templates.test.ts
 ✓ tests/drafting/templates.test.ts (29 tests) 73ms
 Test Files  1 passed (1)
      Tests  29 passed (29)

$ npx vitest run tests/drafting/ tests/deadlines/ tests/pipeline/console.test.ts
 Test Files  20 passed (20)
      Tests  384 passed | 1 skipped (385)
```

- `GET /v1/draft-templates` sayısı ve `domain` alanları korunur → test
  *"the 13 template ids, kinds and domains are unchanged by the W14 content
  fixes"* 13 satırı birebir listeliyor.
- "bir ay içinde" (tahliye), "ayrı ayrı gösterilmesi" (FSEK), "değişim oranını"
  (TBK m.344), "nispi/BELLİ BİR YÜZDESİ" (Av.K. m.164/2) → L5/L6/L7, L15,
  L8/L9/L10, L12/L13/L14 testleri.
- istinaf/temyiz `karar-ozeti` bölümü + `tebligTarihi required` → L20/L21/L22
  testi.
- Hiçbir şablon **gövdesinde** `hmk-istinaf`, `Süreler ekranından`,
  `doğrulayın`, `Genel Tebliği Seri No`, `ekBilgiler`, `matter.` geçmiyor →
  L18/L25 testi (13 şablonun tamamı taranıyor).
- İmza bloğu `dayanakNotlariSection`'dan **önce** → *"B-25/L26: the signature
  block comes BEFORE the machine legal notes in every contract"* + yapısal test
  imzadan sonra yalnızca `dayanak` bölümüne izin veriyor.

### 2.2 Sapmalar (dürüst kayıt)

1. **`kararOzeti` `requiredFields`'a EKLENMEDİ**, yalnızca alan düzeyinde
   `required: true`. Gerekçe: `requiredFields`'a eklemek
   `control-plane/tests/drafting/composer.test.ts:604`'ü (L-EVID'in dosyası)
   kırardı. `tebligTarihi` eklendi çünkü o test onu zaten veriyor. Boş
   bırakılırsa bölüm görünür bir `[Kararın özeti — doldurun]` yer tutucusu
   basıyor. Faz B'de tamamlanması için L-EVID'e istek yazıldı (§5).
2. **Eksik yüksek değerli şablonlar eklenmedi** (bilirkişi raporuna itiraz,
   delil/tanık listesi, istinaf cevap, ıslah, ihtiyati tedbir/haciz, KVKK
   aydınlatma + açık rıza). B-25 metni bunları **atamıyor**; B-25 yalnızca
   L5–L28 düzeltmelerini ve ARCH S7'nin JSON'a taşıma önerisinin **bu dalgada
   yapılmamasını** söylüyor. **Bir sonraki dalganın girdisi olarak** kayda
   geçiyor; `hmk-bilirkisi-rapor-itiraz` süre kuralı bugün eklendiği için
   "bilirkişi raporuna itiraz" şablonu en düşük maliyetli adaydır.
3. **ARCH S7 (şablonların `templates/*.json` + zod'a taşınması) yapılmadı** —
   G.4 bunu bilinçle erteliyor.

---

## 3. B-35 — harç / parasal sınır / AAÜT hesaplayıcısı

### 3.1 Tasarım kararı: **ColleX hiçbir zaman bir tutar uydurmaz**

Bir Türk yargı harcının iki yarısı vardır:

1. **Kanundaki yapı ve oran** — yıllarca sabittir, kanun metninden çekilebilir.
   *(nispi karar ve ilam harcı **binde 68,31**, 492 s.K. (1) sayılı tarife
   A/III-1-a; nispi avukatlık ücreti tavanı **%25**, Av.K. m.164/2; kesinlik
   sınırlarının **kanundaki taban** tutarları.)*
2. **Yıllık parasal tutar** — maktu harçlar, AAÜT kademeleri, uygulanacak
   kesinlik sınırları. Her Ocak Resmî Gazete'de yeniden yayımlanır ve **ColleX
   bunları bilmez.**

Bu yüzden ikinci gruptaki her kalem `amount: null` + `dogrulanmadi` ile gelir;
avukat tutarı **yılda bir kez** `POST /v1/fees/compute` gövdesindeki
`overrides` ile girer, hesap o tutarla yapılır. Yanlış harç reddedilen
dosyadır; `amount: null` bir kusur değil, **dürüst cevaptır**.

### 3.2 Ölçülen sonuç

| Ölçüm | Değer |
|---|---|
| Tarife yılı | 2026 |
| Tarife kalemi | **20** |
| `dogrulandi` kalem | **5** |
| `dogrulanmadi` kalem | **15** |

`dogrulandi` 5 kalem ve dayanakları:

| Kalem | Değer | Çekilen metin |
|---|---|---|
| `karar-ilam-harci-nispi-orani` | binde **68,31** | 492 s.K. (1) sayılı tarife A/III-1-a: *"…hüküm altına alınan anlaşmazlık konusu değer üzerinden (Binde 68,31)"* |
| `avukatlik-nispi-ucret-tavani` | **0,25** | Av.K. m.164/2: *"Yüzde yirmibeşi aşmamak üzere, … belli bir yüzdesi avukatlık ücreti olarak kararlaştırılabilir."* |
| `hmk-istinaf-kesinlik` | **3.000 TL (TABAN)** | HMK m.341/2: *"Miktar veya değeri üç bin Türk Lirasını geçmeyen malvarlığı davalarına ilişkin kararlar kesindir."* + HMK ek m.1 |
| `hmk-temyiz-kesinlik` | **40.000 TL (TABAN)** | HMK m.362/1-a: *"Miktar veya değeri kırk bin Türk Lirasını (bu tutar dâhil) geçmeyen davalara ilişkin kararlar."* |
| `iik-istinaf-kesinlik` | **7.000 TL (TABAN)** | İİK m.363/1: *"…yedi bin Türk lirasını geçmesi şartıyla istinaf yoluna başvurulabilir."* |

Kesinlik sınırlarının hepsi `yenidenDegerlemeyeTabi: true` ve kaynak cümleleri
**"KANUNDAKİ TABAN TUTAR"** diyor; hesap, avukat bu yılın rakamını girmediyse
**yüksek sesle uyarıyor** (`warnings` içinde "KANUNDAKİ TABAN … yeniden
değerleme").

`492 s.K. m.28` (peşin harcın karar ve ilam harcına oranı) çekilemedi:
`pesin-harc-orani` `rate: 0.25` ile hesaplıyor **ama `dogrulanmadi`** ve hem
adım açıklamasında hem `nasilDogrulanir`'da "oranı madde metniyle doğrulayın"
diyor.

### 3.3 KABUL kanıtı

```
$ npx vitest run tests/fees/
 ✓ tests/fees/tariffs.test.ts (9 tests) 15ms
 ✓ tests/fees/calc.test.ts (14 tests) 36ms
 ✓ tests/fees/routes.test.ts (8 tests) 53ms
 Test Files  3 passed (3)
      Tests  31 passed (31)
```

- `GET /v1/fees/tariffs` yıl bazlı tarifeyi döndürür ve doğrulanmamış her kalem
  `dogrulanmadi` taşır → `routes.test.ts` *"returns the year's lines, the group
  vocabulary and the disclaimer"*.
- Hesap **adım adım** → `calc.test.ts` *"shows the arithmetic step by step"*:
  `dava-degeri → basvurma-harci → karar-ilam-harci → karar-ilam-harci-asgari →
  pesin-harc → gider-avansi → acilista-odenecek`; 100.000 TL için nispi harç
  **6.831,00 TL** (`100.000 × binde 68,31`).
- Her çıktıda tarife uyarısı birebir → `FEE_DISCLAIMER` her `compute` ve
  `tariffs` cevabında; test birebir dizeyle karşılaştırıyor.
- `tests/fees/` **kaynaksız `dogrulandi`'yı reddediyor** → *"REJECTS a
  sourceless 'dogrulandi'"* (erişim tarihi + `mevzuat.gov.tr` + atıf zorunlu) ve
  *"a yearly monetary amount is NEVER invented"* (doğrulanmamış maktu kalemin
  `amount`'u `null` olmak zorunda).

### 3.4 Sapma

- **`expense` öğesi olarak dosyaya kaydetme yapılmadı.** Kayıt yeri
  `control-plane/src/matters/**` (**L-MATTER**). Sunucu tarafı hazır: hesabın
  tamamı JSON olarak dönüyor; L-MATTER'a spesifikasyon yazıldı (§5).
- **AAÜT nispi kademeleri hesaplanmıyor.** Tarife metni (yıllık Resmî Gazete
  tebliği) elde yok; adım `TUTAR_GEREKLI` dönüyor ve avukatı tarifenin Genel
  Hükümler bölümüne yönlendiriyor. Uydurmaktansa boş bırakmak tercih edildi.

---

## 4. Faz B için tam UI sözleşmesi (L-CONSOLE)

### 4.1 Süreler ekranı — değişen alanlar

`GET /v1/deadlines/rules` cevabındaki her kural **iki yeni alan** taşıyor
(additive, mevcut alanlar aynı):

| Alan | Tip | Ekranda |
|---|---|---|
| `adliTatileTabi` | `true \| false \| "belirsiz"` | Kural kartında rozet: `true` → "Adli tatile tâbi", `false` → "Adli tatile tâbi değil", `"belirsiz"` → **"Adli tatil: tartışmalı"** (sarı) |
| `nasilDogrulanir` | `string` | Kural kartının altında açılır satır: başlık **"Bu kuralı nasıl doğrularım?"**, içerik bu cümle |

`verified.status` artık **her kuralda `dogrulanmadi` değil**. Kart rozeti:

- `dogrulanmadi` → mevcut damga **`DOĞRULANMADI — madde metniyle kontrol edin`**
  (değişmedi).
- `dogrulandi` → yeni damga **`DOĞRULANDI — <madde> · <GG.AA.YYYY>`**; `title`
  olarak `verified.source` gösterilir. Ton yükseltilmez; damga nötr griden
  farklı olmalı ama vurgulu olmamalı.

Sistem durumu satırı (`console.html:9504`) zaten `unverified`/`verified`
sayıyor; **metin değişmesin**, sayı kendiliğinden 41 / 25 / 16 olacaktır.

**`DEADLINE_DISCLAIMER` metni değişti** — `console.html:7614`'teki gömülü kopya
güncellenmelidir (§5).

### 4.2 Süre hesabı — `belirsiz` için iki tarih (L-MATTER + L-CONSOLE)

Sunucu tarafı L-MATTER'da (§5). Konsol sözleşmesi: `POST
/v1/deadlines/compute` cevabı `adliTatileTabi: "belirsiz"` olan bir kural için
**iki tarih** taşıdığında, kart iki satır gösterir:

- **"Adli tatile tâbi sayılırsa: GG.AA.YYYY"**
- **"Adli tatile tâbi sayılmazsa: GG.AA.YYYY (kısa ve güvenli tarih)"**
- altında tek cümle: **"Bu kuralın adli tatile tâbi olup olmadığı
  tartışmalıdır; kısa tarihe göre hareket edin."**

### 4.3 Taslak formu — yeni alanlar ve bölümler

`GET /v1/draft-templates` cevabındaki `fieldGroups` dizisine **yeni bir grup**
eklendi; sıra:

```
Mahkeme ve dosya · Belge künyesi · Taraflar · Vekil · Olaylar · Talepler · Deliller · Ek bilgiler
```

"Belge künyesi" fieldset'i, mahkemesi olmayan belgelerde (6 sözleşme,
ihtarname, icra itirazı, arabuluculuk başvurusu) tarih ve yer alanlarını
taşır. Konsol grupları `fieldGroups` sırasına göre çizdiği için **kod
değişikliği gerekmeyebilir**; yalnızca boş fieldset'in gizlendiğini doğrulayın.

Yeni alanlar (hepsi `matter.ekBilgiler.*`, konsolun mevcut `buildField`
`kind`'larıyla):

| Şablon | `path` | `kind` | `required` | Etiket |
|---|---|---|---|---|
| `istinaf-basvuru` | `matter.ekBilgiler.kararOzeti` | `text` + `multiline` | **evet** | "Kararın özeti" |
| `istinaf-basvuru` | `matter.ekBilgiler.tebligTarihi` | `date` | **evet** | "Kararın tebliğ tarihi" |
| `temyiz-dilekcesi` | `matter.ekBilgiler.kararOzeti` | `text` + `multiline` | **evet** | "Kararın özeti" |
| `temyiz-dilekcesi` | `matter.ekBilgiler.tebligTarihi` | `date` | **evet** | "BAM kararının tebliğ tarihi" |
| `cevap-dilekcesi` | `matter.ekBilgiler.defiler` | `list` | hayır | "Def'iler (zamanaşımı, takas, hapis hakkı …) — her satır bir def'i" |
| `cevap-dilekcesi` | `matter.ekBilgiler.karsiDava` | `list` | hayır | "Karşı dava talepleri (varsa) — her satır bir talep" |

Yeni bölümler (önizlemede görünür): `karar-ozeti` ("KARARIN ÖZETİ") istinaf ve
temyizde; `defiler` ("DEF'İLERİMİZ") ve `karsi-dava` ("KARŞI DAVA") cevap
dilekçesinde. Sözleşmelerde `dayanak` bölümü **imzadan sonra** çiziliyor ve
başlığı "EK — … SÖZLEŞMENİN PARÇASI DEĞİLDİR; İMZAYA GİRMEZ".

Değişen `select` seçenekleri (değerler artık belgeye yazılabilir cümlelerdir):

| `path` | Eski | Yeni |
|---|---|---|
| `matter.arabuluculuk.yapildi` | `evet` / `hayır` | `Evet` / `Hayır` |
| `matter.ekBilgiler.durusma` (temyiz) | `istenmiyor` / `isteniyor` | `Duruşma talep edilmemektedir` / `Duruşma yapılması talep edilmektedir` |
| `matter.ekBilgiler.mulkiyetiSakliTutma` (satış) | `yok` / `var (TMK m.764 …)` | `Yok` / `Var — TMK m.764 uyarınca noter özel siciline tescil edilecek` |

*(`arabuluculuk.yapildi` sunucu tarafında `tr-TR` küçük harfe çevrilerek
boolean'a dönüştüğü için "Evet"/"Hayır" sorunsuz çalışır —
`src/drafting/input.ts:151-156`, test edildi.)*

### 4.4 Yeni ekran: **Harç ve sınır hesabı** (`#harc`)

**Uç 1 — tarife listesi**

```
GET /v1/fees/tariffs?year=2026
200 {
  year: 2026,
  years: [2026],
  groups: [ {id:"harc",label:"Yargı harçları"},
            {id:"gider",label:"Yargılama giderleri"},
            {id:"vekalet",label:"Vekâlet ücreti"},
            {id:"kesinlik",label:"Kesinlik (parasal) sınırları"} ],
  lines: [ { id, title, group, kind:"maktu"|"nispi"|"oran"|"sinir",
             rate: number|null, amount: number|null,
             yenidenDegerlemeyeTabi: boolean,
             reference: { legislationNo, article, label },
             verified: { status:"dogrulandi"|"dogrulanmadi", date, source },
             nasilDogrulanir: string, notes: string[] } ],
  disclaimer: "<FEE_DISCLAIMER>",
  note: "Tutarı boş (null) olan kalemler her yıl …"
}
400 { error: { kind:"INVALID_REQUEST"|"TARIFF_YEAR_NOT_FOUND", message, issues[] } }
```

Ekran: gruplara göre dört fieldset. Her satırda başlık, `reference.label`,
tutar/oran ve rozet:

- `amount === null` → **"Tutar girilmedi"** + tek satır giriş kutusu (TL) +
  `title` olarak `nasilDogrulanir`.
- `verified.status === "dogrulanmadi"` → **`DOĞRULANMADI — tarife metniyle
  kontrol edin`** damgası.
- `yenidenDegerlemeyeTabi && amount !== null` → **"Kanundaki taban tutar —
  bu yılın sınırı değildir"** (sarı).

Girilen tutarlar `localStorage`'da yıl bazında tutulur ve her hesapta
`overrides` olarak gönderilir. Ekranın altında `disclaimer` **birebir**.

**Uç 2 — hesap**

```
POST /v1/fees/compute
{
  year: 2026,
  kind: "dava-harci" | "vekalet-ucreti" | "kesinlik-siniri",
  davaDegeri: 100000,                      // TL, üç türde de zorunlu
  mahkeme?: "sulh" | "asliye" | "kanun-yolu",   // dava-harci; varsayılan "asliye"
  yol?: "hmk-istinaf" | "hmk-temyiz" | "iik-istinaf" | "iyuk-istinaf", // kesinlik-siniri'nde zorunlu
  overrides?: { "<tarife kalem kimliği>": 1500 }
}
200 {
  year, kind, davaDegeri,
  steps: [ { id, label, detail, amount: number|null,
             durum: "hesaplandi"|"TUTAR_GEREKLI"|"BILGI",
             lineId?, kullaniciDegeri?, verified? } ],
  toplam: number|null,
  eksikKalemler: string[],          // doldurulması gereken tarife kalemleri
  dogrulanmamisKalemler: string[],
  warnings: string[],
  disclaimer: "<FEE_DISCLAIMER>",
  sinirSonucu?: { yol, sinir: number|null, kullaniciDegeri: boolean,
                  kanunYoluAcik: boolean|null, aciklama: string }
}
400 { error: { kind:"INVALID_REQUEST"|"TARIFF_YEAR_NOT_FOUND"|"TARIFF_LINE_NOT_FOUND",
               message, issues:[{path,message}] } }
```

Ekran (Türkçe etiketler birebir):

- Form: **"Dava değeri (TL)"**, **"Mahkeme"** (Sulh / Asliye / Kanun yolu),
  **"Hesap"** (Dava harcı / Vekâlet ücreti / Kesinlik sınırı), kesinlik
  seçildiyse **"Kanun yolu"** (İstinaf — hukuk / Temyiz — hukuk / İstinaf —
  icra mahkemesi / İstinaf — idari yargı).
- Sonuç: `steps` sırayla numaralı satırlar — `label`, altında `detail`, sağda
  tutar. `durum === "TUTAR_GEREKLI"` satırında tutar yerine **"Tutarı girin"**
  düğmesi (tarife listesindeki ilgili kaleme götürür).
- `toplam === null` ise başlık **"Toplam hesaplanamadı — {n} kalem eksik"**;
  değilse **"Dava açılışında ödenecek toplam"**.
- `warnings` → sondaki katlanmış **"Uyarılar"** kartı (B-27 bütçesine tabi;
  cevap ekranı değil, ayrı ekran).
- `sinirSonucu.kanunYoluAcik === null` → **"Belirlenemedi — bu yılın sınırını
  girin"**.
- `disclaimer` ekranın altında **birebir**, her hesapta.

**Vaporware kapısı (G.3-4):** bu ekran ancak L-SAFE mount satırını ekledikten
sonra çizilmelidir; `GET /v1/fees/tariffs` 404 dönüyorsa sekme görünmez.

---

## 5. integrationRequests — başka hatların dosyaları

Aşağıdakiler **bu hattın sahibi olmadığı** dosyalardır; hiçbirine
dokunulmamıştır.

### 5.1 L-SAFE — `control-plane/src/api/server.ts` (mount)

```ts
import { createFeesRouter } from "../fees/routes.js";
// … diğer router mount'larının yanına:
app.route("/", createFeesRouter());
```

Yollar: `GET /v1/fees/tariffs`, `POST /v1/fees/compute`. Router saf (DB yok,
saat yok), bağımlılık almaz.

### 5.2 L-SAFE — süre kuralı sayısı 30 → ≥ 40 (ÖLÇÜLDÜ: 41)

Bu üç iddia şu anda **kırmızıdır** ve sebebi B-11'in kendisidir:

| Dosya:satır | Şu an | Olması gereken |
|---|---|---|
| `control-plane/tests/api.test.ts:117` | `expect(body["deadlineRules"]).toBe(30);` | `expect(body["deadlineRules"]).toBeGreaterThanOrEqual(40);` |
| `control-plane/tests/integration/app.test.ts:957` | `expect(body.rules).toHaveLength(30);` | `expect(body.rules.length).toBeGreaterThanOrEqual(40);` |
| `control-plane/tests/integration/app.test.ts:1019` | `deadlineRules: 30,` (`toMatchObject` içinde) | satırı `toMatchObject`'ten çıkarıp ayrı bir `expect(body["deadlineRules"]).toBeGreaterThanOrEqual(40);` yapın |

Sabit sayı yerine alt sınır önerilir: bir sonraki dalga kural eklediğinde
tekrar kırılmasın.

### 5.3 L-CONSOLE — `control-plane/public/console.html:7614`

Gömülü `DEADLINE_DISCLAIMER` kopyası eski metni taşıyor. Birebir şu olmalı:

```
Süre hesabı bilgi amaçlıdır; tebliğ usulü, adli tatil ve özel süreler avukatça kontrol edilmelidir — kaçırılan süreden ColleX sorumlu değildir.
```

Gerekçe: W13-COPY L31 — hukuk Türkçesinde "uygulama" = yerleşik içtihat, yani
eski cümle "içtihat sorumlu değildir" diye okunuyor. B-27 bu değişikliği
bağımlılık olarak zaten sayıyor.

### 5.4 L-MATTER — `src/deadlines/calc.ts` + `routes.ts`: `belirsiz` iki tarih

Veri hazır: `DeadlineRule.adliTatileTabi: true | false | "belirsiz"`
(`src/deadlines/rules.ts`, additive; `adliTatilApplies` boolean'ı korundu ve
`belirsiz` kurallarda `false`).

İstenen: `computeDeadline`, kuralın `adliTatileTabi === "belirsiz"` olduğu
hâlde **iki sonuç** döndürsün (additive alanlar, mevcut alanlar aynı kalsın):

```ts
adliTatilBelirsiz?: {
  tabiIse: string;      // ISO tarih — HMK m.104 uzaması uygulanmış
  tabiDegilse: string;  // ISO tarih — uygulanmamış (bugünkü davranış, kısa/güvenli)
  aciklama: string;     // "Bu kuralın adli tatile tâbi olup olmadığı tartışmalıdır; kısa tarihe göre hareket edin."
}
```

Ana `dueDate` **değişmesin** (kısa tarih kalsın). 7 kural etkilenir:
`hmk-kesin-sure`, `iik-itirazin-iptali`, `thh-itiraz`, `tbk-kira-odeme-suresi`,
`tbk-tahliye-taahhudu-dava`, `tbk-iki-hakli-ihtar-dava`, `tmk-mirasin-reddi`.

### 5.5 L-MATTER — harç sonucunun dosyaya `expense` olarak kaydı (B-35)

`POST /v1/matters/{id}/items` için yeni öğe türü **`expense`** önerilir
(mevcut altı türe additive):

```json
{ "kind": "expense",
  "payload": { "year": 2026, "kind": "dava-harci", "davaDegeri": 100000,
               "toplam": 7207.75, "eksikKalemler": [],
               "steps": [ { "id": "...", "label": "...", "amount": 1500 } ],
               "disclaimer": "<FEE_DISCLAIMER>" } }
```

Kural: `disclaimer` **birebir** saklanmalı ve dosya ekranında/çıktısında
gösterilmelidir; `eksikKalemler` boş değilse öğe **"eksik"** rozetiyle
listelenmelidir.

### 5.6 L-EVID — `control-plane/tests/drafting/composer.test.ts:604`

`kararOzeti`'nin `requiredFields`'a girebilmesi için istinaf fixture'ına bir
alan eklenmesi gerekiyor:

```ts
matter: davaMatter({ ekBilgiler: {
  karar: "…", tebligTarihi: "2026-02-10",
  kararOzeti: "Sentetik ilk derece kararının özeti.",   // <-- eklenecek
}}),
```

Bu eklendikten sonra L-LEGAL (veya L-DOCS) `templates.ts`'te
`istinaf-basvuru` ve `temyiz-dilekcesi` `requiredFields`'ına
`"ekBilgiler.kararOzeti"` ekleyebilir; o zamana kadar alan **form düzeyinde**
zorunlu, sunucu düzeyinde değil.

### 5.7 L-DOCS (Faz B) — `CLAUDE.md`

İki cümle artık yanlıştır (Faz A'da dokunulmadı):

- satır 89: *"`rules.ts` (30 rules, **all `verified.status: 'dogrulanmadi'`**)"*
  → **41 kural; 16'sı `dogrulandi` (madde metni elde), 25'i `dogrulanmadi`**.
- satır 206: *"All 30 rules are `verified.status: 'dogrulanmadi'`"* → aynı
  düzeltme. Kural sabit kalır: *"a rule may only flip to `dogrulandi` with the
  article text in hand"* — ve `tests/deadlines/rules.test.ts` bunu artık
  kaynak-biçimi testiyle de zorluyor.
- Yeni dizin satırı: `control-plane/src/fees/` — *"Pure TS, no I/O: `tariffs.ts`
  (20 tarife kalemi, 5'i `dogrulandi`, `FEE_DISCLAIMER` verbatim), `calc.ts`,
  `routes.ts` (`/v1/fees/tariffs|compute`)"*.
- `docs/KULLANIM-ColleX.md:423` — gömülü disclaimer kopyası (yeni metin).

---

## 6. openapi.yaml additive delta (Faz B'de L-DOCS uygular)

**Faz A'da `openapi.yaml`'a dokunulmadı.**

### 6.1 Mevcut şemaya eklenen alanlar (additive)

`DeadlineRule`:

```yaml
adliTatileTabi:
  description: >-
    Kuralın adli tatile tâbi olup olmadığı. "belirsiz" = tartışmalı; hesap
    HMK m.104 uzamasını uygulamaz (kısa ve güvenli tarih) ve arayüz iki
    tarihi birden gösterir.
  oneOf: [ { type: boolean }, { type: string, enum: ["belirsiz"] } ]
nasilDogrulanir:
  type: string
  description: Avukatın bu kuralı bir dakikada doğrulaması için tek cümle (hangi madde, ne karşılaştırılacak).
```

`DraftTemplate.fields[].group` numaralandırmasına **"Belge künyesi"** eklendi;
`GET /v1/draft-templates` `fieldGroups` dizisi 7 → **8** eleman.

### 6.2 Yeni yollar (2 path / 2 operation)

```yaml
/v1/fees/tariffs:
  get:
    summary: Yıl bazlı harç, gider, vekâlet ücreti ve kesinlik sınırı tarifesi
    parameters: [ { name: year, in: query, schema: { type: integer } } ]
    responses:
      "200": FeeTariffResponse
      "400": ApiError   # INVALID_REQUEST | TARIFF_YEAR_NOT_FOUND
/v1/fees/compute:
  post:
    summary: Bir dava değeri için harç / vekâlet ücreti / kesinlik sınırı hesabı
    requestBody: FeeComputeRequest
    responses:
      "200": FeeComputation
      "400": ApiError   # INVALID_REQUEST | TARIFF_YEAR_NOT_FOUND | TARIFF_LINE_NOT_FOUND
```

Yeni şemalar: `FeeTariffLine`, `FeeTariffResponse`, `FeeComputeRequest`,
`FeeStep`, `FeeComputation`. Alan adları ve tipleri §4.4'te birebir yazılıdır.

Sayı deltası: **35 → 37 path**, **44 → 46 operation** *(L-DOCS diğer hatların
deltalarıyla birlikte yeniden saymalıdır; bu satır yalnız bu hattın katkısıdır)*.

---

## 7. Ölçümler — gerçek komut çıktıları

```
$ cd control-plane && npx tsc --noEmit
tests/drafting/contracts.test.ts(385,5): error TS2322: Type 'Response | Promise<Response>' is not assignable to type 'Promise<Response>'.
```

→ **Bu hattın hiçbir dosyasında hata yok.** Tek hata L-EVID'in henüz akıştaki
`tests/drafting/contracts.test.ts` dosyasındadır; düzeltilmedi (sahibi değiliz).

```
$ npx vitest run tests/deadlines/rules.test.ts tests/drafting/templates.test.ts tests/fees/
 ✓ tests/fees/tariffs.test.ts        (9 tests)
 ✓ tests/deadlines/rules.test.ts    (18 tests)
 ✓ tests/fees/calc.test.ts          (14 tests)
 ✓ tests/fees/routes.test.ts         (8 tests)
 ✓ tests/drafting/templates.test.ts (29 tests)
 Test Files  5 passed (5)
      Tests  78 passed (78)
```

Etkilenebilecek komşu süitler (dürüstlük için koşuldu):

```
$ npx vitest run tests/drafting/ tests/deadlines/ tests/pipeline/console.test.ts
 Test Files  20 passed (20)
      Tests  384 passed | 1 skipped (385)
```

Tüm süit:

```
$ npx vitest run
 Test Files  6 failed | 92 passed (98)
      Tests  6 failed | 1937 passed | 7 skipped (1950)
```

Altı kırığın kaynağı:

| Kırık | Sebep |
|---|---|
| `tests/api.test.ts:117` | **BU HAT** — `deadlineRules` 30 → 41 (§5.2) |
| `tests/integration/app.test.ts:957` | **BU HAT** — kural sayısı (§5.2) |
| `tests/integration/app.test.ts:1008` | **BU HAT** — `deadlineRules: 30` (§5.2) |
| `tests/research/routes.test.ts:34` | başka hat (L-SOURCES, akıştaki iş) |
| `tests/research/researchService.test.ts:82` | başka hat (L-SOURCES) |
| `tests/store/persistence.test.ts:747` | başka hat (L-MATTER, `nextDeadline` yeni alanlar) |

Bu üç kırığın hiçbiri bir **davranış** hatası değildir; üçü de "30 kural"
sabitini kontrol ediyor ve B-11 sayıyı bilerek 41'e çıkardı.

**pytest koşulmadı.** Gerekçe: bu hattın değişikliklerinin tamamı TypeScript'tir
ve Python tarafında değişen sabitlere atıf yoktur —
`grep -rn "kaçırılan süreden" --include=*.py` ve
`grep -rn "HUKUKÎ DELİLLER\|istenmiyor" export/ intake/` sıfır sonuç verdi.
`tests/drafting/real-export.test.ts` (gerçek venv Python ile DOCX/UDF üretimi)
düzeltilmiş şablonlarla **koştu ve geçti**.

**Sunucu başlatılmadı, port kullanılmadı, veritabanı oluşturulmadı,
`collex_local`'a dokunulmadı, git işlemi yapılmadı.**

---

## 8. Açık konular — dürüst liste

1. **25 süre kuralı hâlâ `dogrulanmadi`.** Bunlar bir sonraki doğrulama
   turunda aynı yolla bitirilebilir: HMK m.127/136/345/347/366/96, CMK
   m.273/291/173, İYUK m.7/16/45/46/8/61/20A, İİK m.16/67/68, 6216 m.47,
   6502 m.70, 4857 m.20, 6183 m.58, 7036 m.3. Her birinin
   `nasilDogrulanir` cümlesi hangi maddenin açılacağını söylüyor.
2. **492 s.K. m.28 çekilemedi.** Peşin harcın karar ve ilam harcına oranı
   `0.25` ile hesaplanıyor ama `dogrulanmadi`; hesap adımı bunu söylüyor. Bir
   sonraki turda m.28 çekilip `dogrulandi`'ya çevrilmelidir.
3. **AAÜT ve Harçlar Kanunu Genel Tebliği hiç elde yok.** Bunlar kanun değil
   yıllık Resmî Gazete metinleridir; MCP yüzeyi (`search_teblig`) denenmedi —
   denenmesi bir sonraki turun işidir. Bu yüzden **15 tarife kalemi
   `amount: null`** ile geliyor. Bu bilinçli bir tercihtir: yanlış harç,
   reddedilen dosyadır.
4. **`kararOzeti` sunucu düzeyinde zorunlu değil** (§2.2-1). Faz B'de L-EVID
   fixture'ı düzelttiğinde tamamlanmalı.
5. **`belirsiz` iki tarih** L-MATTER'da; bu hat yalnız veri katmanını
   verdi (§5.4).
6. **Eksik yüksek değerli şablonlar** (bilirkişi raporuna itiraz, delil/tanık
   listesi, istinaf cevap, ıslah, ihtiyati tedbir/haciz, KVKK aydınlatma + açık
   rıza) **eklenmedi** — B-25 bunları atamıyor; bir sonraki dalgaya not.
7. **`iik-kambiyo-itiraz`'ın m.170 atfı yarım doğrulanmış.** m.168/1'in (4) ve
   (5) numaralı bentleri birebir elde; m.170 gövdesi çekilemediği için not
   "incelemesi m.170'e tabidir — madde metnini ayrıca kontrol edin" diyor.
   Kuralın kendisi (5 gün) m.168/1 metnine dayandığı için `dogrulandi`.
8. **`iik-ihalenin-feshi` başlangıcı `karar`** (`ihale tarihi`) olarak
   modellendi; sonradan öğrenilen fesat hâlinde süre ıttıla tarihinden işler
   ve **bir yıllık üst sınıra** tabidir. Bu istisna not olarak yazıldı, ayrı
   bir kural olarak modellenmedi.
9. **Para hesabı JavaScript `number` ile yapılıyor** ve iki ondalığa
   yuvarlanıyor (`roundTl`). Harç tahmini için yeterlidir; kuruş kesinliği
   iddia edilmiyor ve disclaimer bunu söylüyor.
10. **`GET /v1/fees/*` henüz mount edilmedi** — L-SAFE mount satırını
    eklemeden uç 404 döner. Vaporware kapısı gereği konsolda sekme
    çizilmemelidir.
