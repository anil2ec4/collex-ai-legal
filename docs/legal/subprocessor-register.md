# Alt İşleyen Kayıt Defteri (Subprocessor Register) — ŞABLON

> **HUKUKÇU İNCELEMESİ GEREKLİ** — Şablondur; nihai hukuki değerlendirme
> değildir. Durum: TASLAK.

## Amaç

Kişisel veri dokunan her üçüncü taraf sağlayıcının kaydı; DPA (dpa-template.md)
ve yurt dışı aktarım değerlendirmesinin (cross-border-transfer-assessment.md)
girdisi. Kural (brief §12.3): **provider allowlist olmadan L2/L3 verisi dışarı
çıkmaz**; no-training, retention, subprocessor ve region yazılı doğrulanır.

## Kayıt tablosu (TODO — sözleşmeler ve güncel şartlar tarihli doğrulanacak)

| # | Sağlayıcı | Hizmet | Dokunan veri sınıfı (L0-L3) | Region/ülke | DPA var mı? | No-training taahhüdü | Retention | Prompt/content cache | Alt-alt işleyenler | Doğrulama tarihi | Karar (allowlist?) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Brave Search API | KVKK karar keşfi (arama) | L0/L1 (sorgu metni) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 2 | Tavily | BDDK + Sigorta keşfi (arama) | L0/L1 (sorgu metni) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 3 | OpenRouter (embedding rotası) | Embedding | L0 (yalnız kamu korpusu; baseline) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 4 | Mistral (opsiyonel OCR) | Bazı mevzuat PDF fallback OCR | L0 | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 5 | Supabase (planlı) | Postgres/pgvector/storage | L0-L3 | (TODO) | (TODO) | — (hosting) | (TODO) | — | (TODO) | (TODO) | (TODO) |
| 6 | Hosted LLM sağlayıcı(ları) (planlı) | Üretim/verifier modeli | (TODO — L2/L3 için ayrı karar) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 7 | Telemetry/log sağlayıcı (planlı) | Content-off metrik | L1 | (TODO) | (TODO) | — | (TODO) | — | (TODO) | (TODO) | (TODO) |

## Kurallar

- Yeni sağlayıcı eklemek = bu tabloya satır + hukukçu onayı + gerekiyorsa
  cross-border değerlendirmesi. Onaysız sağlayıcıya hiçbir L2/L3 içerik gitmez.
- Sağlayıcı şartları zamana duyarlıdır; implementation ve release anında
  yeniden doğrulanır (RESEARCH.md protokolü).

## TODO — hukukçu

- [ ] Her satır için DPA/şart belgelerini `evidence_paths` mantığıyla arşivle (tarihli).
- [ ] L2/L3 için aday sağlayıcılarda no-training/retention/region yazılı teyidi.
- [ ] Alt-alt işleyen değişiklik bildirim mekanizmalarını kaydet.
