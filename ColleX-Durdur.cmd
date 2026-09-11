@echo off
rem ColleX'i tamamen kapatir: sunucu penceresi + MCP gecidi (uvicorn) + veritabani.
rem Sira (W14 B-34): NAZIK DURDURMA -> pencere -> pid dosyalari (yalniz komut
rem satiri gercekten ColleX ise) -> komut satirinda serve.mjs / serve-mcp.mjs /
rem "uvicorn asgi_app" / "local_embedding_server --collex-managed" gecen
rem surecler -> PostgreSQL.
rem
rem W14 B-34 (ENGRISK E10) — neden nazik durdurma once geliyor:
rem   Windows'ta taskkill /F sureci TerminateProcess ile oldurur; Node'un
rem   SIGINT / SIGTERM / exit kancalari CALISMAZ. Yani serve.mjs'in shutdown()
rem   yolu — answerStore.flush(), draftStore.flush(), pid temizligi,
rem   sql.end() — bugune kadar URUNDE HIC KOSMADI; var\collex.pid her
rem   kapanista yerinde kaldi (RISKS #22'nin gozledigi belirti, sebebi bu).
rem   serve.mjs artik <veri>\collex.stop dosyasini 500 ms'de bir yokluyor.
rem   Once o dosyayi olusturup 6 saniye bekleriz; surec kendi kapandiysa
rem   sert kapatma hic gerekmez.
rem
rem W12-FIX2 (P2-16): 8787/8898 portunu dinleyen HERHANGI bir surec
rem kapatilmaz (baska bir uygulama olabilir); yalniz komut satiri ColleX'e ait
rem olan surecler kapatilir. Eski/yeniden kullanilmis pid'ler de ayni sinamadan
rem gecer. Repo yolu ASCII disi: chcp 65001 kalir.
chcp 65001 >nul
cd /d "%~dp0"

set "PGROOT=%USERPROFILE%\scoop\apps\postgresql\current"
set "PGDATA_DIR=%PGROOT%\data"
set "PGBIN=%PGROOT%\bin"
set "PGPORT=55432"
set "COLLEX_CMDLINE=serve\.mjs|serve-mcp\.mjs|uvicorn asgi_app|local_embedding_server.*--collex-managed"

rem --- Veri dizini: serve.mjs ile AYNI cozucu (B-34). ---
set "COLLEX_VARDIR=var"
if not "%COLLEX_DATA_DIR%"=="" set "COLLEX_VARDIR=%COLLEX_DATA_DIR%"

rem --- 1) Nazik durdurma (kayitlari diske yazar). ---
if exist "%COLLEX_VARDIR%\collex.pid" call :gracefulstop

del /q "%COLLEX_VARDIR%\collex.stop" >nul 2>nul

echo [ColleX] Sunucu pencereleri kapatiliyor...
taskkill /FI "WINDOWTITLE eq ColleX Sunucu*" /T /F >nul 2>nul

rem --- pid dosyalari (serve.mjs yazar; normal kapanista siler). Bir pid ancak
rem     komut satiri ColleX'e aitse oldurulur (P2-16: yeniden kullanilmis pid). ---
for %%f in ("%COLLEX_VARDIR%\collex-mcp.pid" "%COLLEX_VARDIR%\collex.pid") do (
  if exist %%f (
    for /f "usebackq" %%p in (%%f) do call :killpid %%p
    del /q %%f >nul 2>nul
  )
)

rem --- Komut satiri ColleX'e ait olan sarkan surecler (serve.mjs, serve-mcp.mjs,
rem     uvicorn asgi_app). Port dinleyicileri DEGIL. ---
echo [ColleX] ColleX'e ait sarkan surecler kapatiliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $pat='%COLLEX_CMDLINE%'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match $pat) -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

echo [ColleX] Veritabani durduruluyor...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA_DIR%" -m fast -w stop >nul 2>nul
"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p %PGPORT% >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Kapatildi.
) else (
  echo [ColleX] Veritabani hala calisiyor gorunuyor; gunluk: %TEMP%\collex-postgres.log
)
timeout /t 3 >nul
exit /b 0

rem --- Nazik durdurma: collex.stop dosyasini birak, pid dosyasinin
rem     kaybolmasini bekle. serve.mjs pid dosyasini ancak flush() ve
rem     sql.end() bittikten sonra siler, yani pid'in gitmesi "kayitlar
rem     yazildi" demektir. ---
:gracefulstop
echo [ColleX] Nazik durdurma isteniyor ^(kayitlar diske yaziliyor^)...
if not exist "%COLLEX_VARDIR%" mkdir "%COLLEX_VARDIR%" >nul 2>nul
echo stop> "%COLLEX_VARDIR%\collex.stop"
set /a WAITED=0
:waitloop
timeout /t 1 /nobreak >nul
set /a WAITED+=1
if not exist "%COLLEX_VARDIR%\collex.pid" (
  echo [ColleX] Sunucu duzgun kapandi.
  exit /b 0
)
if %WAITED% lss 6 goto waitloop
echo [ColleX] Sunucu 6 saniyede kapanmadi; sert kapatmaya geciliyor.
exit /b 0

rem --- Bir pid'i yalnizca komut satiri ColleX'e aitse (agaciyla) kapat. ---
:killpid
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $p = Get-CimInstance Win32_Process -Filter \"ProcessId = %1\"; if ($p -and $p.CommandLine -match '%COLLEX_CMDLINE%') { Stop-Process -Id %1 -Force }"
exit /b 0
