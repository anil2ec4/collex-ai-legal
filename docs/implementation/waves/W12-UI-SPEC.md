# W12 — Arayüz ve entegrasyon spesifikasyonu (taslak, 02.09.2026)

Bu belge W12 yapım dalgasının ikinci yarısı (entegrasyon + arayüz hatları) için
bağlayıcı tasarım metnidir. Hatların "as implemented" raporları
(`W12-A.md` … `W12-F.md`) ile çelişen bir yer varsa **raporlar kazanır**; bu
belge güncellenir.

Hedef kullanıcı: tek başına çalışan bir avukat. Uygulama onun günlük çalışma
masasıdır; mühendislik kavramları (runId, tenant, hash, lane) arayüzde
görünmez, yalnız "Teknik ayrıntılar" katlanır alanlarında durur.

## 1. Kabuk (shell)

Üst çubuk: monogram + "ColleX" · **aktif dosya seçici** ("Dosya: Yılmaz / Kira
tahliye" veya "Dosyasız çalışma") · durum rozetleri: `Veritabanı`, `Canlı
araştırma`, `Bulut AI` (her biri /v1/health'ten; tıklayınca Ayarlar › Sistem
durumu) · Ayarlar dişlisi.

Ana gezinme (pill sekmeler, role=tablist): **Dosyalarım** · **Araştır** ·
**Belgeler** · **Taslak** · **Ayarlar**. Dosya sayfası (matter page)
"Dosyalarım" içinden açılır ve kendi alt sekmelerini taşır.

Aktif dosya bağlamı: Araştır/Belgeler/Taslak görünümleri aktif dosyayla
çalışır — üretilen her cevap, yüklenen her belge, kaydedilen her taslak
otomatik olarak o dosyaya bağlanır (`POST /v1/matters/{id}/items`). "Dosyasız
çalışma"da hiçbir şey bağlanmaz; ekranda sarı bir şerit bunu söyler.

İlk açılış (profil boş **ve** hiç dosya yok): karşılama kartı — üç adım
(1 Profilini gir, 2 İlk dosyanı aç, 3 Belge yükle veya araştır) + sistem
durumu. Korpus boşsa (`health.demoCorpus=false`, yerel korpus 0 belge) demo
"Senaryolar" gizlenir; canlı mod hazırsa Araştır'da varsayılan kapsam "Canlı
kaynaklar" olur; canlı kapalıysa kart: "Canlı araştırma kapalı —
ColleX-Baslat.cmd ile başlatın".

## 2. Dosyalarım (ana sayfa)

- Üstte "Bugün / Bu hafta" paneli: `GET /v1/matters/deadlines?until=+14g`
  (kırmızı ≤ 7 gün, turuncu ≤ 14) + "Süre hesapla" hızlı düğmesi.
- Dosya tablosu (`GET /v1/matters`): Başlık · Müvekkil · Karşı taraf ·
  Mahkeme / E. · Durum · Sonraki süre · Son işlem. Arama kutusu (q), durum
  filtresi (Açık / Beklemede / Kapalı). Satıra tıkla → dosya sayfası.
- "+ Yeni dosya": 6 alanlı form (Başlık*, Müvekkil, Karşı taraf, Mahkeme,
  Esas no, Tür: Dava / Danışmanlık / Sözleşme / İcra / Diğer). `POST
  /v1/matters` → otomatik aktif dosya yapılır.
- Bir belgeyi satıra bırakmak → yükle + o dosyaya bağla.

## 3. Dosya sayfası

Başlık: dosya adı, taraf çipleri (rol etiketli), mahkeme/E., durum
(değiştirilebilir), "Bu çalışma alanı yereldir; UYAP ile eşitlenmez" alt
notu, "Belge deposu: collex_local".

Hızlı işlemler: Belge yükle · Bu dosyada araştır (Araştır'a geçer, aktif
dosya bağlamı) · Taslak oluştur (şablon seçici, dosyadan ön-dolu) · Not ekle
· Süre ekle.

Alt sekmeler:
1. **Belgeler** — dosyaya bağlı yüklemeler (kart = mevcut dosya kartı +
   "Belgeye sor" + "Tam metni aç" + taranmış sayfa uyarısı).
2. **Araştırmalar** — kayıtlı cevaplar (`GET /v1/answers?matterId=`): tarih,
   soru, durum rozeti (TAM/ŞERHLİ/KISMİ/ÇEKİMSER), kaynak sayısı, mod (Yerel /
   Canlı / Belge). Aç → mevcut cevap ekranı (`GET /v1/answers/{runId}`) ·
   "Taslakta kullan".
3. **Taslaklar** — `GET /v1/drafts?matterId=`: başlık, şablon, sürüm,
   KAYNAKSIZ sayısı, tarih. Aç → editör. "Sürümler" listesi.
4. **Zaman çizelgesi** — event kayıtları: belgelerden çıkarılan tarihler
   ("belgeden sezgisel çıkarım — tebliğ/duruşma tarihlerini UYAP'tan
   doğrulayın", kaynak bağlantısı) + manuel olaylar; her satır düzenlenebilir /
   silinebilir; "Süre başlat" eylemi.
5. **Süreler** — bkz. §7.
6. **Notlar** — manuel notlar; AI özeti notu (varsa) "AI · kaynaklı ·
   GG.AA.YYYY" etiketiyle.

## 4. Araştır (v2)

- Kapsam çipleri: **Yerel korpus** · **Canlı kaynaklar** · **Yüklediğim
  belgeler** (aktif dosyanın belgeleri seçilir; `filters.fileIds`,
  "korpusla birlikte" onay kutusu → `includeCorpus`).
- Bulut AI çipi ("Bulut AI: kapalı" varsayılan). İlk açmada açıklama
  penceresi: veriler Anthropic'e gider, her istek için ayrı onay, model adı.
  Açıkken istek gövdesine `useCloudAi:true`; `/v1/ai/status.configured=false`
  ise çip devre dışı ve "ANTHROPIC_API_KEY tanımlı değil" ipucu.
- Canlı mod: `POST /v1/research/start` → `GET /v1/research/runs/{id}` 1 sn
  aralıklı yoklama; "Araştırma izi" paneli adım adım Türkçe etiketlerle
  ("Yargıtay kararları aranıyor… 3 sonuç", "Belge çekiliyor 2/6"); bitince
  mevcut cevap çizimi. Sonuç artık kalıcı (F hattı) → "Belgeyi tam metniyle
  aç" ve "Doğrulama dosyasını indir" canlıda da çalışır.
- Cevap kartı ek satırı: "Soru kapsamı: %63 — soru sözcüklerinin kaynaklarda
  karşılığı" (B hattı `coverage`). ÇEKİMSER + `QUESTION_NOT_COVERED` için
  metin: "Aşağıda listelenen pasajlar sorunuzla yalnız kelime düzeyinde
  benziyor; dayanak değildir."
- Her kaynak kartında **kaynak çipi**: "yüklediğiniz belge" · "yerel korpus
  (SENTETİK)" / "yerel korpus" · "canlı resmî kaynak · alınma HH:MM" ·
  "AI · kaynaklı".
- Geçmiş: DB'den (`GET /v1/answers?limit=20`), tıklayınca yeniden çizilir.
- Uyarı kodu sözlüğüne eklenecekler (Türkçe): EVIDENCE_FILTERED,
  UPSTREAM_DEGRADED, DRAFTER_DEGRADED, RESEARCH_COVERAGE_INCOMPLETE,
  BUDGET_EXHAUSTED, TIMEOUT, STORE_UNAVAILABLE, SCANNED_PAGES,
  CORPUS_UNAVAILABLE, QUESTION_NOT_COVERED, AI_UNAVAILABLE, AI_DRAFTER_USED.

## 5. Belgeler (v2)

- Liste: ad/tür arama, dosya filtresi, sıralama; çoklu sürükle-bırak +
  yükleme kuyruğu ("3/7 yükleniyor"); "zaten yüklüydü" rozeti; taranmış
  sayfa uyarısı ("10 sayfanın 9'unda metin yok — taranmış olabilir");
  tamamen taranmış dosyada 422 metni + (AI açıksa) "Bulut OCR ile metne
  çevir" düğmesi → `POST /v1/ai/ocr` → dönen metin `<ad>.ocr.txt` olarak
  `/v1/files`'a yüklenir (ilk satır provenance).
- Belge sayfası (iki bölme): SOL tam metin (mevcut docmodal → bölme),
  chunk çapaları, vurgulama; SAĞ üst "Belgeye sor" (Ctrl+Enter; kapsam
  çipleri Bu belge / Bu dosyadaki tüm belgeler / Belge + korpus) → `POST
  /v1/answer` (`fileIds`); SAĞ orta analiz kartları — her satır bir eylem:
  Atıf → "Korpusta doğrula" (`/v1/answer` ile atıf metni, `asOf` = belge
  tarihi; yürürlük rozeti), Tarih → "Süre başlat" / "Zaman çizelgesine ekle",
  Talep → "Taslağa talep olarak aktar"; SAĞ alt: bu belgeye sorulan sorular.
  AI analizi kartı (rıza): `POST /v1/ai/analyze-document` → özet, talepler,
  dayanaklar, riskler, eksikler, karşı argümanlar; `kaynakli:false` maddeler
  ⚠ KAYNAKSIZ; alt not "AI özeti: her madde işaretli pasaja bağlıdır…".

## 6. Taslak (v2) — editör

- Şablon seçici gruplu (Dilekçeler / Sözleşmeler / Diğer), 13 şablon.
- Form `fields[]`'dan: `group` başlıkları; `kind`: party-list (satır: ad, rol,
  TCKN/VKN, adres, vekil), event-list (tarih + metin), list (textarea →
  satırlar), date, select. Aktif dosyadan ve profilden ön-dolum (taraflar,
  mahkeme, esas no, vekil bloğu) — "otomatik — kontrol edin" çipiyle.
- Kanıt kaynağı: Son araştırma · Dosyadaki kayıtlı araştırma (seçim) ·
  Seçili belgeler (sadece DELİLLER + olay önerisi).
- Editör üç sütun: **Bölümler** (durum noktası: yeşil/kırmızı/sarı) ·
  **Metin** (paragraf blokları `contenteditable="plaintext-only"`, rol
  etiketi, [n] kanıt bağlantıları, araç çubuğu: Alıntı ekle · KAYNAKSIZ
  bırak · Sil; canlı linter: alıntı metinden çıkarsa rozet anında ⚠
  KAYNAKSIZ) · **Kanıtlar** (kaynak kartı + yön çipi + "Dayanak olarak kullan"
  anahtarı; karşıt kilitli; "Araştırmadan kanıt ekle" / "Belgeden kanıt ekle").
- Üst çubuk: şablon adı · "KAYNAKSIZ: n" · "v3 · kaydedildi 14:02" ·
  Kaydet (`PUT /v1/drafts/{id}`) · DOCX · Markdown · UDF (deneysel — ipucu:
  "UYAP Doküman Editörü'nde açarak doğrulayın").
- AI: paragraf araç çubuğunda "Bu paragrafı yaz (Bulut AI)" → `POST
  /v1/ai/draft-paragraph`; sonuç notu "AI taslak — kaynak bağı entailment
  ile doğrulandı (≥%85)".
- EK — DOĞRULAMA BİLGİLERİ bölümü salt okunur; hash'ler yalnız burada.
- Alt sabit inceleme şeridi (mevcut).

## 7. Süreler

- "Süre ekle" formu: kural seçimi (usule göre gruplu, `GET
  /v1/deadlines/rules`) veya özel süre; başlangıç tarihi (tebliğ/tefhim);
  adli tatil anahtarı → `POST /v1/deadlines/compute` → adımlar + son gün +
  gün adı; "Kaydet" → matter item (kind=deadline, `computed` saklanır).
- Liste: başlık, son gün (kalan gün; kırmızı ≤ 7), dayanak (HMK m.127),
  durum (açık/tamam anahtarı). Belge analizindeki tarih satırlarından "Süre
  başlat" bu formu ön-dolu açar.
- Zorunlu uyarı metni her kartta ve dışa aktarımda (D hattı sözleşmesi).

## 8. Ayarlar

- Avukat profili (`GET/PUT /v1/settings`): ad, unvan, baro, sicil no, adres,
  telefon, e-posta, UETS adresi, vergi dairesi/no → taslaklarda vekil bloğu.
- Tercihler: varsayılan şehir, tema, demo senaryolarını göster.
- Sistem durumu: veritabanı (ad, durum, migrasyon sayısı), canlı araştırma
  (MCP 54 araç, durum), Bulut AI (yapılandırıldı mı, model, "canlı sınanmadı"),
  OCR (bulut), sürüm; "Verilerim nerede?" açıklaması (yerel PostgreSQL,
  var/uploads).

## 9. Erişilebilirlik, dil, görsel

- Etiketler normal büyük/küçük harf, ≥ 14px; tüm tarihler GG.AA.YYYY;
  UUID'ler yalnız "Teknik ayrıntılar" içinde; insan başlıkları ("Dava
  Dilekçesi — 02.09.2026").
- Tasarım dili korunur: İçtihat Külliyatı (serif, fildişi, bordo mühür,
  bronz), yumuşak gölgeler, mikro-etkileşimler, koyu tema, yazdırma stili.
- CSP sözleşmesi: tek `<style>` + tek `<script>`, textContent-only DOM,
  LF-only dosya, `https?://` yok (127.0.0.1 hariç).
- Testler: `control-plane/tests/pipeline/console.test.ts` yeni görünümler,
  sözlük anahtarları, LF koruması, "no markup API" koruması.
