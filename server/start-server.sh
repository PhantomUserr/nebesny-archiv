#!/usr/bin/env bash
# Nebesny Archiv - dedicated server bootstrap for Linux.
# Requires Java 21 and NeoForge 21.1.250 installed in this folder.
set -euo pipefail
cd "$(dirname "$0")"

PACK_URL="$(head -n 1 pack-url.txt 2>/dev/null | tr -d '\r\n')"
if [ -z "$PACK_URL" ]; then
  echo "[!] Fill pack-url.txt with the public pack.toml URL first."
  exit 1
fi

JAVA=java
if [ -x jre/bin/java ]; then JAVA=jre/bin/java; fi

echo "[1/3] Checking pack updates..."
"$JAVA" -jar packwiz-installer-bootstrap.jar -g -s server "$PACK_URL"

if [ ! -f "libraries/net/neoforged/neoforge/21.1.250/unix_args.txt" ]; then
  echo "[!] NeoForge 21.1.250 is not installed. Run the installer with --installServer first."
  exit 1
fi

if [ ! -f eula.txt ]; then echo "eula=false" > eula.txt; fi
if ! grep -qi "eula=true" eula.txt; then
  echo "[!] Accept the Minecraft EULA in eula.txt (eula=true)."
  exit 1
fi

echo "[2/3] Starting server on port 25565..."
exec "$JAVA" @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.250/unix_args.txt nogui
