@echo off
rem ============================================================
rem  ColleX BEYIN BAGLANTISI - cift tikla, bir kez.
rem
rem  Evdeki Mac mini'de calisan yerel yapay zeka modelini (beyin) bu
rem  bilgisayardaki ColleX'e baglar. Once Mac mini'de:
rem      bash collex-beyin.sh kur
rem  Bu betik oradaki adresi ve parolayi sorar, Mac mini cevap verirse
rem  ColleX'in ayarlarini kullanici duzeyinde yazar (.env'e ASLA yazmaz).
rem  Iki bilgisayar Tailscale ile baglidir; belgeler internete cikmaz.
rem  Asil is scripts\collex_beyin_bagla.ps1 dosyasindadir.
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\collex_beyin_bagla.ps1"
echo.
pause
