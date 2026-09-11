@echo off
rem ============================================================
rem  ColleX GERI YUKLEME (W14 B-03).
rem
rem  Kullanim:  ColleX-Geri-Yukle.cmd "C:\Users\...\ColleX-Yedek\20260902-143000"
rem
rem  Pazarlik edilemeyen tasarim kararlari:
rem   1. ONCE DOGRULAMA. yedek.json'daki her dosyanin SHA-256 ozeti yeniden
rem      hesaplanir. Bozuk bir yedekle geri yukleme baslamaz; sonradan
rem      dogrulamak dogrulama degildir.
rem   2. ASLA "drop database" ile baslanmaz. Mevcut collex_local yeniden
rem      ADLANDIRILIR (collex_local_eski_<tarih>), yerine bos bir veritabani
rem      acilir. Geri yukleme basarisiz olursa eski veriniz yerinde durur.
rem   3. pg_restore --exit-on-error: yarim geri yuklenmis bir veritabani,
rem      ledger'in kandirildigi durumun ta kendisidir (ENGRISK E3).
rem   4. robocopy /E asillari BIRLESTIRIR, silmez: eksik bir yedek diskteki
rem      mevcut belgeleri yok edemez.
rem   5. ARSIV DOSYASININ ADI MANIFESTTEN OKUNUR (V-14). Eskiden burada
rem      "collex_local.dump" adi sabit yaziliydi; yedek her veritabani icin
rem      ayni adi kullandigi surece bu kontrol TESADUFEN calisiyordu. Artik
rem      dosya adini yedek.json soyluyor (backup.mjs --dump-name).
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

set "PGROOT=%USERPROFILE%\scoop\apps\postgresql\current"
set "PGBIN=%PGROOT%\bin"
set "PGPORT=55432"
set "DBNAME=collex_local"
set "SRC=%~1"

if "%SRC%"=="" (
  echo Kullanim: ColleX-Geri-Yukle.cmd "C:\Users\...\ColleX-Yedek\20260902-143000"
  pause
  exit /b 1
)
if not exist "%PGBIN%\pg_restore.exe" (
  echo [ColleX] PostgreSQL araclari bulunamadi: %PGBIN%
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Node.js bulunamadi. nodejs.org adresinden kurun.
  pause
  exit /b 1
)

rem --- 0) Arsivin adini MANIFESTTEN oku (V-14). ---
set "DUMPNAME="
rem stderr bastirilir: avukat asagidaki Turkce cumleyi gorur, surucunun
rem dosya-yolu mesajini degil. Basarisizlik bos %DUMPNAME% ile anlasilir.
for /f "usebackq delims=" %%D in (`node control-plane\scripts\backup.mjs --dump-name "%SRC%" 2^>nul`) do set "DUMPNAME=%%D"
if "%DUMPNAME%"=="" (
  echo [ColleX] Bu klasor bir ColleX yedegi degil ^(yedek.json okunamadi^): %SRC%
  pause
  exit /b 1
)
if not exist "%SRC%\%DUMPNAME%" (
  echo [ColleX] Yedek dosyasi yok: %SRC%\%DUMPNAME%
  pause
  exit /b 1
)

rem --- 1) YAZMADAN ONCE DOGRULA. ---
echo [ColleX] Yedek dogrulaniyor ^(arsiv: %DUMPNAME%; her dosyanin SHA-256 ozeti^)...
node control-plane\scripts\backup.mjs --verify "%SRC%"
if errorlevel 1 (
  echo.
  echo [ColleX] Bu yedek BOZUK. Geri yukleme YAPILMADI; mevcut verinize dokunulmadi.
  echo [ColleX] Baska bir yedek klasoru deneyin.
  pause
  exit /b 1
)

echo.
echo  DIKKAT: mevcut %DBNAME% veritabani yeniden adlandirilacak ve yerine
echo  bu yedek geri yuklenecek. Once ColleX-Durdur.cmd calistirin.
echo.
set "ONAY="
set /p ONAY="Devam etmek icin EVET yazin: "
if /I not "%ONAY%"=="EVET" (
  echo Iptal edildi. Hicbir sey degismedi.
  pause
  exit /b 1
)

"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p %PGPORT% >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Veritabani calismiyor. Once ColleX-Baslat.cmd calistirin
  echo [ColleX] ^(sonra sunucuyu ColleX-Durdur.cmd ile kapatin, veritabani acik kalsin^).
  pause
  exit /b 1
)

set "STAMP=%date:~-4%%date:~3,2%%date:~0,2%-%time:~0,2%%time:~3,2%"
set "STAMP=%STAMP: =0%"

rem --- 2) Guvenlik agi: geri yukleme de bir risktir; mevcut hali once yedekle. ---
echo [ColleX] Mevcut veritabaninin yedegi aliniyor ^(guvenlik agi^)...
"%PGBIN%\pg_dump.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d %DBNAME% -Fc -f "%TEMP%\collex_local_gerialma_oncesi_%STAMP%.dump" 2>nul

rem --- 3) Eskiyi SAKLA, yerine bos bir veritabani ac. ASLA drop ile baslama. ---
echo [ColleX] Mevcut veritabani %DBNAME%_eski_%STAMP% adiyla saklaniyor...
"%PGBIN%\psql.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d postgres -v ON_ERROR_STOP=1 -c "alter database %DBNAME% rename to %DBNAME%_eski_%STAMP%;" -c "create database %DBNAME%;"
if errorlevel 1 (
  echo [ColleX] Veritabani hazirlanamadi ^(baska bir surec bagli olabilir^).
  echo [ColleX] ColleX-Durdur.cmd calistirip yeniden deneyin. Hicbir veri silinmedi.
  pause
  exit /b 1
)

rem --- 4) Geri yukleme. ---
echo [ColleX] Veritabani geri yukleniyor...
"%PGBIN%\pg_restore.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d %DBNAME% --no-owner --no-privileges --exit-on-error "%SRC%\%DUMPNAME%"
if errorlevel 1 (
  echo.
  echo [ColleX] GERI YUKLEME BASARISIZ.
  echo [ColleX] Eski veritabaniniz %DBNAME%_eski_%STAMP% adiyla DURUYOR — veri kaybi yok.
  echo [ColleX] Geri almak icin: psql -c "drop database %DBNAME%; alter database %DBNAME%_eski_%STAMP% rename to %DBNAME%;"
  pause
  exit /b 1
)

rem --- 5) Belge asillari: BIRLESTIRIR, silmez. ---
set "COLLEX_VARDIR=var"
if not "%COLLEX_DATA_DIR%"=="" set "COLLEX_VARDIR=%COLLEX_DATA_DIR%"
echo [ColleX] Belge asillari geri konuluyor ^(mevcut dosyalar silinmez^)...
robocopy "%SRC%\uploads" "%COLLEX_VARDIR%\uploads" /E /R:2 /W:1 /NFL /NDL /NJH /NJS >nul
if errorlevel 8 (
  echo [ColleX] UYARI: belge asillari kopyalanirken hata olustu; veritabani geri yuklendi.
)

rem --- 6) Dogrulama: sayilari bas. pg_policies satiri B-05'e emniyet agidir. ---
echo.
echo [ColleX] Geri yuklenen icerik:
"%PGBIN%\psql.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d %DBNAME% -Atc "select 'dosya='||(select count(*) from app_private.matters)||'  cevap='||(select count(*) from app_private.answers)||'  taslak='||(select count(*) from app_private.drafts)||'  belge='||(select count(*) from legal.documents where scope='tenant')||'  politika='||(select count(*) from pg_policies where schemaname in ('legal','app_private'))||'  migrasyon='||(select count(*) from app_private.schema_migrations);"

echo.
echo [ColleX] Geri yukleme tamam. Eski veritabani: %DBNAME%_eski_%STAMP%
echo [ColleX] Her sey yolundaysa ELLE silin:
echo [ColleX]   psql -c "drop database %DBNAME%_eski_%STAMP%;"
echo [ColleX] ColleX-Baslat.cmd ile acip kontrol edin.
pause
exit /b 0
