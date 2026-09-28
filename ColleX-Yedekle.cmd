@echo off
rem ============================================================
rem  ColleX YEDEKLEME - cift tikla.
rem
rem  Neden (W14 B-03): dosyalariniz, her taslak surumu, sureler ve
rem  yukledigniz belgelerin ASILLARI tek diskte, tek veritabaninda duruyor.
rem  "Verileriniz bu bilgisayarda" cumlesi yedek olmadan yarim bir sozdur:
rem  disk arizasi, yanlis bir kaldirma islemi ya da fidye yazilimi hepsini
rem  goturur. Bu betik bir klasore uc sey birakir:
rem     collex_local.dump   veritabaninin tamami (pg_dump -Fc). Dosya adi
rem                         yedeklenen VERITABANININ adidir (V-14); geri
rem                         yukleyici bu adi yedek.json'dan okur.
rem     uploads\            belgelerin asillari
rem     yedek.json          her dosyanin boyutu ve SHA-256 ozeti
rem  Ucu birden olmadan geri yukleme yapilamaz; yedek.json geri yuklemeden
rem  ONCE dogrulama yapmayi mumkun kilar (ColleX-Geri-Yukle.cmd).
rem
rem  Yedek ALIRKEN collex_local'a hicbir sey YAZILMAZ (pg_dump yalniz okur).
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

set "PGROOT=%USERPROFILE%\scoop\apps\postgresql\current"
set "PGBIN=%PGROOT%\bin"
set "PGPORT=55432"
set "DBNAME=collex_local"
if not "%~1"=="" (set "OUTROOT=%~1") else (set "OUTROOT=%USERPROFILE%\ColleX-Yedek")

if not exist "%PGBIN%\pg_dump.exe" (
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

"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p %PGPORT% >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Veritabani calismiyor. Once ColleX-Baslat.cmd calistirin.
  pause
  exit /b 1
)

echo [ColleX] Yedek aliniyor: %DBNAME%
echo [ColleX] Hedef klasor   : %OUTROOT%
echo.
node control-plane\scripts\backup.mjs --database %DBNAME% --out "%OUTROOT%" --port %PGPORT%
if errorlevel 1 (
  echo.
  echo [ColleX] YEDEK BASARISIZ. Yukaridaki mesaji okuyun; hicbir sey silinmedi.
  pause
  exit /b 1
)

echo.
echo [ColleX] Bu klasoru harici bir diske veya bulut klasorune KOPYALAYIN.
echo [ColleX] UYARI: yedek klasoru MUVEKKIL VERISI icerir - sifreli bir diske
echo [ColleX] veya BitLocker'li bir klasore koyun.
echo [ColleX] Geri yuklemek icin: ColleX-Geri-Yukle.cmd "klasor yolu"
pause
exit /b 0
