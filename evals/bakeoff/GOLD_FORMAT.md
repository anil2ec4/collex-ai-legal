# Yerel model karşılaştırması — altın vaka biçimi (W20)

Bu klasör, yerel dil modellerini **aynı vakalarla, aynı üretim koduyla**
karşılaştıran düzeneğin (`control-plane/src/evals/bakeoff.ts`,
`control-plane/scripts/bakeoff.mjs`) girdisidir. Mimari hiçbir modeli
seçmez; seçim bu vakaların ölçümüne dayanır.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `cases.synthetic.jsonl` | Bu depoda yazılmış **sentetik** vakalar. Düzeneğin çalıştığını gösterir; hukukî kalite hakkında hüküm vermez. |
| `cases.lawyer.jsonl` *(depoya girmez)* | Avukatın hazırladığı ve onayladığı vakalar. **Gerçek müvekkil belgesi depoya konmaz**: bu dosya `.gitignore` ile dışarıda tutulur ve yalnız ölçümü yapan makinede durur. |

## Satır biçimi (`collex.bakeoff.case/v1`)

Her satır tek bir JSON nesnesidir. Ortak alanlar:

| Alan | Zorunlu | Anlamı |
|---|---|---|
| `schema` | evet | `"collex.bakeoff.case/v1"` |
| `id` | evet | Vakanın kalıcı kimliği (ör. `ext-12`). |
| `task` | evet | `extraction` · `contradiction` · `entailment` · `terminology` · `instruction` |
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
- **entailment** — `claim`, `passage`, `goldEntails` (`true`/`false`).
- **terminology** — `prompt`, `requiredTerms` (cevapta geçmesi gereken
  Türkçe hukuk terimleri), isteğe bağlı `forbiddenTerms`.
- **instruction** — `prompt`, `expectKeys` (JSON'da tam olarak bulunması
  gereken alanlar; fazlası da eksiği de hatadır).

## Avukat vakası hazırlama kuralları

1. Belgeden **birebir** alıntı alın; düzeltmeyin, kısaltmayın. Kişisel
   verileri gerekiyorsa değiştirin, ama değiştirilmiş metni hem `unitText`
   hem `quote` içinde aynı biçimde kullanın.
2. Her vakayı ikinci bir avukat bağımsız olarak etiketlesin; iki etiket
   aynıysa `adjudication: "agreed"`, değilse `"disputed"` yazın. Ölçüm
   raporları `disputed` vakaları ayrıca sayar.
3. Vaka dosyası müvekkil belgesi içerdiği için **depoya girmez**; ölçüm
   raporları yalnız sayıları içerir.

## Ölçülenler

Model başına: yapı geçerliliği, çıkarım duyarlılığı/kesinliği (tür + örtüşen
birebir alıntı), alıntı geçerliliği (alıntının belgede birebir bulunma oranı),
çelişki sınıflandırma doğruluğu, destek (entailment) doğruluğu, terim kapsamı,
talimata uyum, gecikme (p50/p95), sunucu bildiriyorsa girdi/çıktı token
sayıları ve başarısızlık oranı. Ollama kullanılıyorsa `--memory-probe` ile
modelin bellek kullanımı (`/api/ps`) da kaydedilir.

## Kurallar

- Betikli sahte uçla yapılan koşu (`--dry-run`) **ölçüm değildir**; rapor
  bunu en üstte yazar ve modelleri sıralamaz.
- Rapor **kazanan seçmez**. Her ölçüt ayrı gösterilir; seçim ölçümlere bakan
  kişinin kararıdır.
- Yalnız sentetik vakalarla yapılan bir ölçüm, hukukî kalite hakkında hüküm
  için yeterli değildir; rapor bunu da yazar.
