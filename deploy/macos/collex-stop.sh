#!/bin/bash
# UNVALIDATED ON PHYSICAL MAC
#
# ColleX'i kapatır (macOS) — ColleX-Durdur.cmd'nin karşılığı.
#
#   Sıra:
#     1) Nazik durdurma: <veri>/collex.stop dosyası bırakılır ve pid dosyasının
#        kaybolması beklenir. serve.mjs pid dosyasını ancak kayıtları diske
#        yazıp veritabanı bağlantısını kapattıktan sonra siler.
#     2) Pid dosyalarındaki süreçlere SIGTERM — YALNIZ program node/python ve
#        komut satırı gerçekten ColleX'e aitse (yeniden kullanılmış bir pid
#        başka bir programa ait olabilir). serve.mjs SIGTERM'de de kayıtlarını
#        yazar.
#     3) Komut satırı ColleX'e ait kalan süreçlere SIGTERM; 5 saniyede
#        kapanmayan ve HÂLÂ ColleX olan süreç zorla kapatılır. Bir portu
#        dinleyen HERHANGİ bir sürece asla dokunulmaz.
#     4) PostgreSQL: COLLEX_PGDATA verildiyse pg_ctl ile hızlı kapatma.
#        --keep-db ile veritabanı açık bırakılır (geri yükleme bunu ister).
#
#   ColleX launchd ile çalışıyorsa (com.collex.app.plist) önce onu kaldırın:
#     launchctl bootout gui/$(id -u)/com.collex.app
set -u
. "$(cd "$(dirname "$0")" && pwd -P)/collex-env.sh"

KEEP_DB=0
for arg in "$@"; do
  case "$arg" in
    --keep-db) KEEP_DB=1 ;;
    *)
      collex_err "bilinmeyen seçenek: $arg (yalnız --keep-db)"
      exit 2
      ;;
  esac
done

PIDFILE="$COLLEX_VARDIR/collex.pid"
MCP_PIDFILE="$COLLEX_VARDIR/collex-mcp.pid"
STOPFILE="$COLLEX_VARDIR/collex.stop"
WAIT_S="${COLLEX_STOP_WAIT_S:-6}"

# --- 1) Nazik durdurma (kayıtlar diske yazılır). ---
if [ -f "$PIDFILE" ]; then
  collex_log "Nazik durdurma isteniyor (kayıtlar diske yazılıyor)..."
  mkdir -p "$COLLEX_VARDIR"
  printf 'stop\n' > "$STOPFILE"
  waited=0
  while [ -f "$PIDFILE" ] && [ "$waited" -lt "$WAIT_S" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if [ -f "$PIDFILE" ]; then
    collex_log "Sunucu ${WAIT_S} saniyede kapanmadı; SIGTERM gönderiliyor."
  else
    collex_log "Sunucu düzgün kapandı."
  fi
fi
rm -f "$STOPFILE"

TERMED=""
signal_term() {
  local pid="$1"
  if [ "$pid" = "$$" ]; then
    return 0
  fi
  if collex_proc_is_collex "$pid"; then
    if kill -TERM "$pid" 2>/dev/null; then
      TERMED="$TERMED $pid"
    fi
  fi
  return 0
}

collect_collex_pids() {
  local pid
  ps -x -o pid= 2>/dev/null | while read -r pid; do
    if [ "$pid" != "$$" ] && collex_proc_is_collex "$pid"; then
      printf '%s\n' "$pid"
    fi
  done
}

# --- 2) Pid dosyaları: pid ancak komut satırı ColleX'e aitse. ---
for f in "$MCP_PIDFILE" "$PIDFILE"; do
  if [ -f "$f" ]; then
    signal_term "$(tr -dc '0-9' < "$f")"
    rm -f "$f"
  fi
done

# --- 3) Komut satırı ColleX'e ait sarkan süreçler (port dinleyicileri DEĞİL). ---
collex_log "ColleX'e ait sarkan süreçler kapatılıyor..."
for pid in $(collect_collex_pids); do
  signal_term "$pid"
done
if [ -n "$TERMED" ]; then
  waited=0
  while [ "$waited" -lt 5 ]; do
    alive=""
    for pid in $TERMED; do
      if kill -0 "$pid" 2>/dev/null; then
        alive="$alive $pid"
      fi
    done
    [ -z "$alive" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  for pid in $TERMED; do
    if kill -0 "$pid" 2>/dev/null && collex_proc_is_collex "$pid"; then
      kill -KILL "$pid" 2>/dev/null
      collex_log "Süreç $pid SIGTERM'e 5 saniyede cevap vermedi; zorla kapatıldı."
    fi
  done
fi

# --- 4) Veritabanı. ---
if [ "$KEEP_DB" = "1" ]; then
  collex_log "Veritabanı açık bırakıldı (--keep-db)."
elif [ -n "${COLLEX_PGDATA:-}" ]; then
  collex_log "Veritabanı durduruluyor..."
  if PG_CTL="$(collex_pg_tool pg_ctl)"; then
    "$PG_CTL" -D "$COLLEX_PGDATA" -m fast -w stop >/dev/null 2>&1
  fi
  if PG_ISREADY="$(collex_pg_tool pg_isready)" && "$PG_ISREADY" -h 127.0.0.1 -p "$COLLEX_PGPORT" >/dev/null 2>&1; then
    collex_err "Veritabanı hâlâ çalışıyor görünüyor; günlük: $COLLEX_LOG_DIR/collex-postgres.log"
  else
    collex_log "Kapatıldı."
  fi
else
  collex_log "Sunucu kapatıldı. Veritabanına dokunulmadı (COLLEX_PGDATA verilmedi; Homebrew"
  collex_log "services ya da com.collex.postgres.plist yönetiyor olabilir)."
fi
exit 0
