# W13 — Hat GLOBAL: küresel hukuk-AI durumu, mekanizma çıkarımı ve ColleX'e uyarlama

Tarih: **02.09.2026** · Hat: GLOBAL (araştırma/denetim; kod değişikliği yok) ·
Erişim tarihi: bu belgedeki bütün dış kaynaklar **02.09.2026**'da görüldü.

Bu belge `docs/COMPETITIVE.md`'nin (Apilex · De Jure, TR pazarı) küresel
tamamlayıcısıdır. Amacı rakip listelemek değil, **mekanizma çıkarmaktır**:
lider ürünlerin kaynak/güven sunumu, belge Q&A, taslak UX, iş kütüphanesi ve
halüsinasyon kapılarını sökmek ve bunlardan **bu depoda bugünkü yüzeylerle
uygulanabilir** olanları §7'de 25 kalem hâlinde önceliklendirmektir.

## 0. Etiketleme ve dürüstlük kuralı

- **[doğrulandı]** = üreticinin/kurumun kendi yüzeyinde (ürün sitesi, yardım
  merkezi, resmî duyuru) bu oturumda görüldü; URL + erişim tarihi verilir.
- **[pazarlama]** = üreticinin beyanı, mekanizması gösterilmiyor.
- **[çıkarım]** = benim iki kaynağı karşılaştırmamdan çıkan sonuç.
- **[üçüncü taraf]** = bağımsız inceleme/akademik çalışma; üreticinin kendi
  yüzeyi değil.

Hiçbir özellik, fiyat veya sayı uydurulmadı. Alıntılar kısa tutuldu.
Mahkeme/akademik sayılar (§1) üçüncü taraf derlemelerdir; ColleX'in hiçbir
belgesinde "ölçülmüş sayı" olarak kullanılamaz — `STATUS.md` "Ölçülen
sayılar" tablosunun kapsamı dışındadır.

---

## 1. Neden atıf doğrulama bir ürün kategorisi oldu (tasarımımızın en güçlü savunması)

Bu bölüm ColleX'in "kanıt yoksa cümle yok" duruşunun **pazar gerekçesidir**.

| Bulgu | Kaynak | Etiket |
|---|---|---|
| Damien Charlotin'in *AI Hallucination Cases* veritabanı 11.08.2026 itibarıyla **1.871 kayıt** (ABD, Kanada, Avustralya, BK); 09.06.2026'da 1.598 idi, bir yıl önce ~200 | naturalandartificiallaw.com/ai-hallucination-cases-tracker/ ve türev derlemeler (haqq.ai, gc.ai, vaquill.ai), erişim 02.09.2026 | [üçüncü taraf] |
| Tek bir dosyadaki rekor yaptırım ~**109.700 USD** | gc.ai/blog/ai-hallucination-legal-cases, 02.09.2026 | [üçüncü taraf] |
| Şubat 2026, Nebraska: bir istinaf dilekçesinde **63 atıftan 57'si kusurlu**, 20'si tamamen uydurma; avukat önce inkâr etti, Nisan 2026'da süresiz olarak meslekten men edildi | aynı derlemeler, 02.09.2026 | [üçüncü taraf] |
| *Withers v. City of Aberdeen* (N.D. Miss., 08.06.2026): **iki taraf da** sahte atıf sundu; duruşma iptal, iki baş avukat o bölgede 2 yıl men | aynı, 02.09.2026 | [üçüncü taraf] |
| Yaptırım eğrisindeki en tutarlı örüntü: **hatayı erken sahiplenen avukat daha az ceza aldı**; örtbas cezayı büyüttü | aynı, 02.09.2026 | [üçüncü taraf / çıkarım] |
| Stanford RegLab, *Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools* (ön-kayıtlı, 202 sorgu, uzman puanlı): **Lexis+ AI %17'den fazla**, **Westlaw AI-Assisted Research %34'e yakın** oranda halüsinasyon; doğru+kaynaklı cevap oranı Lexis %65, Westlaw %41, Ask Practical Law AI %19 | reglab.stanford.edu/publications/hallucination-free-…, arxiv.org/pdf/2405.20362, erişim 02.09.2026 | [üçüncü taraf] |
| Aynı çalışmanın açık sonucu: RAG'ın halüsinasyonu "ortadan kaldırdığı" / "hallucination-free" iddiaları **abartılıdır** | aynı | [üçüncü taraf] |
| Kullanıcı tarafı: hukuk-AI kullanıcılarının yalnız **~%22'si** çıktıya yüksek güven duyduğunu söylüyor; güven, aracın cevabı **doğrulanabilir kaynağa bağlayıp bağlamamasıyla** birlikte hareket ediyor | vaquill.ai/blog/what-lawyers-really-think-of-legal-ai, gc.ai/blog/legal-ai-tools, 02.09.2026 | [üçüncü taraf] |

**ColleX için sonuç.** İki büyük sağlayıcının kendi korpusunda ölçülen
halüsinasyon oranı %17–34 iken, ürün mesajı olarak "daha iyi model" satmak
savunulamaz. Savunulabilir tek pozisyon bizim zaten seçtiğimizdir:
*doğrulanamayan alıntı çıktıya giremez* (`export/` exit 2), *kanıt yoksa
çekimserlik*, *üçüncü tarafın bize güvenmeden yeniden çalıştırabileceği
doğrulama tarifi*. §7'nin ilk beş kalemi bu duruşu **avukatın elinde
kanıta** çevirmekle ilgilidir — Charlotin veritabanındaki örüntü ("erken
sahiplenen kazandı") tam olarak bir **denetim izinin** ürettiği şeydir.

---

## 2. Ürün ürün mekanizma envanteri

Her satır: tanımlayıcı 3–5 özellik → kaynak/güven sunumu → belge yükleme ve
belge Q&A → taslak UX → iş kütüphanesi → fiyat → eleştiri.

### 2.1 Harvey (harvey.ai)

- **Tanımlayıcı yüzeyler** [doğrulandı, harvey.ai/products, 02.09.2026]:
  **Agents** ("Purpose built agents execute complex legal work end to end",
  görevler "automatically routed to the right agent"), **Vault** ("Securely
  store, organize, and bulk-analyze legal documents"), **Knowledge**
  (alan/mevzuat/vergi araştırması), **Spaces** (kuruluşlar arası paylaşımlı
  çalışma alanları, "governance and ethical walls"), **Contract
  Intelligence**, **Command Center** (kim neyi kullanıyor analitiği),
  **Harvey Mobile**.
- **Bilgi kaynakları (bizim için en önemli mekanizma)** [doğrulandı,
  help.harvey.ai/articles/knowledge-sources-overview, 02.09.2026]: *Regional
  Knowledge Sources* — kullanıcı sorguda bir bölgesel kaynak seçtiğinde
  Harvey "aramayı ve atıfları o yargı çevresi için tanımlı bir hukukî ve
  düzenleyici site kümesiyle **sınırlar**". Platformda 200 veri kaynağı
  doğrudan erişilebilir [pazarlama, harvey.ai/blog].
- **Kaynak sunumu** [doğrulandı, help.harvey.ai/articles/assistant-workflows,
  academy.harvey.ai]: satır içi **numaralı atıflar** + sağda **kaynak yan
  paneli**; atıfa tıklayınca kaynağa iniliyor. Akademi materyali bir
  **"üç adımlı doğrulama alışkanlığı"** öğretiyor: taslak elden çıkmadan
  önce atıflar, kilit iddialar ve çapraz referanslar teyit edilir.
- **Workflow Builder**: bölgesel bilgi kaynakları, Vault dosyaları ve bilgi
  tabanları **özel iş akışlarının içine gömülebiliyor** [doğrulandı,
  help.harvey.ai/articles/embed-files-and-knowledge-sources-in-workflow-builder].
- **Fiyat**: yayımlanmıyor [çıkarım — ürün sitesinde fiyat sayfası yok].

### 2.2 Thomson Reuters CoCounsel (Casetext mirası) + Westlaw

- **İş (skill) kütüphanesi** — bizim için en somut kopyalanabilir yapı
  [doğrulandı, thomsonreuters.com/en-ca/help/cocounsel/legal/skills/understanding-cocounsel-skills,
  02.09.2026]. On adlandırılmış iş, her biri **tek cümlelik sözleşmeyle**:
  1. *AI-Assisted Research* — "answers a legal research question by searching
     Westlaw Precision's trusted legal database"
  2. *Ask Practical Law AI* — editör yazımı pratik rehberlik
  3. *Search a Database* — "answers questions by searching a database of your
     information"
  4. *Review Documents* — "reads documents **word-for-word**"
  5. *Extract Contract Data*
  6. *Contract Policy Compliance* — "…to ensure the current terms comply with
     **your policies**"
  7. *Summarize*
  8. *Timeline* — "…to quickly identify date, time, and event description
     information"
  9. *Draft Correspondence*
  10. *Prepare for a Deposition*
- **Çıktı biçimi sözleşmeye bağlı** [doğrulandı, aynı sayfa]: *Review
  Documents / Extract Contract Data / Contract Policy Compliance* → **tablo**;
  *AI-Assisted Research / Ask Practical Law AI* → "inline citations for fast
  verification" + kaynak listesi; *Timeline* → "dynamic, searchable list".
  **Güven skoru yok** — sayfa hiçbir yerde yüzde vermiyor.
- Mart 2026: *Draft Editor* dört işin (Review Documents, Draft, Summarize,
  Timeline) üstüne geldi [üçüncü taraf, thomsonreuters.com/en-us/posts/
  innovation/cocounsel-legal-monthly-insider-march-2026].
- **KeyCite** (Westlaw'ın citator'ı) — §3'te ayrı ele alınıyor.

### 2.3 LexisNexis — Lexis+ with Protégé

- Şubat 2026'da *Lexis+ AI* → **Lexis+ with Protégé** olarak yeniden
  adlandırıldı ve uçtan uca iş akışı platformuna dönüştü [üçüncü taraf,
  lawnext.com/2026/02/…, 02.09.2026].
- **Shepard's Verify**: "AI cevaplarındaki, belgelerdeki ve taslaklardaki
  atıfları denetler — otoriteyi yüzeye çıkarır ve **desteklenmemiş ifadeleri
  işaretler**" [doğrulandı-sayfa metni,
  lexisnexis.com/en-us/products/lexis-plus-protege.page, 02.09.2026].
  Bu, ColleX'in `verifier.ts` + `drafting/composer.ts` KAYNAKSIZ rozetinin
  bire bir muadilidir — **fark**: onlar bunu Word/taslak içine taşıyor.
- **Protégé Vault**: 100.000 belgeye kadar tek çalışma alanı; PDF, tablo,
  görsel, ses, video [üçüncü taraf, lawnext.com/2026/05/…].
- **Kişiselleştirme**: "responses reflect your practice context"
  [doğrulandı-sayfa metni].
- Mayıs 2026: agentic skills, işbirliği *Workrooms*, **müşteride duran
  şifreleme anahtarı** [üçüncü taraf, lawnext.com/2026/05/…] — kurumsal
  güven dili; bizim yerel-tek-kullanıcı duruşumuzun bulut karşılığı.

### 2.4 vLex Vincent AI (artık Clio bünyesinde)

- **Citation analysis, "up-the-tree" ve "down-the-tree"** [doğrulandı,
  support.vlex.com/…/understanding-vincents-unique-features, 02.09.2026]:
  kaynağın **atıf yaptığı** kararlar ve kaynağa **atıf yapan** kararlar
  birlikte taranır; sayfa bunun "en iyi hukuk araştırmacılarının otoritenin
  gücünü ve geçerliliğini doğrulamak için yaptığını taklit ettiğini" söylüyor.
- **Kaynak şeffaflığı**: "you can easily click through to the underlying case
  law or statute" [doğrulandı, aynı sayfa].
- **Build an Argument** iş akışı: müvekkil dosyasındaki **olgular** ile
  otoritelerin verisi birleştirilir; hangi pozisyonun daha güçlü olduğuna
  dair gerekçeli öneri üretir [doğrulandı-sayfa metni,
  support.vlex.com/features/vincent/build-an-argument].
- *Compare Jurisdictions* iş akışı; Docket Alarm entegrasyonu (yayımlanmamış
  dosyalar) [doğrulandı, aynı].
- **Eleştiri** [üçüncü taraf, lawyerist.com Vincent AI Review, 02.09.2026]:
  "No Published Pricing", "Add-on Product", düşük maliyetli basit AI arayan
  bürolara uygun değil; arayüz için "works similarly to other web-based legal
  research applications" — yani **ayırt edici bir arayüz iddiası yok**.

### 2.5 Clearbrief (Word içinde atıf doğrulama) — bizim en yakın felsefî akrabamız

- **Renk kodlu destek derecesi** [üçüncü taraf, lawnext.com/2021/03/…,
  02.09.2026]: eklenti dilekçedeki her atıfı bulur, atfedilen belgeyle
  hizalar ve **atfın, kendisini gösteren cümleyi ne ölçüde desteklediğini
  renk koduyla** işaretler.
- **Cite Check Report** (Aralık 2025) [doğrulandı-üçüncü taraf,
  lawnext.com/2025/12/clearbrief-launches-cite-check-report-…, 02.09.2026]:
  - Hem **hukukî hem maddî (record) atıfları** denetler; şirket bunu
    sektörde ikisini birden kapsayan tek araç olarak sunuyor [pazarlama].
  - "automatically identifies all citations and flags potential issues";
    eksik karar/kaynak, biçim hatası ve **kaynağın iddiayı desteklemediğini
    gösteren düşük semantik skor** işaretlenir.
  - Doğrulama motoru **üretken AI değil "klasik" AI** — yani doğrulama
    adımının kendisi halüsinasyon üretemiyor. *(ColleX'in deterministik
    doğrulayıcısıyla aynı tasarım kararı.)*
  - "a patented semantic analysis score that compares each sentence to its
    cited source"; alıntı doğruluğu ayrıca kontrol edilir.
  - **Çıktı bir PDF rapordur**: "tracks how associates, paralegals or
    attorneys addressed each identified issue, with any notes they left
    during their review"; dosyaya kaydedilir ve **dosyalama öncesi gereken
    özenin kalıcı kanıtı** olur.
- **Fiyat** [doğrulandı, clearbrief.com, 02.09.2026]: **Solo 300 USD/ay/
  kullanıcı**; Enterprise Unlimited özel fiyat.
- Diğer yüzeyler: hiperbağlı atıflar (yargıç ve karşı taraf güvenli bağlantı
  ile dilekçeyi kaynaklarıyla yan yana görebiliyor), *Analyze & Add
  Fact-Cite*, *Table Builder, Timelines & Summaries*.

### 2.6 Midpage

- AI destekli **citator**: bir kararın bütün atıf yapan referanslarını
  değerlendirip **Negative / Caution / Neutral** olarak sınıflandırır
  [üçüncü taraf, legaltechnologyhub.com + aitoolsbakery karşılaştırmaları,
  02.09.2026].
- Ajan iş akışları: kullanıcı AI'a atıf yapılan dilekçeleri çektirip
  **bir brief'teki atıf ve alıntıların doğruluğunu teyit ettirebiliyor**
  [üçüncü taraf, geeklawblog.com/2026/02/…].
- Temmuz 2026: federal + eyalet **mevzuat, düzenleme ve kurum rehberliği**
  kapsama eklendi [üçüncü taraf, lawnext.com/2026/07/…].
- Konumlanma: solo/küçük büro için uygun fiyatlı, **önerme-temelli arama** ve
  ızgara (grid) tabanlı karar karşılaştırma [üçüncü taraf].

### 2.7 Paxton AI

- **Paxton AI Citator** [doğrulandı-üretici, paxton.ai/post/introducing-the-
  paxton-ai-citator-…, 02.09.2026]: bir kararın bozulup bozulmadığını,
  onanıp onanmadığını, sorgulanıp sorgulanmadığını izler; **birbirine
  doğrudan atıf yapmayan ama aynı hukukî ilkeyi paylaşan kararları
  gruplar**.
- **Yayımlanmış doğruluk skoru**: Stanford CaseHOLD türevi 2.400 örnekte
  **%94**, kendi iç ölçütlerinde **%86** [doğrulandı-üretici — kendi
  ölçümüdür, bağımsız değildir].
- Bizim için önemli olan mekanizma değil **jest**: bir citator'ın doğruluk
  oranını **açıkça yayımlaması**. ColleX'in `dogrulanmadi` etiketleri aynı
  dürüstlük ekonomisinin diğer ucudur.

### 2.8 Legora

- **Tabular Review** (imza özelliği) [üçüncü taraf, gc.ai/blog/legora-legal-
  ai-review, 02.09.2026]: çok sayıda belge aynı anda işlenir, sonuç
  **ızgara** olarak döner — "one row per document, one column per question,
  with each cell linked to the source".
- Word ve Outlook eklentileri, *Editor* (memo yazım ortamı), *Workflows*,
  *Portal* (büro→müvekkil), *Agent* katmanı.
- **Eleştiri** [üçüncü taraf, aynı]: kaynak atfı **belge düzeyinde**, karakter
  düzeyinde değil; "No public pricing (as of May 2026)"; deneme sürümü yok.
  *(ColleX'in kod-noktası ofseti + sha256'sı burada net bir üstünlüktür.)*

### 2.9 Spellbook (Word eklentisi, sözleşme)

- Çekirdek dört yüzey Word içinde: **Review** (AI redlining + risk
  işaretleme), **Draft**, **Ask**, **Benchmarks**; ayrıca *Compare to
  Market* ve *Associate* [üçüncü taraf, spellbook.com/learn/legal-ai-tools ve
  gc.ai incelemesi, 02.09.2026].
- **Yazarlığı koruyan redline**: değişiklikler **avukatın adı altında** ve
  track-changes olarak öneriliyor [üçüncü taraf, spellbook.com/learn/best-ai-
  contract-redlining-tools]. Bu, ColleX'in "makine üretimi — avukat
  incelemesi zorunludur" bandının tersi bir çözüm: sorumluluğu gizlemek
  yerine **düzenlemeyi izlenebilir** kılmak.
- **Custom Playbooks**: kullanıcının kural setini kodlayıp her sözleşmeye
  uygulama [üçüncü taraf].
- **Fiyat**: yayımlanmıyor; üçüncü taraf tahmini ~99 USD → 350 USD/kullanıcı/
  ay [üçüncü taraf, bindlegal.com — **tahmin, doğrulanmadı**].

### 2.10 Callidus

- Word içinde beş modül: **Negotiate** (redline önerisi), **Draft**, **Chat**,
  **Compare Contracts**, **Proofread** [üçüncü taraf, callidusai.com
  karşılaştırma sayfası + spellbook.com/briefs, 02.09.2026].
- **Fiyat açıkça yayımlanıyor**: 3.000 USD/kullanıcı/yıl, sınırsız kullanım,
  ek ücret yok [üçüncü taraf]. Sektörde nadir; §6'daki eleştiriyle birlikte
  okunmalı.

### 2.11 Luminance · Robin AI · Kira · Diligen (yığın sözleşme incelemesi)

- **Luminance**: yüksek hacimli sözleşme kümeleri için **panolar ve görsel
  ısı haritaları**; ekip her dosyayı açmadan örüntü ve aykırı değerleri
  görüyor [üçüncü taraf, spellbook.com/learn/best-ai-tools-for-contract-due-
  diligence + layer3labs rehberi, 02.09.2026].
- **Düşük güvenli çıkarımların yönetimi** — bizim için asıl ders [üçüncü
  taraf, ctacquisitions.com/ai-due-diligence-tools-2026, 02.09.2026]:
  Kira ve Luminance düşük güvenli çıkarımları **platform içi bir inceleme
  kuyruğuna** yönlendiriyor; Harvey **yapılandırılmış belirsizlik
  açıklamaları** üretip ekibe triyaj yaptırıyor; Robin AI kendi hukukçu
  ekibine yükseltiyor (süre maliyeti).
  *ColleX karşılığı: `unusedEvidence` + `unusedReason` zaten bir kuyruktur;
  eksik olan onu bir **iş listesi** gibi göstermek.*

### 2.12 DeepJudge

- Büro **kurum içi bilgisini** aranabilir hâle getiren arama katmanı
  (SharePoint, DMS, e-posta); *SuperSearch*, çok-belgeli sohbet, müzakere
  istihbaratı, yönetişimli LLM ajanları [üçüncü taraf, beri.net/tools/
  deepjudge, legaltechnology.com LegalWeek demoları, 02.09.2026].
- Solo avukat için doğrudan karşılığı yok; **ders**: "araştırma" ile "kendi
  arşivinde arama" ayrı ürünlerdir. ColleX'in `filters.fileIds` +
  `includeCorpus` ikilisi bu ayrımı zaten yapıyor ama arayüz onu iki ayrı
  **iş** olarak sunmuyor.

### 2.13 Clio (Manage AI / eski adıyla Duo) — solo avukat pratik yönetimi

- Yetenekler [üçüncü taraf, legaltechnologyhub.com + layer3labs + clio
  fiyat analizleri, 02.09.2026]: taslak fatura üretimi, makbuz/masrafı
  dosyayla eşleştirme, **sonraki adım önerisi**, görev/not/etkinlik/masraf
  kaydının otomatik oluşturulması, dosya adlandırma önerisi, dilekçe ve
  müvekkil yazışması taslağı, uzun belge özeti, pratik verisinden içgörü
  (hangi dosya türü kârlı, hangi müvekkilde açık fatura var).
- **Paketleme**: bağımsız ürün değil, üst paketlere gömülü [üçüncü taraf].
- **Ders**: solo avukatın günlük acısının yarısı hukukî değil **idarî**.
  ColleX'in `matters` + `deadlines` yüzeyi bunun çekirdeğine sahip; eksik
  olan "sonraki adım" önerisi ve dosya özeti kartı (§7 #21).

### 2.14 Josef

- Kod yazmadan **akış şeması** mantığıyla hukukî araçlar ve karar ağaçları
  kuran no-code platform; tarayıcı içi belge otomasyonu [üçüncü taraf,
  joseflegal.com + legaltechnologyhub.com, 02.09.2026].
- **Ders (sınırlı)**: ColleX'in 13 şablonu sabit; Josef'in gösterdiği şey,
  avukatın kendi tekrar eden işini **kendisinin** tarif edebilmesinin değerli
  olduğu. Bizde bunun düşük maliyetli karşılığı "kontrol listesi" (§7 #12),
  tam karşılığı değil.

### 2.15 Alexi

- Litigasyon odaklı: *Memo* ve *Arguments* ürünleri; dava dosyasındaki
  belgelerden **kanıta bağlı taslak** üretimi ("otomatik kanıt bağlama");
  **Workflow Library** — yaygın litigasyon belgeleri için önceden
  hazırlanmış, özelleştirilebilir otomasyonlar [üçüncü taraf, alexi.com
  ve lawnext.com/2024/10/…, 02.09.2026].
- 2026'da Fastcase ile içtihat verisi üzerine dava içinde [üçüncü taraf,
  lawnext.com/2026/07/… ve 2026/01/…] — **ders**: korpus mülkiyeti bir
  ürün riskidir; ColleX'in "statik kopya-korpus yarışına girmeme" kararı
  (COMPETITIVE.md §1) bu riski taşımıyor.

### 2.16 Descrybe

- Bu oturumda **kendi araç yüzeyinde** görülen fiil kümesi (MCP araç listesi,
  02.09.2026) [doğrulandı — araç adları, davranış değil]:
  `search_cases_by_concept`, `search_case_text`, `find_case_from_reference`,
  `search_laws_and_rules`, `get_case_passages`, `get_case_summary`,
  `find_cases_that_cite`, `check_case_status`, `extract_case_references`,
  **`verify_quote`**.
- **Ders**: bu, bir hukuk araştırma ürününün **API olarak** doğru
  ayrıştırılmasıdır — "atıftan karar bul", "kararı citeleyenler", "durum
  kontrolü", "alıntıyı doğrula" ayrı fiillerdir. ColleX'in 35 yolu bu
  granülerliğe sahip değil: `POST /v1/answer` her şeyi yapıyor. §7 #20 bunu
  düzeltmeyi öneriyor (yeni uç değil, **adlandırılmış iş**).

### 2.17 CourtListener / RECAP / Free Law Project (açık kaynak referansı)

- **eyecite** [doğrulandı, free.law/projects/eyecite + pypi, 02.09.2026]:
  metinden hukukî atıf çıkaran açık kaynak kütüphane; 50 milyondan fazla
  atıfa karşı test edilmiş; **tam atıf**, **kısa biçim**, **supra**, **id.**
  ve **ibid.** referanslarını ayrı ayrı tanıyor.
- **Citation Lookup API** [doğrulandı, free.law/2024/04/16/citation-lookup-
  api/, 02.09.2026]: ~64.000 karakterlik metin gönderilir; atıflar çıkarılır,
  **geçersiz ve belirsiz atıflar işaretlenir**, geçerli olanlar veri
  tabanındaki kararlarla eşleştirilir. Duyurunun başlığı doğrudan
  "Combat Hallucinations".
- **Ders (çok yüksek):** üç kovalı sınıflandırma — **eşleşti / belirsiz /
  bulunamadı** — bizim `legal_reference/` ayrıştırıcımızda zaten hesaplanan
  bilgidir ama **arayüzde bir kovaya bağlanmıyor**. Ayrıca `supra` / `id.` /
  kısa biçim muadili Türkçede "**aynı karar**", "**anılan karar**", "**agk.**"
  gibi biçimlerdir; ayrıştırıcı bunları tanımıyorsa karşı tarafın
  dilekçesindeki atıfların bir kısmı sessizce kaybolur.

### 2.18 2026'nın bilinmesi gereken hamleleri

| Hamle | Ne | Kaynak | Etiket |
|---|---|---|---|
| **Google Gemini Enterprise for Legal** (25.08.2026) | Hukuka özgü ajan seti: **atıf doğrulama**, sözleşme yaşam döngüsü, dilekçe taslağı, DSAR yürütme, mevzuat izleme | artificiallawyer.com/2026/08/25/…, 02.09.2026 | [üçüncü taraf] |
| **CoCounsel agentic workflows** (2026 başı) | Otonom belge incelemesi + "Deep Research" | thomsonreuters kaynakları, 02.09.2026 | [üçüncü taraf] |
| **Inline Citations** (2026 baharı) | AI cevaplarının içinde **üzerine gelince önizleme** açan kaynak bağlantıları | gc.ai/blog/legal-ai-tools, 02.09.2026 | [üçüncü taraf] |
| **LegalCiteBench @ ICML 2026** | "Legal AI Needs Reliable Citation Evaluation" — atıf değerlendirmesi artık akademik bir ölçüt kategorisi | phala.com/posts/legalcitebench-ai4law-icml-2026, 02.09.2026 | [üçüncü taraf] |
| **Lexis Protégé Work / Workrooms / müşteri anahtarı** (07.05.2026) | Agentic skills + işbirliği + müşteride duran şifreleme anahtarı | lawnext.com/2026/05/…, 02.09.2026 | [üçüncü taraf] |
| **DISCO agentic e-discovery**, NetDocuments AI (ILTACON 2026 öncesi) | Depolama/DMS katmanına ajan gömülmesi | law.com/legaltechnews/2026/08/21/…, 02.09.2026 | [üçüncü taraf] |

**Örüntü [çıkarım]:** 2026'da rekabet "daha iyi cevap"tan **"cevabın
denetlenebilirliği ve iş akışına gömülmesi"**ne kaydı. Atıf doğrulama artık
ayrı bir ürün değil, her platformun **zorunlu bir ajanı**. ColleX bu eğrinin
önünde başladı; risk, bunu **avukatın görebileceği bir çıktıya**
dönüştürmemek.

---

## 3. Kaynak ve güven sunumunun dilbilgisi (ColleX'in çekirdek farklılaştırıcısı)

### 3.1 Citator sinyalleri — iki olgun sistem

**Shepard's Signals (LexisNexis)** [doğrulandı,
supportcenter.lexisnexis.com/app/answers/answer_view/a_id/1088155,
02.09.2026]:

| Sinyal | Şekil + renk | Anlam |
|---|---|---|
| Warning | **kırmızı sekizgen (dur işareti)** | güçlü olumsuz işlem (ör. *overruled by*) |
| Questioned | **turuncu Q** | geçerliliği sorgulanmış |
| Caution | **sarı üçgen** | olumsuz etkisi olabilecek işlem (ör. *limited*, *criticized by*) |
| Positive | **yeşil artılı elmas** | olumlu işlem (ör. *affirmed*, *followed by*) |
| Analysis | **mavi sekizgen "A"** | ne olumlu ne olumsuz (ör. *explained*) |

**KeyCite (Westlaw)** [doğrulandı, thomsonreuters.com/en-us/help/drafting-
assistant/westcheck/keycite-status-flags + legal.thomsonreuters.com/blog/…,
02.09.2026]:

| Bayrak | Anlam |
|---|---|
| **kırmızı bayrak** | kararın en az bir noktası artık geçerli hukuk değil |
| **sarı bayrak** | olumsuz atıf var ama bozulmamış/değiştirilmemiş (ör. gerekçe eleştirilmiş, kapsam daraltılmış) |
| **kırmızı çizgili bayrak** | **kısmen** bozulmuş; diğer noktalar geçerli |
| **mavi çizgili bayrak** | temyiz/istinaf yolunda, sonuç henüz yok |
| **Overruling Risk simgesi** | **örtük** olumsuz işlem: karar, sonradan bozulan bir karara dayandığı için zayıflamış olabilir |
| **Depth of treatment çubukları** | atıf yapan kararın, atıf yapılan kararı **ne kadar derinlemesine** tartıştığı |

**Bu iki sistemden çıkarılacak dört tasarım kuralı:**

1. **Durum, cevaptan önce gelir.** Sinyal karar başlığının **solunda**dır;
   okuyucu metni okumadan önce riski görür. ColleX'in kaynak kartında
   `originChip` ve `currentnessChip` var ama **karar/norm düzeyinde tek bir
   birleşik durum rozeti yok**.
2. **Derece vardır, ikili değildir.** "İyi hukuk / kötü hukuk" değil; beş–altı
   kademe. Bizim `currentness` yalnız yürürlükte/mülga/henüz-değil/
   değerlendirilemez veriyor — **kararlar için karşılığı yok**.
3. **Örtük riskin ayrı bir adı vardır** (Overruling Risk). Bu, ColleX'in
   citator şeridinin (`legal.document_relations`) tam olarak
   üretebileceği bir şeydir: dayanağı mülga olmuş bir kararı işaretlemek.
4. **"Bayrak yok" ≠ "temiz"**. Her iki sistem de bunu belgelerinde söyler;
   biz **bunu daha da açık söylemek zorundayız**, çünkü kapsamımız kısmî.
   Rozet metni asla "sorun yok" olmamalı; **"olumsuz işlem taranmadı"**
   olmalı. (Bu, `verified.status:'dogrulanmadi'` disiplininin aynısıdır.)

### 3.2 Atıf çipi / kaynak paneli kalıpları

Somut, ölçülebilir rehberlik [üçüncü taraf, aydesign.ai/blog/ai-citation-
source-ui-patterns-2026, 02.09.2026]:

| Kalıp | Sözleşme |
|---|---|
| **Satır içi numaralı atıf + hover önizleme** | küçük tıklanabilir işaret (üst simge sayı ya da çip); popover'da favicon/başlık/kaynak/alıntı; **alıntı 200 karakterde kesilir** (…) |
| **Kaynak kartı yan paneli** | **üç ve daha fazla kaynaklı** cevaplarda; kart = başlık + kaynak + alıntı; **numaralandırma satır içi çiplerle birebir aynı** olmalı |
| Mobil davranış | panel "Kaynaklar (12)" etiketli bir açılıra iner |
| **İddia düzeyinde atıf** | atıf paragrafa değil **her olgusal iddiaya** bağlanır; yüksek riskli alanlarda (hukuk, tıp, finans) zorunlu |
| **Kaynak pasajına derin bağlantı** | pasaj ofsetleri saklanır (**sayfa, blok kimliği, karakter aralığı**) ve kaynak görüntüleyicide eşleşen aralık vurgulanır |
| **Güven rozeti** | strong / mixed / weak / unsupported; **hem renk hem metin etiketi** kullanılmak zorunda; tıklayınca destekleyen ↔ çelişen kaynak dökümü |
| **Kaynak süzgeci** | prompt kutusunun yanında **tek, görünür** bir kontrol; seçim oturumlar arası korunur; aktif süzgeç cevabın içinde belirgin gösterilir |
| **"Citation graveyard" / eksik kaynak beyanı** | kaynaksız iddia görünür bir işaretle rozetlenir ("AI çıkarımı", "kaynak yok"); **asla kaynaklı iddiayla aynı stille gösterilmez**; "kaynaksız iddiaları kaldır" süzgeci sunulur |

**ColleX'in durumu (dürüst denetim).** `console.html` bu kalıpların
çoğunu **zaten** karşılıyor: `[K-n]` çipleri, `.evchip.broken` kırık atıf,
`⚠ KAYNAKSIZ` rozeti, sağdaki `#edevidence` Kanıtlar paneli, `#parca-<chunkId>`
çapaları, `highlightEvidenceChunks`, `unusedEvidence` + `unusedReason`,
`originChip`, "Soru kapsamı: %N".
Eksikler net ve küçüktür:
- **hover önizleme yok** — çipe tıklamak gerekiyor;
- **cevap görünümünde** iddia↔kaynak eşlemesi paragraf düzeyinde, taslak
  editöründeki kadar keskin değil;
- **derin bağlantı** parça (chunk) düzeyinde, **ofset aralığı düzeyinde
  değil** — oysa ofsetler zaten kayıtta;
- **"kaynaksız iddiaları kaldır" süzgeci yok**;
- **karar/norm durum rozeti yok** (§3.1).

---

## 4. Belge yükleme ve belgeye soru kalıpları

| Ürün | Kalıp | ColleX karşılığı |
|---|---|---|
| Harvey **Vault** | belgeleri güvenle sakla + **toplu analiz**: "extract the insights that matter with a single query" [doğrulandı] | `/v1/files` + `filters.fileIds` — **tek belge veya seçili belgeler**; "tek sorguyla tüm dosya" yolu var (`matterFileIds`) ama sonuç **düz metin cevap**, tablo değil |
| Lexis **Protégé Vault** | tek çalışma alanında 100.000 belge; PDF/tablo/görsel/ses/video [üçüncü taraf] | 25 MiB/dosya, PDF/DOCX/TXT/UDF; ses/video yok (kapsam dışı, doğru karar) |
| Legora **Tabular Review** | **belge × soru ızgarası**, her hücre kaynağa bağlı [üçüncü taraf] | **yok** — §7 #9 |
| CoCounsel **Review Documents** | "reads documents word-for-word", çıktı **tablo** [doğrulandı] | `POST /v1/answer` per belge; tablo yok |
| CoCounsel **Timeline** | tarih/saat/olay çıkarımı → "dynamic, searchable list" [doğrulandı] | `intake/analysis.py` tarih çıkarımı + matter Zaman çizelgesi sekmesi — **otomatik toplu kronoloji yok** (§7 #10) |
| Luminance | ısı haritası + panolar; düşük güvenli çıkarım **inceleme kuyruğuna** [üçüncü taraf] | `unusedEvidence`/`unusedReason` bir kuyruktur ama iş listesi gibi sunulmuyor |
| Clearbrief | maddî (record) atıfları **belgedeki sayfaya** bağlar [üçüncü taraf] | `Ek-n` + `chunkId` var; **sayfa numarası** intake'te `pages` istatistiğiyle biliniyor ama atıfta taşınmıyor |

**Kritik ColleX invaryantı korunmalı:** ADR-021 — yüklenen belge parçası
**delildir, hukukî değerlendirme değildir**. Yukarıdaki hiçbir kalıp bu
kuralı gevşetmeyi gerektirmiyor; ızgara ve kronoloji **olgu** üretir, dayanak
değil.

---

## 5. Taslak UX kalıpları

| Kalıp | Kim | Mekanizma | ColleX |
|---|---|---|---|
| **Word içinde redline, avukatın adı altında, track-changes ile** | Spellbook [üçüncü taraf] | yazarlık ve izlenebilirlik korunur | Word eklentisi yok; DOCX çıktısı düz. **Uyarlama**: KAYNAKSIZ paragrafları DOCX'te görünür bir "İNCELENECEK" stiliyle/yorumla işaretlemek (§7 #14) |
| **Playbook / kural seti** | Spellbook, CoCounsel *Contract Policy Compliance* [doğrulandı] | kullanıcının kuralları sözleşmeye uygulanır | **yok** — §7 #12; ColleX'te tamamen kural tabanlı yapılabilir |
| **Draft Editor'ün işlerin üstüne gelmesi** | CoCounsel, Mart 2026 [üçüncü taraf] | araştırma çıktısı doğrudan düzenlenebilir metne dönüşür | **var ve iyi**: `PUT /v1/drafts/{id}` → sürüm+1, canlı linter, `/versions` |
| **Argüman kurma (olgu × otorite)** | Vincent *Build an Argument* [doğrulandı] | dosya olguları otoritelerle birleştirilir, güçlü pozisyon önerilir | Kısmî: `suggestedFacts` var ama "hangi argüman güçlü" **yok ve olmamalı** (kanıtsız kanaat) — kural tabanlı sürümü: hangi talebi hangi kanıt destekliyor **matrisi** |
| **Desteklenmemiş ifadeyi işaretleme** | Lexis *Shepard's Verify* [doğrulandı] | taslaktaki atıflar denetlenir, desteksiz ifade işaretlenir | **var ve daha güçlü**: `⚠ KAYNAKSIZ`, canlı linter, %70 alıntı örtüşmesi + sayı eşleşmesi |
| **Uzunluk seçeneği** | De Jure (TR) "normal/uzun" [COMPETITIVE.md, 28.08.2026] | — | var (`length`, bulut hattı) |
| **Kanıt kümesinin sabitliği** | — | — | ColleX'e özgü kısıt: kanıt kümesi taslak başına sabit; "yeniden oluştur" yolu var. **Rakiplerde bu kısıt yok**; bizde bilinçli ve doğru (kanıt kimliği ile paragraf arasındaki bağın kopmaması için) — ama arayüz bunu daha az cezalandırıcı sunabilir |

---

## 6. Fiyatlama ve eleştiriler

**Fiyat modelleri (görünen kadarıyla):**

| Ürün | Model | Etiket |
|---|---|---|
| Clearbrief | **Solo 300 USD/ay/kullanıcı**, Enterprise özel | [doğrulandı, clearbrief.com, 02.09.2026] |
| Callidus | **3.000 USD/kullanıcı/yıl, sınırsız, ek ücret yok** | [üçüncü taraf, 02.09.2026] |
| Spellbook | yayımlanmıyor; üçüncü taraf tahmini 99–350 USD/ay | [üçüncü taraf — **tahmin**] |
| Harvey, Legora, Vincent, Lexis Protégé, CoCounsel | **yayımlanmıyor**, demo/satış hunisi | [çıkarım — fiyat sayfası yok] |
| Clio Manage AI | bağımsız satılmıyor, üst pakete gömülü | [üçüncü taraf] |

**Eleştiriler (tekrarlayanlar):**

1. **Şeffaf olmayan fiyat.** Lawyerist Vincent incelemesinin ilk "con"u
   "No Published Pricing"; Legora incelemesi "No public pricing (as of May
   2026)" ve deneme sürümü yokluğu [üçüncü taraf, 02.09.2026].
2. **Güven düşük, kullanım sığ.** Kullanıcıların ~%22'si yüksek güven
   bildiriyor; kurum içi avukatların ~%23'ü günlük kullanıyor [üçüncü taraf].
3. **Gölge BT.** Onaylı platform yavaş ya da işi kapsamıyorsa avukatlar
   kişisel hesaplara kayıyor — kurumsal hukuk departmanlarının en büyük
   riski olarak anılıyor [üçüncü taraf, vaquill.ai, 02.09.2026].
4. **"Halüsinasyonsuz" iddiaları abartılı** — Stanford RegLab, §1.
5. **Atıf granülerliği belge düzeyinde kalıyor** (Legora eleştirisi);
   karakter düzeyinde alıntı bir ayrışma noktası [üçüncü taraf].
6. **Doğrulama yükü kullanıcıda kalıyor**: her inceleme aynı cümleyle
   bitiyor — "her atfı açın, okuyun, teyit edin" [üçüncü taraf, midpage ve
   Paxton incelemeleri].

**ColleX için stratejik okuma [çıkarım]:** (2), (3) ve (6) birlikte tek bir
ürün fırsatına işaret ediyor — **doğrulamayı bir iş yükünden bir çıktıya
çevirmek**. Avukat zaten her atfı açmak zorunda; ColleX bunu yaptığını
**kanıtlayan bir belge** üretirse, aynı zamanı bir savunma varlığına
dönüştürür. §7 #2 + #8 + #25 bu tek fikri üç parçaya böler.

---

## 7. ColleX'e uyarlanabilir 25 mekanizma (öncelikli)

Kolonlar: **Ne** · **Türk solo avukatına neden** · **Bizim yığında nereye
oturur** · **Efor** (S ≤ bir günlük odaklı iş / M bir hat / L birden çok hat)
· **Bulut AI gerekir mi**.

> Sıralama değer/efor değil, **tematik**dir. En iyi beş oran §8'de.

### A. Kaynak ve güven sunumu (bizim çekirdeğimiz)

**1 · Karar/norm durum rozeti (Türk KeyCite'i) — "İçtihat Durumu"**
Her kaynak kartına ve her `[K-n]` çipine birleşik bir durum rozeti: *ilgili
madde yürürlükte / madde değişti (tarih) / mülga / aleyhe atıf bulundu /
karşı oy var / **olumsuz işlem taranmadı*** — **hem renk hem Türkçe metin**
(§3.1 kural 4).
*Neden:* Türk avukatının en pahalı hatası mülga fıkraya veya bozulmuş
Yargıtay kararına dayanmaktır; bugün bunu elle kontrol ediyor.
*Nereye:* `legal.relation_kind` enum'ı zaten `AMENDS · REPEALS · CITES ·
INTERPRETS · **OVERRULES** · RELATED` içeriyor
(`supabase/migrations/20260826010000_extensions_and_schemas.sql:57`), ama
`DEFAULT_CITATOR_KINDS` yalnız `["AMENDS","REPEALS"]` izliyor
(`control-plane/src/store/chunkStore.ts`). Sinyal = citator kenarlarının
toplaması + `currentness` + `contrary` şeridinin bulguları; `EvidenceView`'a
**additive** bir `authoritySignal` alanı, konsolda `originChip`'in yanında
çip.
*Efor:* **L** (veri tarafı: OVERRULES kenarlarını üretecek kaynak — İBK/HGK
— ingest edilmeli; rozet altyapısı M). *Bulut:* hayır.
*Dürüstlük şartı (pazarlık edilemez):* kapsam kısmî olduğu sürece varsayılan
değer **"taranmadı"**; "temiz" ya da yeşil asla varsayılan olamaz.

**2 · Atıf Denetim Raporu (Clearbrief "Cite Check Report" muadili)**
Bir cevap ya da taslak için tek PDF/DOCX: her atıf bir satır — *atıf ·
bulundu mu · alıntı hash doğrulandı mı · o tarihte yürürlükte mi · aleyhe
kayıt var mı · kim, ne zaman, hangi notla inceledi* — sonda birebir yeniden
doğrulama tarifi ve "avukat incelemesi zorunludur" bandı.
*Neden:* §1'deki yaptırım örüntüsünde kazanan davranış "gereken özeni
kanıtlayabilmek". Türkiye'de baro/mahkeme bağlamında bunun karşılığı henüz
yok; **ilk üreten biz oluruz**.
*Nereye:* `export/bundle*.py` (`collex.answer.evidence-bundle/v1`) + `draft.py`
zaten bütün alanlara sahip; yeni bir render hedefi + `GET /v1/drafts/{id}/
export?format=denetim-docx` (mevcut `format` enum'una **additive**).
*Efor:* **S/M**. *Bulut:* hayır.

**3 · Karşı tarafın dilekçesinin atıf denetimi (tek düğme)**
Yüklenen dilekçedeki her atıf (`intake/analysis.py` zaten tekilleştirilmiş
`count`'lu referans listesi üretiyor) `asOf` = dilekçe tarihi ile korpusta ve
canlı geçitte doğrulanır; çıktı bir **tablo** + §7 #2 raporu.
*Neden:* COMPETITIVE.md §2.9'da mekanizma parçaları sayılmış ama **arayüzde
düğme yok**; iki TR rakibinin resmî sayfalarında atıf doğrulama/yürürlük
kontrolü **hiç geçmiyor** (02.09.2026). Bu, tek cümlelik bir satış argümanı.
*Nereye:* `#belge/<fileId>` sayfasındaki `renderAnalysisCard` → "Atıf" satırı
zaten `verifyReference` çağırıyor; eksik olan **toplu koşu + tablo + rapor**.
*Efor:* **M**. *Bulut:* hayır.

**4 · Kısa biçim / "anılan karar" atıf tanıma (eyecite dersi)**
`legal_reference/` ayrıştırıcısına Türkçe kısa-biçim kalıpları: "anılan
karar", "aynı yönde", "yukarıda anılan", "agk.", "s.K. m. …" tekrarları,
"aynı Daire'nin … sayılı kararı".
*Neden:* karşı tarafın dilekçesindeki atıfların önemli kısmı ilk geçişten
sonra kısa biçimdedir; bugün sessizce kayboluyorlar — bu, **eksik denetim**
demek.
*Nereye:* `legal_reference/` + `control-plane/src/retrieval/referenceParser.ts`;
**ikisi birden**, `evals/fixtures/reference_parity.json` fixture'ıyla
(CLAUDE.md invaryantı).
*Efor:* **M**. *Bulut:* hayır.

**5 · Üç kovalı atıf sınıflandırması: eşleşti / belirsiz / bulunamadı**
Free Law Citation Lookup API'nin sözleşmesi. Bugün ayrıştırıcı bunu biliyor
ama arayüz "bulunamadı"yı "sonuç yok"tan ayırmıyor.
*Neden:* "bulunamadı" bir uyarıdır (uydurma olabilir); "belirsiz" bir iştir
(daire/yıl seçilmeli); "sonuç yok" bir kapsam sorunudur. Üçünü aynı boş
kutuda göstermek avukatı yanıltır.
*Nereye:* `verifyReference` sonucu + `renderAnalysisCard`; `answerPipeline`
`warnings`'e üç ayrı kod.
*Efor:* **S**. *Bulut:* hayır.

**6 · Hover önizlemeli atıf çipi (Inline Citations kalıbı)**
`[K-n]` çipinin üzerine gelince küçük kart: etiket + künye + **alıntının
ilk ~200 kod noktası** + "kaynağa git". Konsol sözleşmesi gereği saf
CSS/`textContent`, uzak varlık yok.
*Neden:* doğrulama sürtünmesini bir tıktan sıfıra indirir; §6'daki "her atfı
aç" yükünün en ucuz kısmî çözümü.
*Nereye:* `console.html` `renderParagraphRefs` + cevap görünümündeki kaynak
numaraları.
*Efor:* **S**. *Bulut:* hayır.

**7 · Ofset düzeyinde derin bağlantı**
Bugün `#parca-<chunkId>`'ye gidiliyor; hedef `#belge/<fileId>` içinde
**kod-noktası aralığını** vurgulamak (ofsetler `EvidenceItem`'da zaten var,
ADR-003).
*Neden:* uzun bir parçada avukat hâlâ gözle arıyor; ürünün "hash'li, konumlu
alıntı" iddiasının görsel karşılığı bu.
*Nereye:* `showDocText`/`fillDocText` + `highlightEvidenceChunks`.
*Efor:* **S**. *Bulut:* hayır.

**8 · Dosyalama öncesi doğrulama kontrol listesi (Harvey'in "üç adımlı alışkanlık"ı)**
Taslak dışa aktarılmadan önce üç kutulu, kalıcı bir liste: (a) her `[K-n]`
açıldı, (b) her ⚠ KAYNAKSIZ paragraf gözden geçirildi, (c) KARŞI İÇTİHAT
bölümü okundu. İşaretlemeler **taslak sürümüne yazılır** ve §7 #2 raporuna
düşer. Dışa aktarımı **engellemez** (avukatın işini kesmeyiz), ama
işaretlenmemişse çıktıda "doğrulama tamamlanmadı" satırı görünür.
*Neden:* §1'in tek en güçlü dersi; ayrıca dürüst — biz "doğruladık" demiyoruz,
**avukatın doğruladığını kaydediyoruz**.
*Efor:* **S**. *Bulut:* hayır.

**9 · Belge × soru ızgarası (Legora Tabular Review muadili)**
"Bu dosyadaki 12 belgeye şu 4 soruyu sor" → satır=belge, sütun=soru, her
hücre = kısa cevap + kaynak çipi + boşsa "kapsanmadı".
*Neden:* Türk solo avukatının gerçek işi: 30 sayfalık ekler yığınında
"tebligat tarihi nedir / ihtarname var mı / bedel ne kadar". Bugün bunu
belge belge soruyor.
*Nereye:* mevcut `POST /v1/answer` + `filters.fileIds` döngüsü; **yeni uç
gerekmez**, yeni bir görünüm ve `Promise` kuyruğu gerekir (`answerLimits`
ve süre bütçesi zaten var).
*Efor:* **M**. *Bulut:* hayır.

**10 · Otomatik dosya kronolojisi (CoCounsel Timeline muadili)**
Dosyadaki bütün belgelerden çıkarılan tarihler tek zaman çizelgesinde;
her olay **kaynak belge + parça** bağlantısı ve `verified:false` rozetiyle;
avukat tek tek "doğrulandı"ya çeviriyor; "Süre başlat" oradan.
*Neden:* süre kaçırmak Türkiye'de tazminat sorumluluğudur; kronoloji süre
hesabının girdisidir.
*Nereye:* `intake/analysis.py` tarih çıkarımı (FIX-2'de tekilleştirildi) →
`POST /v1/matters/{id}/items {kind:'event', source:'belge:<fileId>:analiz'}`
zaten var; eksik olan **toplu üretim + tek görünüm**.
*Efor:* **S/M**. *Bulut:* hayır.

### B. İş (skill) kütüphanesi ve iş akışı

**11 · Sohbet kutusu yerine adlandırılmış işler (CoCounsel'in 10 skill'i, Descrybe'ın fiil ayrımı)**
`Araştır` sekmesindeki tek soru kutusunun yanına 8–10 **iş kartı**, her biri
sabit girdi/çıktı sözleşmesiyle: *Belgeyi özetle · Kronoloji çıkar ·
Atıfları denetle · Karşı tarafın dilekçesini denetle · Belge × soru ızgarası ·
Sözleşmeyi kontrol listesine göre incele · Süre hesapla · Dosya özeti ·
Karşıt içtihat tara*.
*Neden:* solo avukat "ne sorabilirim?" sorusuyla boş kutunun karşısında
donuyor; ürünün yeteneklerinin yarısı bugün keşfedilemez durumda.
*Nereye:* yeni uç yok; her kart mevcut uçlara sabit gövde gönderir. Şablon
kütüphanesinin (`/v1/draft-templates`, 13 şablon) yanına **iş kütüphanesi**.
*Efor:* **M**. *Bulut:* hayır (bazı işler bulutla daha iyi olur, hiçbiri
buluta bağımlı değil).

**12 · Kontrol listesi motoru (Playbook / Contract Policy Compliance muadili)**
Avukatın kendi yazdığı, dosyada saklanan kontrol listeleri: "Kira
sözleşmesinde: depozito maddesi var mı · artış oranı yazılı mı · tahliye
taahhüdü var mı · damga vergisi …". Her madde için **VAR (kanıt bağlı) /
YOK / BELİRSİZ** — tamamen sözcüksel/kalıp tabanlı, halüsinasyon riski sıfır.
*Neden:* Türk solo avukatının en tekrarlı işi; ayrıca bu, "AI" olmadan da
satılabilen bir değer.
*Nereye:* `POST /v1/answer` + `filters.fileIds` üzerinde ince bir katman;
liste `app_private.settings` ya da matter item olarak saklanır.
*Efor:* **M**. *Bulut:* hayır.

**13 · İki sürüm karşılaştırma (Compare Contracts muadili)**
Aynı dosyadaki iki yüklemenin madde madde farkı; eklenen/çıkarılan/değişen.
*Neden:* karşı taraftan gelen sözleşme revizyonu, kendi dilekçesinin iki
sürümü.
*Nereye:* `intake` chunk'ları üzerinde deterministik diff; yeni görünüm.
*Efor:* **M**. *Bulut:* hayır.

**14 · DOCX'te "İNCELENECEK" işaretlemesi (Spellbook'un yazarlık dersi)**
Dışa aktarılan DOCX'te ⚠ KAYNAKSIZ paragraflar görünür bir stille/Word
yorumuyla işaretlenir; avukat Word'de açtığında ne yapacağını görür ve
temizleyip kendi adıyla teslim eder.
*Neden:* çıktı bugün Word'de "temiz" görünüyor; KAYNAKSIZ uyarısı ekranda
kalıyor. Bu, ürünün en dürüst özelliğinin çıktıda kaybolması demek.
*Nereye:* `export/petition.py`.
*Efor:* **S/M**. *Bulut:* hayır.

**15 · Talep ↔ kanıt matrisi (Vincent "Build an Argument"ın kanaatsiz hâli)**
Taslak editöründe küçük bir tablo: her **talep** satırı × onu destekleyen
kanıt sütunu; desteksiz talep kırmızı.
*Neden:* "hangi argüman güçlü" bir kanaattir ve biz kanaat üretmiyoruz; ama
"hangi talebin altı boş" bir olgudur ve dilekçenin en pahalı hatasıdır.
*Nereye:* `drafting/relevance.ts` verdict'leri + `composer.ts` slot bilgisi
zaten üretiyor; yalnız görselleştirme.
*Efor:* **S**. *Bulut:* hayır.

### C. Kapsam, dürüstlük ve güven

**16 · Kapsam manifestosu / kaynak sağlık sayfası**
Kaynak başına: canlı durum · son başarılı erişim zamanı · bilinen boşluklar ·
"bu kaynak bugün taranamadı" satırı. Harvey'in *Regional Knowledge Sources*
mantığının dürüst versiyonu.
*Neden:* iki TR rakibi "12 milyon karar" / "tüm veritabanını tarar" diyor ve
biri kendi iki resmî sayfasında çelişiyor (COMPETITIVE.md §3). Sayı vermeyen
ama **her kaynağın durumunu gösteren** bir sayfa, sayı vermekten daha güçlü
bir güven aracıdır.
*Nereye:* MCP aracı `check_government_servers_health` + `/v1/research/health`
+ `/v1/health corpus` zaten var; Ayarlar › Sistem durumu'nun genişletilmiş
hâli ya da ayrı `#kapsam` görünümü.
*Efor:* **S/M**. *Bulut:* hayır.

**17 · Kaynak seçici (Harvey Regional Knowledge Sources kalıbı)**
Soru kutusunun yanında **tek görünür kontrol**: hangi kurum kümesinde
aransın (Yargıtay/Danıştay/AYM/mevzuat/KVKK/Rekabet/KİK/…); seçim dosya
başına hatırlanır; cevabın içinde "Bu cevap şu kaynaklarda arandı: …" satırı.
*Neden:* 54 aracın varlığı bugün avukata görünmüyor; ayrıca seçim, canlı
araştırmanın bütçesini (24 çağrı) doğru yere harcatır.
*Nereye:* `control-plane/src/research/` planner + `#qform`; `AnswerResult`'a
additive `searchedSources`.
*Efor:* **M**. *Bulut:* hayır.

**18 · Pasaj derinlik ölçeği (KeyCite depth-of-treatment muadili)**
Her kanıt kartında 1–4 kademeli küçük bir çubuk: bu pasaj sorunun ne
kadarını karşılıyor. Sayı zaten hesaplanıyor (`answer/coverage.ts`
`mapPassageCoverage`).
*Neden:* sekiz kaynak kartı arasında hangisinin gerçekten konuya girdiğini
görmek; bugün hepsi eşit ağırlıkta görünüyor.
*Efor:* **S**. *Bulut:* hayır.

**19 · Çekimserliğin "sonraki adım"ları**
ÇEKİMSER kartı bugün doğru ama çıkışsız. Ekle: *canlı resmî kaynaklarda ara ·
belge yükle · soruyu daralt (karşılığı bulunamayan sözcükler: …) · tarihi
değiştir*.
*Neden:* §6(3) gölge BT — cevap alamayan avukat ChatGPT'ye gider. Çekimserlik
bir **yol ayrımı** olmalı, bir duvar değil.
*Nereye:* `console.html` `answerMetaBlock` / ÇEKİMSER dalı.
*Efor:* **S**. *Bulut:* hayır.

**20 · "Kaynaksız iddiaları gizle" süzgeci**
Taslak editöründe tek anahtar: KAYNAKSIZ paragrafları gizle → geriye yalnız
kanıta bağlı metin kalır.
*Neden:* avukat "elimde gerçekten ne var?" sorusunu bir saniyede yanıtlar;
aydesign kalıbının ("remove unsourced claims") hukukta en anlamlı hâli.
*Efor:* **S**. *Bulut:* hayır.

**21 · Dosya özeti kartı ("get up to speed")**
Dosya sayfasının başına tek kart: taraflar · mahkeme/esas · **en yakın üç
süre** · belge sayısı · son araştırma · açık taslaklar · son 5 hareket.
*Neden:* Clio Manage AI'nin ve Harvey Mobile'ın sattığı şey bu; solo avukat
dosyaya haftada bir dönüyor ve her seferinde yeniden hatırlıyor.
*Nereye:* `GET /v1/matters/{id}` verisi zaten yeterli.
*Efor:* **S**. *Bulut:* hayır.

**22 · Bulut çağrısı öncesi maliyet/kapsam önizlemesi**
"Bu istekte şunlar gönderilecek: <n> pasaj, ~<m> jeton; tahminî maliyet"
+ aylık toplam sayacı; onay kutusunun **üstünde**.
*Neden:* KVKK ve rıza (ADR-018) tarafında zaten istek başına onay var; §6(1)
fiyat şeffaflığı eleştirisi ve `docs/implementation/AI.md`'nin "ne çıkıyor"
sözü bunu doğal tamamlıyor.
*Nereye:* `control-plane/src/ai/routes.ts` yanıtındaki `AiUsage` + konsol
onay penceresi.
*Efor:* **S**. *Bulut:* evet (yalnız bulut hattı açıkken görünür).

### D. Daha büyük / daha sonraki

**23 · Duruşma / tanık hazırlık notu (Prepare for a Deposition muadili)**
Dosyanın belgelerinden konu başlıkları ve soru taslakları.
*Neden:* değerli ama **kural tabanlı sürümü zayıf olur**; kanaat üretimidir.
*Efor:* **L**. *Bulut:* **evet** — ve entailment eşiği 0.85 fail-closed
disiplinine sokulmalı; aksi hâlde ürünün kimliğine aykırı.

**24 · Belge içi sayfa numarası taşıyan atıf (Clearbrief record-cite dersi)**
`Ek-n` atıflarına **sayfa numarası** eklemek (intake `pages` istatistiğini
chunk'a bağlayarak): "Ek-1, s. 4".
*Neden:* mahkemeye giden dilekçede delil atfı sayfasızsa hâkim aramaz.
*Efor:* **M** (chunk→sayfa eşlemesi PDF çıkarımında tutulmalı). *Bulut:* hayır.

**25 · Doğrulama denetim izi (kim, ne zaman, hangi notla)**
Her kanıt/atıf için kalıcı inceleme durumu (`incelendi` + not + zaman);
#2'nin raporunu besler, #8'in kutularını doldurur.
*Neden:* Clearbrief'in raporunun **değeri buradan** geliyor: "associates,
paralegals or attorneys addressed each identified issue, with any notes".
Tek kişilik büroda bile bu, altı ay sonraki kendine karşı savunmadır.
*Nereye:* `app_private` taslak sürüm satırına additive alan ya da matter
item `kind:'review'`.
*Efor:* **M**. *Bulut:* hayır.

---

## 8. En iyi değer/efor oranına sahip beş kalem

| Sıra | Kalem | Neden bu beş |
|---|---|---|
| **1** | **#2 Atıf Denetim Raporu** | Bütün parçalar var (`export/bundle*.py`, `draft.py`, hash + ofset + doğrulama tarifi); yeni bir render hedefi. Çıktı, §1'deki dünya çapındaki tek en büyük hukukî risk için **avukatın elinde tutabileceği kanıt**. Hiçbir TR rakibinin yakınında olmadığı bir şey; Clearbrief'in 300 USD/ay'lık ürününün çekirdeği. **S/M, kural tabanlı.** |
| **2** | **#8 Dosyalama öncesi doğrulama kontrol listesi** | Bir günlük konsol işi; #2'yi anlamlı kılan insan adımı; dürüstlük duruşumuzu ("biz doğrulamıyoruz, sizin doğruladığınızı kaydediyoruz") ürün davranışına çeviriyor. **S, kural tabanlı.** |
| **3** | **#3 Karşı tarafın dilekçesinin atıf denetimi** | Mekanizmanın beş parçası (intake atıf çıkarımı, `asOf` pin, temporal kapanış ADR-012, citator ADR-015, karşıt tarama ADR-008) **zaten çalışıyor ve testli**; eksik olan tek düğme, bir döngü ve bir tablo. İki TR rakibinin resmî sayfalarında karşılığı yok. **M, kural tabanlı.** |
| **4** | **#16 Kapsam manifestosu / kaynak sağlık sayfası** | `check_government_servers_health` + `/v1/research/health` + `/v1/health corpus` verisi hazır. "12 milyon karar" pazarlamasına karşı **sayı vermeden kazanan** tek cevap; ayrıca bugünkü en büyük kullanıcı sürprizini ("neden sonuç yok?") ortadan kaldırıyor. **S/M, kural tabanlı.** |
| **5** | **#9 Belge × soru ızgarası** | Yeni uç yok — mevcut `POST /v1/answer` + `filters.fileIds` döngüsü. Algılanan değer sıçraması en büyük olan kalem (Legora'nın imza özelliği); süre bütçesi (60 s) ve `answerLimits` koruması zaten yerinde. **M, kural tabanlı.** |

Beşinin de ortak özelliği: **bulut AI gerektirmiyor**, mevcut invaryantların
hiçbirini gevşetmiyor ve hepsi `STATUS.md`'nin "doğrulanmamış üç yüzey"
listesine yeni bir doğrulanmamış yüzey **eklemiyor**.

**Stratejik istisna:** #1 (durum rozeti) değer/efor oranında beşe girmez ama
**tek başına en yüksek etkili** kalemdir; ön koşulu veri (OVERRULES kenarları)
olduğu için bir sonraki dalganın veri hattı işidir, UI işi değil.

---

## 9. Görsel dil: ne profesyonel gösteriyor, Türk hukuk bürosunda ne yanlış durur

### 9.1 En iyilerinin ortak görsel kararları [çıkarım — inceleme/ürün görselleri ve §3.2 kalıp derlemesinden]

1. **Üç bölgeli düzen.** Sol: gezinme/anahat. Orta: iş yüzeyi. Sağ:
   **kaynaklar**. Kaynak paneli asla modal değil, **kalıcı**dır — çünkü işin
   kendisi kaynakla metni yan yana tutmaktır. *(ColleX'in editörü bunu
   yapıyor: `#edoutline` / `#edtext` / `#edevidence`. Cevap görünümü
   yapmıyor.)*
2. **Numaralandırma tutarlılığı.** Satır içi çipteki numara, yan paneldeki
   kart numarasıyla **aynı**dır. Bu tek kural, güven algısının yarısıdır.
3. **Yoğunluk vardır ama gürültü yoktur.** Tablo satırları ince ve sessiz
   çizgilerle ayrılır; renk yalnız **durum** için kullanılır, dekorasyon için
   değil. Bir ekranda tipik olarak **tek vurgu rengi** vardır.
4. **Tipografi iki katmanlıdır.** Uygulama kabuğu sans-serif ve küçük;
   **okunan hukukî metin** daha büyük punto, daha geniş satır aralığı, daha
   dar ölçü. Tanımlayıcılar (esas/karar no, hash) monospace.
5. **Boş durumlar bir işe davet eder**, boş tuval değildir: "şunu deneyin"
   listesi ya da iş kartları. *(§7 #11 bunu doğrudan karşılıyor.)*
6. **Onboarding bir alışkanlık öğretir**, tur değildir. Harvey Academy'nin
   "üç adımlı doğrulama alışkanlığı" bunun en net örneği.
7. **Durum rozetleri hem renkli hem yazılıdır** — renk körlüğü ve yazdırma
   için zorunlu; ayrıca hukukta renk tek başına bağlayıcı bilgi taşıyamaz.
8. **Bekleme dürüsttür.** Adım adım ilerleme (hangi kaynakta, kaçıncı çağrı),
   sahte "düşünüyorum" tiyatrosu değil. *(ColleX'in `progress.ts` + canlı
   ilerleme paneli bunu zaten doğru yapıyor — 54 aracın Türkçe etiketi.)*

### 9.2 Türk hukuk bürosunda **yanlış duracak** şeyler (yapmayın listesi)

1. **Shepard's/KeyCite ikonografisini olduğu gibi ithal etmek.** Türk avukat
   "sarı bayrak"ın kodunu bilmez; renk **her zaman** Türkçe kelimeyle
   birlikte gelmeli ("● Aleyhe atıf bulundu"), ve sözlük tek bir yerde
   açıklanmalı. Amerikan trafik-işareti metaforları (dur işareti sekizgeni)
   tanıdık ama **anlam kodu tanıdık değil**.
2. **Bluebook/anglo-sakson atıf sırası.** Türk pratiği *Yargıtay <Daire>,
   E. <esas>, K. <karar>, T. <tarih>* düzenindedir; "case name v. case name"
   biçimi yabancı ve amatör görünür. Mevzuatta *<no> sayılı Kanun m. <madde>/
   <fıkra>* ve kısaltmalar (TCK, TBK, HMK, İİK) beklenir.
3. **İngilizce etiket kalıntısı.** "Sources", "Confidence", "Draft", "Vault"
   gibi kelimeler tek bir çipte bile kalırsa ürün "çeviri" gibi görünür.
   LANG-7 disiplini ("Bulut AI" / "bulut yapay zekâ (Bulut AI)") bunun
   kurumsallaşmış hâli — genişletilmeli.
4. **Emoji, maskot, illüstrasyon, gradyan.** Hukuk bürosunda bir dilekçe
   ekranında sevimlilik güven kaybıdır. (Konsol sözleşmesi zaten uzak varlık
   yasağıyla bunu teknik olarak koruyor — ama simge yerine **kelime**
   kullanma kararı bilinçli sürdürülmeli.)
5. **Yüzde göstermenin yanlış olduğu yerde yüzde göstermek.** UI-2'nin
   "Güncellik: %100 yerine 'yüklediğiniz belge — yürürlük değerlendirilemez'"
   kararı doğru ve **genel bir kural** olmalı: **ölçülmemiş bir şey için
   sayı basmayın.** Rakiplerin "%100 Kaynaklı" iddiası tam olarak bunun
   karşıtıdır ve kendi sözleşmeleriyle çelişir (COMPETITIVE.md §3).
6. **Yalnız sohbet baloncuğu arayüzü.** Türk avukatın zihinsel modeli
   *dosya → belge → dilekçe*dir, *konuşma → mesaj* değil. Sohbet bir araç
   olabilir, **iskelet olamaz**. (ColleX'in beş sekmeli masası bu yüzden
   doğru bir seçim.)
7. **Dilekçe önizlemesinin web sayfası gibi görünmesi.** UYAP'a alışkın bir
   göz dilekçeyi A4, serifli, blok paragraflı bekler. Editörün **yazdırma
   görünümü** (UI-2 §1.4'te zaten var) varsayılan önizleme olmalı; ekran
   kromu dilekçeye karışmamalı.
8. **"AI düşünüyor…" animasyonu ve sahte ilerleme.** Türk avukat için bekleme
   maliyeti gerçek; her saniye bir kaynak adıyla açıklanmalı.
9. **Yaşam döngüsü yanlış varsayımı.** Amerikan ürünleri "matter → deal →
   data room" varsayar; bizde omurga **esas numarası, tebligat tarihi, süre**
   ve **adli tatil**tir. Ekranın en üstündeki sabit bilgi, dosya adı ve
   **en yakın süre** olmalıdır — Clio'nun "next step" kartının Türk hâli
   (§7 #21).

### 9.3 ColleX'in bugünkü görsel durumu — dürüst not

`W12-UI1/UI2` yürüyüşleri ölçülebilir iyi işaretler veriyor: 1440'ta içerik
**175 px**'te başlıyor, 390 px'te yatay kayma yok, koyu tema token'lı,
yazdırma yalnız metin, odak halkası tek kural, `aria-live` bölgeleri var,
tipografide `font-variant-caps` temizliği yapılmış. Eksikler §3.2'de sayılan
**dört küçük kalem** (hover kartı, ofset vurgusu, kaynaksızı gizleme süzgeci,
durum rozeti) ve §9.1(1)'in cevap görünümüne uygulanması. Yani sorun estetik
değil, **eksik kalıp**tır — ve dördü de S efordadır.

---

## 10. Bu depoya uygulanmaması gereken şeyler (vaporware ve kimlik koruması)

- **"Hallucination-free" tipi iddia** — Stanford RegLab bunu iki büyük
  sağlayıcıda çürüttü (§1); ColleX'in iddiası **reddetme** olarak kalmalı.
- **Kanaat üretimi** ("bu argüman daha güçlü") — Vincent'ın *Build an
  Argument*'ı satılabilir ama bizim kanıt disiplinimizle uyumsuz; kanaatsiz
  karşılığı §7 #15'tir.
- **Word/Chrome eklentisi, UYAP eşitlemesi, mobil uygulama** — bugün yok,
  yol haritası olarak dürüstçe anılıyor (COMPETITIVE.md), bu hat bunu
  değiştirmiyor.
- **Yüzde biçiminde "güven skoru"** — Clearbrief'in "semantic analysis
  score"u patentli ve kalibre edilmiş; bizim sözcüksel örtüşme oranımız
  **kalibre edilmemiştir** ve yüzde olarak sunulursa yanıltır. Kademe
  (1–4 çubuk, §7 #18) evet; ondalık yüzde hayır.
- **Statik korpus büyüklüğü yarışı** — Alexi/Fastcase davası (2026) korpus
  mülkiyetinin ürün riski olduğunu gösteriyor; canlı resmî kaynak geçidi
  duruşu korunmalı.

---

## 11. Kaynak listesi (hepsi erişim 02.09.2026)

| Kaynak | Ne için | Etiket |
|---|---|---|
| harvey.ai/products · help.harvey.ai/articles/knowledge-sources-overview · /assistant-workflows · /embed-files-and-knowledge-sources-in-workflow-builder · academy.harvey.ai/page/library | Agents/Vault/Knowledge/Spaces, bölgesel bilgi kaynakları, kaynak yan paneli, üç adımlı doğrulama alışkanlığı | [doğrulandı] |
| thomsonreuters.com/en-ca/help/cocounsel/legal/skills/understanding-cocounsel-skills · /skills-prompts-workflows/timeline · /review-documents · /prepare-for-a-deposition | 10 skill ve çıktı biçimleri | [doğrulandı] |
| thomsonreuters.com/en-us/help/drafting-assistant/westcheck/keycite-status-flags · legal.thomsonreuters.com/blog/westlaw-tip-of-the-week-checking-cases-with-keycite | KeyCite bayrakları, Overruling Risk, depth of treatment | [doğrulandı] |
| supportcenter.lexisnexis.com/app/answers/answer_view/a_id/1088155 | Shepard's Signals ve anlamları | [doğrulandı] |
| lexisnexis.com/en-us/products/lexis-plus-protege.page | Shepard's Verify, kişiselleştirme, taslak | [doğrulandı-sayfa metni] |
| lawnext.com/2026/02/… · lawnext.com/2026/05/… | Protégé'ye geçiş, Workrooms, müşteri anahtarı, Vault 100k belge | [üçüncü taraf] |
| support.vlex.com/vincent-by-vlex/…/understanding-vincents-unique-features · support.vlex.com/features/vincent/build-an-argument · vlex.com/news/VincentAIWinterRelease | up/down-the-tree atıf analizi, Build an Argument, Docket Alarm | [doğrulandı] |
| lawyerist.com/reviews/…/vincent-ai-review-… · …/paxton-ai-review-… | eleştiriler, fiyat şeffaflığı | [üçüncü taraf] |
| clearbrief.com · lawnext.com/2025/12/clearbrief-launches-cite-check-report-… · lawnext.com/2021/03/… | Cite Check Report içeriği, renk kodlu destek derecesi, Solo 300 USD/ay | [doğrulandı + üçüncü taraf] |
| paxton.ai/post/introducing-the-paxton-ai-citator-… | citator, %94/%86 kendi ölçümü | [doğrulandı-üretici] |
| lawnext.com/2026/07/… (midpage) · geeklawblog.com/2026/02/… | kapsam genişlemesi, ajan içinde atıf teyidi | [üçüncü taraf] |
| gc.ai/blog/legora-legal-ai-review | Tabular Review, belge düzeyi atıf eleştirisi, fiyat şeffaflığı | [üçüncü taraf] |
| spellbook.com/learn/… (legal-ai-tools, best-ai-contract-redlining-tools, best-ai-tools-for-contract-due-diligence) · gc.ai/blog/spellbook-legal-ai-review | Review/Draft/Ask/Benchmarks, avukat adı altında redline, playbook | [üçüncü taraf] |
| callidusai.com/why-callidus/callidus-legal-ai-vs-paxton-ai · spellbook.com/briefs/callidus-vs-gc-ai | beş Word modülü, 3.000 USD/yıl | [üçüncü taraf] |
| ctacquisitions.com/ai-due-diligence-tools-2026 · layer3labs.io/guides/luminance-explained | düşük güvenli çıkarımın inceleme kuyruğuna yönlendirilmesi, ısı haritaları | [üçüncü taraf] |
| beri.net/tools/deepjudge · legaltechnology.com/2025/04/01/… | DeepJudge kurum içi arama | [üçüncü taraf] |
| legaltechnologyhub.com/vendors/clio-duo-by-clio · layer3labs.io/guides/clio-duo-explained | Clio Manage AI yetenekleri, paketleme | [üçüncü taraf] |
| joseflegal.com/josef-no-code · legaltechnologyhub.com/vendors/josef | no-code akış şeması otomasyonu | [üçüncü taraf] |
| alexi.com · lawnext.com/2024/10/… · lawnext.com/2026/07/… · lawnext.com/2026/01/… | Memo/Arguments, Workflow Library, Fastcase davası | [üçüncü taraf] |
| free.law/projects/eyecite · free.law/2024/04/16/citation-lookup-api/ · pypi.org/project/eyecite | kısa biçim/supra/id. tanıma, geçersiz+belirsiz atıf sınıflandırması | [doğrulandı] |
| Descrybe MCP araç listesi (bu oturum) | `verify_quote`, `check_case_status`, `find_cases_that_cite`, `extract_case_references` fiil ayrımı | [doğrulandı — araç adları] |
| reglab.stanford.edu/publications/hallucination-free-… · arxiv.org/pdf/2405.20362 · dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf | %17–34 halüsinasyon, %65/%41/%19 doğruluk, "hallucination-free" iddialarının abartısı | [üçüncü taraf] |
| naturalandartificiallaw.com/ai-hallucination-cases-tracker/ · gc.ai/blog/ai-hallucination-legal-cases · haqq.ai/blog/… · vaquill.ai/blog/ai-hallucination-sanctions-tracker | 1.871 kayıt, 109.700 USD, Nebraska ve N.D. Miss. vakaları | [üçüncü taraf] |
| vaquill.ai/blog/what-lawyers-really-think-of-legal-ai · gc.ai/blog/legal-ai-tools | %22 güven, %23 günlük kullanım, gölge BT | [üçüncü taraf] |
| aydesign.ai/blog/ai-citation-source-ui-patterns-2026 | atıf çipi/kaynak paneli/derin bağlantı/güven rozeti/"kaynak yok" kalıpları ve ölçüleri | [üçüncü taraf] |
| artificiallawyer.com/2026/08/25/… · law.com/legaltechnews/2026/08/21/… · phala.com/posts/legalcitebench-ai4law-icml-2026 | Gemini Enterprise for Legal, ILTACON 2026 hamleleri, LegalCiteBench | [üçüncü taraf] |

**Bu belgede ColleX hakkında hiçbir yeni ölçüm yapılmadı.** ColleX'e dair her
sayı `docs/implementation/STATUS.md` "Ölçülen sayılar" tablosundan (S1–S22)
alınmıştır ve buraya kopyalanmamıştır. Rakip sayfaları değişebilir; her iddia
kullanılmadan önce erişim tarihi yenilenerek yeniden teyit edilmelidir.
