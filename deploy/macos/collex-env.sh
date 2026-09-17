#!/bin/bash
# UNVALIDATED ON PHYSICAL MAC
#
# ColleX macOS ortak ayarları. collex-start.sh, collex-stop.sh,
# collex-backup.sh ve collex-restore.sh bu dosyayı "source" eder; tek başına
# çalıştırılmaz. bash 3.2 (macOS'un kendi bash'i) ile uyumlu yazılmıştır.
#
# Ortam değişkenleri (hepsi isteğe bağlı):
#   COLLEX_HOME        ColleX klasörü (varsayılan: bu dosyanın iki üst klasörü)
#   COLLEX_DATA_DIR    veri klasörü; verilmezse $COLLEX_HOME/var (serve.mjs ile aynı kural)
#   COLLEX_PGBIN       PostgreSQL araçlarının klasörü (pg_ctl, pg_isready, psql, pg_dump)
#   COLLEX_PGDATA      PostgreSQL küme klasörü; verilirse başlatıcı kümeyi pg_ctl ile açar
#                      ve portu dinleyen kümenin bu küme olduğunu denetler
#   COLLEX_PGPORT      PostgreSQL portu (varsayılan 55432; yalnız 127.0.0.1)
#   COLLEX_DB_NAME     ürün veritabanı (varsayılan collex_local)
#   COLLEX_DB_URL      veritabanı adresi (varsayılan postgres://postgres@127.0.0.1:<port>/<ad>)
#   COLLEX_APP_PORT    ColleX portu (varsayılan 8787)
#   COLLEX_EMBED_PORT  yerel E5 modeli portu (varsayılan 8899)
#   COLLEX_NODE        node programı (varsayılan: PATH, sonra Homebrew)
#   COLLEX_LOG_DIR     günlük klasörü (varsayılan: ~/Library/Logs/ColleX)
#   COLLEX_BACKUP_DIR  yedek kök klasörü (varsayılan: ~/ColleX-Yedek)
#
# Bu makine dışında hiçbir hizmete bağlanılmaz: her adres 127.0.0.1'dir.

_collex_env_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# One configuration file for the launchd jobs AND for scripts run by hand, so
# a hand-run backup or restore uses the same data folder as the service.
# A value already set in the environment (e.g. by a plist) wins.
#
# W21 (#27) — the file is read strictly, and anything it cannot read exactly
# STOPS the script (exit 64, the same as a leftover __...__ placeholder):
#   * one KEY=VALUE per line, starting at the first column; KEY is COLLEX_
#     followed by capital letters, digits and underscores only;
#   * blank lines and lines whose first non-blank character is # are skipped;
#   * a Windows line ending (CR) is stripped, never kept in a value;
#   * a value may not be empty, start or end with blanks, be quoted, or use
#     ~ or $ (nothing is expanded: write the full path);
#   * nothing in the file is ever evaluated: keys are read by indirect
#     expansion only after they passed the check above.
# Before W21 a CRLF file exported values ending in CR, "KEY = value" printed
# "bad substitution" and the script went on with the <repo>/var default, and
# a crafted key line could run a command through eval.
# The refusal names the file, the line number and the reason — never the
# value, which could be a secret.
COLLEX_ENV_FILE="${COLLEX_ENV_FILE:-$HOME/.collex/collex.env}"
if [ -f "$COLLEX_ENV_FILE" ]; then
  _collex_cr="$(printf '\r')"
  _collex_upper_digits='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'
  _collex_lineno=0
  _collex_current=""
  while IFS= read -r _collex_line || [ -n "$_collex_line" ]; do
    _collex_lineno=$((_collex_lineno + 1))
    _collex_line=${_collex_line%"$_collex_cr"}
    _collex_trimmed=${_collex_line#"${_collex_line%%[![:space:]]*}"}
    case "$_collex_trimmed" in
      ''|'#'*) continue ;;
    esac
    _collex_bad=""
    _collex_key="${_collex_line%%=*}"
    _collex_value="${_collex_line#*=}"
    if [ "$_collex_key" = "$_collex_line" ]; then
      _collex_bad="KEY=değer biçiminde değil"
    else
      case "$_collex_key" in
        COLLEX_)
          _collex_bad="anahtar adı eksik"
          ;;
        COLLEX_*)
          case "$_collex_key" in
            *[!$_collex_upper_digits]*)
              _collex_bad="anahtar yalnız büyük harf, rakam ve alt çizgiden oluşabilir (boşluk yok)"
              ;;
          esac
          ;;
        *)
          _collex_bad="anahtar satırın başında ve COLLEX_ ile başlamalı (export, girinti ve başka adlar okunmaz)"
          ;;
      esac
    fi
    if [ -z "$_collex_bad" ]; then
      case "$_collex_value" in
        '')
          _collex_bad="değer boş (gerekmiyorsa satırı silin)"
          ;;
        [[:space:]]*|*[[:space:]])
          _collex_bad="değerin başında ya da sonunda boşluk var"
          ;;
        \"*|\'*)
          _collex_bad="değer tırnak içinde (tırnak kullanmayın)"
          ;;
        *"$_collex_cr"*)
          _collex_bad="değerin içinde satır sonu karakteri (CR) var"
          ;;
        '~'*|*'$'*)
          _collex_bad="değer ~ ya da \$ içeriyor (hiçbir şey açılmaz; tam yolu yazın)"
          ;;
      esac
    fi
    if [ -n "$_collex_bad" ]; then
      printf '[ColleX] %s dosyasının %s. satırı okunamadı: %s. Dosyayı düzeltin; ColleX yanlış ayarla çalıştırılmadı.\n' \
        "$COLLEX_ENV_FILE" "$_collex_lineno" "$_collex_bad" >&2
      exit 64
    fi
    _collex_current="${!_collex_key:-}"
    if [ -z "$_collex_current" ]; then
      export "$_collex_key=$_collex_value"
    fi
  done < "$COLLEX_ENV_FILE"
fi

COLLEX_HOME="${COLLEX_HOME:-$(cd "$_collex_env_dir/../.." && pwd -P)}"
export COLLEX_HOME

# A template placeholder left in a plist (__COLLEX_DATA_DIR__ and friends) is
# a configuration error, never a path: refuse to start rather than create a
# data folder literally named after it.
for _collex_var in COLLEX_HOME COLLEX_DATA_DIR COLLEX_PGBIN COLLEX_PGDATA COLLEX_BACKUP_DIR COLLEX_LOG_DIR COLLEX_NODE; do
  _collex_val="${!_collex_var:-}"
  case "$_collex_val" in
    *__*__*)
      printf '[ColleX] %s hâlâ şablon yer tutucusu içeriyor (%s); plist dosyasındaki __...__ değerlerini gerçek yollarla değiştirin ya da satırı silin.\n' "$_collex_var" "$_collex_val" >&2
      exit 64
      ;;
  esac
done

COLLEX_PGPORT="${COLLEX_PGPORT:-55432}"
COLLEX_APP_PORT="${COLLEX_APP_PORT:-8787}"
COLLEX_EMBED_PORT="${COLLEX_EMBED_PORT:-8899}"
COLLEX_DB_NAME="${COLLEX_DB_NAME:-collex_local}"
COLLEX_DB_URL="${COLLEX_DB_URL:-postgres://postgres@127.0.0.1:${COLLEX_PGPORT}/${COLLEX_DB_NAME}}"
export COLLEX_DB_URL
# The launcher on Windows sets this too: the product never reads a .env file.
COLLEX_NO_DOTENV=1
export COLLEX_NO_DOTENV

if [ -n "${COLLEX_DATA_DIR:-}" ]; then
  COLLEX_VARDIR="$COLLEX_DATA_DIR"
else
  COLLEX_VARDIR="$COLLEX_HOME/var"
fi
COLLEX_LOG_DIR="${COLLEX_LOG_DIR:-$HOME/Library/Logs/ColleX}"
COLLEX_HEALTH_URL="http://127.0.0.1:${COLLEX_APP_PORT}/v1/health"
COLLEX_PY="$COLLEX_HOME/.venv/bin/python"
COLLEX_SERVE="$COLLEX_HOME/control-plane/scripts/serve.mjs"
COLLEX_BACKUP_MJS="$COLLEX_HOME/control-plane/scripts/backup.mjs"

# Where Homebrew and Postgres.app keep the PostgreSQL tools. The SAME list,
# in the same order, as MACOS_PG_BIN_CANDIDATES in
# control-plane/src/backup/runner.ts (a test keeps the two equal). A hit here
# is a guess and is announced as one.
COLLEX_MACOS_PG_CANDIDATES="/opt/homebrew/opt/postgresql@18/bin /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql/bin /opt/homebrew/bin /usr/local/opt/postgresql@18/bin /usr/local/opt/postgresql@17/bin /usr/local/bin /Applications/Postgres.app/Contents/Versions/latest/bin"

collex_log() { printf '[ColleX] %s\n' "$*"; }
collex_err() { printf '[ColleX] %s\n' "$*" >&2; }

# node: COLLEX_NODE, then PATH, then Homebrew.
collex_find_node() {
  local candidate
  if [ -n "${COLLEX_NODE:-}" ]; then
    printf '%s\n' "$COLLEX_NODE"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# One PostgreSQL tool: COLLEX_PGBIN, then PATH, then the macOS guesses.
collex_pg_tool() {
  local tool="$1" dir
  if [ -n "${COLLEX_PGBIN:-}" ]; then
    if [ -x "$COLLEX_PGBIN/$tool" ]; then
      printf '%s\n' "$COLLEX_PGBIN/$tool"
      return 0
    fi
    return 1
  fi
  if command -v "$tool" >/dev/null 2>&1; then
    command -v "$tool"
    return 0
  fi
  for dir in $COLLEX_MACOS_PG_CANDIDATES; do
    if [ -x "$dir/$tool" ]; then
      collex_err "PostgreSQL aracı $dir içinde bulundu (tahmin edildi; kalıcı olması için COLLEX_PGBIN ile belirtin)."
      printf '%s\n' "$dir/$tool"
      return 0
    fi
  done
  return 1
}

# Is this command line ColleX's? The same four names ColleX-Durdur.cmd
# matches: serve.mjs, serve-mcp.mjs, "uvicorn asgi_app" and the managed
# local embedding server. Never "whatever listens on a port".
collex_is_collex_cmd() {
  case "$1" in
    *control-plane/scripts/serve.mjs*|*control-plane/scripts/serve-mcp.mjs*) return 0 ;;
    *"uvicorn asgi_app"*) return 0 ;;
    *local_embedding_server*--collex-managed*) return 0 ;;
  esac
  return 1
}

# A pid is ColleX's only when its program is node or python AND its command
# line is ColleX's (an editor with serve.mjs open is neither).
collex_proc_is_collex() {
  local pid="$1" cmd comm base
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  cmd="$(ps -o command= -p "$pid" 2>/dev/null)" || return 1
  [ -n "$cmd" ] || return 1
  comm="$(ps -o comm= -p "$pid" 2>/dev/null)"
  base="${comm##*/}"
  case "$base" in
    node|node[0-9]*|python|python3|python3.*|Python) ;;
    *) return 1 ;;
  esac
  collex_is_collex_cmd "$cmd"
}

collex_health_ok() {
  curl -fsS -o /dev/null --max-time 2 "$COLLEX_HEALTH_URL" >/dev/null 2>&1
}

# W21 (#24): which folder a hand-run backup or restore reads the originals
# from (or writes them to), and where that answer came from. When the app's
# launchd job is installed and names a DIFFERENT data folder, stop (exit 64):
# the backup would miss the service's originals, the restore would put them
# where the service never looks. The plist is only READ (PlistBuddy Print).
COLLEX_APP_PLIST="${COLLEX_APP_PLIST:-$HOME/Library/LaunchAgents/com.collex.app.plist}"
COLLEX_PLISTBUDDY="${COLLEX_PLISTBUDDY:-/usr/libexec/PlistBuddy}"
collex_check_uploads_dir() {
  local service=""
  if [ -n "${COLLEX_DATA_DIR:-}" ]; then
    collex_log "Belge asılları : $COLLEX_VARDIR/uploads (COLLEX_DATA_DIR)"
  else
    collex_log "Belge asılları : $COLLEX_VARDIR/uploads (COLLEX_DATA_DIR ayarlı değil; ColleX klasöründeki var/ varsayıldı)"
  fi
  if [ -f "$COLLEX_APP_PLIST" ] && [ -x "$COLLEX_PLISTBUDDY" ]; then
    service="$("$COLLEX_PLISTBUDDY" -c 'Print :EnvironmentVariables:COLLEX_DATA_DIR' "$COLLEX_APP_PLIST" 2>/dev/null)" || service=""
  fi
  if [ -n "$service" ] && [ "${service%/}" != "${COLLEX_VARDIR%/}" ]; then
    collex_err "DURDURULDU: ColleX hizmeti belge asıllarını $service/uploads klasöründe tutuyor, bu komut ise $COLLEX_VARDIR/uploads klasörünü kullanacaktı."
    collex_err "Hizmetin değerlerini ~/.collex/collex.env dosyasına yazın (ör. COLLEX_DATA_DIR=$service) ve yeniden deneyin. Hiçbir şey değişmedi."
    return 64
  fi
  if [ -z "${COLLEX_DATA_DIR:-}" ] && [ ! -d "$COLLEX_VARDIR/uploads" ]; then
    collex_err "UYARI: $COLLEX_VARDIR/uploads klasörü yok. Hizmetin verisi başka bir klasördeyse değerleri ~/.collex/collex.env dosyasına yazın."
  fi
  return 0
}
