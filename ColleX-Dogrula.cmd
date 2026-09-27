@echo off
rem ============================================================
rem  ColleX DOGRULAMA — cift tikla (ColleX calisirken).
rem
rem  Neden (W23): gelistirme ortaminin agi resmi kaynaklari engelliyor;
rem  gercek bir dil modeli ve fiziksel bilgisayar orada yok. Bu betik
rem  SIZIN bilgisayarinizda, SIZIN ColleX'inize karsi olcer:
rem    - 26 resmi kaynagin her birinde bir arama ve bir tam metin
rem      (metnin parmak izi burada yeniden hesaplanir),
rem    - ayarliysa yerel yapay zeka modeli (yalniz ornek cumlelerle).
rem  Dosyalariniza, taslaklariniza ve cevaplariniza HICBIR SEY yazmaz.
rem  Istekler sirayla, aralikli gider (kaynak kotasi).
rem  Rapor: %COLLEX_DATA_DIR%\dogrulama\ ya da var\dogrulama\
rem
rem  Bulut yapay zekayi da denemek icin: ColleX-Dogrula.cmd --bulut
rem  (ANTHROPIC_API_KEY bu pencerenin ortaminda olmalidir; uc ucretli,
rem  ornek cumlelerle cagri yapilir, muvekkil verisi gonderilmez.)
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Node.js bulunamadi. nodejs.org adresinden kurun.
  pause
  exit /b 1
)

node control-plane\scripts\verify-on-machine.mjs --base http://127.0.0.1:8787 %*
if errorlevel 2 (
  echo.
  echo [ColleX] ColleX calismiyor. Once ColleX-Baslat.cmd ile baslatin, sonra bu betigi yeniden calistirin.
  pause
  exit /b 1
)
echo.
echo [ColleX] Raporu okuyup saklayin; isterseniz gelistiriciye gonderin (muvekkil verisi icermez).
pause
