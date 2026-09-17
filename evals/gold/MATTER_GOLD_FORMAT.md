# Dosya bazında altın değerlendirme biçimi (W21)

Bu belge, bir avukatın **bütün bir dosyayı** (Matter) işaretleyerek sistemin
dosya incelemesini ölçmeye yarayan "altın" dosyayı nasıl hazırlayacağını
anlatır. Düzenek: `control-plane/src/evals/matterGold.ts` (doğrulama ve
puanlama), şema: `evals/gold/matter-gold.schema.json`, örnek:
`evals/gold/samples/ornek-kira-davasi.json`.

Altın dosya iki şeyi birlikte söyler:

1. sistemin **bulması gerekenleri** — iddialar, savunmalar, hangi delilin
   neyi desteklediği ya da çürüttüğü, çelişkiler, olayların tarihleri,
   hukukî meseleler;
2. sistemin **söylememesi gerekenleri** — çelişki olmayan bir farkı çelişki
   saymak, dayanaksız bir savunmaya "desteklendi" demek, belgede olmayan bir
   tarihi olay tarihi gibi göstermek gibi.

Sistemin belirsiz ya da eksik kalması kabul edilebilir; belirsizliği kesin
bir hukukî sonuç gibi sunması kabul edilemez. Bu yüzden ikinci liste de
ölçülür ve **bulunan doğrulardan ayrı** raporlanır: her şeyi bulan ama bir
"söylenmemeli"yi söyleyen sistem "yüzde 90 başarılı" sayılmaz; rapor ikisini
de yazar.

## Dosyanın yeri ve gizlilik

- Avukatın hazırladığı altın dosyalar **gerçek dosyaya ait bilgi içerir** ve
  **depoya girmez**. Adını `<ad>.lawyer.json` koyun
  (ör. `evals/gold/istanbul-kira-2024.lawyer.json`); bu ad kalıbı `.gitignore`
  ile dışarıda tutulur.
- Avukat dosyası belge metnini **içermek zorunda değildir**: `files[].text`
  boş bırakılır, puanlayıcıya ürünün o dosyadan çıkardığı metin ayrıca verilir.
- `samples/` altındaki örnekler **sentetiktir**; gerçek kişi içermez.

## Temel kural: pasajı birebir alıntıyla gösterin

Her işaretleme bir **pasaja** dayanır: hangi dosya (`fileId`) ve o dosyadan
**harfi harfine** kopyalanmış alıntı (`quote`). Alıntıyı düzeltmeyin,
kısaltmayın, noktalamasını değiştirmeyin.

Metindeki yeri (karakter sırası) **uygulama kendisi bulur**. İsterseniz
`startChar` ile bir ipucu verebilirsiniz, ama bu ipucu kontrol edilir:

- alıntı dosyada hiç geçmiyorsa altın dosya **reddedilir**;
- alıntı dosyada birden çok kez geçiyorsa, hangisini kastettiğinizi
  `occurrence` (1, 2, …) ile belirtmeniz gerekir; belirtmezseniz dosya
  reddedilir;
- `startChar` verdiyseniz ve alıntı orada başlamıyorsa dosya reddedilir.

Reddedilen her pasaj için hangi kayıtta, hangi dosyada, hangi alıntıda sorun
olduğu yazılır.

## Alanlar

| Alan | Zorunlu | Anlamı |
|---|---|---|
| `schema` | evet | `"collex.matter.gold/v1"` |
| `id` | evet | Altın dosyanın kimliği. |
| `title` | evet | Kısa başlık. |
| `source` | evet | `synthetic` ya da `lawyer_annotated` |
| `annotators` | evet | İşaretleyen avukatların adı/rumuzu (avukat dosyasında en az bir). |
| `adjudication` | evet | `pending` (ikinci okuma bekliyor) · `agreed` (iki avukat birleşti) · `disputed` |
| `clientRole` | hayır | Müvekkilin sıfatı (ör. `davacı`). |
| `files` | evet | Dosyadaki belgeler: `fileId`, `title`, isteğe bağlı `text`. |

Aşağıdaki kategorilerden **hiç yazılmayan** kategori puanlanmaz
("işaretlenmedi" görünür). **Boş liste** (`[]`) ise "bu dosyada hiç yok"
demektir: sistemin o türde söylediği her şey yanlış sayılır.

### İddialar ve savunmalar (`claims`, `defenses`)

`id`, `statement` (kendi cümlenizle özet), isteğe bağlı `party`, ve en az bir
`sources` pasajı. Sistemin bir iddiası, türü uyuyorsa ve dayandığı pasaj ile
sizin pasajınız **birbirinin en az yarısını** kapsıyorsa "bulundu" sayılır.
Sistemin alıntısı sizin pasajınızı içerse bile ondan iki kat uzunsa (ör. üç
maddeyi birden alıntılamışsa) o pasajı bulmuş sayılmaz. Bu yüzden pasajı
cümle ya da madde düzeyinde, beyanın geçtiği cümlenin tamamını alarak seçin.

### Delil bağlantıları (`evidenceLinks`)

`target` (bir iddia ya da savunmanın `id`'si), `stance` (`supports` destekler
· `opposes` çürütür) ve `evidence` pasajları. Sistem aynı hedefe aynı yönde,
aynı delil pasajını bağladıysa bulunmuş sayılır.

### Çelişkiler (`contradictions`)

`relation` (`CONTRADICTION` ikisi aynı anda doğru olamaz · `TENSION`
bağdaştırmak zor), `left` ve `right` pasajları, isteğe bağlı `explanation`.
Sıra önemli değildir. Etiketin doğruluğu ayrıca raporlanır. Sistemin
çiftinin iki tarafı birbiriyle örtüşüyorsa ya da bir tarafı sizin iki
pasajınızı birden kapsıyorsa (ör. iki tarafı da içeren bir paragraf), o çift
bu çelişkiyi bulmuş sayılmaz.

### Kronoloji (`chronology`)

`date` (`YYYY`, `YYYY-AA` ya da `YYYY-AA-GG`), isteğe bağlı `precision`
(`exact`, `month`, `year`, `approximate`), `description` ve `sources`.
Tarih, verdiğiniz kesinlikte karşılaştırılır (yalnız ay biliniyorsa gün
aranmaz). `precision` verirseniz tarihle uyumlu olmalıdır: `exact` için
`YYYY-AA-GG`, `month` için en az `YYYY-AA`; uymazsa dosya reddedilir (şema da
bunu denetler). `precision` yazmazsanız tarihin uzunluğundan okunur.

Bu kategoride sistemin **olay** kayıtları (`event`, `procedural_event`)
sayılır; incelemedeki olaylar listesi bunlardır.

### Hukukî meseleler (`legalIssues`)

`statement` ve en az biri: `sources` (meselenin geçtiği pasaj) ya da
`keywords` (sistemin mesele başlığında hepsinin geçmesi gereken kelimeler;
büyük/küçük harf ve Türkçe harf farkı gözetilmez).

### Söylenmemesi gerekenler (`expectedAbstentions`)

Her kayıtta `id`, `type` ve **`reason`** (neden söylenmemeli) bulunur:

| `type` | Ek alanlar | Sistem şunu yaparsa ihlal |
|---|---|---|
| `no_contradiction` | `left`, `right`, `relations` | Bu iki pasaj arasında `relations` içindeki bir çelişki türünü ileri sürerse. |
| `no_support_status` | `target`, `statuses` | Hedef iddia/savunma için `statuses` içindeki bir durumu (ör. `supported`) bildirirse. Sistemin o kaydı hangi türde (iddia, savunma, eksik destek notu) tuttuğuna bakılmaz. |
| `no_item` | `kinds`, `passage` | Bu pasajdan `kinds` türünde bir kayıt çıkarırsa (ör. taraf beyanını `evidence` olarak göstermek). |
| `no_event_date` | `passage`, `date` | Bu pasaja dayanarak o tarihi gösterirse. Kaydın türüne bakılmaz: tarih bir olayda, olguda, iddiada ya da delil kaydında görünse de ihlaldir. |

Destek durumları: `supported`, `opposed`, `ambiguous`, `unsupported`,
`disputed`, `no_support_in_candidates`, `search_incomplete`, `not_weighed`.

"Söylenmemeli" denetiminde örtüşme geniş okunur: sistemin dayandığı pasaj
sizin pasajınızın en az yarısını kapsıyorsa — sizinkinden çok daha uzun olsa
bile — ihlal sayılır. (Bulunanlar sayılırken kural daha dardır; bkz.
iddialar ve savunmalar.)

### Tamlık koşulları (`completenessRequirements`)

| `type` | Karşılanması için |
|---|---|
| `run_finished` | İnceleme bitmiş (`status: done`) olmalı. |
| `coverage_complete` | Sistem kapsamı **tam** bildirmeli. |
| `coverage_gap_reported` | Dosyada okunamayan bir kısım olduğunu biliyorsunuz: sistem kapsamı **eksik** bildirmeli ve "tümü" iddiasını reddetmeli. Tam bildirirse karşılanmamış olur. Yanıtta "tümü" iddiasının reddiyle ilgili alan hiç yoksa sonuç "bilinmiyor" olur. |
| `all_files_processed` | İşlenen dosya sayısı, altın dosyadaki dosya sayısına eşit olmalı. |

Yanıttan okunamayan bir koşul **"bilinmiyor"** olarak kalır; karşılanmış
sayılmaz.

### Kabul edilebilir başka okumalar (`alternatives`)

Bir kaydı genişletir (`appliesTo`: kaydın `id`'si) ve `description` ister:

- `acceptKinds` — bir iddianın savunma olarak (ya da tersi) okunması da doğru;
- `acceptRelations` — bir çelişkinin başka bir etiketle (ör. `TENSION`) verilmesi de doğru;
- `acceptSources` — aynı şeyi söyleyen başka pasajlar; bir **çelişki** kaydında
  hangi tarafı yeniden söylediklerini `side` (`left` ya da `right`) ile
  belirtmek zorunludur: başka pasaj yalnız o tarafın yerine geçer, ikisinin
  birden değil (bir tarafla kendi yeniden söyleyişi çelişki sayılmaz);
- `acceptDate` — bir olay için kabul edilebilir başka tarih;
- `optional: true` — bulunması doğru, bulunmaması hata değil.

Puanlayıcının iki dürüstlük kuralı:

- Sistemin söylenmemesi gereken türde bir kaydı var ama bu kaydın dayandığı
  kaynak doğrulanamıyorsa (alıntı dosyada belirtilen yerde yok, kaynak bu
  altın dosyada metni olmayan bir dosyayı gösteriyor ya da kayıt hiç kaynak
  göstermiyor), o kayıt tam da söylenmemesi gereken şey olabilir. Bu durumda
  "söylenmemeli" kaydı — dört türün hepsinde (`no_contradiction`,
  `no_support_status`, `no_item`, `no_event_date`) — **denetlenemedi** olarak
  ayrı yazılır ve **uyuldu sayılmaz**. Çelişkide bu, tarafları alıntılanmamış
  bir çelişki iddiasıdır.
- Kronolojide sistemin yalnız ayını ya da yılını bildiği bir olay
  (`datePrecision` `month`/`year`/`approximate`), tam gün olarak
  işaretlediğiniz tarihle eşleşmez.

## Puanlama

Puanlayıcı, `GET /v1/matters/{id}/analysis/{runId}/findings` yanıtını altın
dosyayla karşılaştırır ve her kategori için ayrı ayrı yazar:

- **duyarlılık** — sizin işaretlediklerinizden (isteğe bağlı olanlar hariç)
  kaçını buldu. Sistemin tek bir kaydı en fazla bir altın kaydı karşılar:
  iki iddiayı birden içeren tek bir iddia kaydı iki iddia bulmuş sayılmaz
  (iddia ve savunmalar birlikte, diğer kategoriler kendi içinde);
- **kesinlik** — sistemin o kategoride söylediklerinden kaçı altın dosyada
  karşılık buldu;
- kaçırılan kayıtların kimlikleri;
- çelişkiler için etiket doğruluğu;
- söylenmemesi gerekenlerden kaçına uyuldu, hangileri ihlal edildi;
- tamlık koşullarının durumu.

Sistemin gösterdiği kaynaklara da körü körüne güvenilmez: sistemin bir
kaynağındaki alıntı, dosya metninde belirtilen yerde birebir yoksa (ya da
kaynak altın dosyada olmayan bir belgeyi gösteriyorsa) o kaynak
"doğrulanamadı" sayılır ve hiçbir eşleşmeye katılmaz. Ama sistemin o kaynağa
dayanarak **söylediği şey ortadan kalkmaz**: o kayıt yine sistemin iddiası
olarak kesinlik hesabına girer ve hiçbir altın kayda uymadığı için kesinliği
düşürür. Bu, delil bağlantıları için de geçerlidir: delili doğrulanamayan bir
"destekler / çürütür" bağlantısı, bağlantının gösterdiği kayıt bulunmayan bir
bağlantı ve hiçbir kaynak göstermeyen bir delilden kurulan bağlantı sistem
bağlantısı olarak sayılır; raporda "kaynağı doğrulanamayan sistem bağlantısı"
olarak ayrıca yazar. Sistemin aynı değerlendirmeyi hem delilden iddiaya bir
bağlantı hem de iddianın üzerinde bir destek kaynağı olarak yazması (aynı
gözlem kimliğiyle) tek bağlantı sayılır.

Puanlar **tek bir sayıda birleştirilmez**; her kategori ayrı okunur.
