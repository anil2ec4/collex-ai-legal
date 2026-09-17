# Gömme (embedding) sağlayıcı karşılaştırması (ölçüm)

Başlangıç: 2026-09-11T16:17:12.866Z · vakalar: synthetic 22 · ortak kelimesi olmayan ilgili pasaj içeren vaka: 22

Ortam: platform=win32 · arch=x64 · node=v24.15.0 · cpu=AMD Ryzen 5 5500 · logicalCpus=12 · totalMemoryGiB=15.8

> Vakaların tamamı sentetiktir; arama kalitesi hakkında hüküm için avukat onaylı vakalar gerekir (evals/embeddings/CASE_FORMAT.md).
> 22 vakada en çok 10 pasaj var: bu vakalarda R@10 kendiliğinden 1 olur (pasaj sayısı K'yı geçmeyen her R@K için de aynısı geçerlidir); sıralama kalitesi için R@1, R@3, MRR ve nDCG@10'a bakın.
> Rapor kazanan seçmez; her ölçüt ayrı gösterilir ve karar bu ölçümlere bakan kişinindir.

## Arama kalitesi (cevaplanan vakalar üzerinden)

| Sağlayıcı | Model | Biçim | Boyut | Ölçülen vaka | R@1 | R@3 | R@5 | R@10 | MRR | nDCG@10 |
|---|---|---|---|---|---|---|---|---|---|---|
| local-e5 | intfloat/multilingual-e5-small:onnx-qint8 | e5 | 384 | 22/22 | 0.379 | 0.864 | 1.000 | 1.000 | 0.890 | 0.703 |

## Yalnız anlamla bulunabilen pasajlar (sorguyla ortak kelimesi yok)

| Sağlayıcı | Ölçülen vaka | R@1 | R@3 | R@5 | R@10 |
|---|---|---|---|---|---|
| local-e5 | 22 | 0.136 | 0.795 | 1.000 | 1.000 |

## İşletim

| Sağlayıcı | Başarısız vaka | Başarısız çağrı | Çağrı | p50 ms | p95 ms | Sorgu p50 ms | Sorgu p95 ms | Açılış ms | Bellek önce MiB | Bellek sonra MiB | Fark MiB | En yüksek MiB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| local-e5 | 0.000 | 0.000 | 44 | 19.3 | 36.4 | 7.2 | 12.5 | 2662 | 477.4 | 484.2 | 6.8 | — |

