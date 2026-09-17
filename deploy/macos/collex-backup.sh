#!/bin/bash
# UNVALIDATED ON PHYSICAL MAC
#
# ColleX YEDEKLEME (macOS) — ColleX-Yedekle.cmd'nin karşılığı. Elle ya da
# launchd ile (com.collex.backup.plist, her gün) çalışır.
#
#   Kullanım: collex-backup.sh [hedef kök klasör] [--allow-empty-uploads]
#     (verilmezse COLLEX_BACKUP_DIR, o da yoksa ~/ColleX-Yedek)
#
#   Belge asılları COLLEX_DATA_DIR/uploads klasöründen okunur; betik bu
#   klasörü ve nereden geldiğini yazar. Değerleri ~/.collex/collex.env
#   dosyasına yazın: elle açılan bir terminalde plist değerleri YOKTUR.
#   Klasör yoksa ya da veritabanının andığı asıllardan hiçbirini taşımıyorsa
#   yedek alınmaz; bunu bilerek istemek için --allow-empty-uploads verilir.
#   Kurulu hizmet başka bir veri klasörü kullanıyorsa betik durur (çıkış 64).
#
#   Tarihli bir klasöre üç şey bırakır:
#     <veritabanı>.dump   veritabanının tamamı (pg_dump -Fc)
#     uploads/            belgelerin asılları
#     yedek.json          her dosyanın boyutu ve SHA-256 özeti
#   Yedek ALINIRKEN veritabanına hiçbir şey YAZILMAZ (pg_dump yalnız okur)
#   ve hiçbir eski yedek silinmez.
set -u
. "$(cd "$(dirname "$0")" && pwd -P)/collex-env.sh"

OUTROOT=""
ALLOW_EMPTY=""
for arg in "$@"; do
  case "$arg" in
    --allow-empty-uploads) ALLOW_EMPTY="--allow-empty-uploads" ;;
    -*)
      collex_err "bilinmeyen seçenek: $arg"
      exit 2
      ;;
    *)
      if [ -n "$OUTROOT" ]; then
        collex_err "tek bir hedef kök klasör verin."
        exit 2
      fi
      OUTROOT="$arg"
      ;;
  esac
done
OUTROOT="${OUTROOT:-${COLLEX_BACKUP_DIR:-$HOME/ColleX-Yedek}}"

# W21 (#24): which originals folder, and stop if the service uses another.
collex_check_uploads_dir || exit $?

NODE="$(collex_find_node)" || {
  collex_err "Node.js bulunamadı. Homebrew ile kurun (brew install node) ya da COLLEX_NODE verin."
  exit 1
}
PG_ISREADY="$(collex_pg_tool pg_isready)" || {
  collex_err "PostgreSQL araçları bulunamadı. COLLEX_PGBIN ile klasörünü belirtin."
  exit 1
}
# backup.mjs finds pg_dump by itself too; hand it the folder found here so
# both steps use the same PostgreSQL.
if [ -z "${COLLEX_PGBIN:-}" ]; then
  COLLEX_PGBIN="$(dirname "$PG_ISREADY")"
  export COLLEX_PGBIN
fi

if ! "$PG_ISREADY" -h 127.0.0.1 -p "$COLLEX_PGPORT" >/dev/null 2>&1; then
  collex_err "Veritabanı çalışmıyor. Önce collex-start.sh çalıştırın."
  exit 1
fi

collex_log "Yedek alınıyor: $COLLEX_DB_NAME"
collex_log "Hedef klasör   : $OUTROOT"
if ! "$NODE" "$COLLEX_BACKUP_MJS" --database "$COLLEX_DB_NAME" --out "$OUTROOT" --host 127.0.0.1 --port "$COLLEX_PGPORT" ${ALLOW_EMPTY:+"$ALLOW_EMPTY"}; then
  collex_err "YEDEK BAŞARISIZ. Yukarıdaki mesajı okuyun; hiçbir şey silinmedi."
  exit 1
fi

collex_log "Bu klasörü harici bir diske KOPYALAYIN."
collex_log "UYARI: yedek klasörü MÜVEKKİL VERİSİ içerir — şifreli bir diske koyun"
collex_log "(FileVault açık bir disk ya da şifreli bir harici disk)."
collex_log "Geri yüklemek için: collex-restore.sh \"klasör yolu\""
exit 0
