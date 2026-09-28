# ColleX: connect the ColleX on this Windows PC to the Mac mini "brain"
# (deploy/beyin/collex-beyin.sh) over Tailscale. Run by ColleX-Beyin-Bagla.cmd.
#
# ASCII only: Windows PowerShell 5.1 reads a BOM-less script in the ANSI code
# page, so any Turkish letter here would be garbled on screen.
#
# What it writes: six USER-level environment variables (never .env - no code
# path reads a key from there; CLAUDE.md). The Mac mini's address must be a
# Tailscale address and is listed EXPLICITLY in COLLEX_TRUSTED_LOCAL_HOSTS,
# the allow-list llm/endpointTrust.ts requires for any non-loopback model
# host. COLLEX_DATA_BOUNDARY=LOCAL_ONLY: no document text goes to a cloud
# model, with no silent fallback. Nothing is written until the Mac mini has
# answered with this password.

$ErrorActionPreference = 'Stop'
$port = 8080

Write-Host ''
Write-Host '[ColleX] Mac mini beyin baglantisi'
Write-Host '[ColleX] Mac mini''de "bash collex-beyin.sh kur" komutunun yazdigi adres ve parolayi girin.'
Write-Host ''

$ip = (Read-Host 'Mac mini adresi (100. ile baslar)').Trim()
if ($ip -notmatch '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.([0-9]{1,3})\.([0-9]{1,3})$') {
  Write-Host '[ColleX] Bu bir Tailscale adresi degil (100.64.x.x ile 100.127.x.x arasi olmali). Hicbir sey degistirilmedi.'
  exit 1
}
$key = (Read-Host 'Parola').Trim().ToLowerInvariant()
if ($key -notmatch '^[0-9a-f]{24,64}$') {
  Write-Host '[ColleX] Parola bicimi tanidik degil (yalniz rakam ve a-f harfleri). Hicbir sey degistirilmedi.'
  exit 1
}

$base = "http://${ip}:$port"
try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri "$base/health" | Out-Null
} catch {
  $status = $null
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  if ($status -eq 503) {
    Write-Host '[ColleX] Mac mini cevap veriyor ama model henuz yukleniyor ya da indiriliyor. Birkac dakika sonra yeniden calistirin.'
  } else {
    Write-Host '[ColleX] Mac mini cevap vermedi. Iki bilgisayarda da Tailscale acik mi, Mac mini uyanik mi,'
    Write-Host '[ColleX] orada "bash collex-beyin.sh durum" HAZIR diyor mu? Hicbir sey degistirilmedi.'
  }
  exit 1
}
try {
  Invoke-RestMethod -TimeoutSec 8 -Uri "$base/v1/models" -Headers @{ Authorization = "Bearer $key" } | Out-Null
} catch {
  Write-Host '[ColleX] Mac mini parolayi kabul etmedi. Mac mini''de "bash collex-beyin.sh anahtar" ile parolayi yeniden okuyun.'
  exit 1
}

$vars = [ordered]@{
  COLLEX_LOCAL_LLM_BASE_URL       = $base
  COLLEX_LOCAL_LLM_MODEL          = 'collex-beyin'
  COLLEX_TRUSTED_LOCAL_HOSTS      = "${ip}:$port"
  COLLEX_LOCAL_LLM_API_KEY        = $key
  COLLEX_DATA_BOUNDARY            = 'LOCAL_ONLY'
  # A 7-8B model on an 8 GB M2 is slow; the 120 s default would cut long answers.
  COLLEX_LOCAL_LLM_TIMEOUT_MS     = '300000'
}
foreach ($name in $vars.Keys) {
  [Environment]::SetEnvironmentVariable($name, [string]$vars[$name], 'User')
}

Write-Host ''
Write-Host "[ColleX] Baglandi: $base (parola bu bilgisayarin kullanici ayarlarinda saklandi)."
Write-Host '[ColleX] ColleX acikse ColleX-Durdur.cmd ile kapatip ColleX-Baslat.cmd ile yeniden acin.'
Write-Host '[ColleX] Sunucu penceresinde "yerel model" satiri artik collex-beyin adini gosterir.'
exit 0
