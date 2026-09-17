#!/bin/bash
# UNVALIDATED ON PHYSICAL MAC
#
# ColleX GERİ YÜKLEME (macOS) — ColleX-Geri-Yukle.cmd'nin karşılığı. Yıkıcı
# yarı taşınabilir koddadır: control-plane/scripts/backup.mjs --restore.
#
#   Kullanım: collex-restore.sh "<yedek klasörü>" [--yes] [--create-uploads-dir]
#
#   Belge asılları COLLEX_DATA_DIR/uploads klasörüne konur; betik onaydan
#   önce bu klasörü yazar. Klasör yoksa geri yükleme yapılmaz (yanlış veri
#   klasörü belirtisi); bilerek oluşturmak için --create-uploads-dir verilir.
#   Kurulu hizmet başka bir veri klasörü kullanıyorsa betik durur (çıkış 64).
#
#   Pazarlık edilemeyen kurallar (Windows betiğiyle aynı):
#     1. ÖNCE DOĞRULAMA: yedek.json'daki her dosyanın SHA-256 özeti yeniden
#        hesaplanır; bozuk bir yedekle hiçbir şey başlamaz.
#     2. ONAY: EVET yazılır. Etkileşimsiz kullanımda (--yes) yazılmaz; ama
#        onaysız hiçbir şey değişmez.
#     3. Mevcut veritabanı önce yedeklenir (güvenlik yedeği), sonra yeniden
#        ADLANDIRILIR (<ad>_eski_<tarih>); asla silinmez.
#     4. pg_restore --exit-on-error: yarım geri yükleme kabul edilmez.
#     5. Belge asılları BİRLEŞTİRİLİR, hiçbiri silinmez; sonra her aslı
#        yedek.json'a karşı yeniden doğrulanır.
#     6. Geri yüklenen veritabanına hangi belge asıllarını andığı sorulur ve
#        her biri klasörde aranır (W21 #24). "Geri yükleme tamam" yalnız bu
#        denetim geçtiğinde yazılır; denetlenemediyse çıkış 3'tür.
set -u
. "$(cd "$(dirname "$0")" && pwd -P)/collex-env.sh"

SRC=""
YES=0
CREATE_UPLOADS=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --create-uploads-dir) CREATE_UPLOADS="--create-uploads-dir" ;;
    -*)
      collex_err "bilinmeyen seçenek: $arg"
      exit 2
      ;;
    *)
      if [ -n "$SRC" ]; then
        collex_err "tek bir yedek klasörü verin."
        exit 2
      fi
      SRC="$arg"
      ;;
  esac
done
if [ -z "$SRC" ]; then
  echo "Kullanım: collex-restore.sh \"<yedek klasörü>\" [--yes] [--create-uploads-dir]"
  exit 1
fi

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
if [ -z "${COLLEX_PGBIN:-}" ]; then
  COLLEX_PGBIN="$(dirname "$PG_ISREADY")"
  export COLLEX_PGBIN
fi

# --- 1) YAZMADAN ÖNCE DOĞRULA. ---
collex_log "Yedek doğrulanıyor (her dosyanın SHA-256 özeti)..."
if ! "$NODE" "$COLLEX_BACKUP_MJS" --verify "$SRC"; then
  collex_err "Bu yedek BOZUK. Geri yükleme YAPILMADI; mevcut verinize dokunulmadı."
  collex_err "Başka bir yedek klasörü deneyin."
  exit 1
fi

# Kenara alma, açık bağlantı varken yapılamaz: sunucu kapalı, veritabanı açık olmalı.
if collex_health_ok; then
  collex_err "ColleX hâlâ çalışıyor. Önce sunucuyu kapatın (veritabanı açık kalsın):"
  collex_err "  collex-stop.sh --keep-db"
  exit 1
fi
if ! "$PG_ISREADY" -h 127.0.0.1 -p "$COLLEX_PGPORT" >/dev/null 2>&1; then
  collex_err "Veritabanı çalışmıyor. PostgreSQL'i başlatın (ColleX sunucusu kapalı kalsın)."
  exit 1
fi

# --- 2) Onay. ---
if [ "$YES" != "1" ]; then
  if [ ! -t 0 ]; then
    collex_err "Etkileşimsiz çalışmada onay için --yes gerekir. Hiçbir şey değişmedi."
    exit 1
  fi
  echo
  echo "  DİKKAT: mevcut $COLLEX_DB_NAME veritabanı yeniden adlandırılacak ve yerine"
  echo "  bu yedek geri yüklenecek. Eski veritabanı silinmez, kenarda kalır."
  echo "  Belge asılları şu klasöre birleştirilecek: $COLLEX_VARDIR/uploads"
  echo
  printf 'Devam etmek için EVET yazın: '
  read -r ONAY
  case "$ONAY" in
    EVET|Evet|evet) ;;
    *)
      echo "İptal edildi. Hiçbir şey değişmedi."
      exit 1
      ;;
  esac
fi

# --- 3) Geri yükleme (doğrulama, güvenlik yedeği, kenara alma, pg_restore,
#        asılları birleştirme ve yeniden doğrulama backup.mjs içinde). ---
"$NODE" "$COLLEX_BACKUP_MJS" --restore "$SRC" --database "$COLLEX_DB_NAME" \
  --host 127.0.0.1 --port "$COLLEX_PGPORT" --out "${COLLEX_BACKUP_DIR:-$HOME/ColleX-Yedek}" ${CREATE_UPLOADS:+"$CREATE_UPLOADS"} --yes
rc=$?
if [ "$rc" -eq 3 ]; then
  # W21 (#24): restored, but the originals the restored database names
  # could not be checked — never reported as "tamam".
  collex_err "Veritabanı geri yüklendi AMA belge asıllarının eksiksiz olduğu DENETLENEMEDİ."
  collex_err "Yukarıdaki UYARI'yı okuyun; birkaç belgede \"Aslını indir\"i deneyin. Hiçbir veri silinmedi."
  exit 3
fi
if [ "$rc" -ne 0 ]; then
  collex_err "GERİ YÜKLEME TAMAMLANMADI. Yukarıdaki mesajı okuyun; hiçbir veri silinmedi."
  exit "$rc"
fi
collex_log "Geri yükleme tamam. collex-start.sh ile açıp kontrol edin."
collex_log "Eski veritabanı her şey yolundaysa elle silinebilir (yukarıda adı yazıyor)."
exit 0
