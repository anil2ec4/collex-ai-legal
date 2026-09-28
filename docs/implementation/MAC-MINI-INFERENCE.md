# M2 Mac mini (8 GB) — yerel çıkarım cihazı kurulum ve ölçüm rehberi (W20)

> **28.09.2026 — kurulum betiği:** bu belgedeki adımlar artık `deploy/beyin/collex-beyin.sh kur` (Mac) ve `ColleX-Beyin-Bagla.cmd` (Windows) ile tek komuttur; bağlantı ev ağı yerine **Tailscale** adresi üzerindendir (100.64.0.0/10, `endpointTrust.ts` bunu özel ağ sayar ve yine açık liste ister). Dışarıdan erişim: `ColleX-Uzak-Erisim.cmd` + `deploy/beyin/ColleX-Uzaktan.command`. Hiçbiri gerçek cihazda çalıştırılmadı (STATUS W23-22).

> **W21 — bu belge bir ARA ÇÖZÜMDÜR.** Burada anlatılan yerleşim
> (Windows ana makine + yerel ağdaki Mac'te yalnız dil modeli) yalnız
> geliştirme döneminde kullanılabilecek geçici bir seçenektir. **Nihai
> üretim yerleşimi** farklıdır: ColleX'in tamamı (konsol, kontrol düzlemi,
> PostgreSQL, MCP ve belge alma, işçiler, dosya deposu, gömme, dosya
> incelemesi, OCR ve yerel dil modeli) **tek bir M2 Mac mini** üzerinde
> çalışır ve model **aynı Mac'te `127.0.0.1`'e** bağlanır (güven düzeyi
> `LOCAL_PROCESS`); o yerleşimde yerel ağ adresi,
> `COLLEX_TRUSTED_LOCAL_HOSTS`, `pf` kuralı ve ağ parolası gerekmez.
> Nihai tasarım: [MAC-MINI-PRODUCTION.md](MAC-MINI-PRODUCTION.md). Taşıma:
> [WINDOWS-TO-MAC-MIGRATION.md](WINDOWS-TO-MAC-MIGRATION.md). Yedek:
> [BACKUP-RESTORE.md](BACKUP-RESTORE.md). Aşağıdaki bölümler ara yerleşim
> için doğru kalır; hiçbiri fiziksel bir Mac'te doğrulanmadı.

> **Durum (11.09.2026):** Bu belgedeki hiçbir performans değeri ÖLÇÜLMEDİ.
> Mac mini üzerinde henüz hiçbir komut çalıştırılmadı; ColleX bu cihaza hiç
> bağlanmadı. Aşağıdaki sayılar yalnız **ayar**dır (bağlam, eşzamanlılık, zaman
> aşımı). Ölçüm, bu rehberin 6. adımındaki komutlar çalıştırıldığında ortaya
> çıkar ve `STATUS.md`'ye ancak o zaman yazılır.

## Rol dağılımı (ara geliştirme yerleşimi)

| Makine | Görev |
|---|---|
| **Windows (ana makine)** | ColleX'in tamamı: PostgreSQL, kontrol düzlemi (`serve.mjs`), belge alma, yerel E5 gömme sunucusu, konsol. Belgeler burada kalır. |
| **M2 Mac mini (8 GB)** | Yalnız **dil modeli çıkarımı**: OpenAI uyumlu `POST /v1/chat/completions` ucu. Veritabanı yok, belge deposu yok. ColleX ona yalnız o anki işin metnini gönderir (dosya incelemesinde bir bölüm, cevapta kanıt pasajları) — her zaman çitlenmiş "güvenilmeyen veri" olarak. |

ColleX tarafında hiçbir model adı sabit değildir. Model bir ayardır ve
seçimi `evals/bakeoff` ölçümüne bırakılır (aşağıda 6. adım).

## 1. Mac'te çıkarım sunucusu

İki yaygın, OpenAI uyumlu seçenek (ColleX ikisini de aynı bağdaştırıcıyla
konuşur). `192.168.1.50` yerine Mac'in **kendi yerel ağ adresini** yazın:

```bash
ipconfig getifaddr en0
```

**A — llama.cpp `llama-server`** (parola destekler; önerilen)

```bash
brew install llama.cpp
openssl rand -hex 24 > ~/.collex-llm-key && chmod 600 ~/.collex-llm-key
# GGUF model dosyasını kendiniz indirip doğrulayın; bu rehber model seçmez.
llama-server --model ~/models/<model>.gguf --host 192.168.1.50 --port 8080 --ctx-size 8192 --parallel 1 --api-key "$(cat ~/.collex-llm-key)"
```

**B — Ollama** (kendi API'si parola desteklemez; erişimi yalnız güvenlik
duvarı kısıtlar)

```bash
brew install ollama
OLLAMA_HOST=192.168.1.50:11434 OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 ollama serve
```

```bash
ollama pull <model>
```

Notlar:
- `0.0.0.0`'a bağlamayın: sunucu yalnız tek bir yerel ağ adresinde dinlesin.
- 8 GB birleşik bellekte **aynı anda tek istek** (`--parallel 1` /
  `OLLAMA_NUM_PARALLEL=1`) ve **tek yüklü model** tutun. ColleX de uca aynı
  anda tek istek gönderir (`COLLEX_LOCAL_LLM_CONCURRENCY`, varsayılan 1;
  bütün roller aynı kuyruğu paylaşır).

## 2. Kimlik doğrulama

- llama.cpp'nin `--api-key` parolasını Windows'ta `COLLEX_LOCAL_LLM_API_KEY`
  olarak ayarlayın (4. adım). ColleX parolayı nesnenin dışında tutar; sağlık
  ekranında, günlüklerde ve hata iletilerinde görünmez.
- Parolayı ekrana basmadan Windows'a taşıyın (örneğin Mac'te
  `pbcopy < ~/.collex-llm-key`, Windows'ta `.env` dosyasına yapıştırın).

## 3. Güvenlik duvarı (Mac)

- *Sistem Ayarları › Ağ › Güvenlik Duvarı*: açık.
- Yalnız Windows makinesinin adresinden (`192.168.1.20` yerine kendi
  adresini yazın) gelen bağlantıya izin veren bir `pf` kuralı:

```bash
printf 'pass in quick proto tcp from 192.168.1.20 to any port {8080, 11434}\nblock in quick proto tcp from any to any port {8080, 11434}\n' | sudo tee /etc/pf.anchors/collex
```

```bash
printf 'anchor "collex"\nload anchor "collex" from "/etc/pf.anchors/collex"\n' | sudo tee -a /etc/pf.conf
```

```bash
sudo pfctl -f /etc/pf.conf && sudo pfctl -e
```

`pfctl -e` yeniden başlatmadan sonra tekrar gerekebilir; `sudo pfctl -s rules`
kuralların yüklü olduğunu gösterir.

## 4. Windows tarafı (ColleX)

`.env` dosyanıza (değerleri kendiniz yazın):

```
COLLEX_LOCAL_LLM_BASE_URL=http://192.168.1.50:8080
COLLEX_LOCAL_LLM_MODEL=<sunucunun tanıdığı model adı>
COLLEX_TRUSTED_LOCAL_HOSTS=192.168.1.50:8080
COLLEX_DATA_BOUNDARY=LOCAL_ONLY
COLLEX_LOCAL_LLM_API_KEY=<parola>
# isteğe bağlı rol ayrımı (aynı uç, farklı model):
# COLLEX_LOCAL_LLM_MODEL_EXTRACTION=<model>
# COLLEX_LOCAL_LLM_MODEL_SYNTHESIS=<model>
# COLLEX_LOCAL_LLM_TIMEOUT_MS=120000
```

Sınırlar (kod tarafından zorlanır, ayarla gevşetilemez):
- Yerel ağ adresi **yalnız** `COLLEX_TRUSTED_LOCAL_HOSTS` listesindeyse
  kabul edilir; alan adı (DNS) her zaman BULUT sayılır ve `LOCAL_ONLY`
  altında reddedilir.
- `LOCAL_ONLY` altında bulut yapay zekâsı hiçbir yoldan çağrılmaz:
  `useCloudAi` istekleri bulut koduna ulaşmadan reddedilir, `/v1/ai/*`
  POST'ları 403 döner, bulut gömme sağlayıcısı kapatılır.
- Yerel uç ulaşılamazsa **buluta düşülmez**: cevap kural tabanlı taslakçıda
  kalır (`LOCAL_DRAFTER_FALLBACK`); dosya incelemesinin model gerektiren
  bölümleri "incelenemedi" sayılır ve kapsam eksik görünür.
- W21: `COLLEX_AI_POLICY=LOCAL_ONLY` aynı sınırı uygulama düzeyinde de
  zorlar (`control-plane/src/llm/aiPolicy.ts`); veri sınırıyla birlikte
  **daha sıkı olan** geçerlidir. Politika verilmezse varsayılan
  `LOCAL_PREFERRED`'dır.

ColleX'i yeniden başlatın (`ColleX-Durdur.cmd`, sonra `ColleX-Baslat.cmd`).

## 5. Sağlık denetimi

Mac'te (llama.cpp):

```bash
curl -s http://192.168.1.50:8080/v1/models -H "Authorization: Bearer $(cat ~/.collex-llm-key)"
```

Mac'te (Ollama):

```bash
curl -s http://192.168.1.50:11434/api/ps
```

Windows'ta:

```bash
curl -s http://127.0.0.1:8787/v1/health
```

Beklenen: `localAi.state` = `"configured"`, `localAi.trust` =
`"TRUSTED_LOCAL_NETWORK"`, `localAi.roles` dört rolün modelini gösterir,
`localAi.liveTested` = `false` (sağlık ucu modeli çağırmaz; canlı ölçüm
6. adımdadır).
W21: aynı bilgi üst düzey `aiPolicy` bloğunda da görünür —
`aiPolicy.localModel.trust` = `"TRUSTED_LOCAL_NETWORK"`,
`aiPolicy.localModel.usableForMatterAnalysis` = `true` (kendi ağınızdaki
model dosya incelemesinde kullanılabilir), `aiPolicy.localModel.liveTested`
= `false`.

## 6. ÖLÇÜM — çalıştırılması gereken komutlar

Bu adım yapılmadan hiçbir hız, bellek ya da kalite sayısı yazılmaz. Aşağıdaki
iki betik `.env` dosyasını **okumaz**; değişkenleri komutu çalıştırdığınız
terminalde ayarlayın. PowerShell'de (parolayı kendiniz yazın; bu değişkenler
yalnız o terminal penceresi açık kaldıkça geçerlidir):

```powershell
$env:COLLEX_LOCAL_LLM_BASE_URL = "http://192.168.1.50:8080"; $env:COLLEX_TRUSTED_LOCAL_HOSTS = "192.168.1.50:8080"; $env:COLLEX_DATA_BOUNDARY = "LOCAL_ONLY"; $env:COLLEX_LOCAL_LLM_API_KEY = "<parola>"
```

**6a. Tek çağrı gecikmesi ve JSON geçerliliği** (Windows'tan, Mac'e; parola
`COLLEX_LOCAL_LLM_API_KEY` ortam değişkeninden okunur, ekrana basılmaz):

```bash
node control-plane/scripts/probe_local_generation.mjs --base-url http://192.168.1.50:8080 --model <model> --runs 20
```

**6b. Model karşılaştırması** (ürünün kullandığı sağlayıcı fabrikasından ve
sınır denetimlerinden geçer). İstekteki model adı, cevabı hangi modelin
verdiğini kanıtlamaz. Bu yüzden betik ölçümden önce uç noktanın model
listesini (`/v1/models`, aynı parola ile) okur. `--models` adlarından biri
listede yoksa ölçüm yapmaz, rapor yazmaz (çıkış kodu 2).

**llama-server (seçenek A) tek model sunar** ve istekteki adı yok sayar: aynı
sunucuya iki ad vermek, iki satırda aynı modeli ölçmek olurdu; betik bunu
reddeder. Her model için sunucuyu o modelin GGUF dosyası ve `--alias` ile
yeniden başlatın ve betiği yalnız o adla çalıştırın. Aynı gün yapılan iki
çalıştırma aynı rapor adını kullanır; bu yüzden her modele ayrı `--out`
klasörü verin (model adında ":" olabilir, klasör adında kullanmayın):

```bash
# Mac'te (önce A modeli)
llama-server --model ~/models/<modelA>.gguf --alias <modelA> --host 192.168.1.50 --port 8080 --ctx-size 8192 --parallel 1 --api-key "$(cat ~/.collex-llm-key)"
```

```bash
# Windows'ta
node control-plane/scripts/bakeoff.mjs --models <modelA> --out evals/reports/bakeoff-a
```

Ardından sunucuyu `<modelB>` dosyası ve `--alias <modelB>` ile yeniden
başlatıp aynı komutu `--models <modelB> --out evals/reports/bakeoff-b`
ile tekrarlayın.

Birden çok modeli adıyla seçerek sunan bir uç kullanıyorsanız (Ollama, ya da
llama-swap gibi adla model yükleyen bir ara sunucu) tek komut yeter; her aday
model o uçta yüklü olmalıdır:

```bash
node control-plane/scripts/bakeoff.mjs --models <modelA>,<modelB>
```

Ollama kullanıyorsanız ve taban adres Ollama'nınkiyse
(`http://192.168.1.50:11434`), modelin bellek kullanımı da kaydedilir:

```bash
node control-plane/scripts/bakeoff.mjs --models <modelA>,<modelB> --memory-probe ollama
```

Model listesi okunamazsa ölçüm yapılır, ama raporda model adları
"doğrulanmadı" diye işaretlenir: o satırların hangi modeli ölçtüğü
kanıtlanmamıştır.

Rapor `evals/reports/bakeoff-<tarih>.{json,md}` olarak yazılır: yapı
geçerliliği, çıkarım duyarlılığı/kesinliği, alıntı geçerliliği, çelişki ve
destek doğruluğu, terim kapsamı, talimata uyum (sentetik, onaylı, bekleyen ve
tartışmalı vakalar için ayrı tablolarda), p50/p95 gecikme (süre aşımına
uğrayan vaka alt sınır olarak, "≥"), token sayıları ve başarısızlık oranı.
**Rapor kazanan seçmez.** Yalnız sentetik vakalarla yapılan ölçüm hukukî
kalite için yeterli değildir; avukat vakaları için
`evals/bakeoff/GOLD_FORMAT.md`.

**6c. Mac'te bellek ve güç gözlemi** (bake-off sürerken Mac'te ayrı
pencerelerde):

```bash
sudo powermetrics --samplers cpu_power,gpu_power -i 2000 -n 30 > ~/collex-powermetrics.txt
```

```bash
vm_stat 2 > ~/collex-vmstat.txt
```

**6d. Gerçek bir dosya incelemesi** (Windows'ta, konsoldan): Dosyalarım ›
bir dosya › *Dosya incelemesi* › *İddia ve delilleri eşleştir*. Süre, işlenen
bölüm sayısı ve reddedilen alıntı sayısı inceleme kaydında görünür
(`GET /v1/matters/{id}/analysis/{runId}`).

Sonuçları (sayıları, komutun kendisini ve tarihi) `docs/implementation/STATUS.md`
W20 bölümüne ekleyin.
