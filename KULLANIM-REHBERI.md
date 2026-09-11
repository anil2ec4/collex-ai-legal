# Bağımsız Yargı + Mevzuat MCP Kullanım Rehberi

Bu rehber sunucunun yerel `stdio` veya auth korumalı HTTP üzerinden kurulmasını,
MCP istemcisine bağlanmasını ve araçların hangi sırayla kullanılmasını açıklar.

> Bu yazılım hukuki araştırmayı kolaylaştırır; hukuki görüş veya resmi kaynak
> doğrulamasının yerine geçmez. Kritik sonuçları kararın/mevzuatın resmi tam
> metni ve güncellik bilgisiyle ayrıca kontrol edin.

Günlük avukat kullanımı için önce [ColleX ekran kullanım kılavuzuna](docs/KULLANIM-ColleX.md) bakın. Bu dosyanın devamı, MCP istemcisiyle teknik bağlantı kuracak kişiler içindir.

## 1. Sunucu neler sunar?

Tek MCP bağlantısında, embedding anahtarı yokken 54 araç bulunur. OpenRouter
embedding yapılandırılırsa Bedesten semantik aracı da kaydedilir ve sayı 55 olur.

### Bedesten içtihat türleri

`search_bedesten_unified` tek çağrı arayüzünden şu beş kodu kabul eder:

- `YARGITAYKARARI`: Yargıtay
- `DANISTAYKARAR`: Danıştay
- `YERELHUKUK`: Yerel hukuk mahkemeleri
- `ISTINAFHUKUK`: Bölge adliye/istinaf hukuk kararları
- `KYB`: Kanun yararına bozma

Arama sonucu içindeki `documentId`, `get_bedesten_document_markdown` aracına
verilerek tam metin alınır.

### Ayrı kurum araçları

| Kurum | Arama aracı | Belge aracı |
|---|---|---|
| Anayasa Mahkemesi | `search_anayasa_unified` | `get_anayasa_document_unified` |
| Emsal/UYAP | `search_emsal_detailed_decisions` | `get_emsal_document_markdown` |
| Uyuşmazlık Mahkemesi | `search_uyusmazlik_decisions` | `get_uyusmazlik_document_markdown_from_url` |
| Sayıştay | `search_sayistay_unified` | `get_sayistay_document_unified` |
| KİK | `search_kik_v2_decisions` | `get_kik_v2_document_markdown` |
| Rekabet Kurumu | `search_rekabet_kurumu_decisions` | `get_rekabet_kurumu_document` |
| KVKK | `search_kvkk_decisions` | `get_kvkk_document_markdown` |
| BDDK | `search_bddk_decisions` | `get_bddk_document_markdown` |
| BTK | `search_btk_decisions` | `get_btk_document_markdown` |
| GİB | `search_gib_ozelge` | `get_gib_ozelge_document_markdown` |
| Sigorta Tahkim | `search_sigorta_tahkim_decisions` | `get_sigorta_tahkim_document_markdown` |

`search` ve `fetch`, Deep Research uyumluluğu için bulunan genel araçlardır.
Normal araştırmada daha kontrollü olan kurum araçlarını veya
`search_bedesten_unified` aracını tercih edin.

### Mevzuat

Yeni Bedesten mevzuat akışı 12 türü kapsar:

- `KANUN`
- `CB_KARARNAME`
- `YONETMELIK`
- `CB_YONETMELIK`
- `CB_KARAR`
- `CB_GENELGE`
- `KHK`
- `TUZUK`
- `KKY` — kurum/kuruluş yönetmelikleri
- `UY` — üniversite yönetmelikleri
- `TEBLIGLER`
- `MULGA`

Temel akış:

1. `search_mevzuat` ile arayın ve sonuçtaki `mevzuatId` değerini alın.
2. Küçük belgede `get_mevzuat_content` ile tam metni alın.
3. Büyük belgede `search_within_mevzuat` ile yalnızca ilgili maddeleri arayın.
4. Yapıyı görmek için `get_mevzuat_madde_tree` kullanın.
5. Sonuçta `gerekceId` varsa `get_mevzuat_gerekce` ile gerekçeyi alın.

Ayrıca türlere ayrılmış klasik araçlar vardır: `search_kanun`, `search_cbk`,
`search_khk`, `search_tuzuk`, `search_teblig`, `search_kurum_yonetmelik`,
`search_cbyonetmelik`, `search_cbbaskankarar`, `search_cbgenelge` ve bunların
`search_within_*` eşleri. Bu uyumluluk araçları da varsayılan olarak Bedesten
REST yolunu kullanır. DNS sorunu yaşayan eski Playwright yolu yalnızca
`MEVZUAT_ENABLE_LEGACY_PLAYWRIGHT=true` ile açıkça etkinleştirilir.

## 2. Gereksinimler

- Python 3.11, 3.12 veya 3.13. Önerilen: Python 3.13 (Windows) veya 3.12.
- `uv` paket yöneticisi.
- Yalnız eski mevzuat.gov.tr fallback'i özellikle açılırsa Playwright Chromium.
- Semantik arama istenirse OpenRouter API anahtarı.
- KVKK için Brave Search anahtarı.
- BDDK araması için Tavily anahtarı. Sigorta Tahkim keşif araması da aynı
  `TAVILY_API_KEY` değişkenini kullanır.

Güncel KİK v2 istemcisi Playwright kullanmaz; imzalı JSON isteklerini `httpx`
ile gönderir. Normal yerel kullanımda Chromium kurulumu gerekmez.

## 3. Yerel kurulum

### Windows PowerShell

```powershell
cd C:\Users\anile\Desktop\yargı-anıl\yargi-mcp-independent
Copy-Item .env.example .env
uv sync --python 3.13
```

### Linux/macOS

```bash
cd /sunucu/yargi-mcp-independent
cp .env.example .env
uv sync --python 3.12
```

Linux sunucuda Chromium sistem kütüphaneleri de gerekiyorsa:

```bash
Eski mevzuat.gov.tr fallback'ini özellikle denemek isterseniz ayrıca:

```powershell
uv run playwright install chromium
```

uv run playwright install --with-deps chromium
```

`--with-deps` sistem paketleri kurduğu için Linux'ta yönetici yetkisi
isteyebilir. Tarayıcı binary indirmesi internet bağlantısı gerektirir.

## 4. `.env` yapılandırması

### Yalnızca yerel stdio

Stdio bağlantısında HTTP endpoint açılmaz; `MCP_API_TOKEN` kullanılmaz.
İstemediğiniz opsiyonel anahtarları boş bırakabilirsiniz:

```env
BRAVE_API_TOKEN=
TAVILY_API_KEY=
OPENROUTER_API_KEY=
```

Anahtarı olmayan KVKK ve BDDK araçları sunucuyu çökertmez; modülün devre dışı
olduğunu açıkça döndürür.

### HTTP sunucusu

En az 32 karakterlik rastgele bir token üretin. PowerShell örneği:

```powershell
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$token = [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
$rng.Dispose()
$token
```

Çıktıyı `.env` içine yazın:

```env
REQUIRE_HTTP_AUTH=true
MCP_API_TOKEN=buraya-uretilen-en-az-32-karakterlik-token
ALLOWED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
HOST=0.0.0.0
PORT=8000
```

`REQUIRE_HTTP_AUTH=false` yalnızca kapalı ve güvenilir bir yerel ağdaki geçici
test için kullanılmalıdır. İnternete açık bir endpoint'i auth'suz çalıştırmayın.

### Semantik arama

```env
OPENROUTER_API_KEY=kendi-openrouter-anahtariniz
OPENROUTER_EMBEDDING_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2:free
OPENROUTER_EMBEDDING_DIMENSION=2048
EMBEDDING_PROMPT_STYLE=raw
```

Ücretsiz rota/model durumu sağlayıcı tarafından değişebilir. Modeli
değiştirirseniz `OPENROUTER_EMBEDDING_DIMENSION` değerini modelin gerçek çıktı
boyutuyla aynı yapın. `.env` değişikliğinden sonra sunucuyu yeniden başlatın;
opsiyonel semantik aracın kaydı başlangıçta belirlenir.

Emsal semantik akışı yalnızca `semantic=true` verildiğinde çalışır. Önce UYAP
keyword aramasıyla en fazla 10 aday üretir,
belgeleri sırayla indirir ve embedding benzerliğiyle yeniden sıralar. OpenRouter
yoksa aynı araç keyword sonuçlarını korur ve semantiğin kapalı olduğunu bildirir.

Örnek parametreler:

```text
keyword: muris muvazaası
semantic: true
semantic_query: Mirasçılardan mal kaçırmak için görünürde yapılan satışın tapu iptali
semantic_top_k: 5
```

### KVKK ve BDDK

Bedesten kararları için doğrudan semantik araç örneği:

```text
initial_keyword: muvazaa
query: Miras bırakandan kalan taşınmazın görünürde satışla kaçırılması
court_types: [YARGITAYKARARI]
candidate_limit: 5
top_k: 5
```

`candidate_limit` varsayılan 5, en fazla 10'dur. Bu sınır, tam metin indirme
süresini ve resmî servise giden istek sayısını denetim altında tutar.

```env
BRAVE_API_TOKEN=kendi-brave-anahtariniz
TAVILY_API_KEY=kendi-tavily-anahtariniz
```

Anahtar değerleri loglanmaz. `.env` ve alt dizinlerdeki `.env` dosyaları Git ve
Docker build context tarafından yok sayılır.

### Bedesten hız sınırı

Güvenli varsayılanları koruyun:

```env
BEDESTEN_RATE_CAPACITY=1
BEDESTEN_RATE_REFILL_S=6.5
BEDESTEN_RATE_MAX_WAIT_S=65.0
```

Mahkeme istemcisi, mevzuat istemcisi ve Bedesten sunucu sağlık kontrolü aynı
süreç-içi kovayı paylaşır. HTTP 429 gelirse `Retry-After` uygulanır; yoksa 30
saniye kabul edilir. İstemci bu süreyi bekleyip yalnızca bir kez yeniden dener.

Birden fazla Uvicorn worker veya container kullanırsanız her süreç ayrı kova
tutar. Aynı kaynak IP'den Bedesten'e çıkan kurulumlarda tek worker kullanın.

## 5. Çalıştırma ve MCP istemcisine bağlama

### Seçenek A — stdio, kişisel masaüstü kullanım için önerilen

Claude Desktop ile Codex aynı anda ayrı stdio süreçleri açarsa süreç-içi kovalar
birbirini göremez. Yoğun Bedesten taramasını iki istemcide aynı anda başlatmayın.

Elle çalıştırma:

```powershell
uv run yargi-mevzuat-mcp
```

MCP istemcisinde genel stdio tanımı:

```json
{
  "mcpServers": {
    "yargi-mevzuat": {
      "command": "uv",
      "args": [
        "--directory",
        "C:\\Users\\anile\\Desktop\\yargı-anıl\\yargi-mcp-independent",
        "run",
        "yargi-mevzuat-mcp"
      ]
    }
  }
}
```

İstemci `cwd` destekliyorsa `--directory` yerine proje dizinini `cwd` olarak
verebilirsiniz. Anahtarları JSON'a yazmak yerine proje içindeki Git-ignore
edilmiş `.env` dosyasında tutun.

### Seçenek B — auth korumalı HTTP

```powershell
uv run uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1
```

Adresler:

- MCP: `http://127.0.0.1:8000/mcp/`
- Liveness: `http://127.0.0.1:8000/health`
- Ayrıntılı durum: `http://127.0.0.1:8000/status`

MCP ve `/status` için başlık:

```text
Authorization: Bearer <MCP_API_TOKEN>
```

PowerShell kontrolü:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/status `
  -Headers @{ Authorization = "Bearer $env:MCP_API_TOKEN" }
```

`/health` yalnızca uygulamanın yaşadığını ve araç sayısını bildirir; kurumlara
istek atmaz. MCP içindeki `check_government_servers_health` aracı ise gerçek
kurum uçlarını kontrol eder ve Bedesten çağrısında ortak rate-limit kovasını
kullanır. Bu aracı sık aralıklarla çağırmayın.

### Seçenek C — Docker

```bash
docker build -t yargi-mevzuat-mcp .
docker run --rm --env-file .env -p 8000:8000 yargi-mevzuat-mcp
```

Container tek Uvicorn worker ile başlar ve Chromium'u image build sırasında
kurar. `.env` image içine kopyalanmaz.

## 6. Önerilen araştırma akışları

### Bedesten kararı

1. `search_bedesten_unified` çağırın.
2. Gereken mahkeme kodlarını `court_types` alanında seçin.
3. Sonuçtan `documentId` alın.
4. `get_bedesten_document_markdown(documentId=...)` çağırın.

Örnek arama:

```text
phrase: "muris muvazaası"
court_types: [YARGITAYKARARI, ISTINAFHUKUK]
pageNumber: 1
birimAdi: ALL
```

### Emsal/UYAP semantik araştırma

1. `search_emsal_detailed_decisions` ile keyword ve filtreleri verin.
2. `semantic=true`, açıklayıcı `semantic_query` ve 1–10 arası
   `semantic_top_k` kullanın.
3. Sonuçtaki `id` ile `get_emsal_document_markdown` çağırın.

Semantik sıralama yalnızca o sayfadaki adayları yeniden sıralar; tüm UYAP
korpusuna karşı bir vektör veritabanı araması değildir.

### Mevzuatta belirli maddeyi bulma

```text
1. search_mevzuat(mevzuat_no="5237", mevzuat_tur="KANUN")
2. Sonuçtaki mevzuatId değerini alın.
3. search_within_mevzuat(mevzuat_id="...", keyword="kast AND taksir")
4. Gerekirse get_mevzuat_content(mevzuat_id="...", page_number=1)
5. Gerekçe varsa get_mevzuat_gerekce(gerekce_id="...", page_number=1)
6. Sonraki parçalar için page_number değerini artırın.
```

`search_mevzuat.phrase` alanında Solr/Lucene sözdizimi, `mevzuat_adi` alanında
daha sade başlık araması kullanılır. `search_within_mevzuat` içindeki Boolean
operatörlerini büyük harfle yazın: `AND`, `OR`, `NOT`.

### Kurum kararı

Kural genellikle aynıdır: önce ilgili `search_*`, sonra sonuçtaki ID veya URL
ile ilgili `get_*` aracını çağırın. Tarih biçimleri araçtan araca değişebilir;
MCP istemcisinin gösterdiği parametre açıklamasına uyun. Örneğin Emsal
`DD.MM.YYYY`, Bedesten mevzuat `DD/MM/YYYY`, bazı KİK/BTK filtreleri
`YYYY-MM-DD` kullanır.

## 7. Doğrulama ve sorun giderme

Tamamen çevrimdışı smoke testi:

```powershell
.\.venv\Scripts\python.exe scripts\smoke_check.py
```

Bu test gerçek anahtarlar `.env` içinde bulunsa bile Brave, Tavily ve
OpenRouter değişkenlerini boşaltır; kurum uçlarına istek göndermez. Şunları
doğrular:

- 54 temel aracın ve 11 kurumun temsilci araçlarının kaydı
- Beş Bedesten mahkeme kodu
- Ortak rate-limit nesnesi ve yerel token-bucket davranışı
- KVKK/BDDK anahtarsız arama ve belge hata yolları
- Sahte embedding ile Emsal yeniden sıralama
- KİK belge ID şifreleme biçimi
- `/health`, `/status` ve `/mcp/` auth davranışı

Derleme kontrolü:

```powershell
.\.venv\Scripts\python.exe -m compileall -q .
uv build --offline
```
Gerçek resmî uçları seri ve rate-limit kontrollü doğrulama:

```powershell
.\.venv\Scripts\python.exe scripts\live_regression_check.py
.\.venv\Scripts\python.exe scripts\live_remaining_check.py
```

Yapılandırılmış embedding modelinin küçük Türkçe hukuk kalite kontrolü:

```powershell
.\.venv\Scripts\python.exe scripts\embedding_quality_check.py
```

Canlı testleri paralel çalıştırmayın; gerçek kamu uçlarına istek gönderirler.


Yaygın sorunlar:

- **HTTP başlamıyor:** `MCP_API_TOKEN` en az 32 karakter olmalı.
- **Semantik araç görünmüyor:** `OPENROUTER_API_KEY` ayarlandıktan sonra süreci
  yeniden başlatın.
- **Embedding boyut hatası:** model ve `OPENROUTER_EMBEDDING_DIMENSION` uyuşmuyor.
- **Eski fallback için Chromium yok:** `uv run playwright install chromium` çalıştırın.
- **Linux tarayıcı kütüphanesi eksik:** `playwright install --with-deps chromium`.
- **KVKK devre dışı:** `BRAVE_API_TOKEN` boş.
- **BDDK/Sigorta araması devre dışı:** `TAVILY_API_KEY` boş.
- **Rate limited:** bildirilen saniye kadar bekleyin; eşzamanlı/çok worker'lı
  çağrıları azaltın.
- **Büyük mevzuat yanıtı:** tam metin yerine `search_within_mevzuat` kullanın.

## 8. Güvenlik özeti

- HTTP auth varsayılan olarak açıktır.
- Yalnızca `/health` anonimdir ve dış servise çağrı yapmaz.
- Anahtarlar kodda fallback olarak bulunmaz ve loglanmaz.
- `.env` Git/Docker dışında tutulur.
- Sunucuyu ters proxy arkasında internete açacaksanız TLS, IP kısıtlaması ve
  erişim loglarında `Authorization` başlığının maskelenmesini ayrıca sağlayın.
- Araçlar dış kurumlardan içerik okuduğu için MCP istemcisinde araç çağrılarını
  kullanıcı onayına bağlamak güvenli bir tercihtir.
