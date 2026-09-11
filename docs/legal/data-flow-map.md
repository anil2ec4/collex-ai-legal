# Veri Akış Haritası (Data Flow Map) — ŞABLON

> **HUKUKÇU İNCELEMESİ GEREKLİ** — Bu dosya mühendislik tarafından hazırlanmış
> bir şablondur; nihai hukuki değerlendirme değildir. Durum: TASLAK.

## Amaç

Her veri alanının nereden girdiğini, hangi sistemlerden geçtiğini, hangi
sağlayıcılara gittiğini ve nerede saklandığını KVKK uyumu için uçtan uca
belgelemek. KVKK m.9 (yurt dışı aktarım), veri sorumlusu/veri işleyen rol
analizi ve VERBİS değerlendirmesinin girdisidir (bkz. brief §12.3):

- VERBİS kayıt istisnası, KVKK'daki diğer yükümlülüklerden genel istisna değildir.
- ColleX, matter içeriğinde avukatın talimatıyla **veri işleyen**;
  hesap/faturalama/güvenlik/kendi analitiğinde **veri sorumlusu** olabilir.
  Rol, fiilî amaç ve vasıta kontrolüne göre **veri akışı bazında** yazılmalıdır.
- Sağlık, ceza mahkûmiyeti, biyometrik/genetik, çocuk vb. veriler özel niteliklidir.
- Yabancı LLM/OCR/telemetry/hosting sağlayıcısı KVKK m.9 değerlendirmesi gerektirebilir.

## Veri sınıfları ve model routing (brief §12.3 — bağlayıcı başlangıç tablosu)

| Sınıf | Örnek | Varsayılan rota |
|---|---|---|
| L0 — Kamu hukuku | Anonim resmî mevzuat/karar | Onaylı hosted model mümkün |
| L1 — Dahilî | Ayar, kişisel şablon | Tenant-isolated; content logging kapalı |
| L2 — Avukat sırrı | Dilekçe, sözleşme, müvekkil dosyası | DPA/no-training/retention/region incelemesi geçen provider veya local |
| L3 — Çok hassas | Sağlık, çocuk, cinsel hayat, ceza, genetik, ticari sır | Varsayılan local/dedicated lane + yazılı risk değerlendirmesi |

L2/L3 zorunlu kuralları: içerik telemetry/exception/analytics'e yazılmaz;
provider prompt cache varsayılan kapalı; no-training/retention/subprocessor/
region yazılı doğrulanır; mümkünse model öncesi pseudonymization (eşleme matter
içinde); embedding de linklenebilir kişisel veri sayılır; cache anahtarı
tenant/matter/user scope + `as_of` + model/config version içerir; yetki
kalkınca session/cache/retrieval erişimi derhal kapanır.

## Akış envanteri (TODO — hukukçu + mühendislik birlikte doldurur)

| # | Akış adı | Veri alanları | Sınıf (L0-L3) | Kaynak | Geçtiği bileşenler | Alıcı/sağlayıcı | Ülke/region | Saklama yeri | Hukuki dayanak (bkz. legal-basis-matrix.md) | Rol (sorumlu/işleyen) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Kamu karar/mevzuat arama | sorgu metni, sonuç metadata | L0 | kullanıcı + resmî portal | provider gateway | upstream portallar | TR | (TODO) | (TODO) | (TODO) |
| 2 | KVKK/BDDK/Sigorta keşif | sorgu metni | L0/L1 | kullanıcı | provider gateway | Brave / Tavily | (TODO) | (TODO) | (TODO) | (TODO) |
| 3 | Embedding üretimi | belge/chunk metni | L0 (public) / L2-L3 (private) | corpus / upload | embedder | OpenRouter veya local lane | (TODO) | (TODO) | (TODO) | (TODO) |
| 4 | Upload pipeline (planlı) | müvekkil belgesi, OCR çıktısı | L2/L3 | tenant kullanıcısı | quarantine/parser/OCR | (TODO OCR sağlayıcı) | (TODO) | (TODO) | (TODO) | (TODO) |
| 5 | Research run state/audit | sorgu, plan, evidence ref | L1/L2 | control-plane | Postgres | — | (TODO) | (TODO) | (TODO) | (TODO) |
| 6 | Telemetry/log | content-off metrik | L1 | tüm bileşenler | log sink | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) |
| 7 | Hesap/faturalama | ad, e-posta, fatura | L1 | kullanıcı | (TODO) | (TODO) | (TODO) | (TODO) | (TODO) | veri sorumlusu (aday) |

## Kabul kapısı (brief §12.3)

- [ ] Her veri alanı için amaç, hukukî sebep, saklama, alıcı ve transfer ülkesi yazılı.
- [ ] Controller/processor rol analizi akış bazında tamamlandı.
- [ ] Tenant/matter silme; object, chunk, embedding, summary, cache ve derived evidence üzerinde geçiyor.
- [ ] Backup deletion/expiry kullanıcıya açıklanıyor.
- [ ] Provider allowlist olmadan L2/L3 dışarı çıkmıyor.
- [ ] Production telemetry'de belge metni, ad, TCKN, sağlık/ceza verisi veya secret yok.
- [ ] İhlal runbook'u masa başı tatbikatla denendi.
- [ ] TBB 2026 yapay zekâ rehberi incelendi (bağlayıcılık-tavsiye ayrımı kayıtlı).
- [ ] ColleX tüzel yapısının VERBİS durumu değerlendirildi.

## TODO — hukukçu için açık sorular

1. Akış 2-4'teki yabancı sağlayıcılar için KVKK m.9 mekanizması (standart
   sözleşme? açık rıza? yeterlilik kararı?) — bkz. cross-border-transfer-assessment.md.
2. Standart sözleşme kullanılacaksa güncel bildirim yükümlülüğü ve süreleri.
3. Veri ihlali bildirimi: Kurul kararları ve güncel 72 saat yaklaşımının teyidi.
