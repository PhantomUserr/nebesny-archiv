#!/usr/bin/env bash
# ============================================================================
#  Nebesny Archiv — «не засыпать»: сон, крышка, USB-autosuspend, Wi-Fi.
#  Запуск (root): sudo bash tools/harden-server.sh
# ============================================================================
set -euo pipefail

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "systemd: запрещаю сон/гибернацию"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/99-nebesny.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
EOF

say "USB: выключаю autosuspend (частая причина отвала Wi-Fi свистка)"
cat > /etc/udev/rules.d/99-usb-no-autosuspend.rules <<'EOF'
ACTION=="add", SUBSYSTEM=="usb", TEST=="power/control", ATTR{power/control}="on"
EOF
udevadm control --reload-rules 2>/dev/null || true
for f in /sys/bus/usb/devices/*/power/control; do
  echo on > "$f" 2>/dev/null || true
done

say "NetworkManager: Wi-Fi без энергосбережения"
mkdir -p /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/99-wifi-powersave-off.conf <<'EOF'
[connection]
wifi.powersave = 2
EOF

IFACE=$(ip -o -4 addr show | awk '/192\.168\.10\./ {print $2; exit}')
if [ -n "${IFACE:-}" ]; then
  iw dev "$IFACE" set power_save off 2>/dev/null || true
  echo "интерфейс: $IFACE"
fi

say "XFCE: никогда не спать и не гасить экран"
USER_NAME="${SUDO_USER:-server}"
USER_ID=$(id -u "$USER_NAME")
for DISP in :0 :1; do
  for PROBE in "inactivity-on-ac 0" "inactivity-on-battery 0" "blank-on-ac 0" "blank-on-battery 0" \
               "dpms-enabled false" "lid-action-on-ac 3" "lid-action-on-battery 3"; do
    set -- $PROBE
    sudo -u "$USER_NAME" env DISPLAY="$DISP" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$USER_ID/bus" \
      xfconf-query -c xfce4-power-manager -p "/xfce4-power-manager/$1" -s "$2" 2>/dev/null || true
  done
done

echo
echo "=== проверка ==="
systemctl is-enabled sleep.target suspend.target 2>&1 || true
echo "--- logind ---"
cat /etc/systemd/logind.conf.d/99-nebesny.conf
echo "--- XFCE ---"
sudo -u "$USER_NAME" env DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$USER_ID/bus" \
  xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/inactivity-on-ac 2>/dev/null || echo "сессия недоступна"
echo "--- USB ---"
grep -h . /sys/bus/usb/devices/*/power/control 2>/dev/null | sort | uniq -c || true
echo "готово"
