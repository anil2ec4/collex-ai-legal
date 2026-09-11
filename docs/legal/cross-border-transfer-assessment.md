# Yurt Dışı Aktarım Değerlendirmesi (KVKK m.9) — ŞABLON

> **HUKUKÇU İNCELEMESİ GEREKLİ** — Şablondur; nihai hukuki değerlendirme
> değildir. Durum: TASLAK.

## Amaç

Yabancı LLM/embedding/OCR/telemetry/hosting sağlayıcılarına yapılan her veri
aktarımının KVKK m.9 çerçevesinde değerlendirilmesi (brief §12.3). Standart
sözleşme kullanılacaksa güncel **bildirim yükümlülüğü ve süreleri** kontrol
edilmelidir; embedding'in de linklenebilir kişisel veri sayıldığı unutulmamalıdır.

## Değerlendirme tablosu (TODO)

| # | Aktarım (data-flow-map.md akış #) | Alıcı sağlayıcı | Ülke/region | Veri sınıfı | m.9 mekanizması (yeterlilik kararı / standart sözleşme / açık rıza / diğer) | Bildirim yükümlülüğü ve süresi | Ek tedbirler (pseudonymization, şifreleme, region pinning) | Durum |
|---|---|---|---|---|---|---|---|---|
| 1 | Akış 2 — Brave | Brave | (TODO) | L0/L1 | (TODO) | (TODO) | (TODO) | TASLAK |
| 2 | Akış 2 — Tavily | Tavily | (TODO) | L0/L1 | (TODO) | (TODO) | (TODO) | TASLAK |
| 3 | Akış 3 — OpenRouter embedding | OpenRouter | (TODO) | L0 | (TODO) | (TODO) | (TODO) | TASLAK |
| 4 | Akış 4 — OCR (planlı) | (TODO) | (TODO) | L2/L3 | (TODO) | (TODO) | (TODO) | TASLAK |
| 5 | Hosting/DB (Supabase, planlı) | Supabase | (TODO region) | L0-L3 | (TODO) | (TODO) | (TODO) | TASLAK |
| 6 | Hosted LLM (planlı) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | TASLAK |
| 7 | Telemetry (planlı) | (TODO) | (TODO) | L1 (content-off) | (TODO) | (TODO) | (TODO) | TASLAK |

## Karar kuralları

- Mekanizması belirlenmemiş aktarım **yapılmaz** (fail closed).
- L3 için varsayılan local/dedicated lane + yazılı risk değerlendirmesi;
  yurt dışı aktarım ancak yazılı hukuki onayla.
- Region seçenekleri (ör. AB bölgesi) teknik olarak sabitlenebiliyorsa
  sabitlenir ve burada belgelenir.

## TODO — hukukçu

- [ ] Güncel m.9 ikincil mevzuatını / Kurul rehberlerini tarihli kaydet.
- [ ] Standart sözleşme kullanılan aktarımlar için bildirim takvimini işlet.
- [ ] Her satırın kanıt belgesini arşivle.
