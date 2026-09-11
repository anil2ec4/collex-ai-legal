# Kişisel Veri İşleme Envanteri (Processing Inventory) — ŞABLON

> **HUKUKÇU İNCELEMESİ GEREKLİ** — Şablondur; nihai hukuki değerlendirme
> değildir. Durum: TASLAK.

## Amaç

KVKK kapsamındaki işleme faaliyetlerinin envanteri; VERBİS değerlendirmesinin
ve kişisel veri saklama/imha politikasının temelidir. Not (brief §12.3):
müvekkil belgesi, **embedding, özet, prompt, model output, trace, cache ve
backup** aynı privacy kapsamına girebilir — envanter türetilmiş verileri de
kapsamalıdır.

## Envanter tablosu (TODO — doldurulacak)

| # | İşleme faaliyeti | Veri kategorileri | Özel nitelikli? | İlgili kişi grubu | Amaç | Hukuki sebep | Saklama süresi (bkz. retention-matrix.yaml) | Alıcılar | Yurt dışı aktarım? | Teknik/idari tedbirler |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Hesap yönetimi | kimlik, iletişim | hayır | kullanıcı (avukat) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 2 | Matter/upload içeriği işleme | müvekkil dosyası (her kategori mümkün) | mümkün (sağlık/ceza/çocuk) | müvekkil, karşı taraf, üçüncü kişiler | hukuki araştırma/taslak | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 3 | Kamu karar korpusu ingestion | karar metinlerindeki kişisel veriler | mümkün | karar tarafları | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 4 | Embedding/türetilmiş veri üretimi | chunk, embedding, özet | içeriğe bağlı | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 5 | Telemetry/güvenlik logları | content-off metrik, IP | hayır (hedef) | kullanıcı | güvenlik | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 6 | Faturalama | fatura/ödeme bilgisi | hayır | kullanıcı | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |

## Notlar

- Anonimleştirme geri çevrilmeye çalışılmaz; cross-source re-identification
  engellenir (source-register.yaml `reidentification_prohibited: true`).
- Silme/yok etme/anonimleştirme kayıtlarının saklanma süresi ve periyodik imha
  politikası güncel resmî metinden uygulanır (TODO: hukukçu teyidi).

## TODO — hukukçu

- [ ] Satırları veri akış haritasıyla (data-flow-map.md) eşleştir.
- [ ] Her satır için hukuki sebebi legal-basis-matrix.md'ye bağla.
- [ ] VERBİS kayıt yükümlülüğü/istisnası değerlendirmesini yaz.
