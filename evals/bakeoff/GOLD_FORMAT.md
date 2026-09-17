# Yerel model karşılaştırması — altın vaka biçimi (W20)

Bu klasör, yerel dil modellerini **aynı vakalarla, aynı üretim koduyla**
karşılaştıran düzeneğin (`control-plane/src/evals/bakeoff.ts`,
`control-plane/scripts/bakeoff.mjs`) girdisidir. Mimari hiçbir modeli
seçmez; seçim bu vakaların ölçümüne dayanır.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `cases.synthetic.jsonl` | Bu depoda yazılmış **sentetik** vakalar. Düzeneğin çalıştığını gösterir; hukukî kalite hakkında hüküm vermez. |
| `cases.semantic.synthetic.jsonl` | W21 anlamsal çelişki şeridi için **sentetik** çift vakaları: karşılaştırılacak tarih ya da tutar içermeyen çelişkiler ("araç duruyordu" / "araç hareket halindeydi"). |
| `cases.weighing.synthetic.jsonl` | W21 iddia-delil değerlendirmesi için **sentetik** vakalar: bir iddia (ya da savunma) ve her biri için avukatın destekler / çürütür / belirsiz / ilgisiz etiketini taşıyan aday deliller. |
| `cases.lawyer.jsonl` *(depoya girmez)* | Avukatın hazırladığı ve onayladığı vakalar. **Gerçek müvekkil belgesi depoya konmaz**: bu dosya `.gitignore` ile dışarıda tutulur ve yalnız ölçümü yapan makinede durur. |

## Satır biçimi (`collex.bakeoff.case/v1`)

Her satır tek bir JSON nesnesidir. Ortak alanlar:

| Alan | Zorunlu | Anlamı |
|---|---|---|
| `schema` | evet | `"collex.bakeoff.case/v1"` |
| `id` | evet | Vakanın kalıcı kimliği (ör. `ext-12`). |
| `task` | evet | `extraction` · `contradiction` · `entailment` · `terminology` · `instruction` · `semantic_contradiction` · `claim_weighing` |
| `source` | evet | `synthetic` ya da `lawyer_annotated` |
| `annotator` | avukat vakasında | Vakayı hazırlayanın adı/rumuzu. |
| `adjudication` | avukat vakasında | `pending` · `agreed` (iki avukat aynı cevapta birleşti) · `disputed` |
| `notes` | hayır | Serbest açıklama. |

Göreve göre alanlar:

- **extraction** — `unitText` (belge bölümü), `kinds` (istenecek öğe türleri:
  `entity, event, fact, claim, defense, evidence, legal_issue, request,
  procedural_event, credibility_issue, possible_conflict`), `goldItems`
  (`[{kind, quote}]`). **Her `quote`, `unitText` içinde harfi harfine
  geçmelidir**; geçmeyen satır yüklenirken reddedilir.
- **contradiction** — `left`, `right`, `goldRelation`
  (`CONTRADICTION` · `TENSION` · `CORROBORATION` · `INDEPENDENT`).
- **entailment** — `claim`, `passage`, `goldEntails` (`true`/`false`). Bu
  görev ürünün **kendi** hakem istemini ve yanıt denetimini kullanır
  (`control-plane/src/llm/localGenerationAdapter.ts`, `entailmentRequest` /
  `validateEntailmentReply`; yerel hakem de tam olarak bunları çağırır): iddia
  ve pasaj güvenilmeyen veri bloğunda `[İDDİA]` / `[PASAJ]` başlıklarıyla
  gider. Doğru sayılan karar, ürünün uyguladığı karardır: puan eşik değerde
  (0,85) ya da üstündeyse "destekliyor", altındaysa "desteklemiyor" —
  `entails` alanı tek başına bir şey değiştirmez. Ürünün reddettiği yanıt
  (puan yok ya da sayı değil, puan 0–1 dışında, "desteklemiyor" deyip eşik
  üstü puan verme) üründe iddiayı "denetlenemedi" bırakır; burada geçersiz
  yapı sayılır ve **sıfır puan** alır.
- **terminology** — `prompt`, `requiredTerms` (cevapta geçmesi gereken
  Türkçe hukuk terimleri), isteğe bağlı `forbiddenTerms`.
- **instruction** — `prompt`, `expectKeys` (JSON'da tam olarak bulunması
  gereken alanlar; fazlası da eksiği de hatadır).
- **semantic_contradiction** (W21) — `pairs`: `[{left, right, leftSummary?,
  rightSummary?, goldRelation, alsoAcceptable?}]` (1–40 çift; her metin en çok
  400 karakter, çünkü ürün modele her metnin en çok 400 karakterini gösterir).
  `left` / `right` belgeden birebir alıntıdır. `leftSummary` / `rightSummary`
  isteğe bağlıdır: çıkarım modelinin o taraf için yazdığı özet. Ürün her
  alıntının altında bu özeti "model özeti, bağlayıcı değil" etiketiyle
  gösterir; gerçekçi ya da bilerek yanıltıcı bir özet yazmak, modelin özete
  kanıp kanmadığını ölçer (`sem-10`: alıntılar birbirini doğruluyor, özet
  olumsuz). Özeti olmayan tarafta bu satır istekte yer almaz; rapor böyle kaç
  çift olduğunu yazar. `goldRelation`:
  `CONTRADICTION` (ikisi aynı anda doğru olamaz) · `TENSION` (bağdaştırmak
  zor ama imkânsız değil) · `CORROBORATION` (birbirini doğruluyor) ·
  `INDEPENDENT` (çelişmiyor ya da farklı şeylerden söz ediyor) ·
  `INSUFFICIENT_EVIDENCE` (bu iki metinle karar verilemez).
  `alsoAcceptable`, avukatın kabul ettiği diğer etiketlerdir. Bu görev
  ürünün **kendi** istem kurucusunu ve yanıt doğrulayıcısını kullanır
  (`control-plane/src/exhaustive/semanticContradictions.ts`). Ürün bir
  çağrıda en çok `COLLEX_ANALYSIS_CONTRADICTION_PAIRS_PER_CALL` (varsayılan
  10) çift gönderir; düzenek de vakanın çiftlerini aynı boyda çağrılara
  böler. Böylece istemin kurgusu ve çağrı boyu gerçek bir incelemedekiyle
  aynıdır; ancak bir taraf için özet verilmemişse o taraftaki özet satırı
  (üründe çoğu zaman bulunan) istekte yoktur. Kullanılan çağrı boyu raporun
  başında yazar.
- **claim_weighing** (W21) — `claim` (en çok 400 karakter), isteğe bağlı
  `claimKind` (`claim` · `defense`, varsayılan `claim`) ve `candidates`:
  `[{text, goldStance, alsoAcceptable?}]` (1–32 aday; her aday en çok 260
  karakter — ürün modele tam bu kadarını gösterir). `goldStance`: `supports`
  (bu delil iddiayı destekler) · `opposes` (çürütür) · `ambiguous` (iki yöne de
  okunabilir) · `unrelated` (iddiayla ilgisi yok). Bu görev ürünün **kendi**
  iddia-delil istemini ve yanıt doğrulayıcısını kullanır
  (`control-plane/src/exhaustive/stageProcessors.ts`, `weighRequest` /
  `validateWeigh`). Ürün bir çağrıda en çok `COLLEX_ANALYSIS_WEIGH_BATCH`
  (varsayılan 8) aday gönderir; düzenek de adayları aynı boyda çağrılara
  böler (20 aday: 8 + 8 + 4).

## Avukat vakası hazırlama kuralları

1. Belgeden **birebir** alıntı alın; düzeltmeyin, kısaltmayın. Kişisel
   verileri gerekiyorsa değiştirin, ama değiştirilmiş metni hem `unitText`
   hem `quote` içinde aynı biçimde kullanın.
2. Her vakayı ikinci bir avukat bağımsız olarak etiketlesin; iki etiket
   aynıysa `adjudication: "agreed"`, değilse `"disputed"` yazın; ikinci
   etiket henüz yoksa `"pending"`. `annotator` ya da `adjudication` alanı
   olmayan avukat vakası yüklenirken reddedilir. Ölçüm raporları sentetik,
   `agreed`, `pending` ve `disputed` vakaları **ayrı tablolarda** gösterir ve
   sayılarını ayrıca yazar. Kalite ölçütleri JSON raporda da yalnız grup
   başına bulunur (`models[i].groups.<grup>`); gruplar üzerinden birlikte
   ortalanmış bir kalite sayısı hiç üretilmez. Model satırında yalnız işletim
   bilgileri (vaka, çağrı, başarısız ve okunamayan oranı, gecikme, token)
   durur.
3. Vaka dosyası müvekkil belgesi içerdiği için **depoya girmez**; ölçüm
   raporları yalnız sayıları içerir.

## Ölçülenler

Model başına: yapı geçerliliği, çıkarım duyarlılığı/kesinliği, alıntı
geçerliliği (alıntının belgede birebir bulunma oranı; hiç alıntı dönmeyen
vaka bu ölçüte katılmaz — boş bir cevap "geçerli alıntı" sayılmaz),
çelişki sınıflandırma doğruluğu, destek (entailment) doğruluğu, terim kapsamı,
talimata uyum, gecikme (p50/p95, vaka başına), sunucu bildiriyorsa girdi/çıktı token
sayıları ve başarısızlık oranı. Ollama kullanılıyorsa `--memory-probe` ile
modelin bellek kullanımı (`/api/ps`) da kaydedilir.

Çıkarımda bir bulunan öğe bir altın öğeyi ancak **tür aynıysa ve alıntı
aralıkları sıkı örtüşüyorsa** karşılar: iki aralığın kesişimi, birleşiminin en
az yarısı olmalıdır. Eşleşme bire birdir: her bulunan öğe en çok bir altın
öğeyi, her altın öğe en çok bir bulunan öğeyi karşılar. Birimin tamamını
alıntılayan bir öğe, içindeki kısa altın öğeleri "bulmuş" sayılmaz.

Okunamayan bir yanıt (JSON olmayan ya da boş) ya da beklenen zarfta olmayan
yanıt hiçbir şey bulmamış ve hiçbir şey ileri sürmemiş sayılır ve ölçütlere
**sıfır puanla** girer — altın öğesi olmayan bir çıkarım vakasında (olumsuz
kontrol) da: okunamayan yanıt "burada bir şey yok" demiş sayılmaz. Olumsuz
kontrolde tam puanı (1/1) yalnız okunabilen ve boş bir `items` listesi dönen
yanıt alır. Yalnız uç noktaya ulaşılamayan vakalar (bağlantı, süre aşımı,
HTTP hatası) kalite ortalamalarına katılmaz; raporda her değerin yanında,
kaç vakaya dayandığı (n/N) yazar.

Gecikme vaka başınadır. Ulaşılamayan ya da HTTP hatası veren vakanın
gecikmesi yoktur, ölçüye katılmaz. Süre aşımına uğrayan vaka ise geçen
süresiyle **alt sınır** olarak katılır: sıralamada böyle bir vaka yüzdelik
değerin yerinde ya da altında kalıyorsa değer "≥" ile yazılır (gerçek değer
en az bu kadardır). "Gecikme vakası" sütunu, gecikmenin kaç vakaya dayandığını
gösterir. Böylece süre sınırına takılan en yavaş vakalar ölçüden düşmez.

İstekteki model adı, cevabı hangi modelin verdiğini kanıtlamaz: tek model
sunan bir sunucu (ör. tek GGUF yüklü `llama-server`) istekteki adı yok sayar
ve yüklü modelle cevap verir. Bu yüzden ölçümden önce uç noktanın model
listesi (`GET /v1/models`) okunur. `--models` adlarından biri listede yoksa
ölçüm yapılmaz ve rapor yazılmaz (çıkış kodu 2); tek model listeleyen bir
uca iki ad vermek de bu yüzden reddedilir. Raporun "Uçta listelenen model"
sütunu, adı listede bulunan modeli yazar. Liste okunamazsa ölçüm yapılır ama
sütunda "doğrulanmadı" yazar ve raporun başında satırlardaki adların yalnız
istenen adlar olduğu belirtilir. Rol başına model değişkenleri
(`COLLEX_LOCAL_LLM_MODEL_EXTRACTION` vb.) karşılaştırmada dikkate alınmaz: her
rol `--models` ile verilen modelle çalışır.

Anlamsal çelişki görevinde ayrıca: etiket doğruluğu, gerçek çelişki ve
gerilimlerin bulunma oranı, çelişki olmayan çiftlere çelişki denme oranı
(yanlış çelişki — en ağır hata; modelin **cevapladığı** çelişki olmayan
çiftler üzerinden, hiç cevap yoksa boş) ve modelin cevapladığı çiftlerin payı.
Okunamayan bir yanıt hiçbir şey bulmamış ve hiçbir şey ileri sürmemiş sayılır.

İddia-delil görevinde ayrıca: karar doğruluğu, destekleyen delillerin
bulunma oranı, desteklemeyen bir delile "destekler" denme oranı (**yanlış
destek** — iddiayı haksız yere "delille desteklenmiş" gösterdiği için en ağır
hata; modelin **cevapladığı** desteklemeyen adaylar üzerinden, hiç cevap yoksa
boş: susan bir model temiz 0 almaz) ve cevaplanan adayların payı (rapor
tablosunda ayrı sütun). Cevapsız aday ne doğru ne de bir
iddia sayılır; üründe de böyle bir aday "arama eksik" (`search_incomplete`)
yazdırır.

## Kurallar

- Betikli sahte uçla yapılan koşu (`--dry-run`) **ölçüm değildir**; rapor
  bunu en üstte yazar ve modelleri sıralamaz. `--dry-run-served <ad>` sahte
  ucu tek model sunan bir sunucu gibi çalıştırır (yalnız düzeneğin
  reddettiğini denetlemek için).
- Rapor **kazanan seçmez**. Her ölçüt ayrı gösterilir; seçim ölçümlere bakan
  kişinin kararıdır.
- Yalnız sentetik vakalarla yapılan bir ölçüm, hukukî kalite hakkında hüküm
  için yeterli değildir; rapor bunu da yazar.
