# Bulut yapay zekâ (Bulut AI) — Anthropic; onaylı, varsayılan KAPALI, her çıktı kanıta bağlı

Son güncelleme: **03.09.2026**, **W14 Faz C kapanışı** (W12 lane E; FIX-2
sonrası adlandırma ve kilitli bölüm notu CLOSEOUT ile eklendi; W14 B-23
maskeleme + kayıt defteri + tavan ekledi).

> **Faz F ve Faz C bu hattın davranışına dokunmadı.** Tek değişiklik
> `src/ai/routes.ts`'in ortak `zodIssues` yardımcısına bağlanmasıdır (V-19):
> tanınmayan bir alan artık **adıyla** reddediliyor ve bir yanıtta iki
> fazladan alan **iki ayrı satır** oluyor — eskiden noktayla birleştirilip
> var olmayan bir iç içe yol gibi okunuyorlardı. **`ai.liveTested` hâlâ
> `false`**; canlı Anthropic API'sine bu depodan **hiçbir istek gitmedi** ve
> STATUS'un birinci doğrulanmamış yüzeyi aynen duruyor.

> **Adlandırma (LANG-7, W12-FIX2 #12).** Kısa etiket her yerde **"Bulut
> AI"**dır (rozet, alan etiketi, çip, pencere başlığı). Düzyazıda ilk geçişte
> **"bulut yapay zekâ (Bulut AI)"**, cümle başında "Bulut yapay zekâ …"
> yazılır. Başka biçim kullanılmaz — büyük harfle yazılmış "yapay zekâ",
> küçük harfli ya da tamamen büyük harfli "ai" etiketi, şapkasız "zeka" ve
> İngilizce karşılığı yasaktır; `console.test.ts` "names cloud AI …" testi
> bu biçimleri reddeder. Bu belge aynı kurala uyar.

> ## Bu ortamda hiçbir canlı çağrı yapılmadı
>
> Bu belge yazılırken makinede `ANTHROPIC_API_KEY` **yoktu**. Aşağıdaki her
> şey yalnızca **sahte `fetch`** ile (65 çevrimdışı test) doğrulanmıştır;
> gerçek Anthropic Messages API'sine **tek bir istek bile gönderilmemiştir**.
> `GET /v1/ai/status` bu yüzden `liveTested:false` döner ve notlarında
> "canlı sınanmadı" yazar. İlk canlı kanıt, kullanıcı tarafından anahtarla
> koşulacak `control-plane/scripts/ai-live-smoke.mjs` olacaktır; çıktısı bu
> belgenin sonundaki "Canlı sınama kaydı" bölümüne eklenene kadar
> `AI_LIVE_TESTED` sabiti `false` kalır.

## 0. W14'ün eklediği üç şey (ve eklemediği bir şey)

1. **Yerel maskeleme** (`src/ai/masking.ts`): TCKN/VKN/IBAN/telefon ve taraf
   adları harf harf Türkçe büyük/küçük çiftlerinden kurulmuş kalıplarla
   maskelenir — `/i` bayrağı ı↔I katlamadığı için "ALİ YILMAZ" eskiden
   maskesiz geçiyordu. `maskMode` **zorunludur** ve `preview` hiçbir şey
   göndermeden ne gönderileceğini gösterir. Doğrulama **fiilen gönderilen**
   metne karşı koşar.
2. **Kayıt defteri** (`app_private.ai_calls`): çağrı sayıları ve kimlikler
   tutulur, **metin tutulmaz**; `GET /v1/ai/ledger`.
3. **Tavan**: `AI_MAX_CALLS_PER_HOUR` ve `AI_MAX_INPUT_TOKENS_PER_DAY`
   aşılınca `429 AI_RATE_LIMITED` (sabitler STATUS S22).

**Eklenmeyen:** `maskMode` yalnız `analyze-document` içindir. `ocr` PDF'in
kendisini gönderir, `draft-paragraph` hash'e bağlı alıntıları gönderir —
onları maskelemek birebir doğrulamayı kırardı. İkisi de tavanın altındadır ve
`masked: false` ile kayda geçer. **ADR-018 gevşetilmedi.**

Ayrıca `AI_LOCKED_SECTION_IDS` (`ek-dogrulama`, `karsi-ictihat`) bir AI
paragrafının hedefi olamaz: istek **400** ile, mağazaya ve modele
**ulaşmadan** durur.

## 1. Ne yapar, ne yapmaz

ColleX'in çekirdeği kural tabanlıdır ve dürüsttür: alıntı olmadan tespit
yazmaz, kaynak yoksa **ÇEKİMSER** kalır. Fakat düz yazı üretemez, bir belgeyi
sezgisel analizin ötesinde okuyamaz ve taranmış PDF'i (OCR) çözemez. Bu lane
bu üç boşluğu, **avukatın her istekte ayrıca onayladığı** bir bulut yapay
zekâ (Bulut AI) modeli (Anthropic) ile kapatır — ve modelin söylediği hiçbir
şeyi kendi otoritesiyle "kaynaklı" saymaz:

| Yüzey | Modelin yaptığı | Sunucunun doğruladığı |
|---|---|---|
| `POST /v1/ai/analyze-document` | Yüklenen belgenin parçalarını okuyup taraf / talep / dayanak / tarih / risk / eksik / karşı argüman listeleri çıkarır; her tespit için `chunkId` + **birebir alıntı** verir | Her alıntı, o parçanın NFC metninde **tam alt dize** mi (kod noktası ofsetleriyle)? Değilse tespit **silinmez**, `kaynakli:false` işaretlenir ve `kaynaksizCount` artar |
| `POST /v1/ai/ocr` | PDF'i `document` içerik bloğu olarak alır, sayfa sayfa metne döker | Boyut (32 MB), PDF imzası, sayfa sınırı (100) **ağ çağrısından önce**; çıktıya sağlama başlığı: `AI OCR — kaynak: <dosya> — <GG.AA.YYYY> — <model>` |
| `POST /v1/ai/draft-paragraph` | Taslağın bir bölümü için TEK paragraf yazar ve dayandığı kanıt id'lerini bildirir | Her atıf için **entailment hakemi** (yine model, ayrı çağrı); skoru `< 0.85` olan atıf **atılır**; hiçbiri kalmazsa paragraf **KAYNAKSIZ** — görünür, sayılır, asla sessizce kaynaklıya terfi etmez |

Her yüzeyde bulut modeli **yalnızca** (a) `ANTHROPIC_API_KEY` tanımlıysa ve
(b) istek gövdesi `useCloudAi:true` (multipart'ta `'true'`) taşıyorsa
çalışır. Aksi hâlde sırasıyla `400 AI_CONSENT_REQUIRED` ve
`503 AI_NOT_CONFIGURED` döner; kural tabanlı ürün olduğu gibi çalışmaya devam
eder.

## 2. Etkinleştirme (ortam değişkeni ADLARI — değer asla yazılmaz)

| Değişken | Anlamı | Varsayılan |
|---|---|---|
| `ANTHROPIC_API_KEY` | Lane'i açar. **Yoksa her şey kapalı.** | yok |
| `COLLEX_AI_MODEL` | Model kimliği | `claude-sonnet-5`; daha yüksek kalite (daha pahalı) için `claude-opus-5` |
| `COLLEX_AI_BASE_URL` | İsteğe bağlı vekil/ağ geçidi (http(s) ile başlamalı, aksi yok sayılır) | `https://api.anthropic.com` |
| `COLLEX_AI_TOOL_CHOICE` | `forced` (model yalnızca aracı çağırabilir) veya `auto` (zorlanmış araç seçimini reddeden modeller için; sistem istemi aracı adıyla ister, şema yine strict) | `forced` |

**Anahtarı nereye koymalı:** `ColleX Sunucu` penceresinin ortamına
(`ColleX-Baslat.cmd` çalıştırmadan önce o pencerede `set ANTHROPIC_API_KEY=...`)
**veya** kullanıcı düzeyi bir Windows ortam değişkenine. **Bu deponun `.env`
dosyasına KOYMAYIN**: `.env` hiçbir kod yolu tarafından okunmaz, bu lane
`.env`'i asla açmaz ve depodaki `.env` zaten açık bir güvenlik olayının
(SEC-2026-08-26-001) parçasıdır.

Anahtar hiçbir yerde loglanmaz, JSON'a yazılmaz, `console.log` ile
görünmez: `AiConfig` ve `AnthropicAnswerAdapter` anahtarı örnek üzerinde
değil, modül-özel bir `WeakMap`'te tutar; `toJSON()` ve `util.inspect`
kancaları `[gizli]` basar. Hata nesneleri (`AnthropicApiError`) yalnızca
`code` + HTTP durumu taşır, gövdeyi ve başlıkları asla. Bunlar testle
sabitlenmiştir (`tests/ai/adapter.test.ts` "the key never leaks",
`tests/ai/config.test.ts`, `tests/ai/routes.test.ts` "log hygiene").

## 3. Onay modeli ve makineden çıkan veri

Onay **istek başınadır** (`consent:'per-request'`): sunucu tarafında
hatırlanan bir onay yoktur ve olmayacaktır; her istek `useCloudAi:true`
taşımak zorundadır. Konsolda bu bayrağı üreten "Bulut AI" çipi bir **oturum
anahtarıdır** (02.09.2026 itibarıyla, UI-2): çip açıkken Araştır'daki her soru
ve her "Belgeye sor" isteği `useCloudAi:true` ile gider, sayfa yenilenince
çip kapanır; paragraf yazıcı ve OCR diyalogları ise her istekte ayrıca
işaretlenen bir onay kutusu gösterir. Çip açıkken Araştır tezgâhı ve belge
sayfasındaki soru kutusu "Bulut AI: açık — bu istek Anthropic'e gider"
satırını basar. Çipi kapatmayı unutan bir avukat her soruda belge metnini
gönderir — bu, belgelenmiş bir sınırdır, gizli bir davranış değil.

Onaylanan istekte Anthropic sunucularına giden veri:

| Uç | Giden | Gitmeyen |
|---|---|---|
| `analyze-document` | Seçilen dosyanın parça metinleri (ordinal sırasıyla, token bütçesine kadar — bkz. §5), dosya adı, odak | Diğer dosyalar, veritabanı, eski araştırmalar |
| `ocr` | **PDF'in tamamı** (base64), dosya adı | — |
| `draft-paragraph` | Talimat, taslak/bölüm başlığı, seçilen kanıtların etiket + alıntısı, komşu/yerine yazılacak paragraf metni; hakem çağrılarında modelin yazdığı paragraf + ilgili alıntı | Taslağın geri kalanı, taraf kimlik bilgileri (talimata yazılmadıysa) |

Hiçbir durumda gitmeyen: başka sağlayıcı anahtarları, `.env`, DSN, yerel
veritabanı içeriği, konsol oturumu.

## 4. KVKK notu (avukat için)

Yüklenen belgeler ve taslak kanıtları **müvekkil verisi** içerebilir. Bu
yüzeyler kullanıldığında bu veri, kişisel veri işleme mevzuatı anlamında
**yurt dışındaki bir işleyiciye (Anthropic) aktarılır**. Karar her istekte
avukata aittir; uygulama:

- varsayılan olarak kapalıdır ve onay olmadan tek bayt göndermez;
- ne gönderdiğini `/v1/ai/status` notlarında ve bu belgede açıkça yazar;
- modeli asla kaynak saymaz: doğrulanmayan tespit `kaynaksız`, doğrulanmayan
  atıf atılır, OCR metni "AI OCR" başlığı taşır.

Aydınlatma yükümlülüğü, açık rıza gerekip gerekmediği ve Anthropic'in veri
saklama koşulları (varsayılan API'de 30 gün; sıfır saklama ayrı sözleşme
gerektirir) avukatın değerlendirmesindedir; uygulama bu değerlendirmeyi
yapmaz ve yapmış gibi görünmez.

## 5. Uygulanan sözleşme

Kod: `control-plane/src/ai/{config,routes,analysis,ocr,paragraph,types}.ts`
ve `control-plane/src/llm/anthropicAdapter.ts`. Entegrasyon lane'i router'ı
`app.route("/", createAiRouter({...}))` ile bağlar.

### `GET /v1/ai/status`

```json
{ "configured": true, "model": "claude-sonnet-5", "consent": "per-request",
  "dataLeavesMachine": true, "notes": ["..."], "liveTested": false,
  "provider": "anthropic",
  "usage": { "inputTokens": 0, "outputTokens": 0, "cacheReadInputTokens": 0,
             "cacheCreationInputTokens": 0, "calls": 0 } }
```

`notes` Türkçedir: varsayılan kapalı / istek başına onay / verinin makineden
çıktığı / model adı ve `claude-opus-5` seçeneği / "canlı sınanmadı".
`usage` yalnızca adaptör örneği oluştuğunda (ilk onaylı istekten sonra)
görünür; süreç ömrü boyunca toplanan token sayımıdır.

### Ortak kapılar (her `POST /v1/ai/*`)

1. Gövde JSON değilse `400 INVALID_REQUEST`.
2. `useCloudAi !== true` (multipart'ta `'true'` değilse) →
   `400 { error: { kind: "AI_CONSENT_REQUIRED", message } }`.
3. Anahtar yoksa → `503 { error: { kind: "AI_NOT_CONFIGURED",
   message: "Bulut yapay zekâ kapalı — ANTHROPIC_API_KEY tanımlı değil." } }`.
4. zod doğrulaması (Türkçe mesajlar; tanınmayan alan adı `path`'te).

### `POST /v1/ai/analyze-document`

İstek: `{ fileId: string, useCloudAi: true, focus?: 'dilekce'|'sozlesme'|'genel' }`
(varsayılan `genel`). Dosya parçaları `deps.files.getChunks([fileId], tenantId)`
ile okunur (`STORE_UNAVAILABLE` 503 / `NOT_FOUND` 404).

Yanıt (`collex.ai.document-analysis/v1`):

```json
{ "schema": "collex.ai.document-analysis/v1", "fileId": "…", "fileName": "…",
  "focus": "genel", "model": "claude-sonnet-5",
  "chunksAnalyzed": 2, "chunksTotal": 2,
  "ozet": "…",
  "taraflar": [ { "text": "…", "kaynakli": true,
                  "evidence": [ { "chunkId": "…", "quote": "…", "dogrulandi": true,
                                  "startChar": 0, "endChar": 19 } ] } ],
  "talepler": [], "dayanaklar": [], "tarihler": [], "riskler": [],
  "eksikler": [], "karsiArgumanlar": [],
  "maddeler": [ … ],            // yalnızca focus = 'sozlesme'
  "kaynaksizCount": 1, "itemCount": 4,
  "warnings": ["…"], "disclaimer": "…",
  "usage": { … }, "liveTested": false }
```

- `kaynakli` = en az bir işaretçi var **ve** hepsi `dogrulandi:true`.
- `startChar/endChar` **kod noktası** ofsetleridir; parçanın NFC metnindeki
  yerel ofset + `chunk.startChar` (dosya kanonik metnine göre mutlak).
- Token bütçesi (`ANALYSIS_TOKEN_BUDGET = 120 000`, tahmin: kod noktası /
  2,5): parçalar ordinal sırasıyla **tamamen** alınır; bütçeyi aşan ilk
  parçadan itibaren atılır ve `warnings`'e "parça ortasından kesilmedi"
  uyarısı yazılır. Atılan parçadan gelen alıntı doğrulanamaz.
- Parçalar `<untrusted_document chunk="…">` içinde gider; içerideki kapatma
  etiketleri `[wrapper-tag-removed]` ile etkisizleştirilir; Türkçe sistem
  istemi bloğun veri olduğunu, talimat olmadığını söyler.

### `POST /v1/ai/ocr` (multipart)

Alanlar: `file` (PDF), `useCloudAi: 'true'`. Kapılar ağ çağrısından önce ve
bu sırayla: `413 PAYLOAD_TOO_LARGE` (> 32 MB), `415 UNSUPPORTED_TYPE`
(ilk 1024 baytta `%PDF-` yoksa), `413 PAYLOAD_TOO_LARGE` (> 100 sayfa —
sayfa sayısı PDF'in kendi sayfa ağacından yerel olarak tahmin edilir).

Yanıt (`collex.ai.ocr/v1`):

```json
{ "schema": "collex.ai.ocr/v1", "fileName": "tarama.pdf", "pageCount": 2,
  "pages": [ { "page": 1, "text": "…" }, { "page": 2, "text": "…" } ],
  "text": "…\f…",                       // sayfalar form-feed ile birleşik
  "warnings": [], 
  "provenanceHeader": "AI OCR — kaynak: tarama.pdf — 02.09.2026 — claude-sonnet-5",
  "model": "claude-sonnet-5", "usage": { … }, "requests": 1,
  "upload": { "fileName": "tarama.ocr.txt", "text": "<başlık>\n\n[Sayfa 1]\n…" },
  "liveTested": false }
```

Sayfalar `OCR_PAGES_PER_REQUEST = 8`'lik aralıklarla istenir (her istekte
aynı PDF `cache_control: ephemeral` ile gönderilir; istek süresi 300 s,
`max_tokens` 24 000). Sayfa sayısı yerelde belirlenemezse (nesne akışlı
PDF) tüm sayfalar tek istekte istenir ve `warnings` bunu söyler — bu
durumda 100 sayfa sınırı **yerelde uygulanamaz** (bilinen boşluk).

**Konsol devri (bağlandı — UI-2, 02.09.2026; `console.html` `renderOcrHook` /
`openOcrDialog`):** konsol, `upload.text`'i
(`provenanceHeader` ilk satır, sayfa işaretleri, kontrol karakteri yok)
`upload.fileName` adıyla mevcut `POST /v1/files` (multipart `file`) ucuna
yükler; böylece transkript aynı intake hattından geçer (karantina →
çıkarım → parçalar) ve ilk satırı her zaman "AI OCR" der. `text` alanı
(form-feed'li) API tüketicileri içindir; intake'e verilmez.

### `POST /v1/ai/draft-paragraph`

İstek: `{ draftId, sectionId, paragraphId?, insertAfter?, instructions,
evidenceIds: string[] (≤ 12, hepsi taslağın kanıt listesinde), useCloudAi: true,
length?: 'normal'|'uzun' }`. `paragraphId` ve `insertAfter` birlikte
verilemez. **Kilitli bölümler (W12-FIX2 #8, P2-17):** `sectionId`
`ek-dogrulama` (EK — DOĞRULAMA BİLGİLERİ) ya da `karsi-ictihat`
(DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT) olamaz — `AI_LOCKED_SECTION_IDS`
isteği **depo okunmadan ve model çağrılmadan** `400 INVALID_REQUEST` ile
reddeder; mesaj `AI_LOCKED_SECTION_MESSAGE_TR`: "Bu bölüme yapay zekâ
paragrafı yazılamaz: doğrulama eki makineye, karşı içtihat bölümü ise
kararlara aittir." (`tests/ai/routes.test.ts`: iki id de 400, adaptör
çağrısı yok, `put` yok, `revise` yok). Akış: `await drafts.warm?.(draftId)`
→ `drafts.get` (404) → bölüm / çapa / kanıt kontrolü (400) →
`write_paragraph` (tek paragraf; model çıktısı `sanitizeMarkdown`'dan geçer)
→ atıf başına `assess_entailment` →
`< 0.85` veya `entails:false` veya kullanılamaz skor (NaN/∞/aralık dışı)
**atılır** → `deps.revise(draft, patch, { trustEntailment: true, now })`
→ `drafts.put`.

**W21 (R2-29) — denetlenemeyen atıf.** Bir atıf için hakemin yanıtı
okunamazsa ya da kendi içinde çelişkiliyse (adaptör `MALFORMED` fırlatır:
şekil bozuk, skor 0–1 dışında ya da `entails:false` iken skor ≥ 0,85) o atıf
**denetlenemedi** sayılır: tutulmaz; `entailment` satırı `checked: false`,
`score: 0` (ölçüm değil, yer tutucu), `entails: false` ve "denetlenemedi —
hakemin yanıtı okunamadı ya da kendi içinde çelişkiliydi; bu kanıt bağı
paragrafa yazılmadı" gerekçesini taşır; `warnings`'e "N kanıt bağı
denetlenemedi (…) ve paragrafa yazılmadı: <id'ler>." düşer (eşik altı
satırından ayrı). Ücreti ödenmiş paragraf ve öteki atıfların geçerli
değerlendirmeleri **atılmaz**; taslak kaydedilir, hiçbir atıf kalmazsa
KAYNAKSIZ işaretlenir. Bu durumda atıflardan en az biri denetlenemediyse
paragraf notu ölçülmüş bir eksiklik ("hiçbir kanıt eşiği geçmedi")
**söylemez**; not `NOTE_AI_KAYNAKSIZ_DENETLENEMEDI` olur: "KAYNAKSIZ — AI
taslak; kanıt bağlarından en az biri denetlenemedi (hakemin yanıtı
okunamadı), hiçbir kanıt bağı paragrafa yazılmadı; avukat eklemeli".
Düzenleyici paragrafı yine de `supported:true` sayarsa not yine budur.
Taslak düzeyinde, hiçbir bağ tutulmamış ve bir bağ denetlenememişse "kaynak
bağları entailment ile doğrulandı" satırı (`WARNING_AI_PARAGRAPH`)
**eklenmez**; denetlenemeyen bağı olan her paragraf için
`WARNING_AI_PARAGRAPH_UNCHECKED` eklenir ("…kanıt bağlarından en az biri
denetlenemeyen paragraf var; denetlenemeyen bağlar paragrafa yazılmadı ve
doğrulanmış sayılmaz, metin avukat incelemesi olmadan kullanılamaz.").
Tutulan bir bağ da varsa iki satır birlikte yazılır. Kural
`aiParagraphNote` / `aiParagraphDraftWarnings` (`paragraph.ts`) içindedir.
Eskiden tek bir çelişkili yanıt bütün isteği `502 AI_MALFORMED_OUTPUT`
yapıyordu. Hakeme **ulaşılamaması** (zaman aşımı, ağ, 401/403, 5xx, 429) ya
da hakemin isteği reddetmesi (`REFUSAL`) veya yanıtının kesilmesi
(`TRUNCATED`) ise eskisi gibi isteğin tamamını başarısız sayar (502/503/504,
bkz. hata eşlemesi) ve taslak değişmez. `checked` alanı yalnız denetlenemeyen
satırda bulunur; OpenAPI `AiDraftParagraphResult.entailment` şeması bu alanı
ve o satırdaki `score`'un ölçüm değil yer tutucu olduğunu belgeler.

**Konsol (W21).** `renderAiParagraphResult`, sonucu `aiParagraphVerdict`
üzerinden okur (`public/console.html`). `checked:false` satırında ölçek
sütunu "denetlenemedi", sonuç sütunu "paragrafa yazılmadı" yazar; yer tutucu
0 skorundan asla "zayıf" üretilmez. Böyle bir satır varken kart "Program her
dayanağı ayrıca denetledi" demez; "…denetlemeye çalıştı; N dayanakta yapay
zekâ hakeminin yanıtı okunamadı…" der. Hiçbir bağ kalmamışsa baş cümle
denetlenemeyen bağları ayrıca sayar ("Bu paragrafa hiçbir dayanak yazılmadı:
1 dayanak denetimi geçemedi, 1 dayanak denetlenemedi…" ya da hepsi
denetlenemediyse "Bu paragrafın dayanakları denetlenemedi…"); "hiçbir
dayanağı denetimi geçemedi" yalnız her bağ gerçekten ölçüldüğünde yazılır.
Model hiçbir dayanak göstermediyse kart bunu söyler. Paragraf yazıldıktan
sonraki bildirim (`aiParagraphToastText`) aynı hükmü kullanır: "hiçbir kanıt
eşiği geçmedi" yalnız ölçülmüş eksiklikte çıkar. Hakemin tuttuğu bir bağ,
kaydedilen paragrafın `evidenceIds` listesinde yoksa satırı "korundu"
**yazmaz**; "denetimi geçti; taslak kabul etmedi" yazar, açıklama ve
bildirim de "N dayanak … taslağın dayanak kurallarınca kabul edilmedi"
cümlesini ekler (paragraf başka bir bağla kaynaklı kalsa bile).
(`tests/pipeline/consoleW21Honesty.test.ts`, "R2-29 · the AI paragraph card".)

Yanıt:

```json
{ "draft": { …revize edilmiş taslak, version+1… },
  "paragraph": { "id": "p-hd-ai-1a2b3c4d", "text": "…", "evidenceIds": ["ev-1"],
                 "supported": true, "role": "hukukiDegerlendirme",
                 "note": "AI taslak — kaynak bağı entailment ile doğrulandı (≥%85)",
                 "binding": { "kind": "entailment", "score": 0.92, "judge": "claude-sonnet-5" } },
  "entailment": [ { "evidenceId": "ev-1", "score": 0.92, "entails": true, "kept": true, "rationale": "…" },
                  { "evidenceId": "ev-2", "score": 0.40, "entails": false, "kept": false, "rationale": "…" } ],
  "threshold": 0.85, "kaynakli": true,
  "warnings": ["1 kanıt bağı entailment eşiğinin (≥%85) altında kaldı …"],
  "issues": [], "model": "claude-sonnet-5", "usage": { … }, "liveTested": false }
```

Hiçbir atıf kalmazsa: `evidenceIds: []`, `supported:false`, `binding` yok,
not `"KAYNAKSIZ — AI taslak; hiçbir kanıt entailment eşiğini (≥%85) geçmedi;
avukat eklemeli"` (atıflardan biri denetlenemediyse
`NOTE_AI_KAYNAKSIZ_DENETLENEMEDI`, bkz. yukarı), `unsupportedCount` yeniden
sayılır. Düzenleyici (lane C
`reviseDraft`) paragrafı daha sert değerlendirir de `supported:false` derse
bu karar **asla** geri alınmaz; paragraf KAYNAKSIZ kalır ve uyarı yazılır
("Düzenleyici paragrafın kanıt bağını kabul etmedi…"). **W21:** bu durumda
not artık "hiçbir kanıt … eşiğini geçmedi" **değildir** (bir bağ hakemden
geçmişti); `NOTE_AI_KAYNAKSIZ_DUZENLEYICI` yazılır: "KAYNAKSIZ — AI taslak;
entailment eşiğini (≥%85) geçen kanıt bağı taslağın dayanak kurallarınca
kabul edilmedi; avukat eklemeli". Yanıttaki `kaynakli` **kaydedilen**
paragrafın hâlidir (`paragraph.supported` ile aynı): hakemin tuttuğu bir bağ
düzenleyicinin kaydettiği paragrafa yazılmadıysa `false`; hakemin kendi
kararı `entailment[].kept` satırlarında durur. Taslağın "Düzenleme notu: AI
paragraf (…) — kaynaklı" uyarısı da bu durumda "— KAYNAKSIZ" olarak yeniden
yazılır. **W21:** kaydedilen paragraf kimliğiyle bulunur; ekleme
(`paragraphId` yok) ve `insertAfter` yolunda gerçek düzenleyici
(`reviseDraft`) taslağın tanımadığı kimliğe yeni bir kimlik verdiği için
paragraf, hedef bölümde önceki taslakta olmayan ve gönderilen metni taşıyan
**tek** paragraf olarak bulunur (`locateRevisedParagraph`); yanıttaki
`paragraph` o kaydedilen paragraftır (`id` sunucunun ürettiği `p-…-ai-…`
değil, düzenleyicinin verdiği kimlik olabilir). Eskiden yalnız kimlikle
arandığı için bu yolda yanıt `kaynakli:true` diyor, kaydedilen paragraf ise
KAYNAKSIZ duruyordu. Paragraf bulunamazsa (ya da iki aday çıkarsa) yanıt
`kaynakli:false`, `paragraph.supported:false` döner ve uyarı paragrafın
kaynaklı sayılmadığını söyler. Düzenleyici bağlardan birini kabul edip
ötekini reddederse paragraf kaynaklı kalır; reddedilen bağ `warnings`'te
adıyla yazılır ("N kanıt bağı entailment denetimini geçti, ancak taslağın
dayanak kurallarınca kabul edilmedi ve paragrafa yazılmadı: <id'ler>.").
(`tests/ai/draftParagraphRealReviser.test.ts`, ürünün kendi düzenleyicisiyle.)
Konsol bu durumda "kaynaklı sayıldı" demez; "Bir dayanak anlam denetimini
geçti, ancak taslağın dayanak kuralları onu kabul etmedi…" der (eski bir
sunucunun `kaynakli:true` + `paragraph.supported:false` yanıtında da).
Her AI revizyonu taslağın `warnings` listesine sabit bir "bulut yapay zekâ
tarafından yazılmış paragraf var" satırı ekler (hiçbir bağ tutulmamış ve bir
bağ denetlenememişse bu satırın yerine `WARNING_AI_PARAGRAPH_UNCHECKED`).

Patch şekli (sözleşme [D]): taslağın **bütün** bölümleri, mevcut paragraflar
kendi `binding`'iyle (`'lexical'` ya da korunan `{kind:'entailment',…}`),
hedef bölümde yeni/yerine paragraf; `note: "AI paragraf (<model>) — kaynaklı|KAYNAKSIZ"`.

### Hata eşlemesi (adaptör → HTTP)

| `AnthropicApiError.code` | HTTP | `kind` |
|---|---|---|
| `TIMEOUT` (60 s; OCR 300 s) | 504 | `AI_TIMEOUT` |
| `NETWORK` (2 yeniden deneme sonrası) | 502 | `AI_UPSTREAM_UNAVAILABLE` |
| `HTTP` 401/403 | 502 | `AI_AUTH_FAILED` |
| `HTTP` 429 (2 yeniden deneme, `retry-after` ≤ 20 s) | 503 | `AI_RATE_LIMITED` |
| `HTTP` diğer / 5xx (2 yeniden deneme) | 502 | `AI_UPSTREAM_FAILED` |
| `REFUSAL` (`stop_reason: refusal`) | 502 | `AI_REFUSED` |
| `TRUNCATED` (`stop_reason: max_tokens`) | 502 | `AI_OUTPUT_TRUNCATED` |
| `MALFORMED` (araç bloğu yok / şekil bozuk) | 502 | `AI_MALFORMED_OUTPUT` (draft-paragraph'ta tek bir atfın hakem yanıtı hariç: o atıf denetlenemedi sayılır, bkz. yukarı) |
| `CONFIG` | 503 | `AI_NOT_CONFIGURED` |

Hata mesajları Türkçedir ve adlandırma kuralına uyar (`AI_NOT_CONFIGURED`,
`AI_UNAVAILABLE`, `AI_TIMEOUT` cümle başında "Bulut yapay zekâ …" der);
hiçbiri istek gövdesini, sağlayıcı metnini veya anahtarı taşımaz. Sunucu
stderr'e yalnızca `[collex-ai] upstream failure code=<kod> status=<n>` yazar.
`POST /v1/ai/analyze-document` ve `draft-paragraph` gövdeleri de sunucu
geneli 1 MiB JSON sınırına tabidir (`413 PAYLOAD_TOO_LARGE`, W12-FIX2 #4);
OCR'ın kendi 32 MB / 100 sayfa kapıları ayrıca uygulanır.

## 6. Adaptör (`src/llm/anthropicAdapter.ts`)

- Ham `fetch` → `POST {baseUrl}/v1/messages`, başlıklar `x-api-key`,
  `anthropic-version: 2023-06-01`, `content-type: application/json`.
  Control-plane bağımlılık kümesi donmuş olduğu için resmî SDK kullanılamaz;
  bu tercih, SDK'nın hazır yeniden deneme/zaman aşımı mantığını elle
  yazmayı gerektirdi (`send()`).
- Yapılandırılmış çıktı: `strict: true` araç şemaları + `tool_choice:
  {type:'tool'}` (`forced`) veya `{type:'auto'}` + sistem talimatı (`auto`).
- Araçlar: `draft_claims`, `assess_entailment` (mevcut),
  yeni `analyze_document`, `transcribe_pages`, `write_paragraph`.
- **W21 (R2-27) `assess_entailment`:** skor 0–1 dışındaysa ya da
  `entails:false` iken skor ≥ 0,85 ise yanıt `MALFORMED`'dır; skor artık
  **kırpılmaz** (eskiden 7 ya da 95, 1'e kırpılıp eşiği geçiyordu). `strict`
  araç kullanımında sayısal `minimum`/`maximum` kısıtları desteklenmediği için
  şemada yoktur; ölçek şema açıklamasında ve sistem talimatında sözle
  söylenir ("pasajın iddiayı desteklediğine dair 0 ile 1 arasında bir
  olasılık", kararın kesinliği değil) ve istemci tarafında denetlenir. Cevap
  hattında güvenli sarmalayıcı bunu `ENTAILMENT_PORT_FAILED` olarak kaydeder,
  tespit `ENTAILMENT_NOT_CHECKED` okunur (yerel yargıçla aynı).
- Her çağrı `{ value, usage }` döner; `adapter.usage` ve `adapter.calls`
  süreç toplamıdır.
- `AbortSignal.timeout(60 000)` (çağrı başına geçersiz kılınabilir), 429/5xx/
  ağ hatasında 2 yeniden deneme (üstel geri çekilme, `retry-after`), zaman
  aşımı yeniden denenmez.

**Canlı sınanmamış varsayımlar** (smoke betiği ilk kez bunları ölçer):
`claude-sonnet-5` / `claude-opus-5` üzerinde zorlanmış `tool_choice` ile
varsayılan (uyarlanabilir) düşünmenin birlikte kabul edilmesi; `document`
bloğunun `cache_control` taşıyabilmesi; `strict` şemada tüm alanların
`required` listelenmesinin yeterli olması. Herhangi biri reddedilirse
`COLLEX_AI_TOOL_CHOICE=auto` ilk kaçış yoludur; Fable/Mythos ailesi
zorlanmış araç seçimini reddettiği için bu adaptörle **desteklenmez**.

## 7. Canlı smoke betiği

```
node control-plane/scripts/ai-live-smoke.mjs --dry-run   # plan; ağ yok (bu ortamda koşuldu: exit 0)
node control-plane/scripts/ai-live-smoke.mjs             # 3 ÜCRETLİ çağrı; yalnızca SENTETİK metin
```

Anahtar yoksa `exit 2` ve Türkçe yönlendirme (bu ortamda koşuldu). Anahtar
varsa sırayla `assess_entailment`, `write_paragraph`, `analyze_document`
çağrılır (hepsi sentetik girdiyle; hiçbir müvekkil belgesi gönderilmez),
token kullanımı ve PASS/FAIL basılır; anahtar hiçbir satırda görünmez.

### Canlı sınama kaydı

_(boş — **02.09.2026 itibarıyla hâlâ koşulmadı**. W14'ün yedi hattı, Faz B
konsol turu, bağımsız doğrulama turu ve Faz F'in üç düzeltme hattının
**hiçbiri** canlı bir çağrı yapmadı; L-VERIFY ürünün bütün P0/P1 yüzeylerini
`ai.configured:false` ile yürüdü — yani ColleX bulut AI olmadan çalışıyor,
ama bulut hattı hiç denenmedi. Koşulduğunda tarih, model, üç çağrının sonucu
ve token sayımı buraya eklenir ve `src/ai/config.ts` içindeki
`AI_LIVE_TESTED` `true` yapılır. RISKS #20, STATUS doğrulanmamış yüzey #1.)_

## 8. Bilinen boşluklar

1. **Canlı hiç sınanmadı** (yukarıdaki her şey).
2. OCR sayfa sınırı, sayfa ağacı nesne akışlarında gizli olan PDF'lerde
   yerelde uygulanamaz; uyarıyla tek istekte tüm sayfalar istenir.
3. OCR tek istek başına çıktı sınırı (24 000 token): çok yoğun 8 sayfa
   kesilirse `AI_OUTPUT_TRUNCATED` döner; küçük parti boyutu (`ocrBatchSize`)
   entegrasyon tarafından ayarlanabilir, henüz ortam değişkenine bağlı değil.
4. Analiz alıntı doğrulaması **tam eşleşme** ister: modelin boşluk/satır
   sonu normalleştirmesi tespiti kaynaksız bırakır (dürüst ama katı).
5. `result.aiUsed` / `POST /v1/answer` `useCloudAi` bağı — **bağlandı**
   (entegrasyon, 02.09.2026): `answerPipeline.ts` istek başına `useCloudAi`
   anahtarını okur ve `aiUsed` görünümünü döndürür.
6. Konsol onay çipi, `/v1/health.ai`, `openapi.yaml` yolları ve `serve.mjs`
   bağlantısı — **bağlandı** (entegrasyon + UI-2, 02.09.2026; bkz.
   `docs/implementation/waves/W12-INTEGRATION.md`, `W12-UI2.md`). Çipin
   oturum anahtarı olduğu §3'te yazılıdır.
