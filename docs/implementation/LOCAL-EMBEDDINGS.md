# Yerel semantik çıkarım — 09.09.2026

Durum: **yerel çıkarım servisi kaynak aramasına ve ana araştırmanın pasaj seçimine bağlı; bağımsız kalite doğrulaması açık**. Bu bileşen metin üretmez, OCR yapmaz ve doğrulama eşiklerini değiştirmez. `relatedSearch` belge sıralamasında, `researchService` ise getirilen belgelerin aday pasajlarını seçmekte kullanır. Son entegrasyon ve gerçek denemenin bulguları `SEMANTIC-PASSAGES.md` içindedir.

## Kaynak ve kurulum

[Resmî model deposu](https://huggingface.co/intfloat/multilingual-e5-small/tree/main/onnx), MIT lisanslı multilingual E5-small. Sabit sürüm `614241f622f53c4eeff9890bdc4f31cfecc418b3`. 118.346.824 bayt ONNX ve 17.082.730 bayt tokenizer verisi; yayıncının SHA-256 değerleri `semantic_search/local_embedding_assets.py` içinde kayıtlı. İndirmede ve modeli açmadan önce boyut/hash doğrulanır. Model deposundan Python kodu çalıştırılmaz.

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-local-embeddings.txt
.venv/Scripts/python.exe scripts/prepare_local_embeddings.py
.venv/Scripts/python.exe -m semantic_search.local_embedding_server --port 8898
```

İndirme yalnız açık kurulum komutunda olur. Çıkarım ağdan model indirmez, metinleri başka sağlayıcıya göndermez. Sunucu yalnız `127.0.0.1` dinler. Dış Origin ve yanlış Host reddedilir; eşzamanlı ikinci hesaplama 429 alır. Bir HTTP isteği en çok 41 metin taşır; bunlar en çok 16'lık gruplarda işlenir. Vektör boyutu 384, model girdisi en çok 512 token. Padding hariç ortalama ve L2 normalizasyonu uygulanır; boş/bozuk vektör reddedilir. Süre veya benzerlik puanı hukukî doğruluk olasılığı değildir.

Model servisi çalışırken uygulamayı yalnız kaynak aramasını etkinleştiren seçenekle başlatın. MCP için farklı bir port kullanın:

```powershell
$env:COLLEX_NO_DOTENV='1'
node control-plane/scripts/serve.mjs --with-mcp --mcp-port 8899 --local-embeddings-port 8898
```

Ürün başlatıcısı bu yaşam döngüsünü artık kendisi yönetir. `ColleX-Baslat.cmd`
MCP'yi 8898'de, yerel E5 servisini 8899'da başlatır; `ColleX-Durdur.cmd`
sunucuyu nazikçe kapatırken modeli de sonlandırır. Elle çalıştırma veya başka
bir port gerekiyorsa `--with-local-embeddings` seçeneği model servisinin
başlatılmasını `serve.mjs`'e devreder:

```powershell
$env:COLLEX_NO_DOTENV='1'
node control-plane/scripts/serve.mjs --with-mcp --with-local-embeddings --local-embeddings-port 8899
```

Portta zaten loopback servisi varsa yeniden kullanılır. Model dosyaları yoksa
veya servis açılamazsa uygulama yine açılır; ana araştırma bunu hazırmış gibi
göstermeden lexical adaylara döner. 8899 gibi varsayılan port başka bir
servisle doluysa başlatıcı 20 portluk loopback aralığında boş bir porta geçer;
MCP ve HTTP portları bu seçimden dışlanır.

Bu seçenek `createApp → sources router → relatedSearch` yoluna yerel model ayarını aktarır. `/v1/sources/related` isteğinde `rerank:true` gerekir. Ortam değişkenlerini değiştirmez; MCP çocuğuna embedding ayarı aktarmaz. Ortak süreç ortamına `EMBEDDING_PROVIDER=local` koymayın: Python tarafında ek araç kaydını açabilir ve 54 araçlık sözleşmeyi değiştirebilir. Geçersiz veya çakışan port açılışta reddedilir; MCP için alternatif port aranırken uygulama ve model portları atlanır. Model servisi kapalıysa mevcut hata/fallback davranışı geçerlidir; anlamsal sıralama yapılmış gibi gösterilmez.

Kullanıcı `.env` dosyasına yazılmadı; varsayılan uzak sağlayıcı değiştirilmedi. Model servisi yalnız açık `--with-local-embeddings` seçeneğiyle veya ürün başlatıcısıyla çalışır; kaynak araması ve ana araştırmanın lexical fallback'i model kapalıyken korunur. Bu oturumda eksik `tokenizers==0.23.2` ve bağımlılıkları kuruldu; yükleyicinin yükselttiği `click`, önceki `8.3.1` sürümüne geri getirildi. `onnxruntime==1.20.1` zaten ortamdaydı.

## Ölçüm ve sınırlar

Gerçek TypeScript `createEmbeddingPort` → yerel FastAPI → CPU ONNX → TypeScript dönüşü, üç sentetik metin/384 boyutla başarılı. Sıcak serviste yaklaşık 58 ms ölçüldü; bu bir genel performans garantisi değildir. Komut: `node control-plane/scripts/probe-local-embedding-port.mjs`.

Daha önce tek tek okunmuş 12 gerçek karar üzerinde tek bir fazla çalışma/ispat sorusu kullanıldı. Bunlar ajan tarafından seçilmiş/etiketlenmiş örneklerdir; kör veya bağımsız avukat değerlendirmesi değildir.

| Deneme | Önce doğrudan ilgili sanılan iki kararın sırası | Çıkarım süresi |
|---|---|---|
| Belgenin başı, en çok 512 token | 1 ve 7 | 2,52 sn |
| Tam metinden örtüşen 1200 karakterlik pasajlar, en yüksek benzerlik | 1 ve 3 | 7,31 sn |

10.09 yeniden inceleme: bu iki kararın (`1224717400`, `1224719800`) gerekçesi özel ispat sorusunu açıklamayan genel onama içeriyor. Etiketleri konuya ilişkin/dolaylı olarak düzeltildi; önceki doğrudan ilgililik yorumu geri çekildi. Yukarıdaki sıra değişimi ölçülmüş olsa da hukukî kalite artışı kanıtı değildir. Bu 12 karar içinde artık özel ispat sorusu için doğrulanmış olumlu örnek yok; bu örneklemden ilgili kararı bulma başarısı çıkarılamaz. Raporlar `var/audit-20260907/local-semantic-probe.json` ve `local-semantic-window-probe.json`; komut `scripts/probe_local_embeddings.py [--windowed]`.

18 birim/API kontrolü yerel sözleşmeyi sınar. Yedi davranış mutasyonu yakalandı. İlk boş-mask guard-negation mutasyonu diğer geçersiz-vektör koruması nedeniyle eşdeğer kaldı; anlamlı “boş girdiye sahte vektör döndür” mutasyonu test tarafından yakalandı. Bu çalışma bütün test envanterinin mutasyon denetimi değildir.

Sıradaki işler: farklı hukuk konularında bağımsız değerlendirme ve modelin
hukukî isabetini ölçmek. Yerel OCR ayrı ve hâlâ açık.

## Uygulama doğrulaması — 09.09.2026, 22:05–22:10

Gerçek HTTP isteği 10 Yargıtay kararını getirdi ve semantik sıralama uyguladı (`var/audit-20260907/local-semantic-http.json`). Ardından tarayıcıdan Araştır → Hazır işler → Olayı anlat, ilgili kararları bul yolunda Yargıtay, 3 arama ve “Anlam benzerliğine göre sırala” seçildi. 81,6 saniyede 27 karar döndü; ilk 10 kararın karşılaştırıldığı, kalanların mutabakat sırasını koruduğu ekranda görüldü. İlk iki satır 9. Hukuk Dairesiydi; bu gözlem tek başına kararların somut soruyu cevapladığını kanıtlamaz.

O tarihteki sözel benzerlik eşikleri (`yakın ≥ 0.75`) modele göre kalibre edilmemişti; karşılaştırılan 10 kararın tamamı “yakın” etiketi aldı. 10.09 düzeltmesi yerel E5 için bu etiketleri kaldırdı ve nedenini açıklıyor. Genel metin benzerliğinin hukukî ilgililikten ayrılması hâlâ gereklidir. Ana araştırma artık aday pasajları karşılaştırır; kaynak aramasının belge sıralaması hâlâ metnin başını kullanır.

Tip denetimi temiz; tam TypeScript 2547 geçti / 6 mevcut atlama; tam Python 1420 geçti (152,60 sn); 4 yeni bağlantı mutasyonu yakalandı; MCP smoke 54 araç, DB 19/19, `demo --keep` 6/6 senaryo / 47/47 kontrol. Dört tekrarlı sentetik değerlendirme aynı dağılımı korudu: 17/21 kesinleştirilebilir, 0 yanlış cevap, 1 yanlış çekimser. Raporlar `var/audit-20260907/{vitest-local-wiring.json,pytest-local-wiring.log,db-local-wiring.log,evals-local-wiring/,demo-local-wiring/}`. Sentetik değerlendirme yerel modelin hukukî kalite testi değildir.
