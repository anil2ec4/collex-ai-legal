#!/bin/bash
# UNVALIDATED ON PHYSICAL MAC
#
# ColleX başlatıcı (macOS) — ColleX-Baslat.cmd'nin karşılığı.
#
#   Akış:
#     0) 8787'de sağlıklı bir ColleX zaten cevap veriyorsa yalnız tarayıcıyı açar.
#     1) Pid dosyasındaki süreç gerçekten ColleX ise yenisini başlatmaz, bekler.
#     2) PostgreSQL 127.0.0.1:$COLLEX_PGPORT'ta hazır mı? Değilse ve
#        COLLEX_PGDATA verildiyse pg_ctl ile başlatır.
#     2b) COLLEX_PGDATA verildiyse portu dinleyen kümenin bizim kümemiz
#        olduğunu denetler; başka bir küme dinliyorsa DURUR.
#     3) intake.cli --ensure-db: veritabanı yoksa oluşturur, eksik
#        migrasyonları uygular (asla silmez); başarısızlıkta DURUR.
#     3b) Kütüphane kuyruğunu yayımlar (başlatmayı durdurmaz).
#     4) serve.mjs'i Windows başlatıcısıyla AYNI bayraklarla başlatır.
#     5) /v1/health 200 dönene kadar (en fazla 60 sn) bekler, tarayıcıyı açar.
#
#   COLLEX_FOREGROUND=1 (launchd, com.collex.app.plist): 4. adımda serve.mjs
#   ön planda çalışır (exec); tarayıcı açılmaz, beklemeyi launchd yapar.
#   Hiçbir adım bir veritabanını ya da dosyayı silmez.
set -u
. "$(cd "$(dirname "$0")" && pwd -P)/collex-env.sh"

FOREGROUND="${COLLEX_FOREGROUND:-0}"
mkdir -p "$COLLEX_LOG_DIR"
ENSURELOG="$COLLEX_LOG_DIR/collex-ensure-db.log"
LIBLOG="$COLLEX_LOG_DIR/collex-library.log"
PGLOG="$COLLEX_LOG_DIR/collex-postgres.log"
SERVERLOG="$COLLEX_LOG_DIR/collex-server.log"
LIBDIR="${COLLEX_LIBRARY_DIR:-$COLLEX_VARDIR/library}"
PIDFILE="$COLLEX_VARDIR/collex.pid"

open_browser() {
  if [ "$FOREGROUND" = "1" ]; then
    return 0
  fi
  if command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:${COLLEX_APP_PORT}/" >/dev/null 2>&1
  fi
  return 0
}

wait_ready() {
  local tries=0
  collex_log "Sunucu hazır olana kadar bekleniyor..."
  while [ "$tries" -lt 30 ]; do
    if collex_health_ok; then
      collex_log "Hazır. Arayüz: http://127.0.0.1:${COLLEX_APP_PORT}/"
      collex_log "Tamamen kapatmak için: collex-stop.sh"
      open_browser
      return 0
    fi
    tries=$((tries + 1))
    sleep 2
  done
  collex_err "Sunucu 60 saniye içinde hazır olmadı. Günlük: $SERVERLOG"
  collex_err "  - 'veritabanı: ÇALIŞMIYOR' -> PostgreSQL ayağa kalkmadı; $PGLOG"
  collex_err "  - 'portu kullanımda'       -> eski bir sunucu açık; collex-stop.sh çalıştırın"
  return 1
}

# --- 0) Zaten çalışıyor mu? ---
if collex_health_ok; then
  collex_log "Sunucu zaten çalışıyor ($COLLEX_HEALTH_URL)."
  open_browser
  exit 0
fi

# --- 1) Açılmakta olan bir ColleX var mı? Varsa hiçbir şey öldürülmez. ---
if [ -f "$PIDFILE" ]; then
  pid="$(tr -dc '0-9' < "$PIDFILE")"
  if collex_proc_is_collex "$pid"; then
    if [ "$FOREGROUND" = "1" ]; then
      collex_log "ColleX zaten başlatılıyor (pid $pid); ikinci bir sunucu açılmadı."
      exit 0
    fi
    collex_log "Sunucu zaten başlatılıyor; öldürmüyoruz, hazır olması bekleniyor."
    wait_ready
    exit $?
  fi
fi

NODE="$(collex_find_node)" || {
  collex_err "Node.js bulunamadı. Homebrew ile kurun (brew install node) ya da COLLEX_NODE verin."
  exit 1
}
if [ ! -f "$COLLEX_SERVE" ]; then
  collex_err "control-plane/scripts/serve.mjs bulunamadı ($COLLEX_HOME)."
  collex_err "Bu betik ColleX klasörünün içindeki deploy/macos altında durmalı."
  exit 1
fi
PG_ISREADY="$(collex_pg_tool pg_isready)" || {
  collex_err "PostgreSQL araçları bulunamadı. COLLEX_PGBIN ile klasörünü belirtin (ör. Homebrew postgresql@18)."
  exit 1
}

# --- 2) Veritabanı ayakta mı? ---
if "$PG_ISREADY" -h 127.0.0.1 -p "$COLLEX_PGPORT" >/dev/null 2>&1; then
  collex_log "Veritabanı zaten çalışıyor."
elif [ -n "${COLLEX_PGDATA:-}" ]; then
  PG_CTL="$(collex_pg_tool pg_ctl)" || {
    collex_err "pg_ctl bulunamadı; COLLEX_PGBIN ile PostgreSQL klasörünü belirtin."
    exit 1
  }
  collex_log "Veritabanı başlatılıyor (port $COLLEX_PGPORT)..."
  "$PG_CTL" -D "$COLLEX_PGDATA" -o "-p $COLLEX_PGPORT -c listen_addresses=127.0.0.1" -l "$PGLOG" -w start >/dev/null 2>&1
  if ! "$PG_ISREADY" -h 127.0.0.1 -p "$COLLEX_PGPORT" >/dev/null 2>&1; then
    collex_err "Veritabanı başlatılamadı. Günlük: $PGLOG"
    exit 1
  fi
  collex_log "Veritabanı hazır."
else
  collex_err "Veritabanı 127.0.0.1:$COLLEX_PGPORT adresinde çalışmıyor."
  collex_err "COLLEX_PGDATA ile küme klasörünü verin (başlatıcı açar) ya da PostgreSQL'i"
  collex_err "Homebrew services veya com.collex.postgres.plist ile başlatın."
  exit 1
fi

# --- 2b) Portu dinleyen küme BİZİM kümemiz mi? (Windows E18 denetimi) ---
if [ -n "${COLLEX_PGDATA:-}" ]; then
  PSQL="$(collex_pg_tool psql)" || PSQL=""
  found=""
  if [ -n "$PSQL" ]; then
    found="$("$PSQL" -X -w -h 127.0.0.1 -p "$COLLEX_PGPORT" -U postgres -d postgres -Atc "show data_directory" 2>/dev/null)"
  fi
  if [ -n "$found" ]; then
    want="$(cd "$COLLEX_PGDATA" 2>/dev/null && pwd -P)"
    have="$(cd "$found" 2>/dev/null && pwd -P)"
    [ -n "$have" ] || have="$found"
    # APFS is case-insensitive by default; compare the way the .cmd does (-ieq).
    want_lc="$(printf '%s' "$want" | tr '[:upper:]' '[:lower:]')"
    have_lc="$(printf '%s' "$have" | tr '[:upper:]' '[:lower:]')"
    if [ -n "$want" ] && [ "$want_lc" != "$have_lc" ]; then
      collex_err "DURDURULDU: 127.0.0.1:$COLLEX_PGPORT portunu ColleX'in veritabanı DEĞİL,"
      collex_err "başka bir PostgreSQL kümesi dinliyor."
      collex_err "  Beklenen veri klasörü: $want"
      collex_err "  Bulunan veri klasörü : $found"
      collex_err "Dosyalarınız duruyor; yanlış kümeye bağlanmamak için başlatma durduruldu."
      exit 1
    fi
  fi
fi

# --- 3) Kalıcı ürün veritabanı: oluştur / eksik migrasyonları uygula (silmez). ---
if [ ! -x "$COLLEX_PY" ]; then
  collex_err "Python çalışma ortamı bulunamadı ($COLLEX_PY); belge yükleme açılamaz."
  collex_err "Kurulum tamamlanmadan program başlatılmadı."
  exit 1
fi
cd "$COLLEX_HOME" || exit 1
if ! "$COLLEX_PY" -m intake.cli --dsn "$COLLEX_DB_URL" --ensure-db --list >"$ENSURELOG" 2>&1; then
  if grep -q "STORE_UNAVAILABLE" "$ENSURELOG" 2>/dev/null; then
    collex_err "Yerel veritabanına ulaşılamadı (STORE_UNAVAILABLE): PostgreSQL 127.0.0.1:$COLLEX_PGPORT bağlantı kabul etmiyor."
    collex_err "Günlük: $PGLOG ve $ENSURELOG"
  else
    collex_err "Veritabanı şeması hazırlanamadı (intake.cli --ensure-db başarısız)."
    collex_err "Ayrıntı: $ENSURELOG"
  fi
  collex_err "Sunucu başlatılmadı. Sorunu giderip collex-start.sh dosyasını yeniden çalıştırın."
  exit 1
fi
collex_log "Veritabanı şeması hazır."

# --- 3b) Getirilen kararları kütüphaneye yayımla (başlatmayı DURDURMAZ). ---
if [ -d "$LIBDIR" ]; then
  if "$COLLEX_PY" -m ingestion.cli --dsn "$COLLEX_DB_URL" --publish-library "$LIBDIR" >"$LIBLOG" 2>&1; then
    collex_log "Kütüphane güncel: getirilen kararlar bu bilgisayarda saklandı."
  else
    collex_log "Kütüphaneye yayımlama tamamlanamadı; program yine de açılıyor. Ayrıntı: $LIBLOG"
  fi
fi

# --- 4) Sunucu + MCP geçidi + yerel E5: ColleX-Baslat.cmd ile aynı bayraklar. ---
set -- "$COLLEX_SERVE" --port "$COLLEX_APP_PORT" --with-mcp --with-local-embeddings --local-embeddings-port "$COLLEX_EMBED_PORT"
if [ "$FOREGROUND" = "1" ]; then
  collex_log "Sunucu ön planda başlatılıyor (launchd)."
  exec "$NODE" "$@"
fi
collex_log "Sunucu arka planda başlatılıyor (kapatmak için: collex-stop.sh). Günlük: $SERVERLOG"
nohup "$NODE" "$@" >>"$SERVERLOG" 2>&1 </dev/null &

# --- 5) Sağlık: /v1/health 200 dönene kadar bekle. ---
wait_ready
exit $?
