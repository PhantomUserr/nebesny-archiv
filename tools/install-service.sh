#!/usr/bin/env bash
# Ставит systemd-юнит для Nebesny Archiv (автозапуск + рестарт при падении).
# Требует sudo. Запуск: sudo bash tools/install-service.sh <каталог-сервера>
set -euo pipefail

TARGET_DIR="${1:-$HOME/nebesny-archiv}"
SERVICE="nebesny-archiv"
# при запуске через sudo $USER = root, а сервер должен работать от владельца каталога
RUN_USER="${SUDO_USER:-$USER}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
[ -n "$RUN_HOME" ] || RUN_HOME="$HOME"

[ -f "$TARGET_DIR/start-server.sh" ] || { echo "!!! нет $TARGET_DIR/start-server.sh"; exit 1; }

echo "==> unit для $TARGET_DIR"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Nebesny Archiv - Minecraft 1.21.1 NeoForge dedicated server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$TARGET_DIR
Environment=HOME=$RUN_HOME
ExecStart=/bin/bash $TARGET_DIR/start-server.sh
Restart=on-failure
RestartSec=15
TimeoutStopSec=60
KillSignal=SIGINT
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

# чтобы сервер поднимался без залогиненного пользователя
[Install]
WantedBy=multi-user.target
EOF

echo "==> включаем"
systemctl daemon-reload
systemctl enable "$SERVICE"
loginctl enable-linger "$RUN_USER" 2>/dev/null || true

echo "==> firewall"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 25565/tcp >/dev/null 2>&1 || true
  echo "    ufw: порты 22 и 25565 открыты"
else
  echo "    ufw не найден — открой порты в фаерволе вручную"
fi

echo ""
echo "Готово. Команды:"
echo "  systemctl start $SERVICE      запустить"
echo "  systemctl stop $SERVICE       остановить"
echo "  systemctl restart $SERVICE    перезапустить"
echo "  journalctl -u $SERVICE -f     логи в реальном времени"
echo "  systemctl status $SERVICE     состояние"
