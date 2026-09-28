#!/bin/bash
# UNVALIDATED ON PHYSICAL MAC
#
# ColleX from outside the house (MacBook): an SSH tunnel over Tailscale to the
# ColleX running on the home Windows PC.
#
# The ColleX console has no login of its own and stays bound to 127.0.0.1 on
# the Windows PC (CLAUDE.md, ADR-025): nothing is opened on the network. This
# Mac reaches it only through the tunnel, as http://127.0.0.1:8787 in its own
# browser; the tunnel itself needs the Windows password and runs only inside
# Tailscale's private network (ColleX-Uzak-Erisim.cmd limits SSH to it).
#
# Double-click in Finder, or in Terminal: bash ColleX-Uzaktan.command
# The first run asks for the Windows PC's Tailscale name and user name and
# remembers them in ~/.collex-uzaktan.

set -u

CONF="$HOME/.collex-uzaktan"
SOCK="$HOME/.collex-uzaktan.sock"
LOCAL_PORT="${COLLEX_UZAK_PORT:-8787}"

if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi
if [ -z "${EV_ADRES:-}" ] || [ -z "${EV_KULLANICI:-}" ]; then
  read -r -p "Evdeki Windows bilgisayarin Tailscale adi ya da adresi (100. ile baslar): " EV_ADRES
  read -r -p "Windows kullanici adiniz: " EV_KULLANICI
  (umask 077 && printf 'EV_ADRES=%q\nEV_KULLANICI=%q\n' "$EV_ADRES" "$EV_KULLANICI" > "$CONF")
fi

echo "[ColleX] Evdeki bilgisayara baglaniliyor ($EV_KULLANICI@$EV_ADRES)."
echo "[ColleX] Windows parolaniz sorulursa girin (ekranda gorunmez)."
if ! ssh -f -N -M -S "$SOCK" \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L "127.0.0.1:$LOCAL_PORT:127.0.0.1:8787" "$EV_KULLANICI@$EV_ADRES"; then
  echo "[ColleX] Baglanilamadi. Kontrol edin: Tailscale bu Mac'te ve evde acik mi, evdeki bilgisayar uyanik mi,"
  echo "[ColleX] ColleX-Uzak-Erisim.cmd orada bir kez calistirildi mi? Kayitli adresi silmek icin: rm ~/.collex-uzaktan"
  read -r -p "Kapatmak icin Enter'a basin." _
  exit 1
fi

open "http://127.0.0.1:$LOCAL_PORT/"
echo "[ColleX] Acik: http://127.0.0.1:$LOCAL_PORT/  (ColleX evde calisiyor olmali: ColleX-Baslat.cmd)"
read -r -p "[ColleX] Baglantiyi kapatmak icin Enter'a basin." _
ssh -S "$SOCK" -O exit "$EV_KULLANICI@$EV_ADRES" >/dev/null 2>&1 || true
echo "[ColleX] Baglanti kapatildi."
