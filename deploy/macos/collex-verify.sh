#!/bin/bash
# ColleX doğrulama (macOS) — ColleX-Dogrula.cmd'nin karşılığı.
#
#   ColleX çalışırken bu Mac'te ölçer: 26 resmî kaynağın her birinde bir
#   arama ve bir tam metin (parmak izi burada yeniden hesaplanır), ayarlıysa
#   yerel yapay zekâ modeli (yalnız örnek cümlelerle) ve bu Mac'in kendisi
#   (macOS sürümü, işlemci, bellek, launchd'de yüklü ColleX servisleri).
#   Dosyalara, taslaklara ve cevaplara HİÇBİR ŞEY yazmaz.
#
#   Bulut yapay zekâyı da denemek için: collex-verify.sh --bulut
#   (ANTHROPIC_API_KEY ortamda olmalıdır; üç ücretli, örnek cümleli çağrı).
set -u
. "$(cd "$(dirname "$0")" && pwd -P)/collex-env.sh"

NODE="$(collex_find_node)" || { collex_err "Node.js bulunamadı (Homebrew: brew install node)."; exit 1; }
cd "$COLLEX_HOME" || exit 1
"$NODE" control-plane/scripts/verify-on-machine.mjs --base "http://127.0.0.1:${COLLEX_PORT:-8787}" "$@"
status=$?
if [ "$status" -eq 2 ]; then
  collex_err "ColleX çalışmıyor. Önce collex-start.sh ile başlatın, sonra bu betiği yeniden çalıştırın."
  exit 1
fi
collex_log "Raporu okuyup saklayın; isterseniz geliştiriciye gönderin (müvekkil verisi içermez)."
exit "$status"
