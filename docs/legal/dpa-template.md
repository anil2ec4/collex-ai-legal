# Veri İşleme Sözleşmesi Şablonu (DPA Template) — ŞABLON

> **HUKUKÇU İNCELEMESİ GEREKLİ** — Şablondur; sözleşme metni hukukçu
> tarafından yazılacaktır. Durum: TASLAK.

## Amaç

İki yönde kullanılacak DPA çerçevesi:

1. **ColleX ↔ müşteri (avukat/büro)**: ColleX'in veri işleyen olduğu matter
   içeriği işlemeleri için.
2. **ColleX ↔ alt işleyenler**: subprocessor-register.md'deki sağlayıcılarla
   yapılan sözleşmelerin asgari şartlarını denetlemek için kontrol listesi.

## Asgari içerik kontrol listesi (TODO — hukukçu metinleştirir)

| # | Hüküm | Not | Durum |
|---|---|---|---|
| 1 | Tarafların rolleri (sorumlu/işleyen) ve talimat mekanizması | legal-basis-matrix.md ile tutarlı | TODO |
| 2 | İşleme konusu, süresi, niteliği, veri kategorileri, ilgili kişi grupları | processing-inventory.md'den | TODO |
| 3 | Gizlilik ve meslek sırrı yükümlülüğü | avukat sırrı özel hükmü | TODO |
| 4 | Güvenlik tedbirleri (teknik/idari) | threat-model.md kontrolleriyle eşleşme | TODO |
| 5 | Alt işleyen kullanımı: ön onay/bildirim, register'a kayıt | subprocessor-register.md | TODO |
| 6 | Yurt dışı aktarım şartları | cross-border-transfer-assessment.md | TODO |
| 7 | **No-training taahhüdü** (model eğitiminde kullanılmaz) | L2/L3 için zorunlu | TODO |
| 8 | Retention ve sözleşme sonu silme/iade (türevler: embedding, özet, cache, backup dahil) | retention-matrix.yaml | TODO |
| 9 | İhlal bildirimi süresi ve içeriği | 72 saat yaklaşımının güncel teyidi (TODO) | TODO |
| 10 | Denetim/doğrulama hakları | | TODO |
| 11 | İlgili kişi başvurularında yardım yükümlülüğü | takedown-and-data-subject-request.md | TODO |
| 12 | Sorumluluk ve tazminat | | TODO |

## TODO — hukukçu

- [ ] Sözleşme dilini (TR/EN) ve uygulanacak hukuku belirle.
- [ ] KVKK terminolojisiyle GDPR terminolojisinin eşleşme tablosunu ekle
      (yurt dışı sağlayıcı DPA'ları çoğunlukla GDPR dilinde).
- [ ] Şablonu gerçek sözleşme metnine dönüştür.
