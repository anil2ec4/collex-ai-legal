#!/bin/bash
# UNVALIDATED ON PHYSICAL MAC
#
# ColleX "beyin": this Mac mini serves ONE local language model to the ColleX
# on the home Windows PC (MAC-MINI-INFERENCE.md, option 2 of 28.09.2026).
#
#   - llama.cpp's llama-server, one request at a time (-np 1): 8 GB of unified
#     memory holds one 7-8B model at 4-bit and nothing else of size.
#   - Bound to this Mac's TAILSCALE address only: never 0.0.0.0, never the
#     open internet, nothing to open on the home router. The Windows PC and
#     this Mac reach each other through Tailscale's encrypted private network.
#   - A password (API key) the Windows side must send; it lives in a 600-mode
#     file and reaches llama-server through --api-key-file, so it never sits
#     on a command line (`ps` shows every command line on the machine).
#   - Started at login by launchd and restarted if it stops.
#
# Usage (Terminal, in the folder holding this file):
#   bash collex-beyin.sh kur       install, create the password, start at login
#   bash collex-beyin.sh durum     is it answering? (prints the address, not the password)
#   bash collex-beyin.sh anahtar   print the password, to type into Windows once
#   bash collex-beyin.sh kaldir    stop and remove the login item (downloaded model stays)
#
# Model: COLLEX_BEYIN_MODEL (a llama.cpp -hf "<repo>:<quant>"), default below.
# It is a STARTING choice, not a measured one: nothing about its speed or
# quality on this Mac has been measured. Compare candidates with
# control-plane/scripts/bakeoff.mjs before relying on one.

set -euo pipefail

LABEL="com.collex.beyin"
DIR="$HOME/Library/Application Support/ColleX"
KEY_FILE="$DIR/beyin-anahtar"
RUNNER="$DIR/beyin-calistir.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/collex-beyin.log"
PORT="${COLLEX_BEYIN_PORT:-8080}"
MODEL="${COLLEX_BEYIN_MODEL:-bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M}"
# Must match COLLEX_LOCAL_LLM_CONTEXT_TOKENS on Windows (ColleX default 8192).
CTX="${COLLEX_BEYIN_CTX:-8192}"

say() { printf '[ColleX beyin] %s\n' "$*"; }

tailscale_cli() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
  elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    printf '%s\n' /Applications/Tailscale.app/Contents/MacOS/Tailscale
  else
    return 1
  fi
}

tailscale_ip() {
  local cli
  cli="$(tailscale_cli)" || return 1
  "$cli" ip -4 2>/dev/null | head -n 1
}

cmd_kur() {
  if [ "$(uname -s)" != "Darwin" ]; then
    say "Bu betik yalniz macOS'ta calisir."
    exit 1
  fi
  if ! command -v brew >/dev/null 2>&1; then
    say "Homebrew bulunamadi. Once https://brew.sh adresindeki tek satirlik komutla kurun, sonra bu betigi yeniden calistirin."
    exit 1
  fi
  local ip
  ip="$(tailscale_ip || true)"
  case "$ip" in
    100.*) ;;
    *)
      say "Tailscale adresi bulunamadi. App Store'dan Tailscale'i kurun, Windows'takiyle AYNI hesapla oturum acin, sonra yeniden calistirin."
      exit 1
      ;;
  esac
  if ! command -v llama-server >/dev/null 2>&1; then
    say "llama.cpp kuruluyor (Homebrew)..."
    brew install llama.cpp
  fi
  local server
  server="$(command -v llama-server)"

  mkdir -p "$DIR" "$(dirname "$PLIST")" "$(dirname "$LOG")"
  chmod 700 "$DIR"
  if [ ! -s "$KEY_FILE" ]; then
    (umask 077 && openssl rand -hex 12 > "$KEY_FILE")
  fi
  chmod 600 "$KEY_FILE"

  # The runner re-reads the Tailscale address at every start: launchd may
  # start it before Tailscale is up, and then it exits and is retried.
  cat > "$RUNNER" <<RUNNER_EOF
#!/bin/bash
# Written by collex-beyin.sh kur. Started by launchd ($LABEL).
set -u
IP=""
for cli in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  if command -v "\$cli" >/dev/null 2>&1; then IP="\$("\$cli" ip -4 2>/dev/null | head -n 1)"; break; fi
done
case "\$IP" in
  100.*) ;;
  *) echo "\$(date '+%F %T') Tailscale henuz hazir degil; 30 sn sonra yeniden denenecek."; sleep 30; exit 1 ;;
esac
exec "$server" -hf "$MODEL" --alias collex-beyin --host "\$IP" --port "$PORT" \\
  --api-key-file "$KEY_FILE" -c "$CTX" -np 1
RUNNER_EOF
  chmod 700 "$RUNNER"

  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$RUNNER</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST_EOF

  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"

  say "Kuruldu ve baslatildi. Ilk acilista model (yaklasik 5 GB) indirilir; bu birkac dakika surebilir."
  say "Windows'ta ColleX-Beyin-Bagla.cmd calistirin ve sunlari girin:"
  say "  Adres  : $ip"
  say "  Parola : $(cat "$KEY_FILE")"
  say "Hazir olup olmadigini gormek icin: bash $0 durum"
}

cmd_durum() {
  local ip code
  ip="$(tailscale_ip || true)"
  if [ -z "$ip" ]; then
    say "Tailscale adresi yok; Tailscale acik ve oturum acilmis olmali."
    exit 1
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$ip:$PORT/health" || true)"
  case "$code" in
    200) say "HAZIR: http://$ip:$PORT (model: collex-beyin)" ;;
    503) say "Model yukleniyor ya da indiriliyor; biraz sonra yeniden bakin. Gunluk: $LOG" ;;
    *) say "Cevap yok (kod: ${code:-yok}). Gunluk: $LOG"; tail -n 20 "$LOG" 2>/dev/null || true; exit 1 ;;
  esac
}

cmd_anahtar() {
  if [ ! -s "$KEY_FILE" ]; then
    say "Parola yok; once: bash $0 kur"
    exit 1
  fi
  cat "$KEY_FILE"
}

cmd_kaldir() {
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST" "$RUNNER"
  say "Durduruldu ve oturum acilisindan kaldirildi. Indirilen model ve parola yerinde duruyor."
}

case "${1:-}" in
  kur) cmd_kur ;;
  durum) cmd_durum ;;
  anahtar) cmd_anahtar ;;
  kaldir) cmd_kaldir ;;
  *)
    say "Kullanim: bash $0 kur | durum | anahtar | kaldir"
    exit 2
    ;;
esac
