@echo off
rem ============================================================
rem  ColleX UZAKTAN ERISIM - sag tik, "Yonetici olarak calistir", bir kez.
rem
rem  Disaridayken MacBook'tan bu bilgisayardaki ColleX'e baglanabilmek icin
rem  Windows'un kendi SSH sunucusunu acar. ColleX'in kendisi ag'a ACILMAZ:
rem  yine yalniz 127.0.0.1'de calisir (giris ekrani yoktur). MacBook ona
rem  yalniz sifreli bir SSH tuneliyle, Windows parolanizla ulasir.
rem
rem  Guvenlik sinirlari:
rem   - SSH kapisi (22) YALNIZ Tailscale adreslerine (100.64.0.0/10) aciktir;
rem     ev agindaki ya da internetteki baska bir cihaz ona ulasamaz.
rem   - Modemde hicbir kapi acilmaz; 8787 hicbir zaman aga yonlendirilmez.
rem   - Bilgisayar prizdeyken uykuya gecmez (disaridan ulasmak icin gerekli).
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

net session >nul 2>nul
if errorlevel 1 goto notadmin

echo [ColleX] Windows SSH sunucusu kuruluyor ve Tailscale ile sinirlaniyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $c = Get-WindowsCapability -Online | Where-Object { $_.Name -like 'OpenSSH.Server*' } | Select-Object -First 1; if ($c -and $c.State -ne 'Installed') { Add-WindowsCapability -Online -Name $c.Name | Out-Null }; Set-Service -Name sshd -StartupType Automatic; Start-Service sshd; $r = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue; if (-not $r) { New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null }; Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Enabled True -Profile Any -RemoteAddress '100.64.0.0/10'"
if errorlevel 1 goto failed

powercfg /change standby-timeout-ac 0 >nul 2>nul
echo [ColleX] Tamam. SSH yalniz Tailscale icinden acik; bilgisayar prizdeyken uyumaz.
echo [ColleX] MacBook'ta ColleX-Uzaktan.command ilk acilista sunlari soracak:
echo [ColleX]   Kullanici adi: %USERNAME%
powershell -NoProfile -Command "$t = Get-Command tailscale -ErrorAction SilentlyContinue; if ($t) { $a = & $t.Source ip -4 2>$null | Select-Object -First 1; Write-Host ('[ColleX]   Adres        : ' + $a) } else { Write-Host '[ColleX]   Adres        : Tailscale bu bilgisayarda bulunamadi; once kurun (tailscale.com).' }"
echo [ColleX] Parola: bu bilgisayara girerken kullandiginiz Windows / Microsoft hesabi parolasi (PIN degil).
pause
exit /b 0

:notadmin
echo [ColleX] Bu betik yonetici izni ister: dosyaya SAG tiklayip "Yonetici olarak calistir" secin.
pause
exit /b 1

:failed
echo [ColleX] SSH sunucusu kurulamadi. Ayarlar ^> Sistem ^> Istege bagli ozellikler ^> "OpenSSH Sunucusu" elle eklenebilir.
pause
exit /b 1
