@echo off
rem ============================================================
rem  ColleX baslatici - cift tikla: veritabani + sunucu + MCP + tarayici.
rem  Bu dosya yargi-mcp-independent kokunde durur; kendi konumuna gore calisir.
rem  Kalici veritabani: scoop PostgreSQL kumesi (port 55432, yalnizca 127.0.0.1).
rem
rem  Akis (W12-F):
rem    0) 8787'de saglikli bir ColleX zaten cevap veriyorsa yalnizca tarayiciyi acar.
rem    1) Eski "ColleX Sunucu" pencerelerini kapatir.
rem    2) Node / serve.mjs / PostgreSQL var mi kontrol eder; veritabanini baslatir.
rem    3) collex_local yoksa olusturur, eksik migrasyonlari uygular (asla silmez);
rem       basarisizlikta (STORE_UNAVAILABLE vb.) Turkce aciklar ve DURUR (W12-FIX2).
rem    4) Sunucuyu ayri pencerede --with-mcp ile baslatir.
rem    5) /v1/health 200 donene kadar (en fazla 60 sn) bekler, sonra tarayiciyi acar.
rem  Repo yolu ASCII disi karakter icerir: chcp 65001 kalmalidir.
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
set "COLLEX_NO_DOTENV=1"
set "ENSURELOG=%TEMP%\collex-ensure-db.log"
set "LIBLOG=%TEMP%\collex-library.log"
if defined COLLEX_DATA_DIR (set "LIBDIR=%COLLEX_DATA_DIR%\library") else (set "LIBDIR=%~dp0var\library")

set "PGROOT=%USERPROFILE%\scoop\apps\postgresql\current"
set "PGDATA_DIR=%PGROOT%\data"
set "PGBIN=%PGROOT%\bin"
set "PGPORT=55432"
set "APPPORT=8787"
set "HEALTHURL=http://127.0.0.1:%APPPORT%/v1/health"

rem --- 0) Zaten calisiyor mu? ---
call :health
if "%HEALTHY%"=="1" (
  echo [ColleX] Sunucu zaten calisiyor ^(%HEALTHURL%^); tarayici aciliyor.
  start "" http://127.0.0.1:%APPPORT%/
  timeout /t 3 >nul
  exit /b 0
)

rem --- 1) Sarkan sunucu pencerelerini kapat (yeni baslatmadan once).
rem     W14 B-34 (ENGRISK E12b): ONCE yasayan bir ColleX var mi diye bak.
rem     Adim 0'daki saglik kontrolu sunucu ACILIS SIRASINDAYSA (60 sn'lik
rem     pencere) HEALTHY=0 doner ve buradaki taskkill /F ACILMAKTA OLAN
rem     sunucuyu oldururdu - sabirsiz bir kullanicinin ikinci tiki tam
rem     olarak buydu. Pid dosyasi varsa ve o pid gercekten bir ColleX
rem     surecine aitse hicbir sey oldurulmez; dogrudan beklemeye gecilir. ---
set "COLLEX_VARDIR=var"
if not "%COLLEX_DATA_DIR%"=="" set "COLLEX_VARDIR=%COLLEX_DATA_DIR%"
set "COLLEX_ALIVE=0"
if exist "%COLLEX_VARDIR%\collex.pid" call :checkalive
if "%COLLEX_ALIVE%"=="1" (
  echo [ColleX] Sunucu zaten baslatiliyor; oldurmuyoruz, hazir olmasi bekleniyor.
  goto waitready
)
taskkill /FI "WINDOWTITLE eq ColleX Sunucu*" /T /F >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Node.js bulunamadi. nodejs.org adresinden kurun.
  pause
  exit /b 1
)

if not exist "control-plane\scripts\serve.mjs" (
  echo [ColleX] control-plane\scripts\serve.mjs bulunamadi.
  echo [ColleX] Bu dosya yargi-mcp-independent klasorunun icinde durmali.
  pause
  exit /b 1
)

if not exist "%PGBIN%\pg_ctl.exe" (
  echo [ColleX] PostgreSQL bulunamadi: %PGBIN%
  echo [ColleX] scoop install postgresql  ile kurun ya da PGROOT yolunu duzenleyin.
  pause
  exit /b 1
)

rem --- 2) Veritabani ayakta mi? Degilse baslat (hazir olana kadar bekler). ---
"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p %PGPORT% >nul 2>nul
if errorlevel 1 (
  echo [ColleX] Veritabani baslatiliyor ^(port %PGPORT%^)...
  "%PGBIN%\pg_ctl.exe" -D "%PGDATA_DIR%" -o "-p %PGPORT% -c listen_addresses=127.0.0.1" -l "%TEMP%\collex-postgres.log" -w start >nul 2>nul
  "%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p %PGPORT% >nul 2>nul
  if errorlevel 1 (
    echo [ColleX] Veritabani baslatilamadi. Gunluk: %TEMP%\collex-postgres.log
    pause
    exit /b 1
  )
  echo [ColleX] Veritabani hazir.
) else (
  echo [ColleX] Veritabani zaten calisiyor.
)

rem --- 2b) W14 B-45 (ENGRISK E18): 55432'yi dinleyen kume BIZIM kumemiz mi?
rem     Kullanici ileride normal bir PostgreSQL kurup bu portu kaparsa ColleX
rem     BOS bir kumeye baglanir ve avukat "butun dosyalarim gitti" gorur.
rem     Yanlis kumeye baglanmaktansa durmak dogrudur. (Blogun DISINDA:
rem     parantezli blok icinde %CLUSTER_OK% gecikmeli genisletme olmadan
rem     eski degerini okurdu.)
rem     28.09.2026: uyari satirlari PARANTEZLI BLOKTA DEGIL, :clusterbad
rem     etiketindedir. Blok icinde CLUSTER_DIR acilinca degerdeki ")"
rem     blogu kapatiyordu ("(okunamadi)" yer tutucusu tam olarak buydu):
rem     son iki uyari satiri, pause ve exit /b 1 KOSULSUZ calisti ve
rem     ColleX her acilista "yanlis kume" diyerek durdu. ---
call :checkcluster
if "%CLUSTER_OK%"=="0" goto clusterbad

rem --- 3) Kalici urun veritabani var mi? Yoksa olustur; eksik migrasyonlari uygula
rem        (yalniz olusturur, silmez). W12-FIX2 (P2-16): basarisizlik ARTIK
rem        sessizce gecilmez - STORE_UNAVAILABLE ya da baska bir hata Turkce
rem        aciklanir ve baslatma durur; sunucu sema olmadan acilmaz. ---
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m intake.cli --dsn postgres://postgres@127.0.0.1:%PGPORT%/collex_local --ensure-db --list >"%ENSURELOG%" 2>&1
  if errorlevel 1 (
    findstr /c:"STORE_UNAVAILABLE" "%ENSURELOG%" >nul 2>nul
    if not errorlevel 1 (
      echo [ColleX] Yerel veritabanina ulasilamadi ^(STORE_UNAVAILABLE^): PostgreSQL 127.0.0.1:%PGPORT% baglanti kabul etmiyor.
      echo [ColleX] Gunluk: %TEMP%\collex-postgres.log ve %ENSURELOG%
    ) else (
      echo [ColleX] Veritabani semasi hazirlanamadi ^(intake.cli --ensure-db basarisiz^).
      echo [ColleX] Ayrinti: %ENSURELOG%
    )
    echo [ColleX] Sunucu baslatilmadi. Sorunu giderip ColleX-Baslat.cmd dosyasini yeniden calistirin.
    pause
    exit /b 1
  )
  echo [ColleX] Veritabani semasi hazir.

  rem --- 3b) W16: canli arastirmada getirilen kararlari kutuphaneye yayimla.
  rem        Kuyruk <veri>\library altindadir ve her "Tam metni getir" oraya
  rem        yazar. Yayimlama BASLATMAYI DURDURMAZ: kuyruk bos olabilir, bir
  rem        zarf bozuk olabilir, veritabani mesgul olabilir - hicbiri avukatin
  rem        programi acmasina engel degildir. Bozuk zarf SILINMEZ, yerinde
  rem        kalir ve bir sonraki acilista yeniden denenir. ---
  if exist "%LIBDIR%" (
    ".venv\Scripts\python.exe" -m ingestion.cli --dsn postgres://postgres@127.0.0.1:%PGPORT%/collex_local --publish-library "%LIBDIR%" >"%LIBLOG%" 2>&1
    if errorlevel 1 (
      echo [ColleX] Kutuphaneye yayimlama tamamlanamadi; program yine de aciliyor.
      echo [ColleX] Ayrinti: %LIBLOG%
    ) else (
      echo [ColleX] Kutuphane guncel: getirilen kararlar bu bilgisayarda saklandi.
    )
  )
) else (
  echo [ColleX] Python calisma ortami bulunamadi; belge yukleme acilamaz.
  echo [ColleX] Kurulum tamamlanmadan program baslatilmadi.
  pause
  exit /b 1
)

rem --- 4) Sunucu + MCP gecidi ayri pencerede. ---
echo [ColleX] Sunucu ayri pencerede baslatiliyor ^(kapatmak icin: ColleX-Durdur.cmd^)...
start "ColleX Sunucu" cmd /k "chcp 65001 >nul && cd /d "%~dp0" && node control-plane\scripts\serve.mjs --port %APPPORT% --with-mcp --with-local-embeddings --local-embeddings-port 8899"

rem --- 5) Saglik: /v1/health 200 donene kadar bekle (2 sn x 30 = 60 sn). ---
:waitready
echo [ColleX] Sunucu hazir olana kadar bekleniyor...
set /a TRIES=0
:poll
call :health
if "%HEALTHY%"=="1" goto ready
set /a TRIES+=1
if %TRIES% geq 30 goto failed
timeout /t 2 /nobreak >nul
goto poll

:ready
echo [ColleX] Hazir. Arayuz aciliyor: http://127.0.0.1:%APPPORT%/
start "" http://127.0.0.1:%APPPORT%/
echo [ColleX] Bu pencereyi kapatabilirsiniz. Tamamen kapatmak icin: ColleX-Durdur.cmd
timeout /t 5 >nul
exit /b 0

:failed
echo [ColleX] Sunucu 60 saniye icinde hazir olmadi.
echo [ColleX] "ColleX Sunucu" penceresindeki mesaja bakin:
echo [ColleX]   - "veritabani: CALISMIYOR"  -^> PostgreSQL ayaga kalkmadi; %TEMP%\collex-postgres.log
echo [ColleX]   - "portu kullanimda"        -^> eski bir sunucu aciktir; ColleX-Durdur.cmd calistirin
pause
exit /b 1

rem --- 55432'deki kume bizim degil (E18). Blok DISINDA: yollardaki parantez
rem     ya da baska ozel karakter bu satirlari bozamaz. ---
:clusterbad
echo [ColleX] DURDURULDU: 127.0.0.1:%PGPORT% portunu ColleX'in veritabani DEGIL,
echo [ColleX] baska bir PostgreSQL kumesi dinliyor.
echo [ColleX]   Beklenen veri dizini: %PGDATA_DIR%
echo [ColleX]   Bulunan veri dizini : %CLUSTER_DIR%
echo [ColleX] Dosyalariniz duruyor; yanlis kumeye baglanmamak icin baslatma durduruldu.
echo [ColleX] Diger PostgreSQL hizmetini kapatip yeniden deneyin.
pause
exit /b 1

rem --- Pid dosyasindaki surec yasiyor ve gercekten ColleX mi? (E12b) ---
:checkalive
set "COLLEX_ALIVE=0"
for /f "usebackq" %%p in ("%COLLEX_VARDIR%\collex.pid") do (
  for /f "usebackq delims=" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $p = Get-CimInstance Win32_Process -Filter \"ProcessId = %%p\"; if ($p -and $p.CommandLine -match 'serve\.mjs') { '1' } else { '0' }"`) do set "COLLEX_ALIVE=%%a"
)
exit /b 0

rem --- 55432'yi dinleyen kumenin veri dizini bizimki mi? (E18)
rem     28.09.2026: psql artik "for /f" ICINDE calismaz. for /f komutu
rem     "cmd /c" ile calistirir; komut tirnakla basliyor ve icinde baska
rem     tirnak da oldugu icin cmd /c ILK ve SON tirnagi siliyordu: psql hic
rem     calismadi, veri dizini hic okunmadi. Cikti gecici bir dosyaya yazilir
rem     ve "set /p" ile okunur. -w: parola sorup beklemez. Yollar PowerShell'e
rem     ortam degiskeniyle gecer (tirnak ya da kesme isareti bozamaz). ---
:checkcluster
set "CLUSTER_OK=1"
set "CLUSTER_DIR="
set "CLUSTERTXT=%TEMP%\collex-cluster.txt"
del /q "%CLUSTERTXT%" >nul 2>nul
"%PGBIN%\psql.exe" -h 127.0.0.1 -p %PGPORT% -U postgres -d postgres -w -Atc "show data_directory" >"%CLUSTERTXT%" 2>nul
if errorlevel 1 goto clusterunknown
if exist "%CLUSTERTXT%" set /p CLUSTER_DIR=<"%CLUSTERTXT%"
del /q "%CLUSTERTXT%" >nul 2>nul
if not defined CLUSTER_DIR goto clusterunknown
rem 0 = ayni dizin, 1 = BASKA dizin, 2 = karsilastirilamadi (denetim atlanir;
rem PowerShell'in kendi hatasi "yanlis kume" diye okunmaz).
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $a=[IO.Path]::GetFullPath($env:CLUSTER_DIR.Trim()).TrimEnd([char]92,[char]47); $b=[IO.Path]::GetFullPath($env:PGDATA_DIR.Trim()).TrimEnd([char]92,[char]47); if ($a -ieq $b) { exit 0 } else { exit 1 } } catch { exit 2 }"
if errorlevel 2 goto clusterunknown
if errorlevel 1 set "CLUSTER_OK=0"
exit /b 0
:clusterunknown
set "CLUSTER_DIR=okunamadi"
echo [ColleX] Veritabani kumesinin veri dizini okunamadi; bu denetim atlandi.
exit /b 0

rem --- Saglik kontrolu: HEALTHY=1 yalnizca HTTP 200 donerse. ---
rem (usebackq: komut ters tirnak icinde, boylece PowerShell'in tek tirnaklari serbest)
:health
set "HEALTHY=0"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri '%HEALTHURL%'; if ($r.StatusCode -eq 200) { '1' } else { '0' } } catch { '0' }"`) do set "HEALTHY=%%s"
exit /b 0
