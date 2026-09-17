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
**W21: yanıt veremeyen yargıç puan uydurmaz.** Yerel yargıca ulaşılamazsa,
süre dolarsa ya da yanıtı okunamazsa bu bir **arıza** olarak kaydedilir:
cevaba `ENTAILMENT_PORT_FAILED` uyarısı düşer (bulut yargıcıyla aynı yol)
ve tespit yine güvenli tarafta desteksiz sayılır (kesinleştirilemez). Eskiden
bu durum sessizce 0 puana dönüşüyordu ve cevap "pasajlar denetlendi, destek
eşiğin altında kaldı" gibi okunuyordu; oysa hiçbir denetim yapılmamıştı.
Denetlenemeyen tespitin gerekçesi artık `ENTAILMENT_NOT_CHECKED:<tespit>`'tir,
`ENTAILMENT_BELOW_THRESHOLD` değil. `ENTAILMENT_BELOW_THRESHOLD` yalnız
gerçekten yapılmış bir değerlendirme eşiğin altını ölçtüğünde kalır (ör. bir
bölüm ölçülüp kısa kaldı, öteki denetlenemedi: ikisi birlikte yazılır). Tek
değerlendirme bile yapılamadıysa `aiUsed.entailment` `false` olur; tespitin
`entailmentMeasured` alanı da `false`'tur. Eşik (0,85) değişmedi.
**W21 (R2-27):** 0 ile 1 dışındaki bir puan (10 üzerinden "7", 100 üzerinden
"95") ve "desteklemiyor" deyip eşiği geçen puan veren yanıt, bulut
yargıcında da (`AnthropicAnswerAdapter.assess`) yanıt sayılmaz. Bulut
yargıcı böyle bir puanı eskiden 1'e kırpıyordu; yargıcın %70 verdiği tespit
böylece kesinleşebiliyordu. Artık iki yargıç da aynı kuralı uygular.
**Açık kalan:** dışa aktarılan belgede ve ekranda bu gerekçe kodu henüz
Türkçe bir cümleyle açıklanmıyor (kod olduğu gibi görünür) ve belgedeki
"Pasaj desteği" satırı bu tespit için hâlâ `%0` yazar; bu iki yüzey
(`src/answer/renderer.ts`, `public/console.html`) bu işin dışında kaldı.
Yerel taslakçı düştüğünde (`LOCAL_DRAFTER_FALLBACK`) kural tabanlı iddialar,
az önce düşen aynı modele değil, kural tabanlı cevabın her zamanki
sözcüksel yargıcına gider; cevap etiketi de "kural tabanlı" olur.

**W21: iddia metni de veri bloğunun içindedir.** Yargıca giden istekte
talimat kısmı sabittir; iddia (`[İDDİA]`) ve pasaj (`[PASAJ]`) ikisi birlikte
güvenilmeyen veri çitinin içinde gönderilir. İddia metni bir modelin ya da
belgenin ürünüdür, talimat yerine geçemez. Yükün içindeki sahte `[İDDİA]` /
`[PASAJ]` etiketleri parantezle etkisizleştirilir. Karşılaştırmadan önce bir
modelin aynı etiket gibi okuyacağı biçimler katlanır: büyük-küçük harf ve
Türkçe I biçimleri, köşeli parantez içindeki boşluk, noktalama ve numara
(`[PASAJ 2]`), görünmez karakterler (sıfır genişlikli boşluk, yumuşak tire,
yön denetim karakterleri — yükün tamamından, çit bunları silmeden **önce**
atılır; eskiden `[PA<sıfır genişlikli boşluk>SAJ]` denetimden geçip çitte
gerçek `[PASAJ]` oluyordu), tam genişlikli harf ve parantezler, parantez
benzerleri (`【PASAJ】`), başka alfabelerden aynı görünen harfler (Kiril Р, А
vb.) ve iç içe parantez (`[[PASAJ]`). Kanıt kimlikleri (`[e1]`) ve olağan
köşeli parantezli metin olduğu gibi kalır. **Sınır:** bu bir yapı yardımıdır,
güvenlik sınırı değildir. Sınır, bloğun çevresindeki çit ve iki kısmın da veri
olduğunu söyleyen sistem cümlesidir; yükün parantezsiz yazdığı bir başlık
yeniden yazılmaz.

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
değişebilen bir ad güven sınırı değildir. **W21:** `localhost.localdomain`
da artık yerel sayılmaz: ayrılmış bir ad değildir ve hedef sistemlerde ağdaki
DNS sunucusuna sorulur, yani adresi o sunucu belirler. Yalnız `localhost` ve
loopback IP adresleri (`127.0.0.0/8`, `[::1]`, tam olarak `0.0.0.0`)
`LOCAL_PROCESS`'tir. **W21 (R2-31):** `0.0.0.0/8` bloğunun geri kalanı
(`0.1.2.3`, `[::ffff:0.8.8.8]` gibi) artık bu bilgisayar sayılmaz: bu adresler
"bu ağ" anlamına gelir, Linux 5.3 ve sonrası onları sıradan adres gibi
yönlendirir ve istem varsayılan ağ geçidinden dışarı çıkabilir. Dış adres gibi
sınıflanırlar; `LOCAL_ONLY` altında hem yerel üretim hem de gömme uç noktası
reddedilir. Böyle bir
ad reddedildiğinde sağlıktaki (`localAi.reason`, `aiPolicy.localModel.reasonTr`)
ve açılış günlüğündeki gerekçe ne yazılması gerektiğini de söyler (`localhost`
ya da `127.0.0.1`); `CLOUD_ALLOWED` altında adres dışarıdaki bir servis olarak
kabul edilir ve aynı cümle uyarı olarak düşer.

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

**W21 (R2-30):** `COLLEX_DATA_BOUNDARY`, `COLLEX_AI_POLICY` gibi okunur.
Büyük/küçük harf, boşluk ve `-` affedilir: `LOCAL-ONLY` ve `local only`
`LOCAL_ONLY` demektir. Boş ya da hiç yazılmamış ayar varsayılanı (`ALLOW_CLOUD`)
korur. Bunların dışındaki her değer (`LOCALONLY`, `yes`, bir yazım hatası)
**güvenli tarafta kalır**: yalnız yerel çalışma (`LOCAL_ONLY`) seçilir ve
sağlıkta (`aiPolicy.warnings`) "Veri sınırı ayarı tanınmadı; güvenli tarafta
kalmak için yalnız yerel çalışma seçildi." uyarısı görünür. Eskiden böyle bir
değer sessizce `ALLOW_CLOUD` oluyordu; oysa operatör bir sınır yazmıştı.

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

## Yapay zekâ ilkesi (W21)

`COLLEX_AI_POLICY`, uygulamanın tamamında yapay zekâ kullanımını belirler.
`COLLEX_DATA_BOUNDARY` ile birleşir; sunucu ikisini açılışta bir kez çözer.

| İlke | Cevaplar | Dosya incelemesi (model gerektiren görevler) |
|---|---|---|
| `LOCAL_ONLY` | Yalnız bu bilgisayardaki ya da kendi ağınızdaki (listeli) model. Model yoksa kural tabanlı cevap ve `MODEL_UNAVAILABLE`. Bulut istense de reddedilir. | Yalnız yerel model |
| `LOCAL_PREFERRED` (varsayılan; `AUTO` aynı anlama gelir) | Yerel model varsa o kullanılır. Bulut yalnız o istek için ayrı onayla ve veri sınırı izin veriyorsa. | Yalnız yerel model |
| `CLOUD_ALLOWED` | Onaylı istekte bulut. Yerel ayara dışarıdaki bir adres yazılmışsa o da yalnız onaylı istekte kullanılır ve uyarı "dış bir sunucu yazdı" der. | Yalnız yerel model; dışarıdaki model dosya incelemesinde asla kullanılmaz |
| `DETERMINISTIC_ONLY` | Her zaman kural tabanlı | Reddedilir (`AI_POLICY_DETERMINISTIC`); çelişkiler ve kronoloji çalışır |

**Kurallar:**

- **Yerelden buluta sessiz geçiş yoktur.** Yerel model yoksa ya da cevap
  vermezse bu söylenir; dosya dışarı gönderilmez.
- **Karar hiçbir porta dokunulmadan verilir.** Betikli uçlarla ölçüldü:
  `LOCAL_ONLY` altında 7 giriş yolunda bulut çağrısı 0.
- **Dosya incelemesinde istek başına onay yoktur.** Bu yüzden model
  gerektiren görevler yalnız iki rol de (çıkarım ve değerlendirme) bu
  bilgisayarda ya da kendi ağınızda çalışıyorsa yürür.
- **Neden kodla söylenir.** Sağlıkta `aiPolicy.modelTasks`, dosya
  incelemesinin yetenek cevabında `model.code` ve 409 mesajında:
  - `AI_POLICY_DETERMINISTIC`;
  - `MODEL_UNAVAILABLE` — kullanılabilir yerel model yok (hiç ayarlanmamış
    ya da ayarlı adres güven kurallarını geçmemiş; ikincisinde sağlık
    gerekçeyi de söyler);
  - `MODEL_OFF_MACHINE` — model dışarıda. W21: `LOCAL_ONLY` ilkesi ya da
    `COLLEX_DATA_BOUNDARY=LOCAL_ONLY` altında reddedilen dış adres de böyle
    adlandırılır; "ayarlı model yok" denmez.
- **Cevapta da aynı neden söylenir (W21).** `useLocalAi` isteyen bir cevapta
  `LOCAL_AI_UNAVAILABLE` uyarısı dört durumdan birini söyler: model hiç
  ayarlı değil ("yapılandırılmadığı için"); ayarlı model dışarıda ve ilke ya
  da veri sınırı izin vermiyor ("yapay zekâ ilkesi dışarıdaki servislere
  izin vermediği için"); ayarlı model dışarıda ve bu istek onay vermedi
  (`CLOUD_ALLOWED`); ayarlı adres güven kurallarını geçmedi. `LOCAL_ONLY`
  altında `MODEL_UNAVAILABLE` uyarısı da modelin dışarıda olduğunu söyler.

## Sağlıkta nasıl görünür

`/v1/health` içindeki `localAi` bloğu üç durumdan birini söyler:
`not_configured`, `refused` (adres güven kurallarını geçmedi, gerekçesiyle)
ve `configured`. **`configured`, "çalışıyor" demek değildir** —
`liveTested` her zaman `false`'tur, çünkü sağlık uç noktası her yoklamada
modeli araması gereken bir yük üreticisi olmamalıdır. Erişilebilirlik ayrı
bir ölçümdür ve yukarıdaki betikle yapılır.

W21'den beri `/v1/health` ayrıca `aiPolicy` bloğunu verir:

- etkin ve ayarlanan ilke, etkin veri sınırı;
- yerel modelin durumu ve nerede çalıştığı (`where`);
- yerel modelin cevaplarda ve dosya incelemesinde kullanılabilir olup
  olmadığı;
- bulutun izinli olup olmadığı;
- `modelTasks` kararı.

`dataBoundary` artık **etkin** sınırı gösterir: ilke `LOCAL_ONLY` ya da
`DETERMINISTIC_ONLY` ise değer `LOCAL_ONLY`'dir.
