# Yerel üretim sağlayıcısı (isteğe bağlı)

**Durum: yapılandırma ve sınır indi, HİÇBİR MODEL ÖLÇÜLMEDİ.**
**W20:** sağlayıcı artık ürüne bağlı (cevap hattı, dosya incelemesi
çıkarımı ve sentezi, rol yönlendirmesi) — ama **gerçek bir model yine
çağrılmadı**; bütün model yolları betikli test çiftleriyle sınandı.
Bu belgede hız, bellek veya kalite iddiası **yoktur**; ölçümü yapan betik
aşağıda, ve çalıştırılana kadar hiçbir sayı hiçbir belgeye yazılamaz.

## Ne işe yarar, ne işe yaramaz

ColleX'in çekirdeği **yerel modelsiz de çalışır**: arama, dosya, süre,
taslak ve kural tabanlı taslakçı/yargıç portları determinist ve çevrimdışıdır.
Yerel model **isteğe bağlı bir hızlandırıcıdır**, zorunlu bir bağımlılık
değil. Hiçbir şey yapılandırılmazsa `/v1/health` bunu `not_configured`
olarak bildirir — bu bir arıza değildir.

Yerel sağlayıcı iki iş için tasarlandı:

1. **yapılandırılmış çıkarım** (`generateJson`) — kapsamlı dosya
   incelemesinin her biriminde kullanılabilecek, küçük ve şemalı çıktı;
2. **gerekçe denetimi** (`assess`) — "bu pasaj bu iddiayı gerçekten
   destekliyor mu?".

**W20: taslak iddiayı kanıt-önce yazar** (ADR-037, W19'daki "yazmaz"
kararının yerini aldı). `draftClaims` yalnız kanıt paketindeki pasajları,
kimlikleriyle görür; her iddia en az bir kanıt kimliği göstermek zorundadır.
Model kendisine verilmeyen bir kimlik yazarsa kimlik **olduğu gibi**
doğrulayıcıya gider ve `CITATION_INVALID` kaydı düşer — sessizce silmek,
modelin atıf uydurduğunu gizlerdi. Her iddia mevcut doğrulayıcıdan
muhafazakâr birleştirmeyle geçer. Yerel taslakçı hata verirse kural tabanlı
taslakçıya dönülür (`LOCAL_DRAFTER_FALLBACK`); **buluta asla dönülmez**.
Yanıt veremeyen bir yargıç hâlâ **"desteklemiyor"** der — muhafazakâr yön.

## Model bağımsızdır

Bağdaştırıcı OpenAI uyumlu `POST /v1/chat/completions` konuşur. Ollama,
llama.cpp sunucusu ve LM Studio bu biçimi sunar. **Kodda hiçbir model ailesi
adı geçmez**; model bir ayardır. Ürünü kodda tek bir modele bağlamak, daha
iyisini ölçemez hâle gelmenin yoludur.

## Güven düzeyleri ve veri sınırı

| Düzey | Ne demek | Liste gerekir mi |
|---|---|---|
| `LOCAL_PROCESS` | loopback; baytlar hiçbir ağ arayüzüne değmez | hayır |
| `TRUSTED_LOCAL_NETWORK` | kendi ağınızdaki bir kutu | **evet, açıkça** |
| `CLOUD` | başkasının bilgisayarı | — |

**Listelenmemiş özel adres reddedilir.** "Özel adres ⇒ güvenilir" kuralı, bir
ayar alanını istek sahteciliği aracına çevirir: ayarı etkileyebilen biri
`10.0.0.5` yazar ve ürün müvekkil dosyasını oraya gönderir. Loopback'in
listeye ihtiyacı yoktur, çünkü makineden çıkamaz. **Bir DNS adı asla yerel
sayılmaz**, bugün özel bir adrese çözülse bile: DNS çözmüyoruz ve adresi
değişebilen bir ad güven sınırı değildir.

`COLLEX_DATA_BOUNDARY=LOCAL_ONLY` bulutu yasaklar ve **geri düşüş yoktur**.
Yerel model erişilemezse bu, çağıranın öğrendiği bir arızadır; dosyayı
dışarıya göndermek için gerekçe değildir. Sınır **her çağrıda** yeniden
denetlenir, yalnız kurulumda değil.

## Ayarlar

Değerler hiçbir günlüğe, hata iletisine veya sağlık çıktısına yazılmaz.

| Değişken | Anlamı |
|---|---|
| `COLLEX_LOCAL_LLM_BASE_URL` | örn. `http://127.0.0.1:11434` |
| `COLLEX_LOCAL_LLM_MODEL` | sunucunun tanıdığı model adı (zorunlu) |
| `COLLEX_LOCAL_LLM_MODEL_ANSWER` | W20, isteğe bağlı: cevap taslakçısı için ayrı model |
| `COLLEX_LOCAL_LLM_MODEL_VERIFIER` | W20, isteğe bağlı: gerekçe denetimi için ayrı model |
| `COLLEX_LOCAL_LLM_MODEL_EXTRACTION` | W20, isteğe bağlı: dosya incelemesi çıkarımı için ayrı model |
| `COLLEX_LOCAL_LLM_MODEL_SYNTHESIS` | W20, isteğe bağlı: dosya incelemesi değerlendirmesi için ayrı model |
| `COLLEX_LOCAL_LLM_API_KEY` | ağdaki sunucu için bearer parolası |
| `COLLEX_TRUSTED_LOCAL_HOSTS` | virgülle ayrılmış `host:port` listesi |
| `COLLEX_LOCAL_LLM_CONTEXT_TOKENS` | varsayılan 8192 |
| `COLLEX_LOCAL_LLM_MAX_OUTPUT_TOKENS` | varsayılan 1024 |
| `COLLEX_LOCAL_LLM_CONCURRENCY` | **varsayılan 1** |
| `COLLEX_LOCAL_LLM_TIMEOUT_MS` | varsayılan 120000 |
| `COLLEX_DATA_BOUNDARY` | `LOCAL_ONLY` \| `ALLOW_CLOUD` (varsayılan) |

Varsayılan `ALLOW_CLOUD`'dur, çünkü bulut yapay zekâ zaten anahtarsız
kapalıdır ve bu ayar mevcut kurulumların davranışını sessizce değiştirmez.

## Hedeflenen kurulum: M2 Mac mini (8 GB) — ÖLÇÜLMEDİ

W20: adım adım kurulum, güvenlik duvarı ve Mac'te çalıştırılacak ölçüm
komutları → [MAC-MINI-INFERENCE.md](MAC-MINI-INFERENCE.md).

Amaçlanan yerleşim, Windows iş istasyonunun yanında duran küçük bir çıkarım
kutusudur. **ColleX'in geri kalanı taşınmaz**: uygulama, veritabanı ve MCP
yığını olduğu yerde kalır; Mac yalnız isteğe bağlı bir model uç noktasıdır.

8 GB kısıt olduğu için varsayılanlar bilerek küçüktür. **Eşzamanlılık 1'dir**:
o donanımda ikinci bir üretim gecikmeyi yarıya indirmez, birincinin önbelleğini
düşürür. Bağlam tavanı bir **ayardır**, modelin ilan ettiği değer değil —
128K bağlam iddia eden bir model kartı, 8 GB'ta ağırlıklarla birlikte 128K'nın
sığdığı anlamına gelmez. Uzun iş, büyük bağlamla değil, **çok sayıda küçük ve
devam ettirilebilir birime bölünerek** yapılır.

### Güvenli kurulum sırası

1. Modeli Mac'te **yalnız loopback'te** dinletin ve önce oradan ölçün.
2. LAN'a açmanız gerekiyorsa: uç noktayı kimlik doğrulamalı hâle getirin,
   `COLLEX_TRUSTED_LOCAL_HOSTS` içine `host:port` olarak **açıkça** ekleyin ve
   `COLLEX_LOCAL_LLM_API_KEY` verin. Liste olmadan ColleX bağlanmaz.
3. **Ollama'yı kimlik doğrulamasız biçimde `0.0.0.0`'a açmayın.**

### Ölçüm

```bash
node control-plane/scripts/probe_local_generation.mjs \
  --base-url http://127.0.0.1:11434 --model <model-adı> --runs 20
```

Betik şunları ölçer: soğuk ilk çağrı, kararlı durumda p50/p95 gecikme ve
**istenen JSON biçiminde olmayan yanıt oranı** — kapsamı sessizce düşüren
arıza türü budur. **Kaliteyi ölçmez.** Yanlış tutarı hızlıca çıkaran bir
model, modelsiz olmaktan kötüdür; hukukî kalite için avukat etiketli altın
küme gerekir, kronometre değil.

Bir sayı ancak bu betik gerçek kutuda koşturulduktan sonra
`docs/implementation/STATUS.md` **Ölçülen sayılar** tablosuna yazılabilir.

## Sağlıkta nasıl görünür

`/v1/health` içindeki `localAi` bloğu üç durumdan birini söyler:
`not_configured`, `refused` (adres güven kurallarını geçmedi, gerekçesiyle)
ve `configured`. **`configured`, "çalışıyor" demek değildir** —
`liveTested` her zaman `false`'tur, çünkü sağlık uç noktası her yoklamada
modeli araması gereken bir yük üreticisi olmamalıdır. Erişilebilirlik ayrı
bir ölçümdür ve yukarıdaki betikle yapılır.
