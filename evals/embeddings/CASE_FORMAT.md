# Anlam araması (gömme / embedding) karşılaştırması — vaka biçimi (W21)

Bu klasör, belgeleri **anlamına göre** bulan aramanın (gömme modeli) ne kadar
iyi çalıştığını ölçen düzeneğin (`control-plane/src/evals/embeddingEval.ts`,
`control-plane/scripts/embedding_eval.mjs`) girdisidir. Sistem hiçbir gömme
modelini kendiliğinden seçmez; seçim bu vakaların ölçümüne dayanır.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `cases.synthetic.jsonl` | Bu depoda yazılmış **sentetik** vakalar. Gerçek kişi, gerçek dosya içermez. Düzeneğin çalıştığını gösterir; arama kalitesi hakkında hüküm vermez. Her vakada yalnız 5 pasaj vardır; bu yüzden bu dosyada R@5 ve R@10 bilgi vermez (bkz. aşağıda "pasaj sayısı"). |
| `cases.lawyer.jsonl` *(depoya girmez)* | Avukatın hazırladığı ve onayladığı vakalar. **Müvekkil bilgisi depoya konmaz**: bu dosya `.gitignore` ile dışarıda tutulur ve yalnız ölçümü yapan bilgisayarda durur. |

## Bir vaka neyi ölçer?

Her vaka bir **soru** ile birkaç **pasajdan** oluşur. Düzenek her pasajı ve
soruyu aynı gömme modeline verir, pasajları soruya yakınlığına göre sıralar
ve avukatın işaretlediği doğru pasajların sıralamada nereye düştüğüne bakar.

Özellikle önemli olan: **soruyla hiçbir ortak kelimesi olmayan** ama soruyu
cevaplayan pasajlar. Örneğin soru "trafik kazasında maddi zarar", pasaj
"Araçların çarpışması sonucu otomobilde oluşan hasarın bedeli." Kelime
araması bu pasajı bulamaz; onu yalnız anlam araması bulabilir. Rapor bu
pasajlar için ayrı bir sonuç verir ("yalnız anlamla bulunabilen pasajlar").

## Satır biçimi (`collex.embedding.case/v1`)

Her satır tek bir JSON nesnesidir.

| Alan | Zorunlu | Anlamı |
|---|---|---|
| `schema` | evet | `"collex.embedding.case/v1"` |
| `id` | evet | Vakanın kalıcı kimliği (ör. `emb-12`). Dosyada tekrar edemez. |
| `query` | evet | Avukatın soracağı biçimde soru ya da arama ifadesi. |
| `passages` | evet | En az 2, en çok 200 pasaj (aşağıda). |
| `source` | evet | `synthetic` ya da `lawyer_annotated` |
| `annotator` | avukat vakasında | Vakayı hazırlayanın adı ya da rumuzu. |
| `adjudication` | avukat vakasında | `pending` · `agreed` (iki avukat aynı etikette birleşti) · `disputed` |
| `notes` | hayır | Serbest açıklama. |

Her pasaj:

| Alan | Anlamı |
|---|---|
| `id` | Vaka içinde tekil kimlik (ör. `p1`). |
| `text` | Pasaj metni (belgeden birebir). |
| `relevance` | Soruyla ilgisi: `0` ilgisiz · `1` kısmen ilgili · `2` ilgili · `3` soruyu doğrudan cevaplıyor. Her vakada en az bir pasaj `1` veya üstü olmalıdır. |
| `lexicalOverlap` | Pasaj soruyla **en az bir anlamlı kelimeyi** paylaşıyorsa `true`, hiç paylaşmıyorsa `false`. "ve", "ile", "edilmiştir" gibi bağlaç ve yardımcı fiiller sayılmaz. |

`lexicalOverlap` işaretine körü körüne güvenilmez: düzenek her pasajı ürünün
kendi Türkçe kelime kökü karşılaştırmasıyla da kontrol eder. Karşılaştırma
sorunun iki biçimiyle de yapılır: yazıldığı biçimle ve ürünün gömdüğü (kelime
aramasının da kullandığı) biçimle. İkinci biçimde kanun kısaltması ya da atfı
kanun numarasına çevrilir ("TCK dolandırıcılık" → "5237 dolandırıcılık");
pasaj bu numarayı taşıyorsa ("5237 sayılı Kanun…") kelime araması onu
bulabilir, yani ortak kelime var sayılır. "Ortak kelime
yok" diye işaretlenmiş ama sorguyla ortak kelime taşıyan bir pasaj raporda
uyarı olarak listelenir ve "yalnız anlamla bulunan" ölçütüne **sayılmaz**:
bir pasaj bu ölçüte ancak işaret de ürünün karşılaştırması da "ortak kelime
yok" derse girer. Raporun başındaki "ortak kelimesi olmayan ilgili pasaj
içeren vaka" sayısı ve başarısız vakalardaki pasaj sayıları da aynı kuralla
sayılır. Emin değilseniz `true` yazın.

Yüklenirken reddedilen satırlar (satır numarası ve nedeniyle bildirilir):
JSON olmayan satır, eksik alan, tekrar eden vaka veya pasaj kimliği, hiç ilgili
pasajı olmayan vaka, 0–3 dışında bir ilgi derecesi, `annotator` ya da
`adjudication` alanı olmayan avukat vakası.

## Avukat vakası hazırlama kuralları

1. Pasajları belgeden **birebir** alın; düzeltmeyin, kısaltmayın. Kişisel
   verileri gerekiyorsa değiştirin.
2. Her vakaya ilgisiz ama soruyla aynı kelimeyi paylaşan en az bir pasaj
   ekleyin ("tuzak" pasaj): iyi bir anlam araması bunu yukarı taşımamalıdır.
3. Mümkünse her vakada soruyla ortak kelimesi olmayan ama soruyu cevaplayan
   bir pasaj bulunsun.
4. **Pasaj sayısı:** bir vakada 10 ya da daha az pasaj varsa ilk 10 sonuç
   bütün pasajları kapsar ve R@10 kendiliğinden 1 olur (5 pasajlık vakada R@5
   de öyle). Sıralamanın gerçekten ölçülmesi için vaka başına en az 20 pasaj
   önerilir; rapor, az pasajlı vakaların sayısını ayrıca yazar.
5. Her vakayı ikinci bir avukat bağımsız olarak etiketlesin; iki etiket
   aynıysa `adjudication: "agreed"`, değilse `"disputed"` yazın; ikinci
   etiket henüz yoksa `"pending"`. Rapor sentetik, `agreed`, `pending` ve
   `disputed` vakaları **ayrı tablolarda** ölçer ve sayılarını ayrıca yazar;
   birlikte ortalanmış bir kalite sayısı üretilmez (JSON raporda da ölçütler
   yalnız `providers[i].groups.<grup>` altındadır). "Avukat onaylı" yalnız
   `agreed` vakalar için söylenir; hiç `agreed` vaka yoksa rapor bunun avukat
   onaylı bir ölçüm olmadığını yazar.
6. Dosya müvekkil bilgisi içerebileceği için **depoya girmez**; raporlar
   yalnız sayıları ve pasaj kimliklerini içerir, metni içermez.

## Ölçülenler

Sağlayıcı (model) başına; arama kalitesi ölçütleri her vaka grubu (sentetik,
avukat onaylı, bekleyen, tartışmalı) için ayrı hesaplanır:

- **R@1, R@3, R@5, R@10** — ilgili pasajların ilk 1/3/5/10 sonuç içindeki payı;
- **MRR** — ilk ilgili pasajın sırasının tersi (1. sırada ise 1, 2. sırada ise 0,5);
- **nDCG@10** — ilgi derecesini de hesaba katan sıralama kalitesi;
- **yalnız anlamla bulunabilen pasajlar için R@K** — yukarıdaki gibi, ama
  yalnız soruyla ortak kelimesi olmayan ilgili pasajlar üzerinden;
- **gecikme** — her model çağrısı için p50/p95 (ayrıca yalnız soru çağrıları);
- **başarısızlık oranı** — vaka ve çağrı başına, hata koduyla;
- **açılış süresi ve bellek** — yalnız düzeneğin kendisinin başlattığı ve
  belleğini okuyabildiği süreç için; okunamıyorsa boş bırakılır, tahmin yazılmaz.

Eşit puan alan pasajlarda sıra **ilgisiz pasajın lehine** bozulur: bir model
pasajların yazılış sırasından puan kazanamaz.

Soru, ürünün anlam (yoğun) şeridinin gömdüğü biçimde gömülür: küçük harfe
çevrilmiş, noktalama birleştirilmiş, mevzuat atfı kanun numarasına indirgenmiş
(ör. "TCK m. 160 kapsamında İhmal" → "5237 m. 160 kapsamında ihmal"). Ölçülen, ürünün sıralamada
kullandığı soru vektörüdür. Anlamsal yeniden sıralama soruyu yazıldığı gibi
gömer; bu sayılar onu ölçmez ve rapor bunu yazar.

## Çalıştırma

```
node control-plane/scripts/embedding_eval.mjs --providers local-e5
node control-plane/scripts/embedding_eval.mjs --providers local-e5 --cases evals/embeddings/cases.synthetic.jsonl,evals/embeddings/cases.lawyer.jsonl
node control-plane/scripts/embedding_eval.mjs --dry-run
```

Rapor `evals/reports/embedding-eval-<tarih>.json` ve `.md` olarak yazılır.

## Kurallar

- Betikli sahte gömücüyle yapılan koşu (`--dry-run`) **ölçüm değildir**;
  rapor bunu başlıkta ve en üstte yazar ("harness check — not a measurement").
- Rapor **kazanan seçmez**. Her ölçüt ayrı gösterilir; seçim ölçümlere
  bakan kişinin kararıdır.
- Yalnız sentetik vakalarla yapılan ölçüm, arama kalitesi hakkında hüküm
  için yeterli değildir; rapor bunu da yazar.
