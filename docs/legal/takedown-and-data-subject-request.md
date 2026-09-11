# Takedown ve İlgili Kişi Başvurusu Süreci — ŞABLON

> **HUKUKÇU İNCELEMESİ GEREKLİ** — Şablondur; nihai hukuki değerlendirme
> değildir. Durum: TASLAK.

## Amaç

İki ayrı süreç tek yerde belgelenir:

1. **Takedown**: Kaynak sahibi/üçüncü kişinin içerik kaldırma talebi
   (kaynak hakkı, kişilik hakları, mahkeme kararı vb.).
2. **İlgili kişi başvurusu (KVKK m.11 / m.13)**: erişim, düzeltme, silme,
   itiraz vb. talepler.

Not (brief §12.2/12.3): her kaynak için takedown süreci production ingestion
kapısının parçasıdır (source-register.yaml `operations.takedown_contact`);
tenant/matter silme; object, chunk, embedding, summary, cache ve derived
evidence üzerinden geçmelidir; anonimleştirme geri çevrilmeye çalışılmaz.

## Takedown akışı (TODO — süreleri hukukçu belirler)

| Adım | Eylem | Sorumlu | Süre hedefi |
|---|---|---|---|
| 1 | Talep alınır ve kayda geçirilir (tarih, talep eden, kapsam, dayanak) | (TODO) | (TODO) |
| 2 | İlk değerlendirme: kapsamdaki canonical document/version/chunk envanteri çıkarılır | (TODO) | (TODO) |
| 3 | Geçici önlem: içerik retrieval'dan çıkarılır (index + cache) | (TODO) | (TODO) |
| 4 | Hukuki değerlendirme ve karar | hukukçu | (TODO) |
| 5 | Kalıcı işlem: snapshot/version/chunk/embedding/cache/evidence türevleri dahil kaldırma veya kısıtlama | (TODO) | (TODO) |
| 6 | Talep edene yanıt + iç kayıt kapatma | (TODO) | (TODO) |

## İlgili kişi başvurusu akışı (TODO)

| Adım | Eylem | Sorumlu | Süre |
|---|---|---|---|
| 1 | Başvuru kanalı ve kimlik doğrulama | (TODO) | — |
| 2 | Rol tespiti: ColleX veri sorumlusu mu, işleyen mi? İşleyen ise ilgili veri sorumlusuna (avukat/büro) yönlendirme/bildirim | hukukçu | (TODO) |
| 3 | Kapsam tespiti (hangi tenant/matter/korpus) | (TODO) | (TODO) |
| 4 | Yanıt ve gerekiyorsa silme/düzeltme (türevler dahil) | (TODO) | KVKK m.13 süresi (TODO: güncel teyit) |
| 5 | Kayıt ve raporlama | (TODO) | (TODO) |

## Kayıt defteri şablonu

| # | Tarih | Tür (takedown / m.11) | Talep eden | Kapsam | Karar | Kapanış tarihi | Kanıt yolu |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — |

## TODO — hukukçu

- [ ] KVKK m.13 yanıt sürelerinin güncel teyidi.
- [ ] Kamu kararlarındaki kişisel veriler için silme talebi geldiğinde
      "resmî kaynakta hâlâ yayımda" durumunun nasıl ele alınacağı.
- [ ] Takedown kanalının (e-posta/form) kurulması ve source-register'a işlenmesi.
