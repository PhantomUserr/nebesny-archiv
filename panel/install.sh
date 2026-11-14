#!/usr/bin/env bash
# ============================================================================
#  MCPanel — панель серверов Minecraft
#  Установщик. Запускать от root:  sudo bash panel/install.sh
# ============================================================================
set -euo pipefail

PANEL_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$PANEL_DIR/data"
PANEL_USER="${RUN_USER:-server}"
SERVICE="mcpanel"

SERVER_DIR="${SERVER_DIR:-/home/server/nebesny-archiv}"
SERVER_UNIT="${SERVER_UNIT:-nebesny-archiv}"
SERVER_RCON_PORT="${RCON_PORT:-25575}"
SERVER_RCON_PASSWORD="${RCON_PASSWORD:-}"
PORT="${PANEL_PORT:-8080}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запускать через sudo"

say "Проверяю пользователя $PANEL_USER"
id "$PANEL_USER" >/dev/null 2>&1 || die "пользователь $PANEL_USER не существует (задайте RUN_USER)"

say "Node.js"
if ! command -v node >/dev/null 2>&1; then
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm
fi
NODE_BIN="$(command -v node)"
NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"
node -v
npm -v
if [ "$NODE_MAJOR" -lt 18 ]; then
  warn "Node.js $NODE_MAJOR слишком старый, панели нужен Node 18+ (лучше 20/22)"
fi

say "Конфигурация панели (.env)"
cd "$PANEL_DIR"
if [ ! -f .env ]; then
  if [ -z "$SERVER_RCON_PASSWORD" ]; then
    SERVER_RCON_PASSWORD="$(openssl rand -hex 16)"
  fi
  cat > .env <<EOF
PANEL_PORT=$PORT
SERVER_DIR=$SERVER_DIR
SERVER_UNIT=$SERVER_UNIT
RCON_HOST=127.0.0.1
RCON_PORT=$SERVER_RCON_PORT
RCON_PASSWORD=$SERVER_RCON_PASSWORD
EOF
  chmod 600 .env
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a
PORT="${PANEL_PORT:-$PORT}"
SERVER_DIR="${SERVER_DIR:-/home/server/nebesny-archiv}"
SERVER_UNIT="${SERVER_UNIT:-nebesny-archiv}"
SERVER_RCON_PORT="${RCON_PORT:-25575}"

say "Каталог данных"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"

if [ ! -f "$DATA_DIR/servers.json" ]; then
  say "Создаю data/servers.json из переменных окружения"
  python3 - "$DATA_DIR/servers.json" "$SERVER_DIR" "$SERVER_UNIT" "$SERVER_RCON_PORT" "${RCON_PASSWORD:-}" <<'PY'
import json
import os
import sys

path, sdir, unit, rcon_port, rcon_password = sys.argv[1:6]
data = {
    "servers": [
        {
            "id": "nebesny-archiv",
            "name": "Небесный Архив",
            "description": "Сюжетная сборка на 1.21.1",
            "icon": "☁",
            "dir": sdir,
            "unit": unit,
            "gamePort": 25565,
            "rconPort": int(rcon_port or 25575),
            "rconPassword": rcon_password,
            "mcVersion": "1.21.1",
            "loader": "NeoForge",
            "memory": {"min": "3G", "max": "4G"},
            "autobackup": {"enabled": False, "everyHours": 6, "keep": 5, "scope": "world"},
        }
    ]
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
os.chmod(path, 0o600)
print("создан", path)
PY
fi
chmod 600 "$DATA_DIR/servers.json" 2>/dev/null || true

say "Зависимости Node"
npm install --omit=dev --no-audit --no-fund

say "Права на файлы панели"
chown -R "$PANEL_USER:$PANEL_USER" "$PANEL_DIR"
chmod 700 "$DATA_DIR"
chmod 600 "$DATA_DIR"/*.json 2>/dev/null || true

say "Включаю RCON в server.properties (для каждого сервера)"
python3 - "$DATA_DIR/servers.json" <<'PY'
import json
import os
import secrets
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    cfg = json.load(f)

servers = cfg.get("servers") or []
changed = False
enabled = 0

for srv in servers:
    pw = str(srv.get("rconPassword") or "")
    if not pw:
        pw = secrets.token_hex(16)
        srv["rconPassword"] = pw
        changed = True
    port = int(srv.get("rconPort") or 25575)
    props = os.path.join(str(srv.get("dir") or ""), "server.properties")
    if not os.path.isfile(props):
        print("  - пропуск (нет server.properties):", props)
        continue

    updates = {
        "enable-rcon": "true",
        "rcon.password": pw,
        "rcon.port": str(port),
        "broadcast-rcon-to-ops": "false",
    }
    with open(props, encoding="utf-8") as f:
        lines = f.read().splitlines()
    seen = set()
    out = []
    for line in lines:
        stripped = line.lstrip()
        if "=" in line and not stripped.startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in updates:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        out.append(line)
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    with open(props, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    enabled += 1
    print("  + RCON:", props)

if changed:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    os.chmod(path, 0o600)

print(f"RCON включён у {enabled} сервер(ов)")
PY
chown "$PANEL_USER:$PANEL_USER" "$DATA_DIR/servers.json"

say "Sudo-правила для панели"
SUDOERS_FILE=/etc/sudoers.d/mcpanel
python3 - "$DATA_DIR/servers.json" "$PANEL_USER" > "$SUDOERS_FILE" <<'PY'
import json
import sys

cfg_path, user = sys.argv[1], sys.argv[2]
try:
    with open(cfg_path, encoding="utf-8") as f:
        servers = json.load(f).get("servers") or []
except Exception:
    servers = []

actions = [
    "start",
    "stop",
    "restart",
    "kill -s SIGKILL",
    "is-active",
    "is-enabled",
    "show -p MainPID --value",
]

# journalctl вызывается панелью ровно с такими наборами аргументов
journal_args = [
    "-f -n 0 --no-pager -o cat",
    "-n 150 --no-pager -o cat",
    "-n 5000 --no-pager -o short-iso",
]

units = []
for srv in servers:
    unit = str(srv.get("unit") or "").strip()
    if unit and unit not in units:
        units.append(unit)

for unit in units:
    cmds = [f"/usr/bin/systemctl {a} {unit}" for a in actions]
    print(f"{user} ALL=(root) NOPASSWD: " + ", ".join(cmds))
    for args in journal_args:
        print(f"{user} ALL=(root) NOPASSWD: /usr/bin/journalctl -u {unit} {args}")

for pattern in ("mc-*", "nebesny-*"):
    cmds = [f"/usr/bin/systemctl {a} {pattern}" for a in actions]
    print(f"{user} ALL=(root) NOPASSWD: " + ", ".join(cmds))
    for args in journal_args:
        print(f"{user} ALL=(root) NOPASSWD: /usr/bin/journalctl -u {pattern} {args}")
PY
chmod 440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null || die "visudo не принял $SUDOERS_FILE"
echo "правила записаны: $SUDOERS_FILE"

say "systemd-служба панели"
if systemctl list-unit-files | grep -q '^nebesny-panel\.service'; then
  warn "останавливаю старую службу nebesny-panel, чтобы не занимала порт"
  systemctl disable --now nebesny-panel >/dev/null 2>&1 || true
fi

cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=MCPanel - панель серверов Minecraft
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$PANEL_USER
WorkingDirectory=$PANEL_DIR
EnvironmentFile=$PANEL_DIR/.env
ExecStart=$NODE_BIN $PANEL_DIR/app.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE"

say "Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -qi active; then
  ufw allow "$PORT"/tcp || true
  echo "ufw: порт $PORT открыт"
else
  echo "ufw не активен — порт $PORT доступен в локальной сети"
fi

sleep 2
systemctl --no-pager --lines=8 status "$SERVICE" || true

IP="$(hostname -I | awk '{print $1}')"
echo
echo "==============================================="
echo " MCPanel — панель серверов"
echo " Открыть:  http://$IP:$PORT"
echo " Пароль:   nebesny2026 (смените в «Настройках»)"
echo " Служба:   $SERVICE"
echo " Логи:     sudo journalctl -u $SERVICE -f"
echo " Серверы:  $DATA_DIR/servers.json"
echo "==============================================="
