# Bağımsız Yargı + Mevzuat MCP

Kişisel olarak barındırılabilen tek bir FastMCP sunucusunda Türk içtihat,
kurum kararı ve mevzuat araçlarını birleştirir. Herhangi bir Yargı PRO
barındırma hizmetine bağlı değildir.
Kurulum, MCP istemcisi bağlantısı, tüm araç grupları ve örnek araştırma
akışları için `KULLANIM-REHBERI.md` dosyasına bakın.


Bu çalışma şu MIT lisanslı projeleri temel alır:

- `saidsurucu/yargi-mcp` — Said Sürücü, içtihat ve kurum kararları
- `saidsurucu/mevzuat-mcp` — Said Sürücü, mevzuat arama

Orijinal telif ve MIT lisans metni `LICENSE` dosyasında korunmuştur.

## Kapsam

- Bedesten: Yargıtay, Danıştay, yerel hukuk, istinaf hukuk ve KYB
- Anayasa Mahkemesi, Emsal/UYAP, Uyuşmazlık Mahkemesi, Sayıştay, KİK,
  Rekabet Kurumu, KVKK, BDDK, BTK, GİB ve Sigorta Tahkim
- Kanun, KHK, tüzük, tebliğ, yönetmelik ve Cumhurbaşkanlığı mevzuatı
- Tüm araçlar tek MCP bağlantısında, özgün araç adları korunarak sunulur

## Kurulum

Python 3.11–3.13 ve `uv` gereklidir. Python 3.14 henüz bazı PDF
bağımlılıkları tarafından desteklenmediğinden kullanılmamalıdır.

```powershell
uv sync --python 3.13
uv run playwright install chromium
Copy-Item .env.example .env
```

Linux/macOS:

```bash
uv sync --python 3.12
uv run playwright install chromium
cp .env.example .env
```

Mevzuat araçları varsayılan olarak Bedesten REST API'sini kullanır. Eski
mevzuat.gov.tr Playwright fallback'i kapalıdır ve yalnızca açıkça istenirse
etkinleştirilir. Güncel KİK v2 istemcisi de Playwright kullanmaz; JSON API ve
imzalı `httpx` istekleri kullanır.

## Ortam değişkenleri

`.env.example` güvenli ve boş anahtarlarla gelir.

Zorunlu veya isteğe bağlı ana değişkenler:

- `MCP_API_TOKEN`: HTTP sunucusu için en az 32 karakterlik Bearer token.
- `REQUIRE_HTTP_AUTH=true`: HTTP auth varsayılan olarak zorunludur.
- `BRAVE_API_TOKEN`: Yoksa KVKK modülü açık hata mesajıyla devre dışıdır.
- `TAVILY_API_KEY`: Yoksa BDDK modülü açık hata mesajıyla devre dışıdır.
- `OPENROUTER_API_KEY`: Emsal ve mevzuat semantik araması için.
- `OPENROUTER_EMBEDDING_MODEL`: Varsayılan ücretsiz rota
  `nvidia/llama-nemotron-embed-vl-1b-v2:free`.
- `OPENROUTER_EMBEDDING_DIMENSION=2048`: Modelin çıktı boyutuyla aynı olmalı.
- `EMBEDDING_PROMPT_STYLE=raw`: Nemotron için kullanılan biçim.

OpenRouter model/ücretsiz rota durumu sağlayıcı tarafından değiştirilebilir.
Bu nedenle model adı ve boyut kod içine sabitlenmemiş, ortam değişkenleriyle
değiştirilebilir bırakılmıştır.

Hiçbir anahtar loglanmaz. `.env` Git tarafından yok sayılır.

## Emsal semantik araması

`search_emsal_detailed_decisions` şu ek parametreleri sunar:

- `semantic=true`: semantik yeniden sıralamayı açıkça etkinleştirir (varsayılan kapalıdır).
- `semantic_query`: ayrıntılı doğal dil sorgusu; boşsa `keyword` kullanılır.
- `semantic_top_k`: en fazla 10 aday döndürür.

UYAP keyword araması aday üretir. Yalnızca istenen sayfadaki en fazla 10
belge sırayla indirilir ve embedding benzerliğine göre yeniden sıralanır.
Embedding yapılandırılmamışsa keyword sonuçları korunur ve semantik durum
alanında neden kapalı olduğu bildirilir.

Örnek:

```text
keyword="muris muvazaası"
semantic=true
semantic_query="Mirasçılardan mal kaçırmak için yapılan görünürde satışın tapu iptali"
```

## Rate limit

Mahkeme Bedesten istemcisi, mevzuat Bedesten istemcisi ve Bedesten health
check aynı süreç-içi token bucket'ı paylaşır:

- `BEDESTEN_RATE_CAPACITY=1`
- `BEDESTEN_RATE_REFILL_S=6.5`
- `BEDESTEN_RATE_MAX_WAIT_S=65.0`

Gerçek HTTP 429 cevabında `Retry-After` uygulanır; başlık yoksa 30 saniye
kabul edilir. İstemci bekledikten sonra yalnızca bir kez retry yapar ve gerekirse sade bir
`Rate limited; X saniye sonra tekrar dene.` cevabı üretir.

Birden fazla worker veya container aynı kaynak IP'yi kullanıyorsa süreç-içi
kovalar birbirini göremez. Bu nedenle Bedesten kullanan dağıtımlarda tek
worker önerilir.

## Çalıştırma

Yerel stdio MCP:

```powershell
uv run yargi-mevzuat-mcp
```

HTTP sunucusu için önce `.env` içinde güçlü bir `MCP_API_TOKEN` belirleyin:

```powershell
uv run uvicorn app:app --host 0.0.0.0 --port 8000
```

MCP endpoint'i `http://localhost:8000/mcp/` adresindedir ve şu başlığı
zorunlu tutar:

```text
Authorization: Bearer <MCP_API_TOKEN>
```

Yalnızca `/health` auth dışında tutulmuştur. Auth'u kapatmak için açıkça
`REQUIRE_HTTP_AUTH=false` ayarlanması gerekir; dışa açık sunucularda bunu
kullanmayın.

## Docker

```bash
docker build -t yargi-mevzuat-mcp .
docker run --env-file .env -p 8000:8000 yargi-mevzuat-mcp
```

Docker imajı Chromium'u kurar. Kişisel anahtarlar imaja kopyalanmaz; yalnızca
çalıştırma anında `--env-file` ile verilir.
